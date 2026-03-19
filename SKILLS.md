# Skills

Reusable shell script workflows built on top of `ss-cli`. Copy them into your project or run directly from this repo.

All skills check token validity before executing. If the token is expired (or missing), they exit with an error and instruct the user to run `ss-cli login`.

> **Token lifetime note:** The examples below reference a ~20 minute window — this is organization-specific. Your Secret Server may be configured for longer-lived tokens. Run `ss-cli token-status --json` to see `minutesLeft` and `expiresAt` for your installation.

---

## Available Skills

| Script | Purpose |
|---|---|
| [`skills/agent-check.sh`](#agent-checksh) | Token validation gate for AI agent workflows |
| [`skills/env-sync.sh`](#env-syncsh) | Refresh env files from Secret Server |
| [`skills/deploy.sh`](#deploysh) | Deploy a Docker Compose service with secrets injected |
| [`skills/rotate-and-sync.sh`](#rotate-and-syncsh) | Rotate a secret field and re-sync env files |
| [`skills/resolve-and-deploy.sh`](#resolve-and-deploysh) | Resolve a config template and push to a remote server |

---

## agent-check.sh

Run at the start of any automated workflow to verify the token is valid before doing any secret access. Exits 0 if valid, exits 1 with a human-readable error if not.

```bash
./skills/agent-check.sh
```

Token lifetime depends on your Secret Server configuration. Use `ss-cli token-status --json` to inspect `minutesLeft` and `expiresAt` for your installation.

**Use in scripts:**

```bash
./skills/agent-check.sh || exit 1
# proceed with ss-cli commands...
ss-cli get 21909 --format json
```

**Output examples:**

```
# Valid file-based token
Token valid. Source: file | Minutes remaining: 17

# Token expiring soon
Token valid. Source: file | Minutes remaining: 3
WARNING: Token expires in less than 5 minutes. Consider re-authenticating.

# Session token
Token valid. Source: in-memory session (SS_TOKEN)

# No token
ERROR: No valid Secret Server token found (source: none).
A human must authenticate: ss-cli login
```

---

## env-sync.sh

Sync secrets from Secret Server to a `.env` file using a JSON map. Wraps `ss-cli refresh-env` with a token validity check.

```bash
# Use configured defaults (from ss-cli config)
./skills/env-sync.sh

# Override the env file or map file
./skills/env-sync.sh --env-file /path/to/global.env --map-file /path/to/env-map.json
```

**Setup:**

```bash
ss-cli config set defaultEnvFile /path/to/global.env
ss-cli config set envMapFile /path/to/env-map.json
```

**Cron example** — refresh env file every 15 minutes:

```cron
*/15 * * * * ss-cli login --token $(cat ~/.config/ss/token.json | jq -r .token) 2>/dev/null; /path/to/skills/env-sync.sh >> /var/log/env-sync.log 2>&1
```

---

## deploy.sh

Deploy a Docker Compose service with secrets injected as environment variables. Secrets are passed directly to the subprocess — never written to disk.

```bash
# Basic usage
./skills/deploy.sh --map-file ./env-map.json

# Target a specific service directory
./skills/deploy.sh --map-file ./env-map.json --dir /opt/myservice

# Pass extra docker-compose args after --
./skills/deploy.sh --map-file ./env-map.json --dir ./myservice -- --force-recreate
```

**How it works:**

1. Validates the Secret Server token
2. Fetches all secrets from the map file
3. Injects them as environment variables into a `docker-compose pull && docker-compose up -d` subprocess
4. Secrets exist only in the child process memory — never on disk

---

## rotate-and-sync.sh

Update a secret field in Secret Server, then immediately re-sync env files. Use this when rotating credentials.

```bash
# Rotate a password and sync the default env file
./skills/rotate-and-sync.sh --id 21909 --field password=newpassword

# Rotate and sync a specific env file
./skills/rotate-and-sync.sh \
  --id 21909 \
  --field password=newpassword \
  --env-file /opt/myservice/.env \
  --map-file /opt/myservice/env-map.json
```

**Steps:**

1. Validates token
2. Runs `ss-cli update <id> --field <key=value>`
3. Runs `ss-cli refresh-env` to propagate the new value

After running, restart any services that load the env file on startup.

---

## resolve-and-deploy.sh

Resolve `<ss:ID:field>` placeholders in a config template and deploy the result to a remote server. The resolved config flows through `stdin` → `ssh` → `tee` — it is never stored on the local or remote filesystem between runs.

```bash
./skills/resolve-and-deploy.sh \
  --template nginx.conf.tpl \
  --remote deploy@webserver01 \
  --remote-path /etc/nginx/conf.d/app.conf \
  --restart nginx
```

**Options:**

| Flag | Description |
|---|---|
| `--template` | Local template file with `<ss:ID:field>` placeholders |
| `--remote` | SSH target (e.g. `user@host`) |
| `--remote-path` | Destination path on the remote server |
| `--restart` | Service to `systemctl reload` (or restart) after deploy |

**Template example:**

```nginx
server {
    listen 443 ssl;
    ssl_certificate_key <ss:18114:private-key>;

    location /api/ {
        proxy_set_header Authorization "Bearer <ss:21909:password>";
        proxy_pass http://backend;
    }
}
```

---

## Writing Your Own Skills

Each skill follows this pattern:

```bash
#!/usr/bin/env bash
set -euo pipefail

# 1. Parse flags
# 2. Check token validity
TOKEN_JSON=$(ss-cli token-status --json)
VALID=$(echo "$TOKEN_JSON" | grep -o '"valid":[^,}]*' | cut -d: -f2 | tr -d ' ')
if [[ "$VALID" != "true" ]]; then
    echo "ERROR: Secret Server token is not valid. Run: ss-cli login"
    exit 1
fi

# 3. Do the work using ss-cli commands
ss-cli get "$SECRET_ID" --format json | ...
```

**Key principles:**

- Always check token validity first — fail fast with a clear message
- Prefer `ss-cli run` over `ss-cli refresh-env` when secrets don't need to persist
- Use `ss-cli resolve` to inject secrets into config files without touching the filesystem
- Use `--format json` and `--json` flags for machine-readable output in scripts
