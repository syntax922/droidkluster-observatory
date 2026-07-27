import type { CurrentSnapshot, PublicEvent, ReplayBundle, ReplayIndex } from "@observatory/core";

export interface ReplayControllerPlayer {
  start(): void;
  stop(): void;
}

export interface ReplayPlayerOpts {
  onFrame: (snap: CurrentSnapshot, feed: PublicEvent[], label: string) => void;
  onDone: () => void;
}

export interface ReplayControllerDeps {
  fetchIndex: () => Promise<ReplayIndex | null>;
  fetchBundle: (id: string) => Promise<ReplayBundle | null>;
  makePlayer: (bundle: ReplayBundle, opts: ReplayPlayerOpts) => ReplayControllerPlayer;
  onFrame: (snap: CurrentSnapshot, feed: PublicEvent[], label: string) => void;
  onIdle: (lastContact: string) => void;
}

export interface ReplayController {
  enter(lastContact: string): Promise<void>;
  exit(): void;
  isActive(): boolean;
}

// Owns replay-session lifecycle so main.ts's polling tick can call enter()/exit()
// without racing itself: concurrent enter() calls collapse to one in-flight
// fetch chain (the `entering` latch, set synchronously before the first await),
// and exit() bumps an epoch counter so any enter() still awaiting a fetch
// abandons instead of starting a player against stale intent.
export function createReplayController(deps: ReplayControllerDeps): ReplayController {
  let player: ReplayControllerPlayer | null = null;
  let entering = false;
  let epoch = 0;
  let ids: string[] = [];
  let cursor = 0;

  function exit(): void {
    epoch += 1;
    player?.stop();
    player = null;
  }

  function isActive(): boolean {
    return player !== null;
  }

  async function enter(lastContact: string): Promise<void> {
    if (player || entering) return; // already replaying, or an enter() is already in flight
    entering = true;
    const myEpoch = epoch;
    try {
      if (ids.length === 0) {
        const index = await deps.fetchIndex();
        if (myEpoch !== epoch) return; // exited while the index fetch was in flight: abandon
        ids = index?.replays.map((r) => r.id) ?? [];
      }
      const id = ids[cursor % Math.max(1, ids.length)];
      if (!id) {
        deps.onIdle(lastContact); // no curated replays exist: say so, never leave stale render standing
        return;
      }
      cursor += 1;

      const bundle = await deps.fetchBundle(id);
      if (myEpoch !== epoch) return; // exited while the bundle fetch was in flight: abandon
      if (!bundle) {
        deps.onIdle(lastContact); // bundle fetch failed: same honest-idle path
        return;
      }

      const newPlayer = deps.makePlayer(bundle, {
        onFrame: deps.onFrame,
        onDone: () => {
          if (player === newPlayer) player = null; // next enter() picks the next bundle
        },
      });
      player = newPlayer;
      player.start();
    } finally {
      entering = false;
    }
  }

  return { enter, exit, isActive };
}
