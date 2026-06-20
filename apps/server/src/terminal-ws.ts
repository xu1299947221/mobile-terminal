import type { FastifyInstance } from "fastify";
import * as pty from "node-pty";
import { TerminalInputSchema } from "@mobile-terminal/shared";
import { audit, db, nowIso } from "./db.js";
import { getProjectBySlug } from "./projects.js";
import { authHook } from "./auth.js";
import { can, projectPermission } from "./permissions.js";
import { capturePane, ensureSession } from "./tmux.js";
import { sendTerminalInput } from "./terminal-input.js";
import { isAllowedOrigin } from "./security.js";

export async function registerTerminalWs(app: FastifyInstance): Promise<void> {
  app.get("/ws/terminal/:slug", { websocket: true }, (socket, request) => {
    let term: pty.IPty | null = null;
    const setupPromise = setupTerminalConnection();

    socket.on("message", async (raw: Buffer) => {
      try {
        const { project, permission, term: currentTerm } = await setupPromise;
        const msg = JSON.parse(raw.toString());
        if (msg.type === "resize") {
          const cols = Math.max(20, Math.min(240, Number(msg.cols) || 80));
          const rows = Math.max(8, Math.min(80, Number(msg.rows) || 24));
          currentTerm.resize(cols, rows);
          return;
        }
        if (!can(permission, "write")) {
          socket.send(JSON.stringify({ type: "error", message: "只读用户不能写入终端" }));
          return;
        }
        const input = TerminalInputSchema.parse(msg);
        await sendTerminalInput(project.tmux_session, input);
        db.prepare("UPDATE projects SET last_activity_at = ?, updated_at = ? WHERE id = ?").run(nowIso(), nowIso(), project.id);
        audit({
          actorUserId: request.user!.id,
          actorUsername: request.user!.username,
          action: "terminal_ws_input",
          projectId: project.id,
          details: { kind: input.kind, bytes: Buffer.byteLength(input.data) }
        });
      } catch (error: any) {
        socket.send(JSON.stringify({ type: "error", message: error?.message ?? "输入格式错误" }));
      }
    });

    socket.on("close", () => {
      term?.kill();
    });

    setupPromise.catch((error: any) => {
      if (socket.readyState === socket.OPEN) {
        socket.close(1011, error?.message ?? "terminal setup failed");
      }
    });

    async function setupTerminalConnection(): Promise<{ project: ReturnType<typeof getProjectBySlug>; permission: ReturnType<typeof projectPermission>; term: pty.IPty }> {
      if (!isAllowedOrigin(request.headers.origin)) {
        socket.close(1008, "origin not allowed");
        throw new Error("origin not allowed");
      }
      await authHook(request);
      if (!request.user) {
        socket.close(1008, "unauthorized");
        throw new Error("unauthorized");
      }
      const { slug } = request.params as { slug: string };
      const project = getProjectBySlug(slug);
      if (!project) {
        socket.close(1008, "project not found");
        throw new Error("project not found");
      }
      const permission = projectPermission(request.user, project.id);
      if (!can(permission, "read")) {
        socket.close(1008, "forbidden");
        throw new Error("forbidden");
      }
      await ensureSession(project);
      term = pty.spawn("tmux", ["attach", "-t", project.tmux_session], {
        name: "xterm-256color",
        cwd: project.path,
        cols: 80,
        rows: 24,
        env: process.env
      });

      audit({ actorUserId: request.user.id, actorUsername: request.user.username, action: "terminal_opened", projectId: project.id, details: { mode: "xterm" } });

      term.onData((data) => {
        if (socket.readyState === socket.OPEN) {
          socket.send(JSON.stringify({ type: "output", data }));
        }
      });

      const recentOutput = await capturePane(project.tmux_session, 120);
      if (recentOutput && socket.readyState === socket.OPEN) {
        socket.send(JSON.stringify({ type: "output", data: recentOutput }));
      }

      term.onExit(({ exitCode, signal }) => {
        if (socket.readyState === socket.OPEN) {
          socket.send(JSON.stringify({ type: "exit", exitCode, signal }));
          socket.close();
        }
      });

      return { project, permission, term };
    }
  });
}
