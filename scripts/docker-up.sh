#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ ! -f .env ]]; then
  cp .env.example .env
  secret="$(openssl rand -base64 48 | tr -d '\n')"
  tmp="$(mktemp)"
  sed "s#^MOBILE_TERMINAL_COOKIE_SECRET=.*#MOBILE_TERMINAL_COOKIE_SECRET=$secret#" .env > "$tmp"
  mv "$tmp" .env
  chmod 600 .env
  cat <<'MSG'
已生成 .env，请先编辑以下必填项后重新运行：

- MOBILE_TERMINAL_PUBLIC_ORIGIN
- MT_ADMIN_PASSWORD
- CLOUDFLARED_TOKEN

文件位置：.env
MSG
  exit 1
fi

missing=0
check_required() {
  local key="$1"
  local placeholder="$2"
  local value
  value="$(grep -E "^${key}=" .env | tail -n 1 | cut -d= -f2- || true)"
  if [[ -z "$value" || "$value" == "$placeholder" ]]; then
    echo "缺少或未修改: $key"
    missing=1
  fi
}

check_required "MOBILE_TERMINAL_COOKIE_SECRET" "replace-with-at-least-32-random-characters"
check_required "MOBILE_TERMINAL_PUBLIC_ORIGIN" "https://terminal.example.com"
check_required "MT_ADMIN_PASSWORD" "replace-with-a-strong-password"
check_required "CLOUDFLARED_TOKEN" "replace-with-cloudflare-tunnel-token"

if [[ "$missing" == "1" ]]; then
  echo "请编辑 .env 后重新运行。"
  exit 1
fi

docker compose --profile tunnel up -d --build
