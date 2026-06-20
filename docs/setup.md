# 部署说明

说明：本文档正文使用中文；产品名、命令名、协议名、路径和代码标识保留英文原文，避免执行命令或配置时产生歧义。

本文说明 `mobile-terminal` 在当前服务器上的安装、启动、验证和公网入口配置。

## 本机开发

进入项目目录：

```bash
cd /home/data/connect/mobile-terminal
```

安装依赖：

```bash
npm install
```

构建前端和后端：

```bash
npm run build
```

创建第一个管理员账号：

```bash
npm run init-admin -w @mobile-terminal/server -- admin 'change-me-now'
```

启动后端：

```bash
npm run start -w @mobile-terminal/server
```

默认服务监听：

```text
http://127.0.0.1:3020
```

如果本机能打开登录页，说明后端和前端静态文件已经正常。

## Cloudflare 隧道

公网访问使用 Cloudflare 隧道（`Cloudflare Tunnel`）。最终目标是：

```text
https://terminal.example.com -> Cloudflare 隧道 -> http://127.0.0.1:3020
```

Cloudflare Dashboard 操作步骤：

1. 登录 Cloudflare Dashboard。
2. 进入 `Zero Trust`。
3. 进入 `Networks` -> `Tunnels`。
4. 选择当前服务器使用的 tunnel。
5. 进入 `Public Hostnames`。
6. 新增或编辑一条公开主机名：

```text
Subdomain: terminal
Domain: example.com
Type: HTTP
URL: 127.0.0.1:3020
```

实际部署时把 `terminal.example.com` 换成自己的公网域名。不要把真实域名写入公开仓库。

服务端需要在本机 env 文件里配置公网 Origin，用于写接口和 WebSocket 的来源校验：

```env
MOBILE_TERMINAL_PUBLIC_ORIGIN=https://terminal.example.com
```

当前 systemd 服务默认读取：

```text
~/.config/mobile-terminal/mobile-terminal.env
```

修改 env 后重启：

```bash
systemctl --user restart mobile-terminal
```

如果 Cloudflare 后台的公开主机名（Public Hostname）还指向旧的裸 `ttyd`，需要改成：

```text
terminal.example.com -> http://127.0.0.1:3020
```

不要把公网入口直接指向 `ttyd` 端口。`ttyd` 只能作为本应用内部的备用终端。

## systemd 用户服务

安装服务：

```bash
cd /home/data/connect/mobile-terminal
bash scripts/install-service.sh
```

启动服务：

```bash
systemctl --user start mobile-terminal
```

查看状态：

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

## 兼容旧隧道入口

如果 Cloudflare 隧道的远程公开主机名（Public Hostname）暂时仍指向旧端口：

```text
terminal.example.com -> http://127.0.0.1:17681
```

可以启动本机兼容代理，把 `127.0.0.1:17681` 转发到正式应用：

```bash
cd /home/data/connect/mobile-terminal
bash scripts/install-proxy-service.sh
systemctl --user start mobile-terminal-proxy
systemctl --user status mobile-terminal-proxy
```

长期建议仍然是在 Cloudflare 后台直接把公开主机名（Public Hostname）改成：

```text
terminal.example.com -> http://127.0.0.1:3020
```

## 验证命令

构建验证：

```bash
npm run build
```

环境检查：

```bash
npm run doctor -w @mobile-terminal/server
```

HTTP 接口和 WebSocket 长连接检查：

```bash
npm run verify:http
```

端口检查：

```bash
ss -tulpen | rg '3020|19000'
```

tmux 检查：

```bash
tmux list-sessions
```

## 当前默认项目

开发环境里已经创建了一个默认项目：

```text
名称：connect
slug：connect
路径：/home/data/connect
tmux 会话：mt_connect
默认命令：shell
启用 ttyd：是
```

## 注意事项

- 正式环境必须修改管理员密码。
- 不要直接暴露 ttyd。
- Cloudflare Access 可以进一步限制指定邮箱访问。
- 隧道令牌不要写入仓库。
- 数据库文件 `data/app.db` 不应提交进仓库。
- 修改代码后需要重新构建并重启服务。
