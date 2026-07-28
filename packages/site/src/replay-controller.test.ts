import type { CurrentSnapshot, PublicEvent, ReplayBundle, ReplayIndex } from "@observatory/core";
import { describe, expect, it, vi } from "vitest";
import type { ReplayControllerPlayer } from "./replay-controller.js";
import { createReplayController } from "./replay-controller.js";

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function bundle(id: string): ReplayBundle {
  return {
    id,
    title: `title-${id}`,
    captured_on: "2026-07-25",
    pr: 1,
    events: [
      {
        id: "e1",
        at: "2026-07-25T00:00:00Z",
        droid: "system",
        kind: "pr_opened",
        pr: 1,
        summary: "x",
      },
    ],
  };
}

function fakePlayer(): ReplayControllerPlayer {
  return { start: vi.fn<() => void>(), stop: vi.fn<() => void>() };
}

describe("createReplayController", () => {
  it("no index / empty index calls onIdle, never starts a player", async () => {
    const onIdle = vi.fn();
    const makePlayer = vi.fn();
    const controller = createReplayController({
      fetchIndex: () => Promise.resolve<ReplayIndex | null>({ replays: [] }),
      fetchBundle: () => Promise.resolve<ReplayBundle | null>(null),
      makePlayer,
      onFrame: vi.fn(),
      onIdle,
    });

    await controller.enter("2026-07-25T13:00:00Z");

    expect(onIdle).toHaveBeenCalledWith("2026-07-25T13:00:00Z");
    expect(makePlayer).not.toHaveBeenCalled();
    expect(controller.isActive()).toBe(false);
  });

  it("unfetchable index (null) also calls onIdle, never starts a player", async () => {
    const onIdle = vi.fn();
    const makePlayer = vi.fn();
    const controller = createReplayController({
      fetchIndex: () => Promise.resolve<ReplayIndex | null>(null),
      fetchBundle: () => Promise.resolve<ReplayBundle | null>(null),
      makePlayer,
      onFrame: vi.fn(),
      onIdle,
    });

    await controller.enter("2026-07-25T13:00:00Z");

    expect(onIdle).toHaveBeenCalledWith("2026-07-25T13:00:00Z");
    expect(makePlayer).not.toHaveBeenCalled();
  });

  it("two concurrent enter() calls while fetchIndex is pending start exactly one player", async () => {
    const indexDeferred = deferred<ReplayIndex | null>();
    const player = fakePlayer();
    const makePlayer = vi.fn().mockReturnValue(player);
    const controller = createReplayController({
      fetchIndex: () => indexDeferred.promise,
      fetchBundle: () => Promise.resolve<ReplayBundle | null>(bundle("a")),
      makePlayer,
      onFrame: vi.fn(),
      onIdle: vi.fn(),
    });

    const first = controller.enter("2026-07-25T13:00:00Z");
    const second = controller.enter("2026-07-25T13:00:00Z"); // fires while fetchIndex is still pending

    indexDeferred.resolve({ replays: [{ id: "a", title: "t", date: "2026-07-25", summary: "s" }] });
    await Promise.all([first, second]);

    expect(makePlayer).toHaveBeenCalledTimes(1);
    expect(player.start).toHaveBeenCalledTimes(1);
  });

  it("exit() during the bundle-fetch await prevents start() (epoch check)", async () => {
    const bundleDeferred = deferred<ReplayBundle | null>();
    const player = fakePlayer();
    const makePlayer = vi.fn().mockReturnValue(player);
    const controller = createReplayController({
      fetchIndex: () =>
        Promise.resolve<ReplayIndex | null>({
          replays: [{ id: "a", title: "t", date: "2026-07-25", summary: "s" }],
        }),
      fetchBundle: () => bundleDeferred.promise,
      makePlayer,
      onFrame: vi.fn(),
      onIdle: vi.fn(),
    });

    const entering = controller.enter("2026-07-25T13:00:00Z");
    // Let the index-fetch microtask settle so enter() reaches the bundle await.
    await Promise.resolve();
    await Promise.resolve();
    controller.exit();
    bundleDeferred.resolve(bundle("a"));
    await entering;

    expect(makePlayer).not.toHaveBeenCalled();
    expect(player.start).not.toHaveBeenCalled();
    expect(controller.isActive()).toBe(false);
  });

  it("rotation: successive enter/exit cycles pick successive ids, wrapping", async () => {
    const ids = ["a", "b"];
    const fetchBundle = vi.fn((id: string) => Promise.resolve<ReplayBundle | null>(bundle(id)));
    const players: ReturnType<typeof fakePlayer>[] = [];
    const makePlayer = vi.fn(() => {
      const p = fakePlayer();
      players.push(p);
      return p;
    });
    const controller = createReplayController({
      fetchIndex: () =>
        Promise.resolve<ReplayIndex | null>({
          replays: ids.map((id) => ({ id, title: id, date: "2026-07-25", summary: id })),
        }),
      fetchBundle,
      makePlayer,
      onFrame: vi.fn(),
      onIdle: vi.fn(),
    });

    await controller.enter("2026-07-25T13:00:00Z");
    controller.exit();
    await controller.enter("2026-07-25T13:00:00Z");
    controller.exit();
    await controller.enter("2026-07-25T13:00:00Z"); // wraps back to the first id

    expect(fetchBundle.mock.calls.map((c) => c[0])).toEqual(["a", "b", "a"]);
    expect(players).toHaveLength(3);
  });

  it("enter() is a no-op while a player is already active", async () => {
    const player = fakePlayer();
    const makePlayer = vi.fn().mockReturnValue(player);
    const fetchIndex = vi.fn(() =>
      Promise.resolve<ReplayIndex | null>({
        replays: [{ id: "a", title: "t", date: "2026-07-25", summary: "s" }],
      }),
    );
    const controller = createReplayController({
      fetchIndex,
      fetchBundle: () => Promise.resolve<ReplayBundle | null>(bundle("a")),
      makePlayer,
      onFrame: vi.fn(),
      onIdle: vi.fn(),
    });

    await controller.enter("2026-07-25T13:00:00Z");
    await controller.enter("2026-07-25T13:00:00Z"); // player still active: no-op

    expect(makePlayer).toHaveBeenCalledTimes(1);
    expect(controller.isActive()).toBe(true);
  });

  it("onDone from the player clears the active player so the next enter() advances", async () => {
    let doneCb: (() => void) | undefined;
    const player = fakePlayer();
    const makePlayer = vi.fn(
      (
        _b: ReplayBundle,
        opts: {
          onFrame: (snap: CurrentSnapshot, feed: PublicEvent[], label: string) => void;
          onDone: () => void;
        },
      ) => {
        doneCb = opts.onDone;
        return player;
      },
    );
    const controller = createReplayController({
      fetchIndex: () =>
        Promise.resolve<ReplayIndex | null>({
          replays: [{ id: "a", title: "t", date: "2026-07-25", summary: "s" }],
        }),
      fetchBundle: () => Promise.resolve<ReplayBundle | null>(bundle("a")),
      makePlayer,
      onFrame: vi.fn(),
      onIdle: vi.fn(),
    });

    await controller.enter("2026-07-25T13:00:00Z");
    expect(controller.isActive()).toBe(true);
    doneCb?.();
    expect(controller.isActive()).toBe(false);

    await controller.enter("2026-07-25T13:00:00Z");
    expect(makePlayer).toHaveBeenCalledTimes(2);
  });
});
