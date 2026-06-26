import type { ChildProcess } from "node:child_process";
import { brotliDecompressSync, gunzipSync, inflateSync } from "node:zlib";
import httpProxy from "http-proxy";
import http from "node:http";
import type { IncomingMessage } from "node:http";
import type { Socket } from "node:net";
import { nanoid } from "nanoid";
import WebSocket from "ws";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ProjectPermission } from "@mobile-terminal/shared";
import { config } from "./config.js";
import { spawnDetached } from "./process.js";
import { ensureSession, hasSession, type ProjectRow } from "./tmux.js";
import { injectMobileTtydControls } from "./ttyd-mobile-controls.js";

type TtydProcess = {
  projectId: string;
  port: number;
  token: string;
  process: ChildProcess;
  startedAt: string;
};

const running = new Map<string, TtydProcess>();
let nextPort = config.ttydPortStart;

const proxy = httpProxy.createProxyServer({ ws: true, xfwd: true, changeOrigin: true });

function rewriteUrl(originalUrl: string | undefined, slug: string): string {
  const original = originalUrl ?? "/";
  const prefix = `/ttyd/${slug}`;
  if (!original.startsWith(prefix)) return original;
  const next = original.slice(prefix.length);
  return next.length > 0 ? next : "/";
}

function allocatePort(): number {
  const port = nextPort;
  nextPort += 1;
  if (nextPort > config.ttydPortEnd) nextPort = config.ttydPortStart;
  return port;
}

export async function ensureTtyd(project: ProjectRow): Promise<TtydProcess> {
  const current = running.get(project.id);
  if (current && isProcessAlive(current.process) && await hasSession(project.tmux_session) && await canFetchHttp(current.port)) {
    return current;
  }
  if (current) {
    current.process.kill("SIGTERM");
    running.delete(project.id);
  }

  await ensureSession(project);
  const port = allocatePort();
  const token = nanoid(24);
  const child = spawnDetached(
    "ttyd",
    [
      "-i",
      "127.0.0.1",
      "-p",
      String(port),
      "-W",
      "-O",
      "tmux",
      "attach",
      "-t",
      project.tmux_session
    ],
    { cwd: project.path }
  );

  const item: TtydProcess = {
    projectId: project.id,
    port,
    token,
    process: child,
    startedAt: new Date().toISOString()
  };
  running.set(project.id, item);

  child.once("exit", () => {
    if (running.get(project.id)?.process === child) {
      running.delete(project.id);
    }
  });
  await waitForHttp(port);
  return item;
}

function isProcessAlive(child: ChildProcess): boolean {
  return !child.killed && child.exitCode === null && child.signalCode === null;
}

async function waitForHttp(port: number): Promise<void> {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    if (await canFetchHttp(port)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`ttyd HTTP 未就绪: ${port}`);
}

function canFetchHttp(port: number, timeoutMs = 800): Promise<boolean> {
  return new Promise((resolve) => {
    const request = http.request(
      {
        hostname: "127.0.0.1",
        port,
        method: "GET",
        path: "/",
        headers: { "accept-encoding": "identity", connection: "close" },
        timeout: timeoutMs
      },
      (response) => {
        response.resume();
        resolve(Boolean(response.statusCode && response.statusCode >= 200 && response.statusCode < 500));
      }
    );
    request.once("timeout", () => {
      request.destroy();
      resolve(false);
    });
    request.once("error", () => {
      resolve(false);
    });
    request.end();
  });
}

export function stopTtyd(projectId: string): void {
  clearTtyd(projectId);
}

function clearTtyd(projectId: string): void {
  const item = running.get(projectId);
  if (!item) return;
  item.process.kill("SIGTERM");
  setTimeout(() => {
    if (isProcessAlive(item.process)) {
      item.process.kill("SIGKILL");
    }
  }, 1500).unref();
  running.delete(projectId);
}

export function ttydStatus(projectId: string): { port: number; startedAt: string } | null {
  const item = running.get(projectId);
  if (!item) return null;
  return { port: item.port, startedAt: item.startedAt };
}

export async function proxyTtyd(
  request: FastifyRequest,
  reply: FastifyReply,
  project: ProjectRow,
  slug: string,
  permission: ProjectPermission
): Promise<void> {
  if (!("ttyd_enabled" in project) || !project.ttyd_enabled) {
    reply.code(403).send({ error: "forbidden", message: "该项目未启用 ttyd 备用终端" });
    return;
  }

  if (permission === "read") {
    // ttyd itself is writable; read-only users are blocked from fallback ttyd.
    reply.code(403).send({ error: "forbidden", message: "只读用户不能打开可写 ttyd 终端，请使用自研终端只读模式" });
    return;
  }

  const item = await ensureTtyd(project);
  const target = `http://127.0.0.1:${item.port}`;
  request.raw.url = rewriteUrl(request.raw.url, slug);
  if (request.raw.method === "GET" && (request.raw.url === "/" || request.raw.url?.startsWith("/?"))) {
    await proxyTtydHtml(request, reply, target, project.id);
    return;
  }
  reply.hijack();
  proxy.web(request.raw, reply.raw, { target }, (error: Error) => {
    if (!reply.raw.headersSent) {
      reply.raw.writeHead(502);
    }
    reply.raw.end(error.message);
  });
}

function proxyTtydHtml(request: FastifyRequest, reply: FastifyReply, target: string, projectId: string): Promise<void> {
  return new Promise((resolve) => {
    const targetUrl = new URL(target);
    const upstream = http.request(
      {
        hostname: targetUrl.hostname,
        port: Number(targetUrl.port || 80),
        method: "GET",
        path: request.raw.url ?? "/",
        headers: { ...request.headers, host: targetUrl.host, "accept-encoding": "identity" }
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        res.on("end", () => {
          const type = String(res.headers["content-type"] ?? "");
          if (!type.includes("text/html")) {
            reply.code(res.statusCode ?? 200).headers(stripHopByHopHeaders(res.headers)).send(Buffer.concat(chunks));
            resolve();
            return;
          }
          const html = decodeHttpBody(Buffer.concat(chunks), String(res.headers["content-encoding"] ?? "")).toString("utf8");
          reply
            .code(res.statusCode ?? 200)
            .header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
            .header("Content-Security-Policy", "frame-ancestors 'self'")
            .header("Pragma", "no-cache")
            .header("Expires", "0")
            .header("X-Frame-Options", "SAMEORIGIN")
            .type("text/html; charset=utf-8")
            .send(injectMobileTtydControls(html, projectId));
          resolve();
        });
      }
    );
    upstream.setTimeout(3000, () => {
      upstream.destroy(new Error("ttyd HTTP 响应超时"));
    });
    upstream.on("error", (error) => {
      clearTtyd(projectId);
      reply.code(502).type("text/plain; charset=utf-8").send(error.message);
      resolve();
    });
    upstream.end();
  });
}

function decodeHttpBody(body: Buffer, encoding: string): Buffer {
  const normalized = encoding.toLowerCase();
  if (normalized.includes("gzip") || (body[0] === 0x1f && body[1] === 0x8b)) {
    return gunzipSync(body);
  }
  if (normalized.includes("br")) {
    return brotliDecompressSync(body);
  }
  if (normalized.includes("deflate")) {
    return inflateSync(body);
  }
  return body;
}

function stripHopByHopHeaders(headers: http.IncomingHttpHeaders): Record<string, string | string[]> {
  const blocked = new Set(["connection", "content-length", "transfer-encoding", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "upgrade"]);
  const next: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (blocked.has(key.toLowerCase()) || value === undefined) continue;
    next[key] = Array.isArray(value) ? value : String(value);
  }
  return next;
}

export async function proxyTtydWebSocket(
  client: WebSocket,
  request: FastifyRequest,
  project: ProjectRow,
  permission: ProjectPermission
): Promise<void> {
  if (!("ttyd_enabled" in project) || !project.ttyd_enabled) {
    client.close(1008, "ttyd disabled");
    return;
  }
  if (permission === "read") {
    client.close(1008, "readonly users cannot open ttyd");
    return;
  }

  const item = await ensureTtyd(project);
  const protocols = String(request.headers["sec-websocket-protocol"] ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const upstream = new WebSocket(`ws://127.0.0.1:${item.port}/ws`, protocols.length > 0 ? protocols : undefined, {
    headers: {
      origin: `http://127.0.0.1:${item.port}`
    }
  });
  const pending: Array<{ data: WebSocket.RawData; binary: boolean }> = [];
  let closed = false;
  let clientAlive = true;
  let upstreamAlive = true;
  const heartbeat = setInterval(() => {
    if (closed) return;
    if (client.readyState === WebSocket.OPEN) {
      if (!clientAlive) {
        closeBoth(1011, "client heartbeat timeout");
        return;
      }
      clientAlive = false;
      client.ping();
    }
    if (upstream.readyState === WebSocket.OPEN) {
      if (!upstreamAlive) {
        closeBoth(1011, "upstream heartbeat timeout");
        return;
      }
      upstreamAlive = false;
      upstream.ping();
    }
  }, 25000);

  const closeBoth = (code = 1000, reason = "") => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    const closeCode = normalizeCloseCode(code);
    const closeReason = reason.slice(0, 120);
    if (client.readyState === WebSocket.OPEN || client.readyState === WebSocket.CONNECTING) {
      client.close(closeCode, closeReason);
    }
    if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) {
      upstream.close(closeCode, closeReason);
    }
  };

  client.on("pong", () => {
    clientAlive = true;
  });
  upstream.on("pong", () => {
    upstreamAlive = true;
  });

  client.on("message", (data, isBinary) => {
    clientAlive = true;
    if (upstream.readyState === WebSocket.OPEN) {
      upstream.send(data, { binary: isBinary });
    } else if (upstream.readyState === WebSocket.CONNECTING) {
      pending.push({ data, binary: isBinary });
    }
  });

  upstream.on("open", () => {
    for (const item of pending.splice(0)) {
      upstream.send(item.data, { binary: item.binary });
    }
  });

  upstream.on("message", (data, isBinary) => {
    upstreamAlive = true;
    if (client.readyState === WebSocket.OPEN) {
      client.send(data, { binary: isBinary });
    }
  });

  client.on("close", (code, buffer) => closeBoth(code, buffer.toString()));
  upstream.on("close", (code, buffer) => closeBoth(code, buffer.toString()));
  client.on("error", () => closeBoth(1011, "client error"));
  upstream.on("error", () => closeBoth(1011, "upstream error"));
}

function normalizeCloseCode(code: number): number {
  if (code >= 1000 && code < 5000 && ![1004, 1005, 1006].includes(code)) {
    return code;
  }
  return 1011;
}

export function registerTtydUpgrade(
  app: FastifyInstance,
  findProject: (slug: string, request: IncomingMessage) => Promise<{ project: ProjectRow; allowed: boolean } | null>
) {
  app.server.on("upgrade", async (request: IncomingMessage, socket: Socket, head: Buffer) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    const match = url.pathname.match(/^\/ttyd\/([^/]+)(\/.*)?$/);
    if (!match) return;
    const slug = match[1];
    const result = await findProject(slug, request);
    if (!result || !result.allowed || !("ttyd_enabled" in result.project) || !result.project.ttyd_enabled) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }
    const item = await ensureTtyd(result.project);
    request.url = rewriteUrl(request.url, slug);
    proxy.ws(request, socket, head, { target: `http://127.0.0.1:${item.port}` });
  });
}
