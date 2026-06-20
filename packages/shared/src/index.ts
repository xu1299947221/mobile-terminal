import { z } from "zod";

export const RoleSchema = z.enum(["admin", "member", "viewer"]);
export type Role = z.infer<typeof RoleSchema>;

export const ProjectPermissionSchema = z.enum(["none", "read", "write", "admin"]);
export type ProjectPermission = z.infer<typeof ProjectPermissionSchema>;

export const DefaultCommandSchema = z.enum(["shell", "codex", "claude"]);
export type DefaultCommand = z.infer<typeof DefaultCommandSchema>;

export const ProjectStatusSchema = z.enum(["idle", "running", "disconnected", "error"]);
export type ProjectStatus = z.infer<typeof ProjectStatusSchema>;

export type User = {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  enabled: boolean;
  hasProjectAdmin?: boolean;
  createdAt: string;
  updatedAt: string;
};

export type Project = {
  id: string;
  name: string;
  slug: string;
  path: string;
  defaultCommand: DefaultCommand;
  tmuxSession: string;
  ttydEnabled: boolean;
  status: ProjectStatus;
  lastActivityAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ProjectWithPermission = Project & {
  permission: ProjectPermission;
};

export type AuditEvent = {
  id: string;
  actorUserId: string | null;
  actorUsername: string | null;
  action: string;
  projectId: string | null;
  details: Record<string, unknown>;
  createdAt: string;
};

export const LoginRequestSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1)
});

export const VerifyGateRequestSchema = z.object({
  answer: z.string().min(1).max(100)
});

export const CreateUserRequestSchema = z.object({
  username: z.string().min(2).max(64).regex(/^[a-zA-Z0-9_.@-]+$/),
  displayName: z.string().min(1).max(100),
  password: z.string().min(6).max(256),
  role: RoleSchema
});

export const UpdateUserRequestSchema = z.object({
  displayName: z.string().min(1).max(100).optional(),
  password: z.string().min(6).max(256).optional(),
  role: RoleSchema.optional(),
  enabled: z.boolean().optional()
});

export const CreateProjectRequestSchema = z.object({
  name: z.string().min(1).max(100),
  slug: z.string().min(1).max(80).regex(/^[a-zA-Z0-9_-]+$/),
  path: z.string().min(1),
  defaultCommand: DefaultCommandSchema,
  tmuxSession: z.string().min(1).max(100).regex(/^[a-zA-Z0-9_.:-]+$/),
  ttydEnabled: z.boolean().default(true)
});

export const UpdateProjectRequestSchema = CreateProjectRequestSchema.partial();

export const GrantProjectRequestSchema = z.object({
  userId: z.string().min(1),
  permission: ProjectPermissionSchema
});

export const TerminalInputSchema = z.object({
  data: z.string(),
  kind: z.enum(["raw", "task", "key"]).default("raw")
});

export const TerminalScrollSchema = z.object({
  direction: z.enum(["up", "down"]),
  lines: z.number().int().min(1).max(200).default(3)
});

export type ApiError = {
  error: string;
  message: string;
};
