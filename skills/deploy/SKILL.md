---
name: ss-cli-deploy
description: Deploys a Docker Compose service with secrets from Delinea Secret Server injected as environment variables. Secrets are never written to disk — they exist only in the subprocess memory. Use when deploying services that need credentials.
license: ISC
metadata:
  author: sieteunoseis
  version: "1.0.0"
---

# Deploy — Docker Compose with Secrets Injected

Pulls Docker images and starts a Compose service with Secret Server credentials injected as environment variables. Secrets flow directly into the subprocess — never written to disk.

## When to use

- Deploying a service that reads credentials from environment variables
- Starting a service without creating plaintext `.env` files
- CI/CD workflows where secrets must not touch the filesystem

## Prerequisites

1. Valid Secret Server token
2. A JSON map file defining which secrets map to which env vars
3. Docker Compose installed on the target machine

## Running a deploy

```bash
# Deploy in the current directory
ss-cli run --map-file env-map.json -- docker-compose up -d

# Deploy in a specific directory
ss-cli run --map-file env-map.json -- bash -c "cd /opt/myservice && docker-compose pull && docker-compose up -d"

# Inject a single secret (all fields become env vars with optional prefix)
ss-cli run --secret 21909 --env-prefix DB_ -- docker-compose up -d
# Injects: DB_USERNAME, DB_PASSWORD, DB_URL, etc.
```

## Script

```bash
./skills/deploy/scripts/deploy.sh \
  --map-file ./env-map.json \
  --dir /opt/myservice
```

## How it works

1. Token is validated before any work starts
2. Secrets are fetched and held in memory
3. `docker-compose pull && docker-compose up -d` runs as a child process with the secrets in its environment
4. When the process exits, secrets are gone

## Security note

Prefer `ss-cli run` over writing a `.env` file whenever possible. The secrets never touch the filesystem and cannot be accidentally committed to version control or left behind after a deploy.
