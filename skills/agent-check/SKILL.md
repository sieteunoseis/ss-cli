---
name: ss-cli-agent-check
description: Validates a Delinea Secret Server token before running any ss-cli operations. Use this at the start of any automated workflow. If the token is invalid or expired, stop and ask the human to run `ss-cli login`.
license: ISC
metadata:
  author: sieteunoseis
  version: "1.0.0"
---

# Agent Check — Secret Server Token Validation

Use this skill at the start of any workflow that requires Secret Server access. It validates the current token and surfaces the result so you can decide whether to proceed or prompt the user to re-authenticate.

## When to use

- Before any `ss-cli get`, `ss-cli run`, `ss-cli refresh-env`, or other secret access
- In automated pipelines to fail fast before attempting secret operations
- When the user asks you to fetch or use a secret

## How to check the token

Run the token status check and parse the JSON response:

```bash
ss-cli token-status --json
```

Response fields:

| Field | Description |
|---|---|
| `valid` | `true` if token is usable, `false` if expired or missing |
| `source` | `"file"` (from `ss-cli login`), `"session"` (SS_TOKEN env var), or `"none"` |
| `minutesLeft` | Remaining minutes (file-based only; `null` for session tokens) |
| `expiresAt` | ISO timestamp of expiry (file-based only; `null` for session tokens) |

> **Token lifetime is organization-specific.** Do not assume a fixed expiry window. Always check `minutesLeft` and `expiresAt` from the actual response.

## Decision logic

```
token-status --json
  → valid: true   → proceed with ss-cli commands
  → valid: false  → stop. Tell the user: "Secret Server token is expired or missing. Please run: ss-cli login"
```

If `minutesLeft` is less than 5 and the workflow will take time, warn the user before starting so they can renew the token.

## Script

Run the provided script for a shell-friendly gate that exits 0 (valid) or 1 (invalid):

```bash
./skills/agent-check/scripts/agent-check.sh || exit 1
```

## Example agent workflow

```bash
# 1. Check token
TOKEN_JSON=$(ss-cli token-status --json)
# Parse valid field — if false, stop and tell the user to run: ss-cli login

# 2. Fetch a secret
ss-cli get 21909 --format json

# 3. Use the result
```

## Security notes

- Never store secret values in files. Prefer `ss-cli run` (injects secrets as env vars into a subprocess) or `ss-cli resolve` (stdout-only).
- If `source` is `"session"`, the token is in-memory only (from `ss-cli session`). It cannot be shared across terminals and vanishes when the shell exits.
- For cross-process agent access, `source` must be `"file"` (from `ss-cli login`).
