# Deployment

This is the manual setup runbook for the two halves of the observatory:
the Cloudflare edge (R2 bucket + Pages site, click-through, no IaC yet)
and the projector (containerized, deployed from the private GitOps
repo).

See [`THREAT_MODEL.md`](../THREAT_MODEL.md) for why the projector only
ever pushes outbound and never accepts inbound connections.

## 1. Cloudflare: R2 bucket (edge data store)

1. Cloudflare dashboard → **R2** → **Create bucket**. Name it `observatory`.
2. Bucket → **Settings** → **Public access** → **Connect Domain** → enter
   `data.whatis.droidkluster.com`. Because that zone is already on
   Cloudflare, this provisions the routing for you and serves bucket
   objects over that hostname with no separate DNS step.
3. **Manage R2 API tokens** → **Create API token**.
   - Permissions: **Object Read & Write**.
   - Scope: **this bucket only** (`observatory`) — not account-wide R2
     access. This is the credential referenced in
     [Threat model → what an attacker gains](../THREAT_MODEL.md) as
     bounded to write access on already-public data.
   - Save the resulting Access Key ID, Secret Access Key, and Account ID —
     they map to `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, and
     `R2_ACCOUNT_ID` below. They're shown once; store them in the private
     secret store, not in this repo.

## 2. Cloudflare: Pages site

1. Cloudflare dashboard → **Workers & Pages** → **Create application** →
   **Pages** → **Connect to Git** → select the `droidkluster-observatory`
   repository.
2. Build settings:
   - Framework preset: **None**.
   - Root directory: `/` (repo root — this is an npm workspaces monorepo;
     Pages needs the root `package.json` and lockfile to resolve
     `@observatory/core` for the site build).
   - Build command: `npm run build --workspace @observatory/core --workspace @observatory/site`

     The site imports `@observatory/core` as a workspace package resolved
     through its built `dist/` output (the package's `main` field points
     there, not at TypeScript source). Building `@observatory/site` alone
     fails with an unresolved-entry error from Vite — verified locally by
     building the site workspace in isolation without a prior core build.
     `@observatory/core` must be built first, in the same command; this
     mirrors the pattern the root CI already uses for the Playwright job
     (`test:e2e`'s `npm run build --workspace @observatory/core --workspace @observatory/site`).
   - Build output directory: `packages/site/dist`.
3. Environment variables: `VITE_DATA_BASE=https://data.whatis.droidkluster.com`
   (the R2 public domain from step 1 above — this is a build-time Vite env
   var, baked into the static bundle, not a runtime secret).
4. Deploy. Pages will auto-redeploy on every push to `main` — repo write
   access is effectively site-deploy access; see
   [Threat model](../THREAT_MODEL.md#what-an-attacker-gains-at-each-compromise-point)
   for the blast radius that implies (defacement, not cluster compromise).

## 3. DNS: `whatis.droidkluster.com`

In the Pages project → **Custom domains** → **Add a custom domain** →
enter `whatis.droidkluster.com`. Since the zone already lives on
Cloudflare, Pages provisions the CNAME automatically; no manual DNS record
is required.

## 4. Projector: environment variables

The projector (`packages/projector`) reads its entire configuration from
environment variables via `readConfig()` in
[`packages/projector/src/config.ts`](../packages/projector/src/config.ts).
Config is fail-fast: any required variable that's unset throws at startup
rather than degrading silently.

| Variable | Example | Required | Secret | Notes |
|---|---|---|---|---|
| `NATS_SERVERS` | `nats://<nats-host>.internal:4222` | yes | no | Comma-separated list. Internal-only hostname, not a credential — but see the [threat model's residual-risk note](../THREAT_MODEL.md#residual-risks) on subject-naming exposure; the server address itself isn't reachable from outside the cluster. |
| `NATS_NKEY_SEED_FILE` | `/etc/observatory/nats.nk` | no | **yes** | Path to an NKey seed file. The path itself isn't sensitive; the file it points to is the actual credential and must be mounted from the cluster secret store, never committed. |
| `NATS_CA_FILE` | `/etc/observatory/ca.pem` | no | no | Path to a CA cert for TLS verification, if the NATS server needs one. Public cert material. |
| `NATS_STREAM` | `EVENTS` | yes | no | JetStream stream name. |
| `NATS_DURABLE` | `observatory-projector-v1` | yes | no | Durable consumer name. **See the filter-change gotcha below before bumping `NATS_FILTER_SUBJECTS` without also bumping this.** |
| `NATS_FILTER_SUBJECTS` | `gh.event.<repo>.>,<repo>.event.merge_decision.reached.>,droidkluster.event.coder.completed.>` | yes | no | Comma-separated subject filters for the durable consumer. |
| `R2_ACCOUNT_ID` | `a1b2c3d4e5f6...` | yes | no | Cloudflare account ID, from step 1.3 above. An identifier, not a secret by itself. |
| `R2_BUCKET` | `observatory` | yes | no | Must match the bucket created in step 1.1. |
| `R2_ACCESS_KEY_ID` | `f0e1d2c3b4a5...` | yes | **yes** | From the bucket-scoped API token, step 1.3. |
| `R2_SECRET_ACCESS_KEY` | `••••••••••••••••` | yes | **yes** | From the bucket-scoped API token, step 1.3. |
| `OBSERVATORY_PUSH_ENABLED` | `true` | no | no | Kill switch. Defaults to enabled; set to the literal string `false` to halt all edge pushes without stopping NATS ingestion. See [threat model](../THREAT_MODEL.md#the-sanitizer-contract). |
| `PUSH_DEBOUNCE_MS` | `10000` | no | no | Defaults to `10000`. Coalescing window for on-event pushes to `current.json` / the day's feed. |
| `PUSH_HEARTBEAT_MS` | `60000` | no | no | Defaults to `60000`. Interval for the `last_contact` heartbeat push even when idle. |
| `OBSERVATORY_IGNORE_PRS` | `99999` | no | no | Defaults to `99999`, the fleet's synthetic canary PR. Comma-separated list of PR numbers filtered out of public artifacts at the `reduce()` boundary, before any droid-status/chain/feed mutation — a canary PR never flips a droid task, never opens a chain, and never appears in the feed. Throws on a non-integer entry. |
| `OBSERVATORY_SOURCE_REPO` | `my-private-repo` | yes | no | Subject-token of the observed repo (`gh.event.<token>.*`). Value lives only in private cluster config — never committed, never present in public code or the browser bundle. |
| `OBSERVATORY_REDACT_TERMS` | `my-private-repo,my-org` | no | no | Defaults to empty. Comma-separated list of literal private names replaced with `[project]` in all public prose (review excerpts, check-run names) at the `reduce()` boundary. Never include any string containing `droidkluster` — that's the public brand and stays visible by design. |

### The durable-consumer filter-change gotcha

From the comment in
[`packages/projector/src/index.ts`](../packages/projector/src/index.ts):

> Durable consumer with `deliver_policy: new` — first boot starts from
> "now" (no backlog replay); restarts resume from the durable's position.
> `jsm.consumers.add()` with a *changed* config (e.g. a new
> `NATS_FILTER_SUBJECTS`) on the *same durable name* is **rejected by the
> server**.

In practice: if you change `NATS_FILTER_SUBJECTS` to add or remove a
subject, you must also bump `NATS_DURABLE` to a new name (or delete the
old consumer server-side first) — otherwise the projector will fail to
start against a durable consumer whose stored config no longer matches
what you're asking for. This is easy to hit and easy to misdiagnose as a
NATS auth or connectivity problem when it's actually a stale durable
config.

Verified: the canon `EVENTS` stream's subjects cover all three observatory
subject families — `gh.event.>`, `<repo>.event.>`, and
`droidkluster.event.>` — so a single durable consumer with the three
`NATS_FILTER_SUBJECTS` filters above is sufficient. No second consumer or
second stream is needed. See the durable filter-change gotcha above if you
ever add, remove, or narrow one of those three filter subjects — that still
requires bumping `NATS_DURABLE`.

## 5. Kubernetes deployment

The projector runs as a deployment named **`observatory-projector`**,
image **`ghcr.io/<owner>/observatory-projector`** (published by
[`.github/workflows/image.yml`](../.github/workflows/image.yml), tagged
by commit SHA on every push to `main` and on `v*` tags).

**The k8s manifests themselves live in the private GitOps repo, not
here** — this repo publishes the image and documents the env-var
contract; the deployment spec, secret mounts (for
`NATS_NKEY_SEED_FILE`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`), and
rollout wiring are cluster-side, consistent with the public-code /
private-deployment split described in
[`THREAT_MODEL.md`](../THREAT_MODEL.md#assets).

## 6. Curating a replay

Both the curation CLI (`curate.js`) and the recording-ingest CLI
(`ingest.js`) only ever touch the R2 bucket — they never open a NATS
connection — so they need just the four `R2_*` variables from the table
above (`R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`,
`R2_SECRET_ACCESS_KEY`), not the full projector env contract
(`NATS_SERVERS` etc.). `readR2Config()` in
[`packages/projector/src/config.ts`](../packages/projector/src/config.ts)
enforces exactly that: it's the same fail-fast `req()` check as
`readConfig()`, scoped to only the four R2 vars.

### Path A — live chain, auto-captured by the running projector

Once the projector is running and has captured at least one completed PR
lifecycle chain (auto-captured on `pr_merged`/`pr_closed` — see
`packages/projector/src/capture.ts`), it's already sitting in the bucket
at `chains/<id>.json`. Promote it into the public replay rotation with the
bundled CLI, run against the same R2 credentials as the projector:

```bash
node packages/projector/dist/curate.js promote \
  --chain pr-1607-2026-07-23 \
  --title "CI red to merge in 41 minutes" \
  --summary "..."
```

This reads `chains/<id>.json` from the bucket, writes it to
`replays/<id>.json`, and prepends it to `replays/index.json` — the site's
idle-state replay rotation reads from that index.

### Path B — inaugural replay, from a private build-window recording

Before the projector has been live long enough to auto-capture a chain
(e.g. the very first deploy), `ingest.js` converts a private JSONL
recording of canon envelopes into sanitized bundles on local disk — see
[`packages/projector/src/ingest.ts`](../packages/projector/src/ingest.ts).
`curate.js promote` only ever reads from `chains/<id>.json` **in the
bucket**, so an ingest-produced bundle has to be uploaded there first —
this is the bridge step that's easy to miss:

```bash
# 1. Convert the recording to bundle(s) on disk.
node packages/projector/dist/ingest.js --input recording.jsonl --out ./out

# 2. Bridge: upload each bundle into the bucket under chains/<id>.json —
#    the same key space curate.js promote reads from. Either tool works
#    as long as it authenticates with the bucket-scoped R2 token from
#    step 1.3 above:
npx wrangler r2 object put observatory/chains/pr-1607-2026-07-23.json \
  --file ./out/pr-1607-2026-07-23.json
#    ...or any S3-compatible client (aws s3 cp, rclone, etc.) pointed at
#    https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com with the same
#    R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY.

# 3. Promote, same as Path A.
node packages/projector/dist/curate.js promote \
  --chain pr-1607-2026-07-23 \
  --title "CI red to merge in 41 minutes" \
  --summary "..."
```
