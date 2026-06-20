#!/usr/bin/env node
import http from "node:http";
import net from "node:net";
import { URL } from "node:url";

const listenHost = process.env.MOBILE_TERMINAL_PROXY_HOST ?? "127.0.0.1";
const listenPort = Number(process.env.MOBILE_TERMINAL_PROXY_PORT ?? "17681");
const target = new URL(process.env.MOBILE_TERMINAL_PROXY_TARGET ?? "http://127.0.0.1:3020");

const server = http.createServer((req, res) => {
  const headers = { ...req.headers, host: target.host };
  const proxyReq = http.request(
    {
      hostname: target.hostname,
      port: Number(target.port || 80),
      method: req.method,
      path: req.url,
      headers
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
      proxyRes.pipe(res);
    }
  );

  proxyReq.on("error", (error) => {
    if (!res.headersSent) {
      res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
    }
    res.end(error.message);
  });
  req.pipe(proxyReq);
});

server.on("upgrade", (req, socket, head) => {
  const upstream = net.connect(Number(target.port || 80), target.hostname, () => {
    upstream.write(`${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`);
    const headers = { ...req.headers, host: target.host };
    for (const [key, value] of Object.entries(headers)) {
      if (Array.isArray(value)) {
        for (const item of value) upstream.write(`${key}: ${item}\r\n`);
      } else if (value !== undefined) {
        upstream.write(`${key}: ${value}\r\n`);
      }
    }
    upstream.write("\r\n");
    if (head.length > 0) upstream.write(head);
    socket.pipe(upstream).pipe(socket);
  });

  upstream.on("error", () => {
    socket.destroy();
  });
});

server.listen(listenPort, listenHost, () => {
  console.log(`mobile-terminal local proxy listening on http://${listenHost}:${listenPort} -> ${target.href}`);
});
