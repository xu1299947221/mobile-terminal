import type { ProjectPermission, User } from "@mobile-terminal/shared";
import { db } from "./db.js";

const weight: Record<ProjectPermission, number> = {
  none: 0,
  read: 1,
  write: 2,
  admin: 3
};

export function projectPermission(user: User, projectId: string): ProjectPermission {
  if (user.role === "admin") return "admin";
  const row = db.prepare("SELECT permission FROM project_permissions WHERE user_id = ? AND project_id = ?").get(user.id, projectId) as
    | { permission: ProjectPermission }
    | undefined;
  if (!row) return "none";
  if (user.role === "viewer" && can(row.permission, "read")) return "read";
  return row.permission;
}

export function can(permission: ProjectPermission, required: ProjectPermission): boolean {
  return weight[permission] >= weight[required];
}

export function hasManagedProjects(user: User): boolean {
  if (user.role === "admin") return true;
  if (user.role === "viewer") return false;
  const row = db.prepare("SELECT 1 FROM project_permissions WHERE user_id = ? AND permission = 'admin' LIMIT 1").get(user.id);
  return Boolean(row);
}

export function managedProjectIds(user: User): string[] {
  if (user.role === "admin") {
    return db.prepare("SELECT id FROM projects ORDER BY updated_at DESC").all().map((row: any) => row.id);
  }
  if (user.role === "viewer") return [];
  return db
    .prepare("SELECT project_id FROM project_permissions WHERE user_id = ? AND permission = 'admin' ORDER BY updated_at DESC")
    .all(user.id)
    .map((row: any) => row.project_id);
}
