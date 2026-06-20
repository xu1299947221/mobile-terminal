import type { AuditEvent, ProjectWithPermission, User } from "@mobile-terminal/shared";

export type AdminContext = {
  isGlobalAdmin: boolean;
  canCreateProjects: boolean;
  canManageUsers: boolean;
  managedProjectIds: string[];
};

async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(url, {
    credentials: "include",
    headers,
    ...options
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(err.message ?? "请求失败");
  }
  return res.json() as Promise<T>;
}

export const api = {
  login: (username: string, password: string) =>
    request<{ user: User }>("/api/auth/login", { method: "POST", body: JSON.stringify({ username, password }) }),
  logout: () => request<{ ok: true }>("/api/auth/logout", { method: "POST", body: JSON.stringify({}) }),
  me: () => request<{ user: User }>("/api/me"),
  projects: () => request<{ projects: ProjectWithPermission[] }>("/api/projects"),
  adminContext: () => request<AdminContext>("/api/admin/context"),
  createProject: (body: unknown) => request<{ project: ProjectWithPermission }>("/api/projects", { method: "POST", body: JSON.stringify(body) }),
  updateProject: (id: string, body: unknown) => request<{ project: ProjectWithPermission }>(`/api/projects/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteProject: (id: string) => request<{ ok: true }>(`/api/projects/${id}`, { method: "DELETE" }),
  ensureSession: (id: string) => request<{ ok: true }>(`/api/projects/${id}/session/ensure`, { method: "POST" }),
  startCommand: (id: string, command: string) => request<{ ok: true }>(`/api/projects/${id}/session/start`, { method: "POST", body: JSON.stringify({ command }) }),
  stopSession: (id: string) => request<{ ok: true }>(`/api/projects/${id}/session/stop`, { method: "POST" }),
  output: (id: string) => request<{ output: string }>(`/api/projects/${id}/output`),
  sendInput: (id: string, data: string, kind: "raw" | "task" | "key") =>
    request<{ ok: true }>(`/api/projects/${id}/input`, { method: "POST", body: JSON.stringify({ data, kind }) }),
  users: () => request<{ users: User[] }>("/api/users"),
  createUser: (body: unknown) => request<{ user: User }>("/api/users", { method: "POST", body: JSON.stringify(body) }),
  updateUser: (id: string, body: unknown) => request<{ user: User }>(`/api/users/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteUser: (id: string) => request<{ ok: true }>(`/api/users/${id}`, { method: "DELETE" }),
  grant: (projectId: string, userId: string, permission: string) =>
    request<{ ok: true }>(`/api/projects/${projectId}/grants`, { method: "POST", body: JSON.stringify({ userId, permission }) }),
  grants: (projectId: string) => request<{ grants: any[] }>(`/api/projects/${projectId}/grants`),
  audit: () => request<{ events: AuditEvent[] }>("/api/audit"),
  doctor: () => request<any>("/api/doctor")
};
