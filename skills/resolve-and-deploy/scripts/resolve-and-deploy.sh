#!/usr/bin/env bash
# skills/resolve-and-deploy.sh
#
# Skill: Resolve a template file with secrets and deploy to a remote server
# Secrets flow through stdin/stdout — never stored on remote disk between runs.
#
# Usage: ./skills/resolve-and-deploy.sh --template <file> --remote user@host --remote-path <path> [--restart <service>]
#
# Example:
#   ./skills/resolve-and-deploy.sh \
#     --template nginx.conf.tpl \
#     --remote deploy@webserver01 \
#     --remote-path /etc/nginx/conf.d/app.conf \
#     --restart nginx

set -euo pipefail

TEMPLATE=""
REMOTE=""
REMOTE_PATH=""
RESTART_SERVICE=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --template)    TEMPLATE="$2"; shift 2 ;;
        --remote)      REMOTE="$2"; shift 2 ;;
        --remote-path) REMOTE_PATH="$2"; shift 2 ;;
        --restart)     RESTART_SERVICE="$2"; shift 2 ;;
        *) echo "Unknown flag: $1"; exit 1 ;;
    esac
done

if [[ -z "$TEMPLATE" || -z "$REMOTE" || -z "$REMOTE_PATH" ]]; then
    echo "ERROR: --template, --remote, and --remote-path are required"
    echo "Usage: $0 --template <file> --remote user@host --remote-path <path> [--restart <service>]"
    exit 1
fi

# Check token validity
TOKEN_JSON=$(ss-cli token-status --json)
VALID=$(echo "$TOKEN_JSON" | grep -o '"valid":[^,}]*' | cut -d: -f2 | tr -d ' ')

if [[ "$VALID" != "true" ]]; then
    echo "ERROR: Secret Server token is not valid. Run: ss-cli login"
    exit 1
fi

echo "Resolving template: $TEMPLATE"
echo "Deploying to: $REMOTE:$REMOTE_PATH"

# Resolve placeholders and pipe directly to the remote server
ss-cli resolve --input "$TEMPLATE" | ssh "$REMOTE" "sudo tee '$REMOTE_PATH' > /dev/null"
echo "Config deployed."

if [[ -n "$RESTART_SERVICE" ]]; then
    echo "Restarting $RESTART_SERVICE on $REMOTE..."
    ssh "$REMOTE" "sudo systemctl reload '$RESTART_SERVICE' 2>/dev/null || sudo systemctl restart '$RESTART_SERVICE'"
    echo "Service reloaded."
fi

echo "Done."
