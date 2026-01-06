# onetoo-ai-autopilot

**New universe (non-archival): fully autonomous AI contribution autopilot** for the ONETOO ecosystem.

This repo implements:

- Deterministic **policy engine** (no LLM heuristics)
- Two-lane model:
  - **Sandbox lane**: immediate visibility, lower trust
  - **Stable lane**: only from **multi-signed artifacts** (autopilot + root)
- Artifact-first publishing: decade-stable, auditable, reproducible decisions

> ✅ This repo is designed to be **autonomous from day one**.

## Core idea

`submit -> hard checks -> sandbox -> policy score -> stable accepted (multi-sig)`

## What gets published

- `data/sandbox/contrib-sandbox.v2.json` (+ optional signature)
- `data/stable/contrib-accepted.v2.json` (**REQUIRES** multi-sig)
  - `contrib-accepted.v2.json.minisig` (autopilot)
  - `contrib-accepted.v2.json.root.minisig` (root)

## Run locally (tests)

```bash
npm i
npm run ci
```

## Cloudflare Worker

Worker entrypoint:
- `services/worker/src/worker.js`

It expects these environment bindings:
- `GITHUB_TOKEN` (repo write)
- `GITHUB_REPO` (e.g. `onetooeu/onetoo-ai-autopilot`)
- `AUTOPILOT_SECRET` (for HMAC / internal request auth)

> Root signing key is **NOT** required in the Worker.

## GitHub Actions

- `pipelines/github/workflows/signing-multisig.yml`
  - consumes a proposal
  - updates accepted-set
  - produces **both** signatures

## Philosophy

- **Trust ≠ runtime opinion**
- only verifiable, deterministic signals
- every decision stores `signals{}` + `reasons[]` + `policy_version`

