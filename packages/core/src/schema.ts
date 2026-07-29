import { z } from "zod";

export const DroidIdSchema = z.enum(["hk-47", "2-1b", "tt-8l", "ev-9d9", "r5", "copilot"]);
export type DroidId = z.infer<typeof DroidIdSchema>;

export const PublicEventKindSchema = z.enum([
  "pr_opened",
  "review_requested",
  "review_started",
  "review_posted",
  "check_run",
  "copilot_session_started",
  "copilot_session_ended",
  "merge_decision",
  "pr_merged",
  "pr_closed",
  "issue_dispatched",
  "coder_completed",
  "rework_started",
  "merge_queued",
  "merge_executed",
]);
export type PublicEventKind = z.infer<typeof PublicEventKindSchema>;

// .strict() everywhere: an extra field is a schema violation, not a passthrough.
export const PublicEventSchema = z
  .object({
    id: z.string().min(1),
    at: z.string().datetime({ offset: true }).or(z.string().datetime()),
    droid: DroidIdSchema.or(z.literal("system")),
    kind: PublicEventKindSchema,
    pr: z.number().int().positive().optional(),
    issue: z.number().int().positive().optional(),
    summary: z.string().min(1).max(200),
    excerpt: z.string().max(600).optional(),
    duration_s: z.number().nonnegative().optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.pr === undefined && v.issue === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "event requires pr or issue",
      });
    }
  });
export type PublicEvent = z.infer<typeof PublicEventSchema>;

export const DroidStatusSchema = z
  .object({
    droid: DroidIdSchema,
    state: z.enum(["idle", "active"]),
    task: z.string().max(120).optional(),
    since: z.string().optional(),
    last_action: z.string().max(200).optional(),
    last_action_at: z.string().optional(),
  })
  .strict();
export type DroidStatus = z.infer<typeof DroidStatusSchema>;

export const ChainHopSchema = z
  .object({
    at: z.string(),
    droid: DroidIdSchema.or(z.literal("system")),
    kind: PublicEventKindSchema,
    label: z.string().max(120),
  })
  .strict();
export type ChainHop = z.infer<typeof ChainHopSchema>;

export const ChainSchema = z
  .object({
    pr: z.number().int().positive(),
    hops: z.array(ChainHopSchema).max(200),
    updated_at: z.string(),
    active: z.boolean(),
    complete: z.boolean(),
  })
  .strict();
export type Chain = z.infer<typeof ChainSchema>;

export const CurrentSnapshotSchema = z
  .object({
    generated_at: z.string(),
    last_contact: z.string(),
    droids: z.array(DroidStatusSchema),
    chains: z.array(ChainSchema).max(20),
  })
  .strict();
export type CurrentSnapshot = z.infer<typeof CurrentSnapshotSchema>;

export const ReplayBundleSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    title: z.string().max(120),
    captured_on: z.string(),
    pr: z.number().int().positive(),
    events: z.array(PublicEventSchema).min(1).max(500),
  })
  .strict();
export type ReplayBundle = z.infer<typeof ReplayBundleSchema>;

export const ReplayIndexSchema = z
  .object({
    replays: z.array(
      z
        .object({
          id: z.string(),
          title: z.string(),
          date: z.string(),
          summary: z.string().max(300),
        })
        .strict(),
    ),
  })
  .strict();
export type ReplayIndex = z.infer<typeof ReplayIndexSchema>;
