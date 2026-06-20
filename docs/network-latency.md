# 网络、Cloudflare 和延迟优化

本文记录 `mobile-terminal` 在公网访问、Cloudflare Tunnel、VPN 和自建中转场景下的延迟判断方法。

## 首页延迟测试

项目页内置“延迟测试”面板，默认收起。

测试项含义：

```text
HTTP      普通 API 请求往返
WS 建连   WebSocket 建立连接耗时
WS 往返   WebSocket 消息发送到收到回显的耗时
```

移动终端体验主要看 `WS 往返`。它最接近手机输入、服务端处理、终端回显这条链路的体感。

对比 VPN 或不同网络时，建议每个节点测 2-3 次，优先比较 `WS 往返` 的平均值，其次看最低值。

## 当前推荐判断

如果不连 VPN 的 `WS 往返` 最低，就不要强行开 VPN。VPN 也是一种中转，但它只改变手机出口到 Cloudflare 的路径，不一定更快。

常见测试顺序：

```text
不连 VPN
VPN 香港
VPN 日本
VPN 新加坡
VPN 台湾
VPN 美国西海岸
```

## Cloudflare Free 使用边界

Cloudflare Free 没有公开固定的每月流量额度，也不是按普通 Web 流量计费的模式。对本项目这种终端文本、WebSocket 回显和少量 API 请求来说，流量很小，通常可以长期使用。

需要避免的用法：

```text
大文件下载
网盘/备份中转
视频/音频分发
图片或静态资源大流量分发
公开多人高并发服务
```

Free 套餐没有 SLA，也不保证国内访问一定落到低延迟节点。Cloudflare 账号、域名、Tunnel 和本机服务都正常时，当前用途可以作为长期方案使用。

## QUIC 和 HTTP/2

`cloudflared` 连接 Cloudflare 时可以使用不同传输协议。当前部署可以通过 Docker compose 的 command 切换：

```yaml
command: tunnel --no-autoupdate --protocol http2 run
```

或：

```yaml
command: tunnel --no-autoupdate --protocol quic run
```

切换后重建容器：

```bash
docker compose -f ~/.config/mobile-terminal/cloudflared-docker/docker-compose.yml up -d --force-recreate cloudflared
```

确认日志：

```bash
docker logs --tail=80 mobile-terminal-cloudflared
```

看 `Initial protocol` 和 `protocol=`。哪种更快取决于当前网络和运营商，建议用首页延迟测试实际对比。

## BBR

Linux 服务器可尝试启用 BBR：

```bash
sudo modprobe tcp_bbr
sudo sysctl -w net.core.default_qdisc=fq net.ipv4.tcp_congestion_control=bbr
printf '%s\n' 'tcp_bbr' | sudo tee /etc/modules-load.d/tcp_bbr.conf >/dev/null
printf '%s\n' 'net.core.default_qdisc = fq' 'net.ipv4.tcp_congestion_control = bbr' | sudo tee /etc/sysctl.d/99-mobile-terminal-bbr.conf >/dev/null
sudo sysctl --system
```

检查：

```bash
sysctl net.ipv4.tcp_available_congestion_control net.ipv4.tcp_congestion_control net.core.default_qdisc
lsmod | rg '^tcp_bbr'
```

BBR 对跨境 TCP 链路可能有小幅帮助，但如果主要瓶颈是 Cloudflare 落点绕远，例如落到美国西海岸，它不能从根本上把 500ms 级延迟压到 100ms。

回滚：

```bash
sudo rm /etc/modules-load.d/tcp_bbr.conf /etc/sysctl.d/99-mobile-terminal-bbr.conf
sudo sysctl -w net.core.default_qdisc=fq_codel net.ipv4.tcp_congestion_control=cubic
```

## 自建香港中转

如果目标是更低、更稳定的延迟，可以购买香港、日本或新加坡云服务器，自建中转，替代 Cloudflare Tunnel 主链路。

推荐结构：

```text
手机
  -> hk.example.com / 香港云服务器
  -> frp / gost / nginx / caddy
  -> 当前内网服务器
  -> mobile-terminal:3020
```

Cloudflare Tunnel 可以继续保留作为备用入口：

```text
ai.example.com -> Cloudflare Tunnel
hk.example.com -> 香港 VPS 自建中转
```

香港或其他非中国内地服务器通常不需要工信部 ICP 备案。中国内地服务器一般需要备案，且公网 HTTP/HTTPS 访问会受备案和云厂商策略影响。

## 域名和 DNS

如果使用自建香港中转，建议先新增子域名测试：

```text
hk.example.com -> 香港服务器公网 IP
```

如果 DNS 仍由 Cloudflare 托管，这条记录应设置为 `DNS only`，不要开启代理。否则流量仍会先进 Cloudflare，可能继续绕路。

测试满意后，再考虑把主入口切过去。
