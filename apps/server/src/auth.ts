import crypto from "node:crypto";
import argon2 from "argon2";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { User } from "@mobile-terminal/shared";
import { db, id, nowIso } from "./db.js";
import { config } from "./config.js";

const sessionTtlMs = 1000 * 60 * 60 * 24 * 14;

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function publicUser(row: any): User {
  const hasProjectAdmin =
    row.role === "admin" ||
    (row.role !== "viewer" &&
      Boolean(db.prepare("SELECT 1 FROM project_permissions WHERE user_id = ? AND permission = 'admin' LIMIT 1").get(row.id)));
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    enabled: Boolean(row.enabled),
    hasProjectAdmin,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id });
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  return argon2.verify(hash, password);
}

export function getUserById(userId: string): User | null {
  const row = db.prepare("SELECT * FROM users WHERE id = ? AND enabled = 1").get(userId);
  return row ? publicUser(row) : null;
}

export function getUserBySessionToken(token: string): { user: User; sessionId: string } | null {
  const row = db.prepare(`
    SELECT sessions.id AS session_id, users.*
    FROM sessions
    JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ? AND sessions.expires_at > ? AND users.enabled = 1
  `).get(hashToken(token), nowIso()) as any;
  if (!row) return null;
  return { user: publicUser(row), sessionId: row.session_id };
}

export function getUserPassword(username: string): any | null {
  return db.prepare("SELECT * FROM users WHERE username = ? AND enabled = 1").get(username) ?? null;
}

export function createSession(userId: string): { token: string; expiresAt: string; sessionId: string } {
  const token = crypto.randomBytes(32).toString("base64url");
  const sessionId = id("ses");
  const expiresAt = new Date(Date.now() + sessionTtlMs).toISOString();
  db.prepare(`
    INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(sessionId, userId, hashToken(token), expiresAt, nowIso());
  return { token, expiresAt, sessionId };
}

export function deleteSession(token: string): void {
  db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(token));
}

export function sessionCookieOptions() {
  return {
    path: "/",
    httpOnly: true,
    secure: config.isProduction,
    sameSite: "lax" as const,
    maxAge: Math.floor(sessionTtlMs / 1000)
  };
}

export async function authHook(request: FastifyRequest): Promise<void> {
  const token = request.cookies?.[config.cookieName];
  if (!token) return;
  const session = getUserBySessionToken(token);
  if (!session) return;
  request.sessionId = session.sessionId;
  request.user = session.user;
}

export function requireAuth(request: FastifyRequest, reply: FastifyReply): boolean {
  if (!request.user) {
    reply.code(401).send({ error: "unauthorized", message: "需要登录" });
    return false;
  }
  return true;
}

export function requireAdmin(request: FastifyRequest, reply: FastifyReply): boolean {
  if (!requireAuth(request, reply)) return false;
  if (request.user?.role !== "admin") {
    reply.code(403).send({ error: "forbidden", message: "需要管理员权限" });
    return false;
  }
  return true;
}

export async function registerAuth(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authHook);
}
