# ss-cli

CLI tool for [Delinea Secret Server](https://delinea.com/products/secret-server). Supports OAuth2 authentication with TOTP/Duo 2FA, secret CRUD operations, and automated env file syncing.

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
| `ss-cli token-status` | Show token validity / expiry time |
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
```

## Authentication

### OAuth2 with TOTP (Duo)

Per [Delinea docs](https://docs.delinea.com/online-help/secret-server-11-5-x/api-scripting/authenticating/index.htm), the OTP code is sent as an HTTP header:

```bash
ss-cli login
# Prompts: Username, Domain, Password, Duo TOTP code
```

You can pre-configure username and domain:

```bash
ss-cli config set username myuser
ss-cli config set domain MYDOMAIN
ss-cli login   # only prompts for password + OTP
```

### Manual Token

If you have a token from a browser session:

```bash
ss-cli login --token <paste-token-here>
```

Tokens are cached in `~/.config/ss/token.json` (mode 0600) and auto-expire.

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

Replace `<ss:ID:field>` placeholders in any file with actual secret values. Works with YAML, JSON, nginx configs, or any text file.

```bash
# Resolve placeholders and write to a new file
ss-cli resolve --input template.yml --output resolved.yml

# Output to stdout
ss-cli resolve --input template.yml

# Pipe from stdin
cat template.yml | ss-cli resolve
```

Example template:
```yaml
database:
  host: <ss:21911:url>
  user: <ss:21911:username>
  password: <ss:21911:password>
```

## Audit Trail

All secret access (get, search, create, update) is logged to `~/.config/ss/audit.jsonl` with an HMAC-SHA256 chain for tamper detection.

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

This tool includes support for servers that require legacy SSL renegotiation (OpenSSL 3.0+). No extra configuration needed.

## License

ISC
