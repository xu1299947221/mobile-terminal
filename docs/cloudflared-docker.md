# Cloudflare Tunnel Docker 独立使用说明

本文只说明 `cloudflared` 容器如何作为独立公网转发服务使用，不依赖 `mobile-terminal`。

## 它解决什么问题

没有公网 IP、不能做端口映射时，内网机器仍然可以通过 Cloudflare Tunnel 暴露一个 HTTPS 域名。

核心链路：

```text
浏览器
  -> Cloudflare
  -> cloudflared 容器
  -> 你的本地服务
```

`cloudflared` 容器只负责转发，不负责登录鉴权、不负责业务逻辑。你的业务服务仍然需要自己做好认证和权限控制。

## 交互式启动脚本

仓库里提供了一个可单独拷走的示例目录：

```text
examples/cloudflared-docker
```

使用：

```bash
cd examples/cloudflared-docker
bash tunnel-up.sh
```

脚本会提示填写 `Cloudflare Tunnel token`，并生成本地 `.env` 文件。`.env` 不要提交进仓库。

注意：这个脚本只配置并启动 `cloudflared` 容器。域名转发到哪个内网地址，仍然在 Cloudflare 后台 `Public Hostnames` 里配置。

## 最小 compose

创建目录：

```bash
mkdir cloudflared-tunnel
cd cloudflared-tunnel
```

创建 `.env`：

```env
CLOUDFLARED_TOKEN=你的 Cloudflare Tunnel token
```

创建 `docker-compose.yml`：

```yaml
services:
  cloudflared:
    image: cloudflare/cloudflared:latest
    restart: unless-stopped
    command: tunnel --no-autoupdate run --token ${CLOUDFLARED_TOKEN}
```

启动：

```bash
docker compose up -d
```

查看日志：

```bash
docker compose logs -f
```

停止：

```bash
docker compose down
```

## Cloudflare 后台配置

进入 Cloudflare Dashboard：

1. `Zero Trust`
2. `Networks`
3. `Tunnels`
4. 选择你的 tunnel
5. `Public Hostnames`
6. 新增公开主机名

示例：

```text
Subdomain: app
Domain: example.com
Type: HTTP
URL: http://host.docker.internal:3000
```

含义：

```text
https://app.example.com
  -> Cloudflare
  -> cloudflared 容器
  -> http://host.docker.internal:3000
```

## 转发不同位置的服务

### 转发同一个 compose 里的服务

如果业务服务也在同一个 `docker-compose.yml` 里，可以直接用服务名。

```yaml
services:
  app:
    image: nginx:alpine
    restart: unless-stopped

  cloudflared:
    image: cloudflare/cloudflared:latest
    restart: unless-stopped
    command: tunnel --no-autoupdate run --token ${CLOUDFLARED_TOKEN}
```

Cloudflare Public Hostname 填：

```text
Type: HTTP
URL: http://app:80
```

### 转发宿主机服务

如果你的服务跑在宿主机，比如：

```text
http://127.0.0.1:3000
```

Docker Desktop 上通常填：

```text
http://host.docker.internal:3000
```

Linux Docker 上可在 compose 里加：

```yaml
services:
  cloudflared:
    image: cloudflare/cloudflared:latest
    restart: unless-stopped
    command: tunnel --no-autoupdate run --token ${CLOUDFLARED_TOKEN}
    extra_hosts:
      - "host.docker.internal:host-gateway"
```

然后 Public Hostname 填：

```text
http://host.docker.internal:3000
```

### 转发局域网其他机器

如果服务在另一台内网机器上：

```text
http://192.168.1.10:8080
```

Public Hostname 填：

```text
http://192.168.1.10:8080
```

前提是运行 `cloudflared` 的机器能访问这个局域网地址。

## 多个域名转发

一个 tunnel 可以配置多个 Public Hostname，例如：

```text
app.example.com      -> http://host.docker.internal:3000
api.example.com      -> http://host.docker.internal:8000
terminal.example.com -> http://mobile-terminal:3020
```

这些规则在 Cloudflare 后台配置，不需要为每个域名启动一个 `cloudflared` 容器。

## 安全注意

- `.env` 不要提交进仓库。
- `CLOUDFLARED_TOKEN` 泄露后要在 Cloudflare 后台轮换。
- 不要把没有认证的管理后台直接暴露给公网。
- 对重要后台建议启用 Cloudflare Access，只允许指定邮箱访问。
- Tunnel 只是转发流量，不等于业务系统已经安全。
- 如果业务服务有 WebSocket，需要确认服务本身支持反向代理场景。

## 常见问题

### cloudflared 容器启动了，但域名打不开

检查：

- `docker compose logs -f cloudflared`
- Cloudflare Tunnel 是否显示 healthy。
- Public Hostname 的 URL 是否能从容器内访问。
- 域名 DNS 是否由 Cloudflare 托管。

### Docker 容器访问不到宿主机 127.0.0.1

容器里的 `127.0.0.1` 是容器自己，不是宿主机。

宿主机服务应使用：

```text
host.docker.internal
```

Linux 上如果不可用，给 compose 加：

```yaml
extra_hosts:
  - "host.docker.internal:host-gateway"
```

### 是否需要开放服务器入站端口

不需要。`cloudflared` 是主动连接 Cloudflare，外部请求通过这条已建立连接转回来。

但服务器必须能访问互联网，至少能连接 Cloudflare。
