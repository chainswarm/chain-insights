#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../../.." && pwd)"
COMPOSE_FILE="$REPO_ROOT/repos/infra/chain-insights/devkit/docker-compose.yml"

docker compose -f "$COMPOSE_FILE" down -v --remove-orphans
