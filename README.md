# droidkluster fleet observatory

A public, live view of the droidkluster autonomous agent fleet — what
each agent (HK-47 reviews PRs, 2-1B diagnoses CI, TT-8L gates merges,
EV-9D9 operates the cluster) is doing right now and has done recently.
The private cluster projects that state out through a sanitizing,
push-only diode: outbound only, no listener, nothing inbound ever
reaches it.

## Architecture

```
[private cluster]                              [Cloudflare edge, free tier]
NATS bus ──► observatory-projector ── push ──► KV/R2 data store ◄── reads ── Pages static site
             (project + sanitize)    HTTPS     current.json                  whatis.droidkluster.com
                                     outbound  feed/<YYYY-MM-DD>.json
                                     only      replays/index.json
                                               replays/<run-id>.json
                                               droids.json
```

The projector consumes cluster NATS events, reduces them to a small
allowlisted public schema, sanitizes any free-text excerpts, and pushes
the result to a Cloudflare R2 bucket over outbound HTTPS. The static site
polls that bucket. There is no path back the other way — see
[`THREAT_MODEL.md`](THREAT_MODEL.md) for the full trust-zone breakdown and
why the control plane gets a diode where other cluster apps get a
Cloudflare Tunnel.

## Why the projector source is public

The interesting security property here isn't a claim, it's a fact you can
read: the exact code that decides what leaves the cluster —
`packages/core`'s allowlisted schemas, field-by-field projection, and
excerpt scrubber — is public, and its test corpus runs in this repo's own
CI on every commit. That corpus isn't a hypothetical fixture; it grew
through adversarial review during this build (see
[`THREAT_MODEL.md`](THREAT_MODEL.md#the-sanitizer-contract) for specific
examples). Publishing this source and its tests is itself the exhibit:
you don't have to trust a description of what the sanitizer does, you can
read it and watch it fail the corpus if it regresses.

Deployment manifests, secrets, and the private droidkluster cluster's own
source stay private. This repo is public code, private deployment.

## Packages

- **`packages/core`** — allowlisted schemas, the excerpt sanitizer + kill-rule corpus, the fleet event reducer, and the snapshot builder; no I/O.
- **`packages/projector`** — the in-cluster NATS consumer that reduces and sanitizes canon events and pushes the result to Cloudflare R2; ships as a container image.
- **`packages/site`** — the static Mission Control board: polls the edge store, renders droid stations and correlation-chain pipelines, falls back honestly to a labeled replay when idle.

## Local development

```bash
npm install
npm run check          # lint + typecheck + unit tests, all workspaces
```

To run the site against fixture data instead of the live edge store, in
one terminal serve the Playwright fixtures (they're plain JSON with the
same shape `current.json` / `replays/*` have on the real edge store):

```bash
node packages/site/e2e/fixture-server.mjs   # http://127.0.0.1:4174
```

and in another, point the dev server at it:

```bash
VITE_DATA_BASE=http://127.0.0.1:4174 npm run dev --workspace @observatory/site
```

## Threat model

See [`THREAT_MODEL.md`](THREAT_MODEL.md) for assets, trust zones, the
diode-vs-tunnel rationale, what an attacker gains at each compromise
point, the sanitizer contract, and residual risks. See
[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for the manual Cloudflare setup
and the projector's full environment-variable contract.
