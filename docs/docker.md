# Docker 部署

本文说明如何用 Docker Compose 一键部署 `mobile-terminal`。Docker 方式适合 Linux、Windows Docker Desktop 和 macOS Docker Desktop；在 Windows 上实际运行的是 Docker Desktop 背后的 Linux 容器环境，不是 Windows 原生终端环境。

## 前提条件

必备：

- Docker Engine 或 Docker Desktop。
- Docker Compose v2。
- 一个 Cloudflare Tunnel token。
- 一个公网域名，例如 `https://terminal.example.com`。

Windows 用户建议：

- 使用 Docker Desktop 的 WSL2 backend。
- 项目代码和工作目录尽量放在 WSL2 文件系统中，避免 Windows 挂载目录带来的 IO 性能问题。

## 快速启动

交互式一键部署：

```bash
bash scripts/docker-up.sh
```

脚本会逐项提示需要填写的内容。直接回车会使用默认值；密码、随机密钥和 Cloudflare token 不会回显。填写完成后脚本会生成 `.env`，并询问是否立即执行 `docker compose --profile tunnel up -d --build`。

手动方式是复制环境变量模板：

```bash
cp .env.example .env
```

编辑 `.env`：

```env
MOBILE_TERMINAL_COOKIE_SECRET=至少 32 个字符的随机密钥
MOBILE_TERMINAL_PUBLIC_ORIGIN=https://terminal.example.com

MT_ADMIN_USER=admin
MT_ADMIN_PASSWORD=你的强密码

CLOUDFLARED_TOKEN=Cloudflare Tunnel token
```

启动：

```bash
docker compose --profile tunnel up -d --build
```

如果只想本地测试应用、不启动 Cloudflare Tunnel：

```bash
docker compose up -d --build mobile-terminal
```

查看日志：

```bash
docker compose logs -f mobile-terminal
docker compose logs -f cloudflared
```

停止：

```bash
docker compose down
```

## Cloudflare 配置

Cloudflare Tunnel 的 Public Hostname 指向 compose 内部服务：

```text
Subdomain: terminal
Domain: example.com
Type: HTTP
URL: http://mobile-terminal:3020
```

如果不使用 compose 里的 `cloudflared` 服务，也可以在宿主机运行 Cloudflare Tunnel，并把 Public Hostname 指向：

```text
http://127.0.0.1:3020
```

## 持久化数据

默认持久化：

- `mobile-terminal-data`：SQLite 数据库。
- `mobile-terminal-home`：容器内 `/root`，可保存 CLI 登录态和 SSH 配置。
- `./workspace`：默认项目目录，挂载到容器 `/workspace`。

默认项目：

```text
名称：workspace
slug：workspace
路径：/workspace
tmux 会话：mt_workspace
默认命令：shell
```

可以通过 `.env` 里的 `MT_PROJECT_*` 变量调整。

## Codex / Claude CLI

当前镜像默认安装运行本系统所需的 Node.js、tmux、ttyd、git 和 ssh。Codex CLI、Claude Code CLI 或自定义 `cc` 命令需要按你的使用方式额外加入镜像，常见做法是：

- 基于本项目 `Dockerfile` 派生自己的镜像。
- 在 Dockerfile 里安装 Codex/Claude CLI。
- 把 CLI 登录态保存在 `mobile-terminal-home` volume。

如果不安装这些 CLI，系统仍可用于普通 shell 和 tmux 终端。

## 安全注意

- `.env` 不要提交进仓库。
- `CLOUDFLARED_TOKEN` 不要写进 Dockerfile。
- `MOBILE_TERMINAL_COOKIE_SECRET` 必须是强随机值。
- `MOBILE_TERMINAL_PUBLIC_ORIGIN` 必须与实际公网地址一致，否则 Origin 校验会拒绝写操作和 WebSocket。
- 不要把 Cloudflare Public Hostname 指向裸 `ttyd` 端口。
