---
name: ss-cli-resolve-and-deploy
description: Resolves <ss:ID:field> placeholders in a config template using Delinea Secret Server secrets, then deploys the result to a remote server via SSH. Secrets flow through stdin/stdout only — never stored on disk. Use when deploying config files that contain credentials.
license: MIT
metadata:
  author: sieteunoseis
  version: "1.0.0"
---

# Resolve and Deploy — Config Templates with Secret Placeholders

Replaces `<ss:ID:field>` placeholders in any config file with live values from Secret Server, then pushes the result to a remote host. Works with nginx configs, docker-compose files, YAML, JSON, or any text format.

## When to use

- Deploying a config file that must contain credentials
- The user has a template file with `<ss:ID:field>` placeholders
- Secrets should not be stored in the config file at rest

## Placeholder format

```
<ss:SECRET_ID:FIELD_NAME>
```

Examples:

```yaml
# nginx config
ssl_certificate_key <ss:18114:private-key>;

# docker-compose
environment:
  INFLUXDB_TOKEN: <ss:21909:password>
  DB_HOST: <ss:21911:url>
```

Field names are case-insensitive and match the field slugs shown by `ss-cli get <id> --format json`.

## Resolve to stdout

```bash
# Preview the resolved output
ss-cli resolve --input template.yml

# Write to a local file
ss-cli resolve --input template.yml --output resolved.yml

# Read from stdin
cat template.yml | ss-cli resolve
```

## Deploy to a remote server

Pipe directly to the remote host — the resolved config is never stored locally:

```bash
ss-cli resolve --input nginx.conf.tpl | ssh user@server "sudo tee /etc/nginx/conf.d/app.conf > /dev/null && sudo nginx -s reload"
```

## Script

```bash
./skills/resolve-and-deploy/scripts/resolve-and-deploy.sh \
  --template nginx.conf.tpl \
  --remote deploy@webserver01 \
  --remote-path /etc/nginx/conf.d/app.conf \
  --restart nginx
```

## Supported file types

Resolve works with any text format — the placeholder is just a string substitution:

- nginx / Apache configs
- docker-compose.yml
- systemd unit files
- application YAML / JSON configs
- shell scripts
- Kubernetes manifests

## Security note

Use `ss-cli resolve` instead of manually embedding secrets in config files. The template can be committed to version control safely — it contains only placeholders, never actual credentials. The resolved output should not be committed.
