import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { config } from "./config.js";

const unsafeMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const loginAttempts = new Map<string, { count: number; resetAt: number; blockedUntil: number }>();

const loginWindowMs = 5 * 60 * 1000;
const loginBlockMs = 10 * 60 * 1000;
const maxLoginFailures = 8;

function clientIp(request: FastifyRequest): string {
  const forwarded = request.headers["cf-connecting-ip"] ?? request.headers["x-forwarded-for"];
  if (Array.isArray(forwarded)) return forwarded[0] ?? request.ip;
  if (forwarded) return forwarded.split(",")[0]?.trim() || request.ip;
  return request.ip;
}

function loginKey(request: FastifyRequest, username: string): string {
  return `${clientIp(request)}:${username.trim().toLowerCase()}`;
}

export function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return true;
  const allowed = new Set([
    config.publicOrigin,
    `http://${config.host}:${config.port}`,
    `http://127.0.0.1:${config.port}`,
    `http://localhost:${config.port}`
  ]);
  return allowed.has(origin);
}

export function assertAllowedOrigin(request: FastifyRequest, reply: FastifyReply): boolean {
  if (!unsafeMethods.has(request.method)) return true;
  if (isAllowedOrigin(request.headers.origin)) return true;
  reply.code(403).send({ error: "forbidden", message: "请求来源不被允许" });
  return false;
}

function setSecurityHeaders(reply: FastifyReply): void {
  reply.header("X-Content-Type-Options", "nosniff");
  reply.header("Referrer-Policy", "same-origin");
  reply.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  reply.header("X-Frame-Options", "DENY");
  reply.header("Content-Security-Policy", "frame-ancestors 'none'");
  if (config.isProduction) {
    reply.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");
  }
}

export function checkLoginRateLimit(request: FastifyRequest, reply: FastifyReply, username: string): boolean {
  const now = Date.now();
  const key = loginKey(request, username);
  const current = loginAttempts.get(key);
  if (current?.blockedUntil && current.blockedUntil > now) {
    const retryAfter = Math.ceil((current.blockedUntil - now) / 1000);
    reply.header("Retry-After", String(retryAfter));
    reply.code(429).send({ error: "rate_limited", message: "登录失败次数过多，请稍后再试" });
    return false;
  }
  if (current && current.resetAt <= now) {
    loginAttempts.delete(key);
  }
  return true;
}

export function recordLoginFailure(request: FastifyRequest, username: string): void {
  const now = Date.now();
  const key = loginKey(request, username);
  const current = loginAttempts.get(key);
  const next =
    current && current.resetAt > now
      ? { ...current, count: current.count + 1 }
      : { count: 1, resetAt: now + loginWindowMs, blockedUntil: 0 };
  if (next.count >= maxLoginFailures) {
    next.blockedUntil = now + loginBlockMs;
  }
  loginAttempts.set(key, next);
}

export function recordLoginSuccess(request: FastifyRequest, username: string): void {
  loginAttempts.delete(loginKey(request, username));
}

export async function registerSecurity(app: FastifyInstance): Promise<void> {
  app.addHook("onRequest", async (request, reply) => {
    setSecurityHeaders(reply);
    if (!assertAllowedOrigin(request, reply)) return reply;
  });
}
