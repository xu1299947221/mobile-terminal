#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE_DIR="${HOME}/.config/systemd/user"
SERVICE_FILE="${SERVICE_DIR}/mobile-terminal.service"

mkdir -p "$SERVICE_DIR"

cat > "$SERVICE_FILE" <<SERVICE
[Unit]
Description=mobile-terminal
After=network-online.target

[Service]
Type=simple
WorkingDirectory=${ROOT}
Environment=NODE_ENV=production
Environment=MOBILE_TERMINAL_HOST=127.0.0.1
Environment=MOBILE_TERMINAL_PORT=3020
ExecStart=/usr/bin/npm run start -w @mobile-terminal/server
Restart=always
RestartSec=3

[Install]
WantedBy=default.target
SERVICE

systemctl --user daemon-reload
systemctl --user enable mobile-terminal.service

echo "Installed ${SERVICE_FILE}"
echo "Start with: systemctl --user start mobile-terminal"

