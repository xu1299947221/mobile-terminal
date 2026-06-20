import path from "node:path";
import { CreateProjectRequestSchema, CreateUserRequestSchema } from "@mobile-terminal/shared";
import { audit, db, id, migrate, nowIso } from "./db.js";
import { hashPassword, publicUser } from "./auth.js";
import { commandExists } from "./process.js";
import { config } from "./config.js";
import { validateDirectory } from "./projects.js";

async function initAdmin(args: string[]) {
  const username = args[0] ?? process.env.MT_ADMIN_USER;
  const password = args[1] ?? process.env.MT_ADMIN_PASSWORD;
  const displayName = args[2] ?? username;
  if (!username || !password) {
    throw new Error("用法: npm run init-admin -w @mobile-terminal/server -- <username> <password> [displayName]");
  }
  const body = CreateUserRequestSchema.parse({ username, password, displayName, role: "admin" });
  const now = nowIso();
  const existing = db.prepare("SELECT * FROM users WHERE username = ?").get(body.username) as any;
  if (existing) {
    db.prepare("UPDATE users SET password_hash = ?, role = 'admin', enabled = 1, updated_at = ? WHERE id = ?").run(
      await hashPassword(body.password),
      now,
      existing.id
    );
    audit({ actorUserId: existing.id, actorUsername: existing.username, action: "admin_reset_by_cli" });
    console.log(JSON.stringify({ user: publicUser(db.prepare("SELECT * FROM users WHERE id = ?").get(existing.id)), updated: true }, null, 2));
    return;
  }
  const userId = id("usr");
  db.prepare(`
    INSERT INTO users (id, username, display_name, password_hash, role, enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'admin', 1, ?, ?)
  `).run(userId, body.username, body.displayName, await hashPassword(body.password), now, now);
  audit({ actorUserId: userId, actorUsername: body.username, action: "admin_created_by_cli" });
  console.log(JSON.stringify({ user: publicUser(db.prepare("SELECT * FROM users WHERE id = ?").get(userId)), created: true }, null, 2));
}

async function doctor() {
  const tools: Record<string, boolean> = {};
  for (const tool of ["node", "tmux", "ttyd", "cloudflared", "codex", "claude"]) {
    tools[tool] = await commandExists(tool);
  }
  const users = db.prepare("SELECT COUNT(*) AS count FROM users").get() as { count: number };
  const projects = db.prepare("SELECT COUNT(*) AS count FROM projects").get() as { count: number };
  console.log(
    JSON.stringify(
      {
        ok: true,
        config: {
          host: config.host,
          port: config.port,
          databasePath: config.databasePath,
          publicOrigin: config.publicOrigin
        },
        tools,
        users: users.count,
        projects: projects.count
      },
      null,
      2
    )
  );
}

async function initProject(args: string[]) {
  const name = args[0] ?? process.env.MT_PROJECT_NAME ?? "workspace";
  const slug = args[1] ?? process.env.MT_PROJECT_SLUG ?? "workspace";
  const projectPath = path.resolve(args[2] ?? process.env.MT_PROJECT_PATH ?? "/workspace");
  const tmuxSession = args[3] ?? process.env.MT_PROJECT_TMUX_SESSION ?? `mt_${slug.replace(/[^a-zA-Z0-9_.:-]+/g, "_")}`;
  const defaultCommand = args[4] ?? process.env.MT_PROJECT_DEFAULT_COMMAND ?? "shell";
  const body = CreateProjectRequestSchema.parse({
    name,
    slug,
    path: projectPath,
    tmuxSession,
    defaultCommand,
    ttydEnabled: true
  });
  await validateDirectory(path.resolve(body.path));
  const now = nowIso();
  const existing = db.prepare("SELECT * FROM projects WHERE slug = ?").get(body.slug) as any;
  if (existing) {
    db.prepare(`
      UPDATE projects
      SET name = ?, path = ?, default_command = ?, tmux_session = ?, ttyd_enabled = 1, updated_at = ?
      WHERE id = ?
    `).run(body.name, path.resolve(body.path), body.defaultCommand, body.tmuxSession, now, existing.id);
    audit({ action: "project_reset_by_cli", projectId: existing.id, details: { slug: body.slug } });
    console.log(JSON.stringify({ projectId: existing.id, updated: true }, null, 2));
    return;
  }
  const projectId = id("prj");
  db.prepare(`
    INSERT INTO projects (id, name, slug, path, default_command, tmux_session, ttyd_enabled, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, 'idle', ?, ?)
  `).run(projectId, body.name, body.slug, path.resolve(body.path), body.defaultCommand, body.tmuxSession, now, now);
  audit({ action: "project_created_by_cli", projectId, details: { slug: body.slug } });
  console.log(JSON.stringify({ projectId, created: true }, null, 2));
}

async function main() {
  migrate();
  const [command, ...args] = process.argv.slice(2);
  if (command === "init-admin") {
    await initAdmin(args);
    return;
  }
  if (command === "doctor") {
    await doctor();
    return;
  }
  if (command === "init-project") {
    await initProject(args);
    return;
  }
  throw new Error(`未知命令: ${command ?? ""}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
