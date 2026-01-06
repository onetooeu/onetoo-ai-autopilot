# TFWS Registry (onetoo-ai-autopilot) — v0.1.9

This folder documents the official publication of the TFWS v2 registry files for onetoo-ai-autopilot v0.1.9.

## Live TFWS endpoints (production)

- https://www.onetoo.eu/.well-known/tfws.json
- https://www.onetoo.eu/.well-known/tfws.policy.json
- https://www.onetoo.eu/.well-known/tfws.keys.json

Signatures:

- https://www.onetoo.eu/.well-known/tfws.json.minisig
- https://www.onetoo.eu/.well-known/tfws.policy.json.minisig
- https://www.onetoo.eu/.well-known/tfws.keys.json.minisig

## Release artifact (offline pack)

Files (stored in this folder and also published on onetoo.eu):

- https://www.onetoo.eu/downloads/onetoo-tfws-autopilot-well-known-v0.1.9.zip
- https://www.onetoo.eu/downloads/onetoo-tfws-autopilot-well-known-v0.1.9.zip.sha256
- https://www.onetoo.eu/downloads/onetoo-tfws-autopilot-well-known-v0.1.9.zip.minisig

## Verify (offline)

```bash
sha256sum -c onetoo-tfws-autopilot-well-known-v0.1.9.zip.sha256
minisign -V -p /c/Users/TV/keys/onetoo-ai-autopilot/minisign-v2.pub \
  -m onetoo-tfws-autopilot-well-known-v0.1.9.zip \
  -x onetoo-tfws-autopilot-well-known-v0.1.9.zip.minisig

Contents of the zip

Contains exactly 6 files:

tfws.json + tfws.json.minisig

tfws.policy.json + tfws.policy.json.minisig

tfws.keys.json + tfws.keys.json.minisig
