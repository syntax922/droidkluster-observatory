import type { FleetState, PublicEvent } from "@observatory/core";
import { ReplayBundleSchema } from "@observatory/core";
import type { EdgeWriter } from "./edge.js";

export async function maybeCaptureChain(
  state: FleetState,
  emitted: PublicEvent[],
  writer: EdgeWriter,
  log: (msg: string, extra?: object) => void,
): Promise<void> {
  for (const e of emitted) {
    if (e.kind !== "pr_merged" && e.kind !== "pr_closed") continue;
    const chain = state.chains.get(e.pr);
    if (!chain || chain.events.length === 0) continue;
    const date = e.at.slice(0, 10);
    const id = `pr-${e.pr}-${date}`;
    const bundle = ReplayBundleSchema.parse({
      id,
      title: `PR #${e.pr} lifecycle`,
      captured_on: date,
      pr: e.pr,
      events: chain.events,
    });
    try {
      await writer.putJson(`chains/${id}.json`, bundle, 3600);
      chain.events = [];
      log("chain captured", { id, events: bundle.events.length });
    } catch (err) {
      log("chain capture failed", { id, err: err instanceof Error ? err.message : String(err) });
    }
  }
}
