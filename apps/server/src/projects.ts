import { stat } from "node:fs/promises";
import type { Project, ProjectPermission, ProjectWithPermission, User } from "@mobile-terminal/shared";
import { db } from "./db.js";
import { can, projectPermission } from "./permissions.js";

export function mapProject(row: any): Project {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    path: row.path,
    defaultCommand: row.default_command,
    tmuxSession: row.tmux_session,
    ttydEnabled: Boolean(row.ttyd_enabled),
    status: row.status,
    lastActivityAt: row.last_activity_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function getProjectBySlug(slug: string): any | null {
  return db.prepare("SELECT * FROM projects WHERE slug = ?").get(slug) ?? null;
}

export function getProjectById(projectId: string): any | null {
  return db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId) ?? null;
}

export function visibleProjects(user: User): ProjectWithPermission[] {
  const rows = db.prepare("SELECT * FROM projects ORDER BY updated_at DESC").all();
  return rows
    .map((row: any) => {
      const permission = projectPermission(user, row.id);
      return { ...mapProject(row), permission };
    })
    .filter((project: ProjectWithPermission) => project.permission !== "none");
}

export function assertProjectAccess(user: User, projectId: string, required: ProjectPermission): ProjectPermission {
  const permission = projectPermission(user, projectId);
  if (!can(permission, required)) {
    throw Object.assign(new Error("项目权限不足"), { statusCode: 403 });
  }
  return permission;
}

export async function validateDirectory(dir: string): Promise<void> {
  const info = await stat(dir);
  if (!info.isDirectory()) {
    throw Object.assign(new Error("路径不是目录"), { statusCode: 400 });
  }
}

