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

## 文档

- [部署说明](docs/setup.md)
- [安全设计](docs/security.md)
- [规格文档](/home/data/connect/mobile-terminal-spec.md)

## 后续开发原则

- 以 `/home/data/connect/mobile-terminal-spec.md` 为准。
- 不做公开注册，只允许管理员创建用户。
- 不直接暴露 `ttyd`，必须通过本应用鉴权后访问。
- 不误杀与本系统无关的 `tmux` 会话。
- 不能把 Cloudflare 隧道令牌、数据库、日志、`.env` 提交进仓库。
