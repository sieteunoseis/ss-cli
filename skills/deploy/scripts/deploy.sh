#!/usr/bin/env bash
# skills/deploy.sh
#
# Skill: Deploy a Docker Compose service with secrets injected as env vars
# Secrets are passed directly to the subprocess — never written to disk.
#
# Usage: ./skills/deploy.sh --map-file env-map.json [--dir /path/to/service] [-- extra-args]
#
# Example:
#   ./skills/deploy.sh --map-file ./env-map.json --dir ./myservice

set -euo pipefail

MAP_FILE=""
SERVICE_DIR="."
EXTRA_ARGS=()
PASSTHROUGH=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        --map-file) MAP_FILE="$2"; shift 2 ;;
        --dir)      SERVICE_DIR="$2"; shift 2 ;;
        --)         PASSTHROUGH=true; shift ;;
        *)
            if $PASSTHROUGH; then
                EXTRA_ARGS+=("$1")
            else
                echo "Unknown flag: $1"; exit 1
            fi
            shift ;;
    esac
done

if [[ -z "$MAP_FILE" ]]; then
    echo "ERROR: --map-file is required"
    echo "Usage: $0 --map-file <path> [--dir <service-dir>]"
    exit 1
fi

# Check token validity
TOKEN_JSON=$(ss-cli token-status --json)
VALID=$(echo "$TOKEN_JSON" | grep -o '"valid":[^,}]*' | cut -d: -f2 | tr -d ' ')

if [[ "$VALID" != "true" ]]; then
    echo "ERROR: Secret Server token is not valid. Run: ss-cli login"
    exit 1
fi

echo "Deploying with secrets from: $MAP_FILE"
echo "Service directory: $SERVICE_DIR"

# Inject secrets as env vars and run docker-compose up
ss-cli run --map-file "$MAP_FILE" -- bash -c "cd '$SERVICE_DIR' && docker-compose pull && docker-compose up -d ${EXTRA_ARGS[*]:-}"

echo "Deploy complete."
