# Threat model — droidkluster fleet observatory

This document covers the observatory's own attack surface: the projector
process, the edge data store, and the public site. It does not cover the
private droidkluster cluster's internal security posture — that lives in
the private `private-worker-repo` / the-gitops-repo repos and is out of scope
here by design (see [Trust zones](#trust-zones)).

## Assets

What's actually at risk if something in this system goes wrong:

- **Private repository content.** `private-worker-repo` (worker
  source, review/CI-diagnosis logic, NATS subject wiring in full) and the
  the-gitops-repo GitOps repo (cluster manifests, secret references) are private.
  Nothing in this system is meant to expose their contents beyond what the
  observatory intentionally re-publishes as sanitized events.
- **Cluster credentials.** NATS auth material (nkey seeds), the GitHub App
  installation tokens brokered by `gh-app-mint`, and any other
  cluster-internal service credentials. None of these should ever reach a
  system outside the private cluster.
- **Internal topology.** Hostnames, IPs, internal domain suffixes
  (`*.internal`, `*.droidkluster.com` internal hosts), filesystem paths on
  cluster hosts, and NATS subject hierarchies. Some topology detail (NATS
  subject *names*, not values) is a deliberately accepted exposure — see
  [Residual risks](#residual-risks).

## Trust zones

Three zones, one hard boundary:

```
┌─────────────────────────┐        ┌──────────────────┐      ┌──────────────────┐
│  Zone 1: private cluster │        │ Zone 2: edge store │      │ Zone 3: visitor  │
│  NATS bus, projector,    │──push─▶│ Cloudflare R2      │◀────│ browser          │
│  credential brokering    │  HTTPS │ (public JSON)      │reads│ static site      │
│  (gh-app-mint, secrets)  │outbound│                     │     │                  │
└─────────────────────────┘        └──────────────────┘      └──────────────────┘
            ▲
            └── the diode: outbound HTTPS PUT only, no listener, no inbound path
```

**Zone 1 → Zone 2 is a diode**, not a tunnel. The projector opens outbound
HTTPS connections to Cloudflare R2 to write sanitized artifacts; it does
not listen on any port, does not accept inbound connections, and exposes
no API. There is no request/response path from Zone 2 or Zone 3 back into
Zone 1 — not "authenticated and restricted," but structurally absent. An
attacker who fully controls Zone 2 or Zone 3 has no protocol-level way to
reach Zone 1.

Zone 2 → Zone 3 is a normal public read: the site polls `current.json` and
related artifacts over HTTPS with no authentication, because everything in
the bucket is already meant to be public.

## Why apps get tunnels, but the control plane gets a diode

The droidkluster fleet already runs app-tier services (e.g.
eldenringlore) behind a Cloudflare Tunnel: a request terminates inside the
cluster, the app pod handles it, and a response goes back out. That's an
acceptable shape for an app pod that owns none of the cluster's
credentials.

The observatory's upstream is different in kind, not just in size: it
consumes the **same NATS event bus** that carries reviewer dispatch,
CI-doctor diagnosis, and merge-decision traffic — the bus adjacent to
`gh-app-mint`'s credential-brokering request/reply subjects. A listener on
that bus, even one scoped to a narrow subject filter, is an inbound path
into infrastructure that is one hop from live credential material. That is
a different risk class from a stateless app pod, and it gets the stricter
control: no listener at all. The projector reads from NATS as a consumer
(pull, not exposed) and only ever *pushes* outward to the edge. Nothing on
the public side of the boundary can cause the projector to do anything.

## What an attacker gains at each compromise point

| Compromise point | What it's worth |
|---|---|
| **R2 edge-store API token** (bucket-scoped, Object Read & Write on `observatory` only) | Write access to data that is *already public* — an attacker could fabricate droid states, forge feed events, or delete replay bundles in that one bucket. No path to NATS, no path into the cluster, no credential material beyond this single bucket's contents. Recoverable by rotating the token and re-pushing from the projector's live state. |
| **Cloudflare Pages / the static site** | Defacement — the ability to serve arbitrary JS to visitor browsers. The site holds no credentials, makes only unauthenticated `GET`s, and has no write path back to the bucket or the cluster. Worst case is a malicious page, not a foothold anywhere else. Droid specifications are deliberately abstracted (verbatim prompts withheld, preventing drift liability and adversarial reconnaissance). The blast radius of a defacement is further bounded by `packages/site/public/_headers`' `Content-Security-Policy` (Cloudflare Pages header file, copied into `dist/` by the build): `connect-src` is scoped to `'self'` plus the R2 public domain, `script-src`/`default-src` to `'self'`, and `frame-ancestors 'none'` — so injected content can't exfiltrate to arbitrary origins or be framed elsewhere. |
| **The public GitHub repo** (`droidkluster-observatory`), if a malicious commit reaches `main` | Same blast radius as a site compromise: Cloudflare Pages auto-deploys from `main`, so repo write access is site-deploy access — defacement, not cluster compromise. The repo carries no deployment secrets or cluster credentials. |
| **The projector process itself** (in-cluster, not internet-reachable) | Listed for completeness, not as a public attack surface: it holds the R2 write credentials and a NATS durable consumer scoped to `NATS_FILTER_SUBJECTS`. It is the diode's private terminus, protected by cluster-level controls (Zone 1), and is out of reach for anyone who has only compromised Zone 2 or Zone 3. |

## The sanitizer contract

Everything that leaves Zone 1 passes through two independent controls
before it's written to the edge store:

- **Deny-by-default field projection.** `PublicEventSchema` and its
  siblings (`packages/core/src/schema.ts`) use `.strict()` everywhere: an
  unlisted field is a schema violation, not a passthrough. More
  importantly, the projection in `packages/core/src/reduce.ts` never
  copies-then-filters a raw event payload — `classify()` reads only named
  fields off the untrusted envelope (`num()`, `str()`, `obj()` helpers)
  and *constructs* the public event field-by-field. There is no code path
  where an unrecognized field on the source payload can flow through.
  Same discipline applies to the snapshot builder
  (`packages/core/src/snapshot.ts`): `toSnapshot()` deliberately does not
  copy each chain's internal event-log (`c.events`) into the public
  `Chain` — the field simply doesn't exist on the output type.
- **Excerpt scrubber, exercised by a growing adversarial corpus in CI.**
  Bot prose (review findings, CI diagnoses, merge verdicts) is free text
  and can't be schema-constrained the way structured fields can.
  `scrubExcerpt()` (`packages/core/src/sanitize.ts`) runs an ordered list
  of kill-rules — URLs, internal hostnames, private-TLD hosts, IPv4/IPv6,
  bare `service:port` pairs, GitHub tokens, JWTs, bearer tokens, absolute
  paths, email addresses — over every excerpt before it can reach a public
  artifact, and truncates to a fixed length cap. The corpus
  (`packages/core/corpus/dirty-excerpts.json`) is not a hypothetical test
  fixture; it grew *through* adversarial review during this build. Findings
  caught in review before ever reaching production and pinned as
  permanent regression entries: a bearer token containing a base64 `/`
  that an earlier bearer-token pattern missed, a macOS path with a space
  in it (`/Users/.../Application Support/...`) that an earlier path
  pattern truncated wrong, bare Kubernetes `service:port` names
  (`redis:6379`, `internal-svc:8080` — no dots, so the dotted-hostname
  rule alone missed them), and a rule-*ordering* regression where the
  bare-service-port rule ran before the IPv6 rule and fragmented IPv6
  addresses into leaking hex groups. Each of those is now a standing
  corpus entry: the exact input that broke a specific rule, permanently
  regression-tested in public CI on every commit. That's the intended
  shape of this control — not "we believe the regex is complete," but
  "here is the adversarial history that shaped it, and it's checked every
  time." The comment at the top of `sanitize.ts` also documents a
  deliberate DoS containment measure: input is capped to 4000 characters
  (`PRE_CAP`) *before* any rule runs, because the kill-rules themselves are
  not asymptotically linear.
- **Kill switch.** `OBSERVATORY_PUSH_ENABLED` (checked in
  `packages/projector/src/config.ts`, wired into
  `packages/projector/src/push-loop.ts`) halts all pushes to the edge
  store when set to `false`, independent of whether the NATS consumer
  keeps running. A bad deploy or a suspected sanitizer gap can be muted at
  the edge without stopping ingestion.
- **Retroactive delete.** The edge store is a mutable R2 bucket, not an
  append-only log. Any published artifact can be overwritten or deleted
  with one API call — there is no "already shipped, can't take it back"
  failure mode.
- **No manual approve-queue in v1**, deliberately: a human-gated queue
  would destroy the site's "live" property, which is the point of the
  exhibit. The corpus and the two safety valves above carry the risk
  instead.

## Residual risks

- **NATS subject naming is visible in public source (accepted).** The
  reducer's `classify()` function matches literal subject prefixes —
  `project.event.merge_decision.reached.*`,
  `gh.event.project.*` — which reveals the fleet's internal
  event-bus naming convention to anyone reading the public repo. This is
  an accepted tradeoff, not an oversight: those subjects are unreachable
  from the internet (no listener exists outside Zone 1, per the diode
  above), and the transparency of "this is exactly what triggers the
  reducer" is worth more to the exhibit than the naming convention is
  worth hiding.
- **Scrubber false negatives.** A pattern-based scrubber cannot prove it
  catches every secret shape that might ever appear in bot-generated
  prose — new token formats, unanticipated internal naming schemes, or a
  secret embedded in a way none of the current kill-rules anticipate are
  all possible. This is mitigated, not eliminated, by the corpus-pinning
  methodology above (every review-caught gap becomes a permanent
  regression test) and by the retroactive-delete lever: a leaked excerpt
  is a one-call fix, not a permanent public record.
- **The excerpt path's reliance on well-formed upstream `ts` fields is a
  known open item.** `PublicEvent.at` is populated directly from the NATS
  envelope's `ts` field in `reduce.ts` (falling back to the epoch if
  absent) and is not re-validated against `PublicEventSchema`'s
  `.datetime()` constraint at the point where `feed/<date>.json` is
  written — only the replay-capture path (which runs
  `ReplayBundleSchema.parse`) enforces that check. This is not a
  confidentiality risk (a malformed timestamp carries no cluster-internal
  data), but it is an unresolved correctness gap: a malformed upstream
  `ts` could distort feed ordering or chain `updated_at` comparisons in
  `toSnapshot()` before ever being caught. Flagged for a root fix at the
  reducer boundary rather than left silent.
