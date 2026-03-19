---
name: ss-cli-env-sync
description: Syncs secrets from Delinea Secret Server to a .env file using a JSON map. Use when the user asks to refresh, update, or pull credentials into an env file. Requires a valid ss-cli token.
license: ISC
metadata:
  author: sieteunoseis
  version: "1.0.0"
---

# Env Sync — Secret Server to .env File

Refreshes a `.env` file by pulling the latest secret values from Secret Server. Uses a JSON map that defines which secret IDs map to which environment variable names.

## When to use

- The user asks to refresh credentials in an env file
- A secret was rotated and env files need to be updated
- Setting up a new environment from Secret Server

## Prerequisites

1. Valid Secret Server token (`ss-cli token-status --json` → `"valid": true`)
2. A JSON map file defining secret → env var mappings
3. Either configured defaults or explicit paths

## Map file format

```json
[
  {
    "secretId": 21908,
    "name": "LDAP credentials",
    "fields": {
      "username": "LDAP_USERNAME",
      "password": "LDAP_PASSWORD"
    }
  },
  {
    "secretId": 21909,
    "name": "InfluxDB",
    "fields": {
      "username": "INFLUXDB_USERNAME",
      "password": "INFLUXDB_PASSWORD",
      "url": "INFLUXDB_URL"
    },
    "transforms": {
      "url": "hostname"
    }
  }
]
```

Supported transforms: `hostname` (extracts hostname from URL), `dbname` (extracts path from URL).

## Running the sync

```bash
# Use configured defaults
ss-cli refresh-env

# Specify paths explicitly
ss-cli refresh-env --env-file /path/to/global.env --map-file /path/to/env-map.json
```

## One-time config setup

```bash
ss-cli config set defaultEnvFile /path/to/global.env
ss-cli config set envMapFile /path/to/env-map.json
```

## Script

```bash
./skills/env-sync/scripts/env-sync.sh [--env-file <path>] [--map-file <path>]
```

## Pairing with dotenvx

For encrypted env files that are safe to commit to git:

```bash
# Pull secrets
ss-cli refresh-env --env-file .env --map-file env-map.json

# Encrypt the result
dotenvx encrypt .env

# Apps decrypt at runtime
dotenvx run -- docker-compose up -d
```

## After sync

Remind the user to restart any services that load the env file at startup — changes only take effect when services restart.
