#!/usr/bin/env bash
# skills/rotate-and-sync.sh
#
# Skill: Update a secret field in Secret Server, then re-sync env files
# Use this when rotating credentials — update the value and push to all env files.
#
# Usage: ./skills/rotate-and-sync.sh --id <secret-id> --field <key=value> [--env-file <path>] [--map-file <path>]
#
# Example:
#   ./skills/rotate-and-sync.sh --id 21909 --field password=newpassword --env-file ./global.env

set -euo pipefail

SECRET_ID=""
FIELD=""
ENV_FILE=""
MAP_FILE=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --id)       SECRET_ID="$2"; shift 2 ;;
        --field)    FIELD="$2"; shift 2 ;;
        --env-file) ENV_FILE="$2"; shift 2 ;;
        --map-file) MAP_FILE="$2"; shift 2 ;;
        *) echo "Unknown flag: $1"; exit 1 ;;
    esac
done

if [[ -z "$SECRET_ID" || -z "$FIELD" ]]; then
    echo "ERROR: --id and --field are required"
    echo "Usage: $0 --id <secret-id> --field <key=value> [--env-file <path>] [--map-file <path>]"
    exit 1
fi

# Check token validity
TOKEN_JSON=$(ss-cli token-status --json)
VALID=$(echo "$TOKEN_JSON" | grep -o '"valid":[^,}]*' | cut -d: -f2 | tr -d ' ')

if [[ "$VALID" != "true" ]]; then
    echo "ERROR: Secret Server token is not valid. Run: ss-cli login"
    exit 1
fi

echo "Step 1: Updating secret $SECRET_ID (field: ${FIELD%%=*})..."
ss-cli update "$SECRET_ID" --field "$FIELD"
echo "Secret updated."

echo ""
echo "Step 2: Re-syncing env file..."
REFRESH_ARGS=()
[[ -n "$ENV_FILE" ]] && REFRESH_ARGS+=(--env-file "$ENV_FILE")
[[ -n "$MAP_FILE" ]] && REFRESH_ARGS+=(--map-file "$MAP_FILE")
ss-cli refresh-env "${REFRESH_ARGS[@]}"
echo "Env file synced."

echo ""
echo "Done. Secret $SECRET_ID updated and env files refreshed."
echo "Remember to restart any services that use these credentials."
