export const INTRO_SEEN_KEY = "observatory-intro-seen";

export interface IntroDeps {
  root: HTMLElement; // #intro overlay container (starts hidden)
  toggle: HTMLElement; // #about-toggle button
  storage: Pick<Storage, "getItem" | "setItem">;
  reducedMotion: boolean; // matchMedia("(prefers-reduced-motion: reduce)").matches
  setTimeoutFn?: typeof setTimeout; // injected for deterministic tests
}

const TITLE = "DROIDKLUSTER FLEET OBSERVATORY";

const LINES = [
  "six autonomous droids run this software project's delivery pipeline — review, CI triage, rework, merge",
  "everything on this board is real observed work; when the fleet is quiet, it replays a real past run, labeled as such",
  "click any droid for its dossier · follow a PR's dot across the journey map",
];

const HOW_ITS_BUILT_BODY =
  "A push-only data diode: the private cluster publishes sanitized events to the edge. No inbound path exists.";

const SOURCE_URL = "https://github.com/syntax922/droidkluster-observatory";

const WRITEUP_URL = "https://blog.droidkluster.com/posts/agent-github-identity/";

const LINE_INTERVAL_MS = 900;

type Mode = "boot" | "panel";

export function initIntro(deps: IntroDeps): void {
  const { root, toggle, storage, reducedMotion } = deps;
  const setTimeoutFn = deps.setTimeoutFn ?? setTimeout;

  let mode: Mode = "boot";
  let previouslyFocused: HTMLElement | null = null;

  const buildLine = (text: string): HTMLParagraphElement => {
    const p = document.createElement("p");
    p.className = "intro-line";
    p.dataset.shown = "false";
    p.textContent = text;
    return p;
  };

  const open = (openMode: Mode): void => {
    mode = openMode;
    previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    root.innerHTML = "";
    root.hidden = false;

    const panel = document.createElement("div");
    panel.className = "intro-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-label", "About this observatory");

    const title = document.createElement("h1");
    title.className = "intro-title";
    title.textContent = TITLE;
    panel.appendChild(title);

    const lineEls = LINES.map(buildLine);
    for (const lineEl of lineEls) panel.appendChild(lineEl);

    if (openMode === "panel") {
      const howHeading = document.createElement("h2");
      howHeading.className = "intro-how-heading";
      howHeading.textContent = "HOW IT'S BUILT";
      panel.appendChild(howHeading);

      const howBody = document.createElement("p");
      howBody.className = "intro-how-body";
      howBody.textContent = HOW_ITS_BUILT_BODY;
      panel.appendChild(howBody);

      const sourceLink = document.createElement("a");
      sourceLink.href = SOURCE_URL;
      sourceLink.textContent = "view the source on GitHub →";
      panel.appendChild(sourceLink);

      const writeupLink = document.createElement("a");
      writeupLink.href = WRITEUP_URL;
      writeupLink.textContent = "why each droid has its own identity →";
      panel.appendChild(writeupLink);
    }

    const enter = document.createElement("button");
    enter.type = "button";
    enter.className = "intro-enter";
    enter.textContent = openMode === "boot" ? "[ enter the observatory ]" : "[ close ]";
    panel.appendChild(enter);

    root.appendChild(panel);

    const showAllInstantly = openMode === "panel" || reducedMotion;
    if (showAllInstantly) {
      for (const lineEl of lineEls) lineEl.dataset.shown = "true";
    } else {
      const firstLine = lineEls[0];
      if (firstLine) firstLine.dataset.shown = "true";
      for (let i = 1; i < lineEls.length; i++) {
        const lineEl = lineEls[i];
        if (!lineEl) continue;
        setTimeoutFn(() => {
          lineEl.dataset.shown = "true";
        }, LINE_INTERVAL_MS * i);
      }
    }

    enter.focus();
  };

  const close = (): void => {
    if (mode === "boot") {
      storage.setItem(INTRO_SEEN_KEY, "1");
    }
    root.hidden = true;
    root.innerHTML = "";
    previouslyFocused?.focus();
    previouslyFocused = null;
  };

  root.addEventListener("click", (event) => {
    if (root.hidden) return;
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target === root || target.closest(".intro-enter")) {
      close();
    }
  });

  root.addEventListener("keydown", (event) => {
    if (root.hidden) return;

    if (event.key === "Escape") {
      close();
      return;
    }

    if (event.key === " ") {
      const target = event.target;
      const tag = target instanceof HTMLElement ? target.tagName : "";
      if (tag !== "A" && tag !== "BUTTON") {
        close();
      }
      return;
    }

    if (event.key === "Tab") {
      const focusable = Array.from(root.querySelectorAll<HTMLElement>("button, a[href]"));
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      const active = document.activeElement;
      if (event.shiftKey) {
        if (active === first || !(active instanceof HTMLElement) || !root.contains(active)) {
          event.preventDefault();
          last.focus();
        }
      } else if (active === last || !(active instanceof HTMLElement) || !root.contains(active)) {
        event.preventDefault();
        first.focus();
      }
    }
  });

  toggle.addEventListener("click", () => open("panel"));

  if (storage.getItem(INTRO_SEEN_KEY) === null) {
    open("boot");
  }
}
