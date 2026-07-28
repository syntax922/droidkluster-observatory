import { beforeEach, describe, expect, it, vi } from "vitest";
import { INTRO_SEEN_KEY, initIntro } from "./intro.js";

function makeDom(): { root: HTMLElement; toggle: HTMLElement } {
  document.body.innerHTML = '<button id="about-toggle"></button><div id="intro" hidden></div>';
  return {
    root: document.querySelector("#intro") as HTMLElement,
    toggle: document.querySelector("#about-toggle") as HTMLElement,
  };
}

function memStorage(seed?: Record<string, string>): Pick<Storage, "getItem" | "setItem"> {
  const m = new Map(Object.entries(seed ?? {}));
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
  };
}

describe("intro gating", () => {
  it("opens boot mode on first visit", () => {
    const { root, toggle } = makeDom();
    initIntro({ root, toggle, storage: memStorage(), reducedMotion: true });
    expect(root.hidden).toBe(false);
    expect(root.querySelector("[role=dialog]")).toBeTruthy();
    expect(root.textContent).toContain("DROIDKLUSTER FLEET OBSERVATORY");
  });

  it("stays closed for a returning visitor", () => {
    const { root, toggle } = makeDom();
    initIntro({
      root,
      toggle,
      storage: memStorage({ [INTRO_SEEN_KEY]: "1" }),
      reducedMotion: true,
    });
    expect(root.hidden).toBe(true);
  });

  it("boot dismissal sets the seen flag exactly once", () => {
    const { root, toggle } = makeDom();
    const storage = memStorage();
    const spy = vi.spyOn(storage, "setItem");
    initIntro({ root, toggle, storage, reducedMotion: true });
    (root.querySelector(".intro-enter") as HTMLElement).click();
    expect(root.hidden).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(storage.getItem(INTRO_SEEN_KEY)).toBe("1");
  });
});

describe("typing sequence", () => {
  it("reveals lines on the injected clock", () => {
    const { root, toggle } = makeDom();
    const pending: Array<() => void> = [];
    const fakeTimeout = ((fn: () => void) => {
      pending.push(fn);
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout;
    initIntro({
      root,
      toggle,
      storage: memStorage(),
      reducedMotion: false,
      setTimeoutFn: fakeTimeout,
    });
    const shown = () => root.querySelectorAll('.intro-line[data-shown="true"]').length;
    expect(shown()).toBe(1); // first line immediate
    pending.shift()?.();
    expect(shown()).toBe(2);
    pending.shift()?.();
    expect(shown()).toBe(3);
  });

  it("reduced motion shows everything at once with no timers", () => {
    const { root, toggle } = makeDom();
    const fakeTimeout = vi.fn() as unknown as typeof setTimeout;
    initIntro({
      root,
      toggle,
      storage: memStorage(),
      reducedMotion: true,
      setTimeoutFn: fakeTimeout,
    });
    expect(root.querySelectorAll('.intro-line[data-shown="true"]').length).toBe(3);
    expect(fakeTimeout).not.toHaveBeenCalled();
  });
});

describe("panel mode", () => {
  it("opens via toggle with extras, without touching the seen flag", () => {
    const { root, toggle } = makeDom();
    const storage = memStorage({ [INTRO_SEEN_KEY]: "1" });
    const spy = vi.spyOn(storage, "setItem");
    initIntro({ root, toggle, storage, reducedMotion: true });
    toggle.click();
    expect(root.hidden).toBe(false);
    expect(root.textContent).toContain("HOW IT'S BUILT");
    const a = root.querySelector("a") as HTMLAnchorElement;
    expect(a.href).toBe("https://github.com/syntax922/droidkluster-observatory");
    (root.querySelector(".intro-enter") as HTMLElement).click();
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("dismissal & focus", () => {
  it("Escape closes and focus returns to the invoker", () => {
    const { root, toggle } = makeDom();
    initIntro({
      root,
      toggle,
      storage: memStorage({ [INTRO_SEEN_KEY]: "1" }),
      reducedMotion: true,
    });
    toggle.focus();
    toggle.click();
    expect(document.activeElement).toBe(root.querySelector(".intro-enter"));
    root.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(root.hidden).toBe(true);
    expect(document.activeElement).toBe(toggle);
  });

  it("Space closes unless focus is on a link", () => {
    const { root, toggle } = makeDom();
    initIntro({
      root,
      toggle,
      storage: memStorage({ [INTRO_SEEN_KEY]: "1" }),
      reducedMotion: true,
    });
    toggle.click();
    const a = root.querySelector("a") as HTMLElement;
    a.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    expect(root.hidden).toBe(false);
    root.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    expect(root.hidden).toBe(true);
  });

  it("backdrop click closes; inner panel click does not", () => {
    const { root, toggle } = makeDom();
    initIntro({
      root,
      toggle,
      storage: memStorage({ [INTRO_SEEN_KEY]: "1" }),
      reducedMotion: true,
    });
    toggle.click();
    (root.querySelector("[role=dialog]") as HTMLElement).click();
    expect(root.hidden).toBe(false);
    root.click();
    expect(root.hidden).toBe(true);
  });
});
