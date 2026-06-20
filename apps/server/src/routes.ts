import path from "node:path";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ProjectPermission } from "@mobile-terminal/shared";
import {
  CreateProjectRequestSchema,
  CreateUserRequestSchema,
  GrantProjectRequestSchema,
  LoginRequestSchema,
  TerminalScrollSchema,
  TerminalInputSchema,
  UpdateProjectRequestSchema,
  UpdateUserRequestSchema,
  VerifyGateRequestSchema
} from "@mobile-terminal/shared";
import { audit, db, id, nowIso } from "./db.js";
import {
  createSession,
  deleteSession,
  getUserPassword,
  hashPassword,
  requireAdmin,
  requireAuth,
  sessionCookieOptions,
  verifyPassword,
  publicUser,
  createGateToken,
  gateCookieOptions,
  readGateToken
} from "./auth.js";
import { can, managedProjectIds } from "./permissions.js";
import { assertProjectAccess, getProjectById, getProjectBySlug, mapProject, validateDirectory, visibleProjects } from "./projects.js";
import { capturePane, ensureSession, killSession, scrollHistory, startCommand } from "./tmux.js";
import { proxyTtyd, proxyTtydWebSocket, stopTtyd, ttydStatus } from "./ttyd.js";
import { commandExists } from "./process.js";
import { sendTerminalInput } from "./terminal-input.js";
import { checkLoginRateLimit, isAllowedOrigin, recordLoginFailure, recordLoginSuccess } from "./security.js";

function isZodError(error: unknown): error is { issues: Array<{ path?: Array<string | number>; code?: string }> } {
  return Boolean(error && typeof error === "object" && (error as any).name === "ZodError" && Array.isArray((error as any).issues));
}

export function handleError(error: any, reply: FastifyReply): void {
  if (isZodError(error)) {
    const first = error.issues[0];
    const field = first?.path?.join(".") || "请求参数";
    const fieldNames: Record<string, string> = {
      username: "用户名",
      password: "密码",
      answer: "验证答案",
      displayName: "显示名",
      role: "角色",
      name: "项目名称",
      slug: "访问标识",
      path: "项目目录",
      defaultCommand: "默认命令",
      tmuxSession: "tmux 会话"
    };
    const label = fieldNames[field] ?? field;
    const message =
      first?.code === "too_small"
        ? `${label}不能为空或长度不足`
        : first?.code === "invalid_format"
          ? `${label}格式不正确`
          : `${label}不符合要求`;
    reply.code(400).send({ error: "bad_request", message });
    return;
  }
  if (error?.code === "SQLITE_CONSTRAINT_UNIQUE" || error?.code === "SQLITE_CONSTRAINT_PRIMARYKEY") {
    const message = String(error?.message ?? "");
    if (message.includes("projects.slug")) {
      reply.code(409).send({ error: "conflict", message: "slug 已存在，请换一个项目访问标识" });
      return;
    }
    if (message.includes("projects.tmux_session")) {
      reply.code(409).send({ error: "conflict", message: "tmux session 已存在，请换一个 session 名称" });
      return;
    }
    reply.code(409).send({ error: "conflict", message: "数据已存在，请检查唯一字段" });
    return;
  }
  const status = error?.statusCode ?? 500;
  reply.code(status).send({
    error: status >= 500 ? "internal_error" : "bad_request",
    message: error?.message ?? "服务器错误"
  });
}

function requireProjectAdminAccess(request: FastifyRequest, reply: FastifyReply, projectId: string): ProjectPermission | null {
  if (!requireAuth(request, reply)) return null;
  const permission = assertProjectAccess(request.user!, projectId, "admin");
  if (!can(permission, "admin")) {
    reply.code(403).send({ error: "forbidden", message: "需要项目管理权限" });
    return null;
  }
  return permission;
}

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/ping", async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    return { ok: true, now: new Date().toISOString() };
  });

  app.get("/api/health", async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    return { ok: true };
  });

  app.get("/api/auth/gate", async (request) => {
    if (request.user) return { verified: true, username: request.user.username, authenticated: true };
    const gate = readGateToken(request.cookies?.mt_gate);
    return { verified: Boolean(gate), username: gate?.username ?? null, authenticated: false };
  });

  app.post("/api/auth/gate/verify", async (request, reply) => {
    const body = VerifyGateRequestSchema.parse(request.body);
    const username = body.answer.trim().toLowerCase();
    const row = db.prepare("SELECT username FROM users WHERE lower(username) = ? AND role != 'admin' AND enabled = 1").get(username) as
      | { username: string }
      | undefined;
    if (!row) {
      audit({ action: "gate_verify_failed", actorUsername: username });
      return reply.code(401).send({ error: "unauthorized", message: "验证失败" });
    }
    reply.setCookie("mt_gate", createGateToken(row.username), gateCookieOptions());
    audit({ action: "gate_verify_success", actorUsername: row.username });
    return { verified: true, username: row.username };
  });

  app.post("/api/auth/login", async (request, reply) => {
    const body = LoginRequestSchema.parse(request.body);
    const gate = readGateToken(request.cookies?.mt_gate);
    if (!gate) {
      return reply.code(403).send({ error: "forbidden", message: "请先完成访问验证" });
    }
    if (!checkLoginRateLimit(request, reply, body.username)) return;
    const row = getUserPassword(body.username);
    if (!row || !(await verifyPassword(row.password_hash, body.password))) {
      recordLoginFailure(request, body.username);
      audit({ action: "login_failed", actorUsername: body.username });
      return reply.code(401).send({ error: "unauthorized", message: "用户名或密码错误" });
    }
    recordLoginSuccess(request, body.username);
    const session = createSession(row.id);
    reply.setCookie(app.configCookieName, session.token, sessionCookieOptions());
    const user = publicUser(row);
    audit({ action: "login_success", actorUserId: user.id, actorUsername: user.username });
    return { user };
  });

  app.post("/api/auth/logout", async (request, reply) => {
    const token = request.cookies?.[app.configCookieName];
    if (token) deleteSession(token);
    reply.clearCookie(app.configCookieName, { path: "/" });
    reply.clearCookie("mt_gate", { path: "/" });
    return { ok: true };
  });

  app.get("/api/me", async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    return { user: request.user };
  });

  app.get("/api/projects", async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    return { projects: visibleProjects(request.user!) };
  });

  app.get("/api/admin/context", async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const isGlobalAdmin = request.user!.role === "admin";
    const managedIds = managedProjectIds(request.user!);
    if (!isGlobalAdmin && managedIds.length === 0) {
      return reply.code(403).send({ error: "forbidden", message: "需要项目管理权限" });
    }
    return {
      isGlobalAdmin,
      canCreateProjects: isGlobalAdmin,
      canManageUsers: isGlobalAdmin,
      managedProjectIds: managedIds
    };
  });

  app.post("/api/projects", async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    try {
      const body = CreateProjectRequestSchema.parse(request.body);
      await validateDirectory(path.resolve(body.path));
      const now = nowIso();
      const projectId = id("prj");
      db.prepare(`
        INSERT INTO projects (id, name, slug, path, default_command, tmux_session, ttyd_enabled, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'idle', ?, ?)
      `).run(projectId, body.name, body.slug, path.resolve(body.path), body.defaultCommand, body.tmuxSession, body.ttydEnabled ? 1 : 0, now, now);
      audit({ actorUserId: request.user!.id, actorUsername: request.user!.username, action: "project_created", projectId, details: { slug: body.slug } });
      return { project: mapProject(getProjectById(projectId)) };
    } catch (error) {
      handleError(error, reply);
    }
  });

  app.patch("/api/projects/:projectId", async (request, reply) => {
    try {
      const { projectId } = request.params as { projectId: string };
      const current = getProjectById(projectId);
      if (!current) return reply.code(404).send({ error: "not_found", message: "项目不存在" });
      if (!requireProjectAdminAccess(request, reply, projectId)) return;
      const body = UpdateProjectRequestSchema.parse(request.body);
      const next = {
        name: body.name ?? current.name,
        slug: body.slug ?? current.slug,
        path: path.resolve(body.path ?? current.path),
        defaultCommand: body.defaultCommand ?? current.default_command,
        tmuxSession: body.tmuxSession ?? current.tmux_session,
        ttydEnabled: body.ttydEnabled ?? Boolean(current.ttyd_enabled)
      };
      await validateDirectory(next.path);
      db.prepare(`
        UPDATE projects
        SET name = ?, slug = ?, path = ?, default_command = ?, tmux_session = ?, ttyd_enabled = ?, updated_at = ?
        WHERE id = ?
      `).run(next.name, next.slug, next.path, next.defaultCommand, next.tmuxSession, next.ttydEnabled ? 1 : 0, nowIso(), projectId);
      audit({ actorUserId: request.user!.id, actorUsername: request.user!.username, action: "project_updated", projectId });
      return { project: mapProject(getProjectById(projectId)) };
    } catch (error) {
      handleError(error, reply);
    }
  });

  app.delete("/api/projects/:projectId", async (request, reply) => {
    try {
      const { projectId } = request.params as { projectId: string };
      const current = getProjectById(projectId);
      if (!current) return reply.code(404).send({ error: "not_found", message: "项目不存在" });
      if (!requireProjectAdminAccess(request, reply, projectId)) return;
      stopTtyd(projectId);
      db.prepare("DELETE FROM project_permissions WHERE project_id = ?").run(projectId);
      db.prepare("UPDATE audit_events SET project_id = NULL WHERE project_id = ?").run(projectId);
      db.prepare("DELETE FROM projects WHERE id = ?").run(projectId);
      audit({ actorUserId: request.user!.id, actorUsername: request.user!.username, action: "project_deleted", details: { projectId, slug: current.slug } });
      return { ok: true };
    } catch (error) {
      handleError(error, reply);
    }
  });

  app.post("/api/projects/:projectId/grants", async (request, reply) => {
    try {
      const { projectId } = request.params as { projectId: string };
      if (!requireProjectAdminAccess(request, reply, projectId)) return;
      const body = GrantProjectRequestSchema.parse(request.body);
      if (body.permission === "none") {
        db.prepare("DELETE FROM project_permissions WHERE project_id = ? AND user_id = ?").run(projectId, body.userId);
        audit({
          actorUserId: request.user!.id,
          actorUsername: request.user!.username,
          action: "project_permission_revoked",
          projectId,
          details: { userId: body.userId, permission: body.permission }
        });
        return { ok: true };
      }
      const targetUser = db.prepare("SELECT role FROM users WHERE id = ?").get(body.userId) as { role: string } | undefined;
      if (!targetUser) return reply.code(404).send({ error: "not_found", message: "用户不存在" });
      if (targetUser.role === "viewer" && body.permission !== "read") {
        return reply.code(400).send({ error: "bad_request", message: "viewer 只能分配只读权限" });
      }
      const now = nowIso();
      db.prepare(`
        INSERT INTO project_permissions (project_id, user_id, permission, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(project_id, user_id)
        DO UPDATE SET permission = excluded.permission, updated_at = excluded.updated_at
      `).run(projectId, body.userId, body.permission, now, now);
      audit({
        actorUserId: request.user!.id,
        actorUsername: request.user!.username,
        action: "project_permission_updated",
        projectId,
        details: { userId: body.userId, permission: body.permission }
      });
      return { ok: true };
    } catch (error) {
      handleError(error, reply);
    }
  });

  app.get("/api/projects/:projectId/grants", async (request, reply) => {
    try {
      const { projectId } = request.params as { projectId: string };
      if (!requireProjectAdminAccess(request, reply, projectId)) return;
      const rows = db.prepare(`
        SELECT project_permissions.project_id, project_permissions.user_id, project_permissions.permission,
               users.username, users.display_name
        FROM project_permissions
        JOIN users ON users.id = project_permissions.user_id
        WHERE project_permissions.project_id = ?
          AND project_permissions.permission != 'none'
        ORDER BY users.username
      `).all(projectId);
      return { grants: rows };
    } catch (error) {
      handleError(error, reply);
    }
  });

  app.get("/api/projects/:projectId/output", async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    try {
      const { projectId } = request.params as { projectId: string };
      const project = getProjectById(projectId);
      if (!project) return reply.code(404).send({ error: "not_found", message: "项目不存在" });
      assertProjectAccess(request.user!, projectId, "read");
      const output = await capturePane(project.tmux_session);
      return { output };
    } catch (error) {
      handleError(error, reply);
    }
  });

  app.post("/api/projects/:projectId/session/ensure", async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    try {
      const { projectId } = request.params as { projectId: string };
      const project = getProjectById(projectId);
      if (!project) return reply.code(404).send({ error: "not_found", message: "项目不存在" });
      assertProjectAccess(request.user!, projectId, "write");
      await ensureSession(project);
      db.prepare("UPDATE projects SET status = 'running', updated_at = ?, last_activity_at = ? WHERE id = ?").run(nowIso(), nowIso(), projectId);
      audit({ actorUserId: request.user!.id, actorUsername: request.user!.username, action: "session_ensured", projectId });
      return { ok: true };
    } catch (error) {
      handleError(error, reply);
    }
  });

  app.post("/api/projects/:projectId/session/start", async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    try {
      const { projectId } = request.params as { projectId: string };
      const project = getProjectById(projectId);
      if (!project) return reply.code(404).send({ error: "not_found", message: "项目不存在" });
      assertProjectAccess(request.user!, projectId, "write");
      const command = (request.body as any)?.command ?? project.default_command;
      await startCommand(project, command);
      db.prepare("UPDATE projects SET status = 'running', updated_at = ?, last_activity_at = ? WHERE id = ?").run(nowIso(), nowIso(), projectId);
      audit({ actorUserId: request.user!.id, actorUsername: request.user!.username, action: "session_command_started", projectId, details: { command } });
      return { ok: true };
    } catch (error) {
      handleError(error, reply);
    }
  });

  app.post("/api/projects/:projectId/session/stop", async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    try {
      const { projectId } = request.params as { projectId: string };
      const project = getProjectById(projectId);
      if (!project) return reply.code(404).send({ error: "not_found", message: "项目不存在" });
      assertProjectAccess(request.user!, projectId, "write");
      stopTtyd(projectId);
      await killSession(project.tmux_session);
      db.prepare("UPDATE projects SET status = 'idle', updated_at = ? WHERE id = ?").run(nowIso(), projectId);
      audit({ actorUserId: request.user!.id, actorUsername: request.user!.username, action: "session_stopped", projectId });
      return { ok: true };
    } catch (error) {
      handleError(error, reply);
    }
  });

  app.post("/api/projects/:projectId/input", async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    try {
      const { projectId } = request.params as { projectId: string };
      const project = getProjectById(projectId);
      if (!project) return reply.code(404).send({ error: "not_found", message: "项目不存在" });
      assertProjectAccess(request.user!, projectId, "write");
      const body = TerminalInputSchema.parse(request.body);
      await sendTerminalInput(project.tmux_session, body);
      db.prepare("UPDATE projects SET last_activity_at = ?, updated_at = ? WHERE id = ?").run(nowIso(), nowIso(), projectId);
      audit({
        actorUserId: request.user!.id,
        actorUsername: request.user!.username,
        action: "terminal_input",
        projectId,
        details: { kind: body.kind, bytes: Buffer.byteLength(body.data) }
      });
      return { ok: true };
    } catch (error) {
      handleError(error, reply);
    }
  });

  app.post("/api/projects/:projectId/scroll", async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    try {
      const { projectId } = request.params as { projectId: string };
      const project = getProjectById(projectId);
      if (!project) return reply.code(404).send({ error: "not_found", message: "项目不存在" });
      assertProjectAccess(request.user!, projectId, "write");
      const body = TerminalScrollSchema.parse(request.body);
      await scrollHistory(project.tmux_session, body.direction, body.lines);
      return { ok: true };
    } catch (error) {
      handleError(error, reply);
    }
  });

  app.get("/api/users", async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    if (request.user!.role !== "admin" && managedProjectIds(request.user!).length === 0) {
      return reply.code(403).send({ error: "forbidden", message: "需要项目管理权限" });
    }
    const users = db.prepare("SELECT * FROM users ORDER BY created_at DESC").all().map(publicUser);
    return { users };
  });

  app.post("/api/users", async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    try {
      const body = CreateUserRequestSchema.parse(request.body);
      const now = nowIso();
      const userId = id("usr");
      db.prepare(`
        INSERT INTO users (id, username, display_name, password_hash, role, enabled, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 1, ?, ?)
      `).run(userId, body.username, body.displayName, await hashPassword(body.password), body.role, now, now);
      audit({ actorUserId: request.user!.id, actorUsername: request.user!.username, action: "user_created", details: { username: body.username } });
      return { user: publicUser(db.prepare("SELECT * FROM users WHERE id = ?").get(userId)) };
    } catch (error) {
      handleError(error, reply);
    }
  });

  app.patch("/api/users/:userId", async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    try {
      const { userId } = request.params as { userId: string };
      const body = UpdateUserRequestSchema.parse(request.body);
      const current = db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as any;
      if (!current) return reply.code(404).send({ error: "not_found", message: "用户不存在" });
      const passwordHash = body.password ? await hashPassword(body.password) : current.password_hash;
      const nextRole = body.role ?? current.role;
      db.prepare(`
        UPDATE users SET display_name = ?, password_hash = ?, role = ?, enabled = ?, updated_at = ?
        WHERE id = ?
      `).run(
        body.displayName ?? current.display_name,
        passwordHash,
        nextRole,
        body.enabled === undefined ? current.enabled : body.enabled ? 1 : 0,
        nowIso(),
        userId
      );
      if (nextRole === "viewer") {
        db.prepare("UPDATE project_permissions SET permission = 'read', updated_at = ? WHERE user_id = ? AND permission IN ('write', 'admin')").run(nowIso(), userId);
      }
      const nextEnabled = body.enabled === undefined ? Boolean(current.enabled) : body.enabled;
      let action = "user_updated";
      if (Boolean(current.enabled) && !nextEnabled) {
        action = "user_disabled";
      } else if (!current.enabled && nextEnabled) {
        action = "user_enabled";
      } else if (body.password) {
        action = "user_password_reset";
      } else if (body.role && body.role !== current.role) {
        action = "user_role_updated";
      }
      audit({
        actorUserId: request.user!.id,
        actorUsername: request.user!.username,
        action,
        details: {
          userId,
          enabled: nextEnabled,
          role: nextRole,
          passwordChanged: Boolean(body.password)
        }
      });
      return { user: publicUser(db.prepare("SELECT * FROM users WHERE id = ?").get(userId)) };
    } catch (error) {
      handleError(error, reply);
    }
  });

  app.delete("/api/users/:userId", async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    try {
      const { userId } = request.params as { userId: string };
      if (userId === request.user!.id) {
        return reply.code(400).send({ error: "bad_request", message: "不能删除当前登录用户" });
      }
      const current = db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as any;
      if (!current) return reply.code(404).send({ error: "not_found", message: "用户不存在" });
      db.prepare("DELETE FROM users WHERE id = ?").run(userId);
      audit({
        actorUserId: request.user!.id,
        actorUsername: request.user!.username,
        action: "user_deleted",
        details: { userId, username: current.username }
      });
      return { ok: true };
    } catch (error) {
      handleError(error, reply);
    }
  });

  app.get("/api/audit", async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const rows = db.prepare("SELECT * FROM audit_events ORDER BY created_at DESC LIMIT 200").all();
    return {
      events: rows.map((row: any) => ({
        id: row.id,
        actorUserId: row.actor_user_id,
        actorUsername: row.actor_username,
        action: row.action,
        projectId: row.project_id,
        details: JSON.parse(row.details_json),
        createdAt: row.created_at
      }))
    };
  });

  app.get("/api/doctor", async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    return {
      tools: {
        tmux: await commandExists("tmux"),
        ttyd: await commandExists("ttyd"),
        codex: await commandExists("codex"),
        claude: await commandExists("claude"),
        cloudflared: await commandExists("cloudflared")
      },
      ttyd: {
        projects: db.prepare("SELECT id, slug FROM projects").all().map((row: any) => ({ ...row, status: ttydStatus(row.id) }))
      }
    };
  });

  app.get("/ttyd/:slug/ws", { websocket: true }, (socket, request) => {
    void (async () => {
      try {
        if (!isAllowedOrigin(request.headers.origin)) {
          socket.close(1008, "origin not allowed");
          return;
        }
        await requireAuthForSocket(request, socket);
        const { slug } = request.params as { slug: string };
        const project = getProjectBySlug(slug);
        if (!project) {
          socket.close(1008, "project not found");
          return;
        }
        const permission = assertProjectAccess(request.user!, project.id, "write");
        await proxyTtydWebSocket(socket, request, project, permission);
      } catch (error: any) {
        socket.close(error?.statusCode === 403 ? 1008 : 1011, error?.message ?? "ttyd websocket failed");
      }
    })();
  });

  app.get("/ttyd/:slug/*", async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    try {
      const { slug } = request.params as { slug: string };
      const project = getProjectBySlug(slug);
      if (!project) return reply.code(404).send({ error: "not_found", message: "项目不存在" });
      const permission = assertProjectAccess(request.user!, project.id, "write");
      await proxyTtyd(request, reply, project, slug, permission);
    } catch (error) {
      handleError(error, reply);
    }
  });
}

async function requireAuthForSocket(request: FastifyRequest, socket: any): Promise<void> {
  if (!request.user) {
    socket.close(1008, "unauthorized");
    throw Object.assign(new Error("需要登录"), { statusCode: 401 });
  }
}
