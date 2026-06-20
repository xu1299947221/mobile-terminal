# Cloudflare Tunnel Docker 独立使用说明

本文只说明 `cloudflared` 容器如何作为独立公网转发服务使用，不依赖 `mobile-terminal`。

## Tunnel 原理

Cloudflare Tunnel 的关键点是：

```text
不是公网用户主动连进你的内网，
而是内网机器主动连出去到 Cloudflare。
```

内网机器虽然没有公网 IP，但通常可以访问互联网。`cloudflared` 利用这个能力，主动向 Cloudflare 建立一条长期连接。

```text
内网机器 / Docker 宿主机
  cloudflared
      │
      │ 主动建立长连接
      ▼
  Cloudflare
```

手机或浏览器访问你的公网域名时，实际先访问的是 Cloudflare：

```text
浏览器
  │
  │ https://app.example.com
  ▼
Cloudflare
```

Cloudflare 再通过 `cloudflared` 已经建立好的连接，把请求转回内网服务：

```text
Cloudflare
  │
  │ 复用 cloudflared 的长连接
  ▼
cloudflared 容器
  │
  │ HTTP 转发
  ▼
你的本地服务
```

所以它不需要服务器开放入站端口，也不要求服务器有公网 IP。

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

## 架构图

### 单独转发宿主机服务

```text
┌────────────┐
│  浏览器/手机 │
└─────┬──────┘
      │ 1. 访问 https://app.example.com
      ▼
┌────────────────────┐
│ Cloudflare 边缘节点 │
│ DNS / HTTPS / WAF  │
└─────┬──────────────┘
      │ 2. 找到对应 Tunnel
      ▼
┌────────────────────┐
│ cloudflared 容器    │
│ 主动连 Cloudflare   │
└─────┬──────────────┘
      │ 3. 转发到宿主机服务
      ▼
┌────────────────────┐
│ 宿主机本地服务      │
│ 127.0.0.1:3000     │
└────────────────────┘
```

Docker Desktop 场景中，`cloudflared` 容器访问宿主机通常使用：

```text
http://host.docker.internal:3000
```

### 转发同一个 compose 里的服务

```text
┌────────────┐
│  浏览器/手机 │
└─────┬──────┘
      ▼
┌────────────────────┐
│ Cloudflare          │
└─────┬──────────────┘
      ▼
┌────────────────────┐
│ cloudflared 容器    │
└─────┬──────────────┘
      │ Docker 内部网络
      ▼
┌────────────────────┐
│ app 容器            │
│ http://app:3000     │
└────────────────────┘
```

同一个 `docker-compose.yml` 里的服务可以直接使用服务名访问，例如：

```text
http://app:3000
```

### 转发局域网其他机器

```text
┌────────────┐
│  浏览器/手机 │
└─────┬──────┘
      ▼
┌────────────────────┐
│ Cloudflare          │
└─────┬──────────────┘
      ▼
┌────────────────────┐
│ cloudflared 容器    │
└─────┬──────────────┘
      │ 局域网访问
      ▼
┌────────────────────┐
│ 192.168.1.50:8080  │
└────────────────────┘
```

前提是运行 `cloudflared` 的机器能访问这个局域网 IP 和端口。

## 数据流转

### HTTP 页面请求

```text
1. 浏览器访问：
   https://app.example.com

2. DNS 指向 Cloudflare。

3. Cloudflare 判断这个域名属于某个 Tunnel。

4. Cloudflare 通过已连接的 cloudflared，把 HTTP 请求交给内网机器。

5. cloudflared 根据 Cloudflare 后台 Public Hostnames 的配置，把请求转发到本地目标服务。

6. 本地服务返回 HTML / JSON / 文件。

7. 响应按原路返回浏览器。
```

图示：

```text
浏览器
  │ HTTPS 请求
  ▼
Cloudflare
  │ Tunnel 长连接
  ▼
cloudflared 容器
  │ HTTP 转发
  ▼
本地服务
  │ HTTP 响应
  ▼
cloudflared
  ▼
Cloudflare
  ▼
浏览器
```

### WebSocket 请求

WebSocket 也是同一条公网入口，只是协议从普通 HTTP 升级为长连接。

```text
浏览器 WebSocket
  -> Cloudflare
  -> cloudflared
  -> 本地 WebSocket 服务
```

如果本地服务支持 WebSocket，Cloudflare Tunnel 可以转发。`mobile-terminal` 的终端实时输出就是通过 WebSocket/代理链路返回手机。

## 支持的转发类型

Cloudflare Tunnel 不只支持 HTTP 和 WebSocket，但不同类型的使用方式不一样。

### 浏览器可以直接访问的类型

这类最适合普通网页、后台系统、API、`ttyd`、WebSocket 实时终端。

```text
HTTP      -> http://127.0.0.1:3000
HTTPS     -> https://127.0.0.1:8443
WebSocket -> 走 HTTP/HTTPS 升级连接，Public Hostname 仍然配置 HTTP 或 HTTPS
```

手机浏览器访问：

```text
https://app.example.com
```

Cloudflare 根据 Public Hostnames 把请求转发给：

```text
http://host.docker.internal:3000
```

对 `mobile-terminal` 来说，最核心就是：

```text
浏览器 HTTPS 页面
浏览器 WebSocket 终端流
  -> Cloudflare
  -> cloudflared
  -> mobile-terminal / ttyd / 本地 Web 服务
```

### 非 HTTP 类型

Cloudflare Tunnel 也可以配置非 HTTP 服务，例如：

```text
SSH  -> ssh://localhost:22
RDP  -> rdp://localhost:3389
SMB  -> smb://localhost:445
TCP  -> tcp://localhost:5432
```

但是这类不能简单理解成“浏览器直接打开域名就能用”。一般需要客户端也安装 `cloudflared`，或者使用 Cloudflare Zero Trust / WARP / Access 相关客户端能力。

例如任意 TCP 服务通常是：

```text
客户端机器
  cloudflared access tcp
      │
      ▼
Cloudflare
      │
      ▼
内网 cloudflared
      │
      ▼
内网 TCP 服务
```

也就是说：

- 网页系统、API、WebSocket：直接用浏览器访问域名。
- SSH、RDP、数据库、普通 TCP：通常需要客户端工具配合。
- 不建议把数据库、SSH、RDP 当作普通公网裸服务暴露，必须配合强认证和访问控制。

### Public Hostname 常见 Service 类型

后台 Public Hostnames 的 Service 可以填写的常见形式：

```text
http://localhost:3000
https://localhost:8443
ssh://localhost:22
rdp://localhost:3389
smb://localhost:445
tcp://localhost:5432
unix:/path/to/socket
unix+tls:/path/to/socket
http_status:404
bastion
hello_world
```

实际可用类型以 Cloudflare 官方文档和后台当前页面为准：

```text
https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/routing-to-tunnel/protocols/
```

### UDP 需要单独理解

Cloudflare Tunnel 自己连接 Cloudflare 时可以使用 QUIC 等传输方式，但这不等于可以像 HTTP 一样随便把任意 UDP 服务发布成公网域名。

如果要做游戏 UDP、内网组网、私有网络访问一类需求，要按 Cloudflare Zero Trust、WARP、private network routing 等方案单独设计，不能直接套普通 Public Hostname 的网页转发思路。

## cloudflared 和 Public Hostnames 的分工

`cloudflared` 容器只需要知道“我属于哪个 Tunnel”。这个身份由 token 决定：

```text
CLOUDFLARED_TOKEN=...
```

具体哪个域名转发到哪个内网地址，在 Cloudflare 后台配置：

```text
Public Hostname:
app.example.com -> http://host.docker.internal:3000
```

可以理解成：

```text
cloudflared 容器：
  我是谁？由 token 决定。

Cloudflare 后台：
  哪些域名进入这个 Tunnel？
  每个域名转发到哪里？
```

当前文档使用的是 Cloudflare 后台托管配置方式。还有另一种本地 `config.yml` 方式，可以把 ingress 规则写在本地文件里，但本项目默认不使用。

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

## Free 套餐和延迟

Cloudflare Free 没有公开固定的每月流量额度。对 `mobile-terminal` 这种终端文本、WebSocket 回显和少量 API 请求来说，流量很小，通常可以长期使用。

不要把 Free Tunnel 当作网盘、下载站、视频流或大文件分发通道。Cloudflare Free 没有 SLA，也不能保证国内访问一定落到低延迟节点。

如果国内访问延迟不理想，优先用应用首页的“延迟测试”面板对比网络/VPN 节点。需要更稳定低延迟时，可以考虑香港、日本或新加坡 VPS 自建中转。详细说明见 [网络、Cloudflare 和延迟优化](network-latency.md)。

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
