#!/usr/bin/env bash
# skills/agent-check.sh
#
# Skill: AI agent token validation gate
# Run this at the start of any agent workflow before accessing secrets.
# Exits 0 if token is valid, exits 1 if not (with a human-readable message).
#
# Usage: ./skills/agent-check.sh
#   Or source it: source ./skills/agent-check.sh && echo "Proceeding..."
#
# Token lifetime depends on your Secret Server configuration.
# Use token-status --json to see minutesLeft and expiresAt for your installation.

set -euo pipefail

TOKEN_JSON=$(ss-cli token-status --json 2>/dev/null || echo '{"valid":false,"source":"none"}')

VALID=$(echo "$TOKEN_JSON" | grep -o '"valid":[^,}]*' | cut -d: -f2 | tr -d ' ')
SOURCE=$(echo "$TOKEN_JSON" | grep -o '"source":"[^"]*"' | cut -d: -f2 | tr -d '"')
MINUTES=$(echo "$TOKEN_JSON" | grep -o '"minutesLeft":[^,}]*' | cut -d: -f2 | tr -d ' ')

if [[ "$VALID" != "true" ]]; then
    echo "ERROR: No valid Secret Server token found (source: $SOURCE)."
    echo "A human must authenticate: ss-cli login"
    exit 1
fi

if [[ "$SOURCE" == "file" && -n "$MINUTES" && "$MINUTES" != "null" ]]; then
    echo "Token valid. Source: $SOURCE | Minutes remaining: $MINUTES"
    if (( $(echo "$MINUTES < 5" | bc -l) )); then
        echo "WARNING: Token expires in less than 5 minutes. Consider re-authenticating."
    fi
elif [[ "$SOURCE" == "session" ]]; then
    echo "Token valid. Source: in-memory session (SS_TOKEN)"
else
    echo "Token valid. Source: $SOURCE"
fi

exit 0
