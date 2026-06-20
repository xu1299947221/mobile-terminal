import { execFileAsync } from "./process.js";

export type ProjectRow = {
  id: string;
  path: string;
  tmux_session: string;
  default_command: "shell" | "codex" | "claude";
  ttyd_enabled?: number | boolean;
};

export async function hasSession(session: string): Promise<boolean> {
  try {
    await execFileAsync("tmux", ["has-session", "-t", session]);
    return true;
  } catch {
    return false;
  }
}

export async function ensureSession(project: ProjectRow): Promise<void> {
  if (await hasSession(project.tmux_session)) return;
  await execFileAsync("tmux", ["new-session", "-d", "-s", project.tmux_session, "-c", project.path, "bash"]);
  await waitForPrompt(project.tmux_session);
}

export async function killSession(session: string): Promise<void> {
  if (await hasSession(session)) {
    await execFileAsync("tmux", ["kill-session", "-t", session]);
  }
}

export async function capturePane(session: string, lines = 240): Promise<string> {
  if (!(await hasSession(session))) return "";
  const { stdout } = await execFileAsync("tmux", ["capture-pane", "-t", session, "-p", "-S", `-${lines}`], {
    maxBuffer: 1024 * 1024 * 4
  });
  return stdout;
}

export async function sendKeys(session: string, text: string): Promise<void> {
  await ensureBareSession(session);
  if (!text) return;
  await cancelCopyMode(session);
  await execFileAsync("tmux", ["send-keys", "-l", "-t", session, text]);
}

export async function sendKeysThenLiteralKey(session: string, text: string, key: string): Promise<void> {
  await ensureBareSession(session);
  await cancelCopyMode(session);
  if (!text) {
    await sendLiteralKey(session, key);
    return;
  }
  await execFileAsync("tmux", ["send-keys", "-l", "-t", session, text]);
  await execFileAsync("tmux", ["send-keys", "-t", session, key]);
}

export async function sendLiteralKey(session: string, key: string): Promise<void> {
  await ensureBareSession(session);
  await cancelCopyMode(session);
  await execFileAsync("tmux", ["send-keys", "-t", session, key]);
}

export async function scrollHistory(session: string, direction: "up" | "down", lines: number): Promise<void> {
  await ensureBareSession(session);
  const count = Math.max(1, Math.min(200, Math.trunc(lines)));
  await execFileAsync("tmux", ["copy-mode", "-t", session]);
  await execFileAsync("tmux", ["send-keys", "-t", session, "-X", "-N", String(count), direction === "up" ? "scroll-up" : "scroll-down"]);
  if (direction === "down") {
    const { stdout } = await execFileAsync("tmux", ["display-message", "-p", "-t", session, "#{scroll_position}"]);
    if (stdout.trim() === "0") {
      await cancelCopyMode(session);
    }
  }
}

export async function cancelCopyMode(session: string): Promise<void> {
  await ensureBareSession(session);
  const { stdout } = await execFileAsync("tmux", ["display-message", "-p", "-t", session, "#{pane_in_mode}"]);
  if (stdout.trim() === "1") {
    await execFileAsync("tmux", ["send-keys", "-t", session, "-X", "cancel"]);
  }
}

async function ensureBareSession(session: string): Promise<void> {
  if (!(await hasSession(session))) {
    throw new Error(`tmux session missing: ${session}`);
  }
}

async function waitForPrompt(session: string): Promise<void> {
  const deadline = Date.now() + 1500;
  while (Date.now() < deadline) {
    const output = await capturePane(session, 20).catch(() => "");
    if (output.includes("$") || output.includes("#")) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

export async function startCommand(project: ProjectRow, command: "shell" | "codex" | "claude"): Promise<void> {
  await ensureSession(project);
  const cmd = command === "shell" ? "bash" : command === "claude" ? "cc" : command;
  await execFileAsync("tmux", ["send-keys", "-t", project.tmux_session, cmd, "Enter"]);
}
