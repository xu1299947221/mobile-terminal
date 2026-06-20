#!/usr/bin/env bash
set -euo pipefail

mkdir -p /data /workspace

if [[ -n "${MT_ADMIN_USER:-}" && -n "${MT_ADMIN_PASSWORD:-}" ]]; then
  node apps/server/dist/cli.js init-admin "$MT_ADMIN_USER" "$MT_ADMIN_PASSWORD" "${MT_ADMIN_DISPLAY_NAME:-$MT_ADMIN_USER}"
fi

if [[ "${MT_INIT_PROJECT:-1}" != "0" ]]; then
  node apps/server/dist/cli.js init-project \
    "${MT_PROJECT_NAME:-workspace}" \
    "${MT_PROJECT_SLUG:-workspace}" \
    "${MT_PROJECT_PATH:-/workspace}" \
    "${MT_PROJECT_TMUX_SESSION:-mt_workspace}" \
    "${MT_PROJECT_DEFAULT_COMMAND:-shell}"
fi

exec "$@"
