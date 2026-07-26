import { readFileSync } from "node:fs";
import {
  type CanonEnvelope,
  type PublicEvent,
  emptyFleetState,
  reduce,
  toSnapshot,
} from "@observatory/core";
import { AckPolicy, DeliverPolicy, connect, nkeyAuthenticator } from "nats";
import { maybeCaptureChain } from "./capture.js";
import { readConfig } from "./config.js";
import { EdgeWriter } from "./edge.js";
import { startPushLoop } from "./push-loop.js";

function log(msg: string, extra?: object): void {
  console.log(JSON.stringify({ ts: new Date().toISOString(), msg, ...extra }));
}

export async function main(): Promise<void> {
  const cfg = readConfig(process.env);
  const state = emptyFleetState();
  const feedByDay = new Map<string, PublicEvent[]>();

  const writer = new EdgeWriter(cfg.r2);
  // Tracks live NATS connection health so the heartbeat can skip pushing a
  // last_contact that would otherwise lie about freshness while we're
  // disconnected/erroring — see the status watcher spawned after connect().
  let natsHealthy = true;
  const loop = startPushLoop({
    enabled: cfg.pushEnabled,
    writer,
    getSnapshot: () => toSnapshot(state, new Date()),
    getFeedDay: () => {
      const day = new Date().toISOString().slice(0, 10);
      return { key: `feed/${day}.json`, events: feedByDay.get(day) ?? [] };
    },
    debounceMs: cfg.debounceMs,
    heartbeatMs: cfg.heartbeatMs,
    isHealthy: () => natsHealthy,
    log,
  });

  const auth = cfg.natsNkeySeedFile
    ? nkeyAuthenticator(new TextEncoder().encode(readFileSync(cfg.natsNkeySeedFile, "utf8").trim()))
    : undefined;
  const nc = await connect({
    servers: cfg.natsServers,
    ...(auth ? { authenticator: auth } : {}),
    ...(cfg.natsCaFile ? { tls: { caFile: cfg.natsCaFile } } : {}),
    name: "observatory-projector",
    maxReconnectAttempts: -1,
  });
  log("connected", { servers: cfg.natsServers });

  // Mark unhealthy on disconnect/async-error, healthy again on reconnect.
  // Only these two transitions matter for last_contact honesty; other
  // status events (ldm, update, debug reconnecting/pingTimer/etc.) don't
  // change whether the connection can currently deliver messages.
  void (async () => {
    for await (const s of nc.status()) {
      if (s.type === "disconnect" || s.type === "error") {
        natsHealthy = false;
        log("nats unhealthy", { type: s.type });
      } else if (s.type === "reconnect") {
        natsHealthy = true;
        log("nats healthy", { type: s.type });
      }
    }
  })();

  const jsm = await nc.jetstreamManager();
  // Durable consumer with deliver_policy: new — first boot starts from "now" (no backlog
  // replay); restarts resume from the durable's position.
  // NOTE: jsm.consumers.add() with a changed config (e.g. new NATS_FILTER_SUBJECTS) on the
  // same durable name is rejected by the server — bump NATS_DURABLE or delete the old
  // consumer when changing filters.
  await jsm.consumers.add(cfg.natsStream, {
    durable_name: cfg.natsDurable,
    ack_policy: AckPolicy.Explicit,
    deliver_policy: DeliverPolicy.New,
    filter_subjects: cfg.filterSubjects,
  });
  const consumer = await nc.jetstream().consumers.get(cfg.natsStream, cfg.natsDurable);

  const messages = await consumer.consume();
  for await (const m of messages) {
    try {
      const parsed: unknown = JSON.parse(new TextDecoder().decode(m.data));
      const envObj = parsed as Partial<CanonEnvelope> & Record<string, unknown>;
      if (
        envObj.kind === "event" &&
        typeof envObj.subject === "string" &&
        typeof envObj.id === "string"
      ) {
        const env: CanonEnvelope = {
          kind: "event",
          id: envObj.id,
          subject: envObj.subject,
          ...(typeof envObj.ts === "string" ? { ts: envObj.ts } : {}),
          payload: envObj.payload,
        };
        const { emitted } = reduce(state, env);
        if (emitted.length > 0) {
          const day = new Date().toISOString().slice(0, 10);
          const dayFeed = feedByDay.get(day) ?? [];
          dayFeed.push(...emitted);
          feedByDay.set(day, dayFeed.slice(-500));
          for (const k of [...feedByDay.keys()]) if (k !== day) feedByDay.delete(k);
          loop.markDirty();
          await maybeCaptureChain(state, emitted, writer, log);
        }
      }
    } catch (err) {
      log("envelope handling failed; skipping", {
        err: err instanceof Error ? err.message : String(err),
      });
    } finally {
      m.ack();
    }
  }

  // The consume() iterator only ends when the consumer or stream was
  // deleted server-side, or the connection closed permanently — either way
  // this process can no longer receive events and must not keep
  // heartbeating a healthy-looking last_contact while deaf. Stop the push
  // loop and throw so the process exits non-zero and the pod restarts.
  loop.stop();
  throw new Error(
    "NATS consume iterator ended — consumer/stream deleted or connection closed; exiting for restart",
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main().catch((err) => {
    console.error("observatory-projector failed to start", err);
    process.exit(1);
  });
}
