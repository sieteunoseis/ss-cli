#!/usr/bin/env bash
# skills/env-sync.sh
#
# Skill: Refresh one or more env files from Secret Server
# Usage: ./skills/env-sync.sh [--env-file <path>] [--map-file <path>]
#
# Uses the configured defaultEnvFile and envMapFile from ss-cli config,
# or accepts overrides via flags.

set -euo pipefail

ENV_FILE=""
MAP_FILE=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --env-file) ENV_FILE="$2"; shift 2 ;;
        --map-file) MAP_FILE="$2"; shift 2 ;;
        *) echo "Unknown flag: $1"; exit 1 ;;
    esac
done

# Check token validity before doing any work
TOKEN_JSON=$(ss-cli token-status --json)
VALID=$(echo "$TOKEN_JSON" | grep -o '"valid":[^,}]*' | cut -d: -f2 | tr -d ' ')

if [[ "$VALID" != "true" ]]; then
    echo "ERROR: Secret Server token is not valid. Run: ss-cli login"
    exit 1
fi

ARGS=()
[[ -n "$ENV_FILE" ]] && ARGS+=(--env-file "$ENV_FILE")
[[ -n "$MAP_FILE" ]] && ARGS+=(--map-file "$MAP_FILE")

echo "Refreshing env file from Secret Server..."
ss-cli refresh-env "${ARGS[@]}"
echo "Done."
