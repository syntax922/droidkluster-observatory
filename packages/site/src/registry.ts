import type { DroidId } from "@observatory/core";

export interface DroidSpec {
  revised: string;
  observes: string[];
  upholds: string[];
  emits: string[];
  forbidden: string[];
  escalates: string[];
}

export interface DroidInfo {
  name: string;
  role: string;
  model: string;
  doctrine: string[];
  specification: DroidSpec;
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
    specification: {
      revised: "2026-07-26",
      observes: [
        "Full PR diff with whole-file context",
        "Linked issues and stated scope",
        "The project doctrine manifest it must cite from",
      ],
      upholds: [
        "Every finding cites an authoritative principle",
        "findings > 0 forces CHANGES_REQUESTED — enforced by the posting layer, not promised by the model",
        "Re-review requires the author to triage every prior finding first",
      ],
      emits: [
        "Structured findings (file, line, severity, cited principle)",
        "A single verdict per review head",
      ],
      forbidden: [
        "Approving with open findings",
        "Reviewing draft or mid-session PRs",
        "Inventing principles not in the manifest",
      ],
      escalates: [
        "Sensitive paths (workflows, migrations, auth) always require a human regardless of verdict",
      ],
    },
  },
  "2-1b": {
    name: "2-1B",
    role: "CI surgeon",
    model: "Claude Sonnet",
    doctrine: [
      "Diagnoses every CI failure with a cited root cause, not a retry button.",
      "Drives the implementing agent to the fix via the agent-tasks API, deduped per head commit.",
    ],
    specification: {
      revised: "2026-07-26",
      observes: [
        "Failed check suites and workflow runs on PR heads",
        "Test logs and failure output",
      ],
      upholds: [
        "Every diagnosis names a root cause with a citation, never just a retry",
        "One diagnosis per (PR, head commit) — deduplicated",
      ],
      emits: [
        "A cited diagnosis comment to the PR author",
        "A driving task to the implementing agent",
      ],
      forbidden: ["Pushing code", "Re-running workflows to mask flakes"],
      escalates: ["Repeated identical failures after a driven fix attempt"],
    },
  },
  "tt-8l": {
    name: "TT-8L",
    role: "Merge gatekeeper",
    model: "deterministic + LLM-assisted",
    doctrine: [
      "Re-validates fresh repository state at merge time; fails closed on any drift.",
      "Sensitive paths always require a human regardless of automation state.",
    ],
    specification: {
      revised: "2026-07-26",
      observes: [
        "Merge-decision events with the full review verdict trail",
        "Fresh repository state re-read at merge time",
      ],
      upholds: [
        "Seven fresh reads re-validated at merge time; fails closed on any drift",
        "Dormant unless explicitly opted in per-PR",
      ],
      emits: ["Merge execution or a refusal with the exact drift found"],
      forbidden: ["Merging gated paths without human review", "Acting on stale state"],
      escalates: ["Any validation drift aborts and reports rather than retrying"],
    },
  },
  "ev-9d9": {
    name: "EV-9D9",
    role: "Cluster operator",
    model: "Claude Sonnet",
    doctrine: ["Translates operator intent into bounded, audited cluster actions."],
    specification: {
      revised: "2026-07-26",
      observes: ["Operator intents from chat surfaces", "Cluster read-state for grounding"],
      upholds: [
        "Mutations require explicit confirmation flows",
        "Every action is audited with its triggering intent",
      ],
      emits: ["Bounded, audited cluster operations", "Observation reports"],
      forbidden: ["Unconfirmed mutations", "Secret material in any reply"],
      escalates: ["Anything outside its allowlisted operation set"],
    },
  },
  r5: {
    name: "R5",
    role: "Dispatch & rework routing",
    model: "deterministic + LLM-assisted",
    doctrine: [
      "Routes approved issues to the implementing agent and reworks PRs when review requests changes.",
      "Renders only observed events — coder failures publish nothing, so R5 never claims a state it cannot see.",
    ],
    specification: {
      revised: "2026-07-26",
      observes: ["Approved issues labeled for dispatch", "Review verdicts requiring rework"],
      upholds: [
        "One command per dispatch with end-to-end correlation ids",
        "Renders only observed events — never claims a state it cannot see",
      ],
      emits: ["Coder dispatch commands", "Completion events linking issues to the PRs they opened"],
      forbidden: [
        "Dispatching unapproved work",
        "Retrying failed sessions without a fresh command",
      ],
      escalates: [
        "Sessions that end without a completion event surface as honest idle, for human follow-up",
      ],
    },
  },
  copilot: {
    name: "Copilot",
    role: "Implementing agent (guest)",
    model: "GitHub Copilot coding agent",
    doctrine: ["Implements changes under review by the resident fleet; never merges its own work."],
    specification: {
      revised: "2026-07-26",
      observes: [
        "Dispatched tasks with issue or rework context",
        "Repository state on its working branch",
      ],
      upholds: [
        "Works only under review by the resident fleet",
        "Must triage every review finding before pushing fixes",
      ],
      emits: ["Branches and PRs; session lifecycle events"],
      forbidden: ["Merging its own work", "Touching gated paths"],
      escalates: ["Quota or session failures surface to the fleet, not silently retried"],
    },
  },
};
