import type { DroidId } from "@observatory/core";

export interface DroidInfo {
  name: string;
  role: string;
  model: string;
  doctrine: string[];
}

export const DROID_REGISTRY: Record<DroidId, DroidInfo> = {
  "hk-47": {
    name: "HK-47",
    role: "Code reviewer",
    model: "Claude Sonnet",
    doctrine: [
      "Reviews every agent PR: two-pass find-then-deepen with whole-file grounding.",
      "Blocks on any finding — findings > 0 forces CHANGES_REQUESTED, enforced by the poster, not promised by the model.",
      "Every finding cites an authoritative principle from the project doctrine manifest.",
    ],
  },
  "2-1b": {
    name: "2-1B",
    role: "CI surgeon",
    model: "Claude Sonnet",
    doctrine: [
      "Diagnoses every CI failure with a cited root cause, not a retry button.",
      "Drives the implementing agent to the fix via the agent-tasks API, deduped per head commit.",
    ],
  },
  "tt-8l": {
    name: "TT-8L",
    role: "Merge gatekeeper",
    model: "deterministic + LLM-assisted",
    doctrine: [
      "Re-validates fresh repository state at merge time; fails closed on any drift.",
      "Sensitive paths always require a human regardless of automation state.",
    ],
  },
  "ev-9d9": {
    name: "EV-9D9",
    role: "Cluster operator",
    model: "Claude Sonnet",
    doctrine: ["Translates operator intent into bounded, audited cluster actions."],
  },
  r5: {
    name: "R5",
    role: "Dispatch & rework routing",
    model: "deterministic + LLM-assisted",
    doctrine: [
      "Routes approved issues to the implementing agent and reworks PRs when review requests changes.",
      "Renders only observed events — coder failures publish nothing, so R5 never claims a state it cannot see.",
    ],
  },
  copilot: {
    name: "Copilot",
    role: "Implementing agent (guest)",
    model: "GitHub Copilot coding agent",
    doctrine: ["Implements changes under review by the resident fleet; never merges its own work."],
  },
};
