# mobile-terminal

`mobile-terminal` 是一个自托管的手机远程终端系统。目标是在手机浏览器里访问当前服务器上的真实 `tmux` 终端，用来操作 `Codex CLI`、`Claude Code` 或普通 shell。

说明：本文档正文使用中文；产品名、命令名、协议名、路径和代码标识保留英文原文，避免执行命令或配置时产生歧义。

它不是聊天机器人，也不做微信桥接。核心能力是：

- 手机浏览器打开 Web/PWA。
- 登录后选择项目。
- 每个项目对应一个持久 `tmux` 会话。
- 手机能看到终端实时输出。
- 手机输入会转发到服务器上的真实终端。
- 手机断开后，服务器里的任务继续运行。
- 重新打开后，仍然回到同一个项目会话。

## 当前部署信息

- 项目目录：`/home/data/connect/mobile-terminal`
- 服务监听：`http://127.0.0.1:3020`
- 公网入口：`https://terminal.example.com`
- 暴露方式：Cloudflare 隧道（`Cloudflare Tunnel`）
- 数据库：`data/app.db`
- 进程管理：`systemd --user`

## 部署环境要求

推荐并支持的部署环境是 Linux。原生 Windows 不作为支持目标，因为本项目依赖 `tmux`、PTY、systemd 用户服务和 Linux 终端生态。

Docker 部署也是支持方式，适合 Linux、Windows Docker Desktop 和 macOS Docker Desktop。Windows 上的 Docker Desktop 通常通过 WSL2/Linux VM 运行 Linux 容器，因此比 Windows 原生部署更可靠。

Windows 可以通过 WSL2 部署：

- 在 Windows 上安装 WSL2。
- 在 WSL2 里安装 Ubuntu/Debian 等 Linux 发行版。
- 后续所有命令都在 WSL2 Linux 环境内执行。
- Cloudflare Tunnel 也运行在 WSL2 里。

必备环境：

- Linux 服务器或 WSL2 Linux 环境。
- Node.js 20 或更新版本。
- npm。
- tmux。
- ttyd。
- SQLite 支持，项目通过 `better-sqlite3` 内嵌使用。
- Cloudflare Tunnel 客户端 `cloudflared`，用于公网访问。
- systemd 用户服务，推荐用于长期运行；没有 systemd 时也可以用 `npm run start -w @mobile-terminal/server` 手动启动。

Docker 部署必备：

- Docker Engine 或 Docker Desktop。
- Docker Compose v2。
- Cloudflare Tunnel token。

按需环境：

- Codex CLI：如果要在项目 session 里启动 `codex`。
- Claude Code CLI 或自定义 `cc` 命令：如果要在项目 session 里启动 Claude。
- Git 和 SSH key：如果需要拉取或推送代码仓库。

运行环境需要确保这些命令在服务进程的 `PATH` 中可用：

```bash
node --version
npm --version
tmux -V
ttyd --version
cloudflared --version
```

可以用内置检查命令查看当前环境：

```bash
npm run doctor -w @mobile-terminal/server
```

生产环境必须配置：

```env
MOBILE_TERMINAL_COOKIE_SECRET=至少 32 个字符的随机密钥
MOBILE_TERMINAL_PUBLIC_ORIGIN=https://terminal.example.com
```

不要把真实域名、隧道令牌、数据库、日志或 `.env` 文件提交进仓库。

## 技术栈

- 前端：React + Vite + TypeScript
- 终端展示：xterm.js
- 后端：Node.js + TypeScript + Fastify
- 长连接：Fastify WebSocket 插件
- 终端会话底座：tmux
- PTY：node-pty
- 备用终端：ttyd
- 数据库：SQLite

## 主要页面

- 登录页
- 项目列表
- 自研 xterm.js 终端
- ttyd 备用终端
- 管理后台

## 管理员账号

首次部署后通过下面命令创建或重置管理员账号：

```bash
npm run init-admin -w @mobile-terminal/server -- admin 'your-strong-password'
```

公网环境必须使用强密码，不要在文档、聊天记录或仓库里保存真实密码。

## 常用命令

```bash
cd /home/data/connect/mobile-terminal
```

构建：

```bash
npm run build
```

本地启动后端：

```bash
npm run start -w @mobile-terminal/server
```

检查运行环境：

```bash
npm run doctor -w @mobile-terminal/server
```

运行 HTTP 接口和 WebSocket 长连接验证：

```bash
npm run verify:http
```

查看服务状态：

```bash
systemctl --user status mobile-terminal
```

重启服务：

```bash
systemctl --user restart mobile-terminal
```

查看日志：

```bash
journalctl --user -u mobile-terminal --no-pager -n 120
```

查看 tmux 会话：

```bash
tmux ls
```

进入某个项目对应的 tmux 会话：

```bash
tmux attach -t mt_connect
```

从 tmux 退回服务器普通终端，并保持会话继续运行：

```text
Ctrl + b
松开
再按 d
```

如果快捷键不生效，也可以在 tmux 里执行：

```bash
tmux detach-client
```

Docker 一键启动：

```bash
bash scripts/docker-up.sh
```

## 文档

- [部署说明](docs/setup.md)
- [Docker 部署](docs/docker.md)
- [Cloudflare Tunnel Docker 独立使用说明](docs/cloudflared-docker.md)
- [ttyd 手机端输入体验优化方案](docs/ttyd-mobile-input-plan.md)
- [安全设计](docs/security.md)
- [规格文档](/home/data/connect/mobile-terminal-spec.md)

## 后续开发原则

- 以 `/home/data/connect/mobile-terminal-spec.md` 为准。
- 不做公开注册，只允许管理员创建用户。
- 不直接暴露 `ttyd`，必须通过本应用鉴权后访问。
- 不误杀与本系统无关的 `tmux` 会话。
- 不能把 Cloudflare 隧道令牌、数据库、日志、`.env` 提交进仓库。
