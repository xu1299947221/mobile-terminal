#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

ENV_FILE=".env"

env_get() {
  local key="$1"
  if [[ -f "$ENV_FILE" ]]; then
    grep -E "^${key}=" "$ENV_FILE" | tail -n 1 | cut -d= -f2- || true
  fi
}

generate_secret() {
  openssl rand -base64 48 | tr -d '\n'
}

prompt_text() {
  local key="$1"
  local label="$2"
  local default_value="$3"
  local required="${4:-0}"
  local current
  current="$(env_get "$key")"
  local shown="${current:-$default_value}"
  while true; do
    if [[ -n "$shown" ]]; then
      read -r -p "$label [$shown]: " value
    else
      read -r -p "$label: " value
    fi
    value="${value:-$shown}"
    if [[ "$required" == "1" && -z "$value" ]]; then
      echo "该项必填。" >&2
      continue
    fi
    printf '%s' "$value"
    return
  done
}

prompt_secret() {
  local key="$1"
  local label="$2"
  local default_value="$3"
  local required="${4:-0}"
  local current
  current="$(env_get "$key")"
  local hint="未设置"
  if [[ -n "$current" && "$current" != "$default_value" ]]; then
    hint="已设置，直接回车保持不变"
  fi
  while true; do
    read -r -s -p "$label ($hint): " value
    echo >&2
    if [[ -z "$value" && -n "$current" ]]; then
      value="$current"
    elif [[ -z "$value" ]]; then
      value="$default_value"
    fi
    if [[ "$required" == "1" && -z "$value" ]]; then
      echo "该项必填。" >&2
      continue
    fi
    printf '%s' "$value"
    return
  done
}

write_env() {
  local cookie_secret="$1"
  local public_origin="$2"
  local admin_user="$3"
  local admin_password="$4"
  local admin_display_name="$5"
  local project_name="$6"
  local project_slug="$7"
  local project_path="$8"
  local project_session="$9"
  local project_command="${10}"
  local cloudflared_token="${11}"

  cat > "$ENV_FILE" <<EOF
MOBILE_TERMINAL_COOKIE_SECRET=$cookie_secret
MOBILE_TERMINAL_PUBLIC_ORIGIN=$public_origin

MT_ADMIN_USER=$admin_user
MT_ADMIN_PASSWORD=$admin_password
MT_ADMIN_DISPLAY_NAME=$admin_display_name

MT_PROJECT_NAME=$project_name
MT_PROJECT_SLUG=$project_slug
MT_PROJECT_PATH=$project_path
MT_PROJECT_TMUX_SESSION=$project_session
MT_PROJECT_DEFAULT_COMMAND=$project_command

CLOUDFLARED_TOKEN=$cloudflared_token
EOF
  chmod 600 "$ENV_FILE"
}

cat <<'MSG'
mobile-terminal Docker 部署向导

说明：
- 直接回车会使用括号里的默认值。
- 密码、密钥和 Cloudflare token 不会回显。
- .env 会保存在当前目录，不能提交进仓库。
MSG

default_secret="$(env_get MOBILE_TERMINAL_COOKIE_SECRET)"
if [[ -z "$default_secret" || "$default_secret" == "replace-with-at-least-32-random-characters" ]]; then
  default_secret="$(generate_secret)"
fi

cookie_secret="$(prompt_secret MOBILE_TERMINAL_COOKIE_SECRET "Cookie 随机密钥，自动生成即可" "$default_secret" 1)"
public_origin="$(prompt_text MOBILE_TERMINAL_PUBLIC_ORIGIN "公网访问地址，例如 https://terminal.example.com" "https://terminal.example.com" 1)"

admin_user="$(prompt_text MT_ADMIN_USER "管理员用户名" "admin" 1)"
admin_password="$(prompt_secret MT_ADMIN_PASSWORD "管理员密码" "" 1)"
admin_display_name="$(prompt_text MT_ADMIN_DISPLAY_NAME "管理员显示名" "$admin_user" 1)"

project_name="$(prompt_text MT_PROJECT_NAME "默认项目名称" "workspace" 1)"
project_slug="$(prompt_text MT_PROJECT_SLUG "默认项目访问标识 slug" "workspace" 1)"
project_path="$(prompt_text MT_PROJECT_PATH "默认项目目录，容器内路径" "/workspace" 1)"
project_session="$(prompt_text MT_PROJECT_TMUX_SESSION "默认 tmux 会话名" "mt_${project_slug//-/_}" 1)"
project_command="$(prompt_text MT_PROJECT_DEFAULT_COMMAND "默认命令 shell/codex/claude" "shell" 1)"
cloudflared_token="$(prompt_secret CLOUDFLARED_TOKEN "Cloudflare Tunnel token" "" 1)"

if [[ ${#cookie_secret} -lt 32 ]]; then
  echo "MOBILE_TERMINAL_COOKIE_SECRET 至少需要 32 个字符。"
  exit 1
fi

case "$project_command" in
  shell|codex|claude) ;;
  *)
    echo "默认命令只能是 shell、codex 或 claude。"
    exit 1
    ;;
esac

write_env \
  "$cookie_secret" \
  "$public_origin" \
  "$admin_user" \
  "$admin_password" \
  "$admin_display_name" \
  "$project_name" \
  "$project_slug" \
  "$project_path" \
  "$project_session" \
  "$project_command" \
  "$cloudflared_token"

echo
echo ".env 已写入。"
read -r -p "现在启动 Docker 服务吗？[Y/n]: " start_now
start_now="${start_now:-Y}"
case "$start_now" in
  Y|y|YES|yes)
    docker compose --profile tunnel up -d --build
    ;;
  *)
    echo "稍后可运行：docker compose --profile tunnel up -d --build"
    ;;
esac
