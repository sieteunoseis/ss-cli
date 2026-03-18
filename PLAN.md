# ss-cli Implementation Plan

## Overview

Refactor the SecretServer scripts into a unified CLI tool called `ss-cli`.
Installed globally via `npm link`, invoked as `ss-cli <command>`.
Designed to work with any Secret Server installation — nothing hardcoded.

---

## Auth Design

### OAuth2 with OTP Header (preferred)

Per [Delinea docs](https://docs.delinea.com/online-help/secret-server-11-5-x/api-scripting/authenticating/index.htm),
2FA OTP is passed as an **HTTP header**, not in the password field:

```
POST /SecretServer/oauth2/token
Content-Type: application/x-www-form-urlencoded
OTP: 123456

grant_type=password&username=USER&password=PASS&domain=DOMAIN
```

This means `ss-cli` can authenticate directly if the user provides their TOTP code:

```bash
ss-cli login                          # prompts for username, password, OTP
ss-cli login --username wordenj-admin --domain OHSUM01   # prompts for password + OTP
```

### Manual token paste (fallback)

If OAuth2 login is not available or the user already has a token from a browser session:

```bash
ss-cli login --token <token>   # paste token copied from browser session
```

### Token caching

Token is written to `~/.config/ss/token.json` with an `expires_at` timestamp (55 min from now).
File permissions set to `0600`. All commands read the cached token. On expiry, commands exit with:

```
Token expired. Run: ss-cli login
```

---

## Configuration

All installation-specific values live in `~/.config/ss/config.json`.
Nothing is hardcoded in source. CLI flags always override config.

### Config file: `~/.config/ss/config.json`

```json
{
  "url": "https://secretserver.ohsu.edu/SecretServer",
  "defaultFolder": 3493,
  "defaultTemplate": 6064
}
```

### Managed via `ss-cli config`

```bash
ss-cli config set url https://secretserver.ohsu.edu/SecretServer
ss-cli config set defaultFolder 3493
ss-cli config set defaultTemplate 6064
ss-cli config get url
ss-cli config show
```

### Priority order (highest to lowest)

1. CLI flag (e.g. `--folder 9999`)
2. `~/.config/ss/config.json`
3. Error — required value not found

---

## What Was Hardcoded → Now Configurable

| Was hardcoded | Now |
|---|---|
| `SECRET_SERVER_URL` in `.env` | `ss-cli config set url <url>` |
| Folder ID `3493` in windmill-to-ss.js | `config.defaultFolder` or `--folder` |
| Template ID `6064` in windmill-to-ss.js | `config.defaultTemplate` or `--template` |
| 17 secret ID → env var mappings in refresh-global-env.js | External JSON map file (`--map-file`) |
| Windmill URL/workspace/token in `.env` | `--windmill-url`, `--windmill-workspace`, `--windmill-token` flags or `.env` |
| Hardcoded global.env path in refresh-global-env.js | `--env-file <path>` flag |

---

## Env Map File (for `refresh-env`)

`refresh-global-env.js` currently has 17 hardcoded secret ID → env var mappings.
This is extracted to a portable JSON file passed via `--map-file`:

```json
[
  {
    "secretId": 21908,
    "fields": {
      "username": "LDAP_USERNAME",
      "password": "LDAP_PASSWORD"
    }
  },
  {
    "secretId": 21909,
    "fields": {
      "username": "INFLUXDB_USERNAME",
      "password": "INFLUXDB_PASSWORD",
      "url":      "INFLUXDB_URL"
    }
  }
]
```

```bash
ss-cli refresh-env --env-file /path/to/global.env --map-file /path/to/env-map.json
```

A default map file path can be stored in config:
```bash
ss-cli config set envMapFile /home/netcomm/biccapps-docker-compose/SecretServer/env-map.json
ss-cli config set defaultEnvFile /home/netcomm/biccapps-docker-compose/global.env
```

---

## Directory Structure (after refactor)

```
SecretServer/
  bin/
    ss-cli.js               # CLI entry point (shebang, commander routing)
  lib/
    client.js               # (moved) shared HTTPS client, legacy SSL
    config.js               # NEW — read/write ~/.config/ss/config.json
    token.js                # NEW — token cache read/write (~/.config/ss/token.json)
    auth.js                 # NEW — OAuth2 login (password grant + OTP header)
    get-secret.js           # (moved)
    create-secret.js        # (moved)
    update-secret.js        # (moved)
    search-secrets.js       # (moved)
    get-templates.js        # (moved)
    get-folders.js          # (moved)
    refresh-global-env.js   # (moved, refactored — map file replaces hardcoded IDs)
    windmill-to-ss.js       # (moved, refactored — no hardcoded folder/template IDs)
  env-map.json              # OHSU-specific secret ID → env var mapping (gitignored)
  package.json              # add "bin", add "commander" dep
  .env                      # Windmill credentials (WINDMILL_URL, WINDMILL_WORKSPACE, WINDMILL_TOKEN)
  PLAN.md                   # this file
```

Root-level `.js` files kept during transition — remove after `lib/` copies are verified.

---

## Commands

| Command | Description | Key flags |
|---|---|---|
| `ss-cli config set <key> <value>` | Set a config value | — |
| `ss-cli config get [key]` | Show one or all config values | — |
| `ss-cli login` | OAuth2 login (prompts for creds + OTP) | `--username`, `--domain`, `--token` (fallback) |
| `ss-cli token-status` | Show token validity / expiry time | — |
| `ss-cli get <id>` | Get secret by ID | `--format json\|table` |
| `ss-cli search <term>` | Search secrets by name | `--folder <id>` |
| `ss-cli create` | Create a new secret | `--name`, `--template`, `--folder`, `--field key=val` |
| `ss-cli update <id>` | Update field(s) on existing secret | `--field key=val` (repeatable) |
| `ss-cli templates` | List secret templates | `--name <filter>` |
| `ss-cli folders` | List folders | — |
| `ss-cli refresh-env` | Sync SS secrets → env file | `--env-file <path>`, `--map-file <path>` |
| `ss-cli windmill-sync` | Sync Windmill variables → SS | `--folder`, `--template`, `--dry-run`, `--skip-secrets`, `--windmill-url`, `--windmill-workspace`, `--windmill-token` |

---

## New Files

### `lib/config.js`

```
CONFIG_DIR   = ~/.config/ss/
CONFIG_FILE  = ~/.config/ss/config.json
TOKEN_FILE   = ~/.config/ss/token.json

getConfig()               — load full config, return {}  if missing
setConfig(key, value)     — set one key, save
getConfigValue(key)       — get one key, return undefined if missing
requireConfigValue(key)   — get key, exit with message if missing
```

### `lib/token.js`

```
saveToken(token)   — writes token + expires_at (55 min), chmod 600
getToken()         — returns token if not expired, null otherwise
requireToken()     — calls getToken(), exits with message if null
tokenStatus()      — returns { valid, expiresAt, minutesLeft }
```

### `lib/auth.js`

```
oauth2Login({ url, username, password, domain, otp })
  — POST /oauth2/token with OTP header
  — returns { access_token, token_type, expires_in }
  — uses legacy SSL agent from client.js

promptLogin(config)
  — interactive: prompts for username, password, OTP via readline
  — reads url and domain from config, allows override
  — calls oauth2Login(), then saveToken()
```

---

## package.json Changes

```json
{
  "name": "ss-cli",
  "bin": { "ss-cli": "./bin/ss-cli.js" },
  "dependencies": {
    "commander": "^12.0.0",
    "dotenv": "^16.4.7",
    "https": "^1.0.0",
    "node-fetch": "^2.7.0"
  }
}
```

Install globally: `npm install && npm link`

---

## Implementation Steps

1. `npm install commander`
2. Create `lib/config.js`
3. Create `lib/token.js`
4. Move existing scripts to `lib/` (keep exports identical)
5. Refactor `lib/refresh-global-env.js` — replace hardcoded mappings with `--map-file`
6. Refactor `lib/windmill-to-ss.js` — replace hardcoded folder/template with flags/config
7. Create `bin/ss-cli.js` with all subcommands wired up
8. Update `package.json` — name, bin, scripts
9. Extract OHSU mappings to `env-map.json`
10. `npm link`
11. Test each command
12. Remove root-level `.js` files once verified

---

## First-Time Setup (any installation)

```bash
npm install && npm link
ss-cli config set url https://your-ss-host/SecretServer
ss-cli config set defaultFolder <folder-id>       # optional
ss-cli config set defaultTemplate <template-id>   # optional
ss-cli config set defaultEnvFile /path/to/.env    # optional
ss-cli config set envMapFile /path/to/env-map.json  # optional
ss-cli login <token>
ss-cli token-status
ss-cli folders   # discover folder IDs for this installation
ss-cli templates # discover template IDs for this installation
```

---

## OAuth2 Test Commands (for future reference)

Run from `SecretServer/` directory.

```bash
# OAuth2 login with OTP header (correct approach per Delinea docs)
NODE_TLS_REJECT_UNAUTHORIZED=0 node --tls-max-v1.2 -e "
const https = require('https');
const fetch = require('node-fetch');
const agent = new https.Agent({ secureOptions: require('crypto').constants.SSL_OP_LEGACY_SERVER_CONNECT });
fetch('https://secretserver.ohsu.edu/SecretServer/oauth2/token', {
  method: 'POST', agent,
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded',
    'OTP': '123456'  // <-- replace with 6-digit TOTP code from Duo
  },
  body: 'grant_type=password&username=wordenj-admin&password=YOURPASSWORD&domain=OHSUM01'
}).then(r => { console.log('Status:', r.status); return r.text(); }).then(console.log).catch(console.error);
" 2>/dev/null

# Test token validity
NODE_TLS_REJECT_UNAUTHORIZED=0 node --tls-max-v1.2 -e "
const https = require('https');
const fetch = require('node-fetch');
const agent = new https.Agent({ secureOptions: require('crypto').constants.SSL_OP_LEGACY_SERVER_CONNECT });
fetch('https://secretserver.ohsu.edu/SecretServer/api/v1/folders?take=1', {
  agent,
  headers: { 'Authorization': 'Bearer TOKEN_HERE' }
}).then(r => { console.log('Status:', r.status); return r.text(); }).then(console.log).catch(console.error);
" 2>/dev/null
```

**Findings:**
- Endpoint: `https://secretserver.ohsu.edu/SecretServer/oauth2/token`
- Domain parameter: `domain=OHSUM01`
- OTP must be sent as an HTTP **header** (`OTP: 123456`), NOT appended to password
- Previous attempts failed because OTP was placed in the password field
- Duo TOTP code from authenticator app should work via OTP header (needs testing)
- Manual `ss-cli login --token <token>` remains as fallback
