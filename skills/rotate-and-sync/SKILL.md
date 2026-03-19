---
name: ss-cli-rotate-and-sync
description: Updates a secret field in Delinea Secret Server and immediately re-syncs downstream env files. Use when the user asks to rotate a credential, change a password, or update a secret value.
license: MIT
metadata:
  author: sieteunoseis
  version: "1.0.0"
---

# Rotate and Sync — Update a Secret, Refresh Env Files

Updates one or more fields on a Secret Server secret, then re-syncs any env files that depend on it. Use this for credential rotation workflows.

## When to use

- The user wants to rotate a password or API key
- A secret value changed and downstream `.env` files need updating
- Post-rotation cleanup after an automated password change

## Prerequisites

1. Valid Secret Server token
2. The secret ID to update
3. The new field value

## Workflow

### Step 1 — Update the secret

```bash
ss-cli update <id> --field password=newvalue
ss-cli update <id> --field password=newvalue --field notes="Rotated 2026-03-19"
```

Multiple `--field` flags are supported for updating more than one field at once.

### Step 2 — Verify the update

```bash
ss-cli get <id> --format json
```

### Step 3 — Re-sync env files

```bash
ss-cli refresh-env --env-file /path/to/global.env --map-file /path/to/env-map.json
```

### Step 4 — Restart affected services

Services that load the env file at startup must be restarted. Identify which services use the env file and restart them. For Docker Compose services:

```bash
docker-compose -f /path/to/docker-compose.yml up -d --force-recreate
```

## Script (all steps combined)

```bash
./skills/rotate-and-sync/scripts/rotate-and-sync.sh \
  --id 21909 \
  --field password=newpassword \
  --env-file /path/to/global.env \
  --map-file /path/to/env-map.json
```

## Audit trail

All updates are logged to `~/.config/ss/audit.jsonl`. Verify the log after rotation:

```bash
ss-cli audit -n 5
ss-cli audit --verify  # check HMAC chain integrity
```

## Important reminders

- Always verify the secret was updated correctly before re-syncing
- Restart all services that use the rotated credential — the env file change alone is not enough
- If the rotation is part of a compliance requirement, note the timestamp and operator in the secret's Notes field
