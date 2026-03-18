# ss-cli

CLI tool for [Delinea Secret Server](https://delinea.com/products/secret-server). Supports OAuth2 authentication with TOTP/Duo 2FA, secret CRUD operations, and automated env file syncing.

## Install

```bash
npm install -g @sieteunoseis/ss-cli
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

## Legacy SSL

This tool includes support for servers that require legacy SSL renegotiation (OpenSSL 3.0+). No extra configuration needed.

## License

ISC
