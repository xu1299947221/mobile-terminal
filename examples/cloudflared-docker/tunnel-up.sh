#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

ENV_FILE=".env"

env_get() {
  local key="$1"
  if [[ -f "$ENV_FILE" ]]; then
    grep -E "^${key}=" "$ENV_FILE" | tail -n 1 | cut -d= -f2- || true
  fi
}

prompt_secret() {
  local key="$1"
  local label="$2"
  local current
  current="$(env_get "$key")"
  local hint="未设置"
  if [[ -n "$current" && "$current" != "replace-with-cloudflare-tunnel-token" ]]; then
    hint="已设置，直接回车保持不变"
  fi
  while true; do
    read -r -s -p "$label ($hint): " value
    echo >&2
    if [[ -z "$value" && -n "$current" ]]; then
      value="$current"
    fi
    if [[ -z "$value" || "$value" == "replace-with-cloudflare-tunnel-token" ]]; then
      echo "Cloudflare Tunnel token 必填。" >&2
      continue
    fi
    printf '%s' "$value"
    return
  done
}

cat <<'MSG'
Cloudflare Tunnel Docker 启动向导

这个脚本只配置 cloudflared 容器本身。
域名 -> 内网地址 的路由映射需要在 Cloudflare 后台 Public Hostnames 里配置。

常见目标示例：
- 同 compose 服务：http://app:3000
- Docker Desktop 宿主机：http://host.docker.internal:3000
- 局域网机器：http://192.168.1.50:8080
MSG

token="$(prompt_secret CLOUDFLARED_TOKEN "Cloudflare Tunnel token")"

cat > "$ENV_FILE" <<EOF
CLOUDFLARED_TOKEN=$token
EOF
chmod 600 "$ENV_FILE"

echo
echo ".env 已写入。"
echo "请确认 Cloudflare 后台 Public Hostnames 已配置好域名和转发目标。"
read -r -p "现在启动 cloudflared 容器吗？[Y/n]: " start_now
start_now="${start_now:-Y}"
case "$start_now" in
  Y|y|YES|yes)
    docker compose up -d
    ;;
  *)
    echo "稍后可运行：docker compose up -d"
    ;;
esac
