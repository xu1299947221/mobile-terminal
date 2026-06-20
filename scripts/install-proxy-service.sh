#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE_DIR="${HOME}/.config/systemd/user"
SERVICE_FILE="${SERVICE_DIR}/mobile-terminal-proxy.service"

mkdir -p "$SERVICE_DIR"

cat > "$SERVICE_FILE" <<SERVICE
[Unit]
Description=mobile-terminal local tunnel compatibility proxy
After=mobile-terminal.service
Requires=mobile-terminal.service

[Service]
Type=simple
WorkingDirectory=${ROOT}
Environment=MOBILE_TERMINAL_PROXY_HOST=127.0.0.1
Environment=MOBILE_TERMINAL_PROXY_PORT=17681
Environment=MOBILE_TERMINAL_PROXY_TARGET=http://127.0.0.1:3020
ExecStart=/usr/bin/node ${ROOT}/scripts/local-proxy.mjs
Restart=always
RestartSec=3

[Install]
WantedBy=default.target
SERVICE

systemctl --user daemon-reload
systemctl --user enable mobile-terminal-proxy.service

echo "Installed ${SERVICE_FILE}"
echo "Start with: systemctl --user start mobile-terminal-proxy"
