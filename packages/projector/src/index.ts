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

  const jsm = await nc.jetstreamManager();
  // Read-only observer: ephemeral-per-boot is acceptable (missing events only
  // degrade the showcase). deliver_policy: new — never replays the backlog.
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
}

if (process.argv[1]) {
  void main().catch((err) => {
    console.error("observatory-projector failed to start", err);
    process.exit(1);
  });
}
