import type { FleetState } from "@observatory/core";
import type { PublicEvent } from "@observatory/core";
import type { EdgeWriter } from "./edge.js";

export async function maybeCaptureChain(
  _state: FleetState,
  _emitted: PublicEvent[],
  _writer: EdgeWriter,
  _log: (msg: string, extra?: object) => void,
): Promise<void> {
  // Implemented in Task 8 (chain auto-capture).
}
