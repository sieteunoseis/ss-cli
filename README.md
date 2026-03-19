# ss-cli

CLI tool for [Delinea Secret Server](https://delinea.com/products/secret-server). Supports OAuth2 authentication with TOTP/MFA (any provider — Duo, Google Authenticator, Microsoft Authenticator, Authy, 1Password, etc.), secret CRUD operations, SSH with stored credentials, template-based secret resolution, and automated env file syncing.

## Install

```bash
npm install -g @sieteunoseis/ss-cli
```

Or with npx (no install):

```bash
npx @sieteunoseis/ss-cli --help
```

Or install from source:

```bash
git clone https://github.com/sieteunoseis/ss-cli.git
cd ss-cli
npm install
npm link
```

## Quick Start

```bash
# Configure your Secret Server URL
ss-cli config set url https://your-server/SecretServer
ss-cli config set domain YOUR_DOMAIN    # optional

# Login with OAuth2 (prompts for password + TOTP code)
ss-cli login

# Or paste a token from your browser session
ss-cli login --token <token>

# Check token status
ss-cli token-status
```

## Commands

| Command | Description |
|---|---|
| `ss-cli config set <key> <value>` | Set a config value |
| `ss-cli config get [key]` | Show one or all config values |
| `ss-cli config show` | Show all config values |
| `ss-cli login` | OAuth2 login (prompts for creds + OTP) |
| `ss-cli login --token <token>` | Cache an existing API token |
| `ss-cli session` | Login + spawn shell — token in memory only, never on disk |
| `ss-cli logout` | Delete the cached token |
| `ss-cli token-status` | Show token validity / expiry (`--json` for scripts) |
| `ss-cli get <id>` | Get secret by ID (`--format json\|table`) |
| `ss-cli search <term>` | Search secrets by name (`--folder <id>`) |
| `ss-cli create` | Create a new secret (`--name`, `--template`, `--folder`, `--field key=val`) |
| `ss-cli update <id>` | Update field(s) on a secret (`--field key=val`, repeatable) |
| `ss-cli templates` | List secret templates (`--name <filter>`) |
| `ss-cli folders` | List folders |
| `ss-cli server-version` | Show Secret Server API version |
| `ss-cli refresh-env` | Sync secrets to an env file (`--env-file`, `--map-file`) |
| `ss-cli run` | Run a command with secrets as env vars — never written to disk |
| `ss-cli resolve` | Replace `<ss:ID:field>` placeholders in any file |
| `ss-cli audit` | View audit trail (`--verify` to check HMAC chain) |
| `ss-cli ssh <target>` | SSH into a server using secret credentials (ID or hostname) |
| `ss-cli ssh-copy-id <target>` | Copy SSH public key using secret credentials |
| `ss-cli windmill-sync` | Sync Windmill variables to SS (`--folder`, `--template`, `--dry-run`) |

## Configuration

All config is stored in `~/.config/ss/config.json`. CLI flags always override config values.

```bash
ss-cli config set url https://your-server/SecretServer
ss-cli config set domain YOUR_DOMAIN
ss-cli config set defaultFolder 1234
ss-cli config set defaultTemplate 5678
ss-cli config set defaultEnvFile /path/to/global.env
ss-cli config set envMapFile /path/to/env-map.json
ss-cli config set sshUsername myuser          # fallback SSH username
ss-cli config set sshTemplates 6007,6010      # template IDs to search for ssh
ss-cli config set sshFolder 3493              # folder ID to search for ssh
ss-cli config set sshDomain example.com       # domain suffix for hostname matching
```

## Authentication

### OAuth2 with TOTP/MFA

Per [Delinea docs](https://docs.delinea.com/online-help/secret-server-11-5-x/api-scripting/authenticating/index.htm), the OTP code is sent as an HTTP header. This works with any TOTP provider (Duo, Google Authenticator, Microsoft Authenticator, Authy, 1Password, etc.):

```bash
ss-cli login
# Prompts: Username, Domain, Password, OTP
# OTP accepts: 6-digit TOTP code, or "push" for Duo push notification
```

You can pre-configure username and domain:

```bash
ss-cli config set username myuser
ss-cli config set domain MYDOMAIN
ss-cli login   # only prompts for password + OTP
```

### Session Mode (Recommended)

Start a session where the token lives only in memory — never written to disk:

```bash
ss-cli session
# Prompts for credentials + OTP, then spawns a new shell
# Token is passed as SS_TOKEN env var — never touches ~/.config/ss/token.json
# Use ss-cli commands normally within this shell...
# When you exit (Ctrl+D, "exit", or close the terminal), the token vanishes
```

Example workflow:

```bash
$ ss-cli session
Username: myuser
Domain (blank for default): MYDOMAIN
Password:
OTP (TOTP code or "push"): 123456
Authenticated (expires in 19 min). Token is in-memory only.
Starting session (/bin/zsh). Token will vanish when this shell exits.

# Now use ss-cli normally — token is available via SS_TOKEN env var
$ ss-cli get 21909 --format json
$ ss-cli ssh myserver01
$ ss-cli token-status
Valid:   true
Source:  in-memory (SS_TOKEN)
Note:    expiry not tracked locally — validated against server

# Done — exit the shell
$ exit
Session ended. Token was never written to disk.
```

This is the most secure mode — no token file to clean up, no risk of stale tokens on disk. The token only exists in the spawned shell's environment and is gone the moment the shell exits.

### Login / Logout (File-Based)

For workflows where you need the token to persist across terminals (e.g., AI agents), use `login` and `logout`:

```bash
# Login — writes token to ~/.config/ss/token.json (mode 0600)
ss-cli login

# Token is now available in any terminal on this machine
ss-cli get 21909

# Done — delete the token file
ss-cli logout
```

### Login vs Session

| | `ss-cli login` | `ss-cli session` |
|---|---|---|
| Token storage | File (`~/.config/ss/token.json`) | Memory (`SS_TOKEN` env var) |
| Available in other terminals | Yes | No (only in spawned shell) |
| Cleanup | Manual (`ss-cli logout`) or auto-expire | Automatic when shell exits |
| Best for | AI agents, multi-terminal workflows | Interactive use, security-conscious |

### Manual Token

If you have a token from a browser session:

```bash
ss-cli login --token <paste-token-here>
```

### Token Status

Check whether the current token is valid. In session mode, this validates against the server since there's no local expiry to check.

```bash
# Human-readable
ss-cli token-status

# JSON output (for agents/scripts) — exit code 0 = valid, 1 = expired
ss-cli token-status --json
```

Example JSON responses:

```jsonc
// File-based token (from ss-cli login)
{"valid":true,"expiresAt":"2026-03-18T18:46:20.645Z","savedAt":"2026-03-18T18:26:20.645Z","minutesLeft":18,"source":"file"}

// Session token (from ss-cli session) — validated against server
{"valid":true,"expiresAt":null,"savedAt":null,"minutesLeft":null,"source":"session"}

// No token
{"valid":false,"expiresAt":null,"savedAt":null,"minutesLeft":0,"source":"none"}
```

The `source` field tells agents how the token was provided:
- `"file"` — from `~/.config/ss/token.json` (has local expiry tracking)
- `"session"` — from `SS_TOKEN` env var (validated against server API)
- `"none"` — no token found

## SSH

Connect to servers using credentials stored in Secret Server. Accepts a secret ID or hostname.

```bash
# By secret ID
ss-cli ssh 18114

# By hostname (searches Secret Server for matching secrets)
ss-cli ssh myserver01
ss-cli ssh myserver01.example.com

# With extra SSH arguments
ss-cli ssh 18114 -- -L 8080:localhost:80
```

### How hostname search works

When you pass a hostname instead of a secret ID, ss-cli searches Secret Server using the configured `sshTemplates` and/or `sshFolder` filters:

1. Strips the domain (e.g., `myserver01.example.com` → `myserver01`)
2. Searches secrets filtered by template IDs and/or folder ID
3. If one match — uses it. If multiple — looks for an exact name match
4. If still ambiguous — lists options so you can pick the ID

This works best when SSH secrets are named by FQDN (e.g., `myserver01.example.com`) and use dedicated SSH templates.

#### Recommended Secret Server setup

Use templates with heartbeat/password rotation enabled:

| Template | Use case | Host field |
|---|---|---|
| Unix Account (SSH) | Linux servers | `Machine` |
| Cisco Account (SSH) | CUCM, Cisco appliances | `Host` |

Name each secret as the FQDN (e.g., `myserver01.example.com`). Then configure ss-cli:

```bash
ss-cli config set sshTemplates 6007,6010    # Unix Account (SSH), Cisco Account (SSH)
ss-cli config set sshFolder 3493            # optional: limit search to a specific folder
ss-cli config set sshUsername myuser         # fallback if secret has no username
ss-cli config set sshDomain example.com     # domain suffix for exact hostname matching
```

### ssh-copy-id

Copy your SSH public key to a server for passwordless auth (standard Linux hosts only — not CUCM/Cisco appliances):

```bash
# One-time key deployment
ss-cli ssh-copy-id 18114
ss-cli ssh-copy-id myserver01

# After that, regular ssh works without password
ssh myuser@myserver01.example.com
```

### Password delivery

ss-cli automatically detects and uses the best available method:

1. **sshpass** — if installed (`sudo apt install sshpass`)
2. **expect** — usually pre-installed on Linux
3. **SSH_ASKPASS** — fallback

No password in the secret? ss-cli connects with key-based auth instead.

## Env File Sync

Sync Secret Server credentials to a `.env` file using a JSON map:

```bash
ss-cli refresh-env --env-file /path/to/global.env --map-file /path/to/env-map.json
```

### Map file format

```json
[
  {
    "secretId": 12345,
    "name": "My Database",
    "fields": {
      "username": "DB_USER",
      "password": "DB_PASSWORD",
      "url": "DB_HOST"
    },
    "transforms": {
      "url": "hostname"
    }
  }
]
```

Supported transforms: `hostname` (extract hostname from URL), `dbname` (extract path from URL).

### Encrypting env files with dotenvx

By default, `refresh-env` writes plaintext `.env` files. For encrypted env files that are safe to commit to git, chain with [dotenvx](https://dotenvx.com/):

```bash
# 1. Pull secrets from Secret Server into .env
ss-cli refresh-env --env-file .env --map-file env-map.json

# 2. Encrypt the .env file (creates .env.keys with decryption key)
dotenvx encrypt .env

# 3. Apps decrypt at runtime — .env can be committed to git
dotenvx run -- docker-compose up -d
dotenvx run -- node app.js
```

Benefits:
- `.env` is encrypted at rest — safe to commit to version control
- Decryption key (`.env.keys`) stays local or in a secure vault
- No plaintext secrets on disk between deployments
- Works with any app that reads environment variables

## Run (Secrets as Env Vars)

Run a command with secrets injected as environment variables. Secrets only exist in the subprocess memory — never written to disk.

```bash
# Inject all secrets from a map file
ss-cli run --map-file env-map.json -- docker-compose up -d

# Inject a single secret (all fields become env vars)
ss-cli run --secret 21909 --env-prefix DB_ -- node app.js
# Injects: DB_USERNAME, DB_PASSWORD, DB_URL, etc.
```

Use `run` when you want secrets available to a process but not persisted. Use `refresh-env` when you need a `.env` file on disk.

## Resolve (Placeholder Replacement)

Replace `<ss:ID:field>` placeholders in any file with actual secret values. Works with YAML, JSON, nginx configs, docker-compose files, or any text format.

```bash
# Resolve placeholders and write to a new file
ss-cli resolve --input template.yml --output resolved.yml

# Output to stdout (pipe to another command)
ss-cli resolve --input template.yml

# Pipe from stdin
cat template.yml | ss-cli resolve
```

### Example template

```yaml
database:
  host: <ss:21911:url>
  user: <ss:21911:username>
  password: <ss:21911:password>

influxdb:
  token: <ss:21909:password>
  url: <ss:21909:url>
```

### Piping to remote servers

Use `resolve` or `get` with SSH to inject secrets into remote commands without the secret touching the remote filesystem:

```bash
# Resolve a template and deploy to a remote server (secret never stored on disk)
ss-cli resolve --input docker-compose.tpl.yml | ssh user@server "cat > /tmp/dc.yml && docker-compose -f /tmp/dc.yml up -d && rm /tmp/dc.yml"

# Extract a single field and pipe to a remote command
ss-cli get 21909 --format json | jq -r '.items[] | select(.fieldName=="Password") | .itemValue' | ssh user@server "xargs -I{} curl -u admin:{} https://localhost/api"

# Chain: resolve a config, copy to remote, restart service
ss-cli resolve --input nginx.conf.tpl | ssh user@server "sudo tee /etc/nginx/conf.d/app.conf > /dev/null && sudo nginx -s reload"
```

## Windmill Sync

Sync all variables from a [Windmill](https://www.windmill.dev/) workspace into Secret Server. Each Windmill variable becomes a secret (or updates an existing one) with the naming convention `Windmill: <path>`.

### Setup

Windmill credentials can be provided three ways (priority: CLI flag > env var > config):

| Value | CLI flag | Env var | Config key |
|---|---|---|---|
| Windmill URL | `--windmill-url` | `WINDMILL_URL` | `windmillUrl` |
| Workspace | `--windmill-workspace` | `WINDMILL_WORKSPACE` | `windmillWorkspace` |
| API token | `--windmill-token` | `WINDMILL_TOKEN` | `windmillToken` |

You also need a Secret Server folder and template ID for new secrets:

```bash
# One-time config
ss-cli config set windmillUrl https://windmill.example.com
ss-cli config set windmillWorkspace devops_workspace
ss-cli config set windmillToken <your-windmill-token>
ss-cli config set defaultFolder 3493
ss-cli config set defaultTemplate 6064
```

### Usage

```bash
# Preview what would be synced
ss-cli windmill-sync --dry-run

# Sync all variables (creates or updates secrets)
ss-cli windmill-sync

# Skip variables marked as secret in Windmill
ss-cli windmill-sync --skip-secrets

# Override folder/template for this run
ss-cli windmill-sync --folder 9999 --template 1234

# Use env vars (e.g., from a .env file)
source .env && ss-cli windmill-sync
```

### What it does

For each variable in the Windmill workspace:
1. Checks if a secret named `Windmill: <path>` exists in the target folder
2. If it exists → updates the password, URL, and notes fields
3. If not → creates a new secret using the configured template

Secret fields are mapped as:
- **URL**: `<windmill-url>/variables/<path>`
- **Username**: variable path (e.g., `f/INFLUXDB/influxdb_token`)
- **Password**: variable value
- **Notes**: variable description

## AI Agent Integration

ss-cli is designed to work with AI agents (Windmill, n8n, etc.) using a human-in-the-loop pattern. Agents use file-based tokens (`ss-cli login`) since they need cross-process access.

1. **Human authenticates** — runs `ss-cli login`, enters password + TOTP code
2. **Agent checks token** — calls `ss-cli token-status --json` before each operation
3. **Agent uses secrets** — calls `ss-cli get`, `ss-cli run`, `ss-cli resolve`, etc.
4. **Token expires** — agent detects via `token-status` (exit code 1), notifies human to re-login

```bash
# Agent checks if token is valid (exit code 0 = valid, 1 = expired)
ss-cli token-status --json
# {"valid":true,"expiresAt":"2026-03-18T18:46:20.645Z","savedAt":"...","minutesLeft":18,"source":"file"}

# Agent fetches a secret
ss-cli get 21909 --format json

# Agent resolves a template
ss-cli resolve --input config.tpl.yml --output config.yml
```

The short token window (~20 min) IS the security model — no long-lived credentials to manage, and MFA is enforced on every session. For interactive use, prefer `ss-cli session` which keeps the token in memory only.

## Audit Trail

All secret access (get, search, create, update, ssh) is logged to `~/.config/ss/audit.jsonl` with an HMAC-SHA256 chain for tamper detection.

```bash
# View recent entries
ss-cli audit

# View last 50 entries
ss-cli audit -n 50

# Verify chain integrity (detect tampering)
ss-cli audit --verify

# JSON output (for scripts/agents)
ss-cli audit --json
```

## Legacy SSL

This tool includes support for servers that require legacy SSL renegotiation (OpenSSL 3.0+). No extra configuration needed — the client automatically enables `SSL_OP_LEGACY_SERVER_CONNECT`.

## License

ISC
