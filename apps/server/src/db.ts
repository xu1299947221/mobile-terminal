import Database from "better-sqlite3";
import { nanoid } from "nanoid";
import { config } from "./config.js";

export const db = new Database(config.databasePath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

export function nowIso(): string {
  return new Date().toISOString();
}

export function id(prefix: string): string {
  return `${prefix}_${nanoid(14)}`;
}

export function migrate(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin','member','viewer')),
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      path TEXT NOT NULL,
      default_command TEXT NOT NULL CHECK(default_command IN ('shell','codex','claude')),
      tmux_session TEXT NOT NULL UNIQUE,
      ttyd_enabled INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'idle' CHECK(status IN ('idle','running','disconnected','error')),
      last_activity_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS project_permissions (
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      permission TEXT NOT NULL CHECK(permission IN ('none','read','write','admin')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(project_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS audit_events (
      id TEXT PRIMARY KEY,
      actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      actor_username TEXT,
      action TEXT NOT NULL,
      project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
      details_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
}

export function audit(input: {
  actorUserId?: string | null;
  actorUsername?: string | null;
  action: string;
  projectId?: string | null;
  details?: Record<string, unknown>;
}): void {
  db.prepare(`
    INSERT INTO audit_events (id, actor_user_id, actor_username, action, project_id, details_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    id("aud"),
    input.actorUserId ?? null,
    input.actorUsername ?? null,
    input.action,
    input.projectId ?? null,
    JSON.stringify(input.details ?? {}),
    nowIso()
  );
}

