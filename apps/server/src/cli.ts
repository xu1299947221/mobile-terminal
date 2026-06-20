import { CreateUserRequestSchema } from "@mobile-terminal/shared";
import { audit, db, id, migrate, nowIso } from "./db.js";
import { hashPassword, publicUser } from "./auth.js";
import { commandExists } from "./process.js";
import { config } from "./config.js";

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
  throw new Error(`未知命令: ${command ?? ""}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

