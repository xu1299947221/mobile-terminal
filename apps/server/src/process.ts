import { type ChildProcess, execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

export const execFileAsync = promisify(execFile);

export async function commandExists(command: string): Promise<boolean> {
  try {
    await execFileAsync("bash", ["-lc", `command -v ${JSON.stringify(command)} >/dev/null 2>&1`]);
    return true;
  } catch {
    return false;
  }
}

export function spawnDetached(command: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): ChildProcess {
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    detached: false,
    stdio: ["ignore", "pipe", "pipe"]
  });
  return child;
}
