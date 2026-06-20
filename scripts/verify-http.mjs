#!/usr/bin/env node
import WebSocket from "ws";
import Database from "better-sqlite3";
import path from "node:path";

const baseUrl = process.env.MOBILE_TERMINAL_VERIFY_URL ?? "http://127.0.0.1:3020";
const username = process.env.MOBILE_TERMINAL_VERIFY_USER ?? "admin";
const password = process.env.MOBILE_TERMINAL_VERIFY_PASSWORD;
const databasePath =
  process.env.MOBILE_TERMINAL_DB ??
  path.join(process.env.MOBILE_TERMINAL_ROOT ?? process.cwd(), "data/app.db");

let cookie = "";
let adminCookie = "";

async function req(path, options = {}) {
  const headers = {
    ...(cookie ? { cookie } : {}),
    ...(options.headers ?? {})
  };
  if (options.body && !headers["content-type"]) {
    headers["content-type"] = "application/json";
  }
  const res = await fetch(`${baseUrl}${path}`, { ...options, headers });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) {
    cookie = setCookie.split(";")[0];
  }
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = text;
  }
  if (!res.ok) {
    throw new Error(`${options.method ?? "GET"} ${path} -> ${res.status}: ${text}`);
  }
  return body;
}

async function withCookie(nextCookie, fn) {
  const previous = cookie;
  cookie = nextCookie;
  try {
    return await fn();
  } finally {
    cookie = previous;
  }
}

async function expectHttpStatus(path, status, options = {}) {
  const headers = {
    ...(cookie ? { cookie } : {}),
    ...(options.headers ?? {})
  };
  if (options.body && !headers["content-type"]) {
    headers["content-type"] = "application/json";
  }
  const res = await fetch(`${baseUrl}${path}`, { ...options, headers });
  const text = await res.text();
  if (res.status !== status) {
    throw new Error(`${options.method ?? "GET"} ${path} expected ${status}, got ${res.status}: ${text}`);
  }
}

async function main() {
  assert(password, "MOBILE_TERMINAL_VERIFY_PASSWORD is required");
  await expectHttpStatus("/api/health", 401);

  const login = await req("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password })
  });
  assert(login.user?.role === "admin", "admin login");
  adminCookie = cookie;
  const health = await req("/api/health");
  assert(health.ok && !("now" in health), "admin health ok");

  const verifySlug = `verify-${Date.now()}`;
  const verifySession = `mt_${verifySlug.replaceAll("-", "_")}`;
  const project = await createVerifyProject(verifySlug, verifySession);
  const cleanupTasks = [];

  try {
    await verifyProject(project);
    await verifyReadOnlyUser(project, cleanupTasks);
    console.log(JSON.stringify({ ok: true, baseUrl, project: project.slug }, null, 2));
  } finally {
    cookie = adminCookie;
    for (const task of cleanupTasks.reverse()) {
      await task().catch((error) => {
        console.error(`verify cleanup task failed: ${error.message}`);
      });
    }
    await cleanupVerifyProject(project.id).catch((error) => {
      console.error(`verify cleanup failed: ${error.message}`);
    });
  }
}

async function createVerifyProject(slug, tmuxSession) {
  const created = await req("/api/projects", {
    method: "POST",
    body: JSON.stringify({
      name: `verify ${slug}`,
      slug,
      path: "/home/data/connect",
      defaultCommand: "shell",
      tmuxSession,
      ttydEnabled: true
    })
  });
  return created.project;
}

async function cleanupVerifyProject(projectId) {
  await req(`/api/projects/${projectId}/session/stop`, { method: "POST" }).catch(() => undefined);
  await req(`/api/projects/${projectId}`, { method: "DELETE" });
}

async function verifyProject(project) {
  const projects = await req("/api/projects");
  assert(Array.isArray(projects.projects), "projects list");
  assert(projects.projects.some((item) => item.id === project.id), "verify project visible");

  const httpMarker = `mobile-terminal-http-${Date.now()}`;
  await req(`/api/projects/${project.id}/session/ensure`, { method: "POST" });
  await waitForSessionReady(project.id);
  await req(`/api/projects/${project.id}/input`, {
    method: "POST",
    body: JSON.stringify({ data: `printf '${httpMarker}\\n'\n`, kind: "raw" })
  });
  const output = await waitForOutput(project.id, httpMarker);
  assert(output.output.includes(httpMarker), `terminal output capture: ${output.output.slice(-500)}`);

  const users = await req("/api/users");
  assert(Array.isArray(users.users), "users list");

  const doctor = await req("/api/doctor");
  assert(doctor.tools?.tmux && doctor.tools?.ttyd, "doctor tools");

  const ttyd = await fetch(`${baseUrl}/ttyd/${project.slug}/`, { headers: { cookie } });
  assert(ttyd.status === 200, `ttyd status ${ttyd.status}`);
  await verifyTtydWebSocket(project.slug);
  await req(`/api/projects/${project.id}`, {
    method: "PATCH",
    body: JSON.stringify({ ttydEnabled: false })
  });
  await expectHttpStatus(`/ttyd/${project.slug}/`, 403);
  await req(`/api/projects/${project.id}`, {
    method: "PATCH",
    body: JSON.stringify({ ttydEnabled: true })
  });

  await verifyWebSocket(project.slug);
}

async function verifyReadOnlyUser(project, cleanupTasks) {
  cookie = adminCookie;
  const suffix = Date.now();
  const viewerPassword = `viewer-${suffix}`;
  const created = await req("/api/users", {
    method: "POST",
    body: JSON.stringify({
      username: `viewer_${suffix}`,
      displayName: `viewer ${suffix}`,
      password: viewerPassword,
      role: "viewer"
    })
  });
  await req(`/api/projects/${project.id}/grants`, {
    method: "POST",
    body: JSON.stringify({ userId: created.user.id, permission: "read" })
  });

  cookie = "";
  const viewerLogin = await req("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username: created.user.username, password: viewerPassword })
  });
  assert(viewerLogin.user?.role === "viewer", "viewer login");
  const viewerCookie = cookie;

  await withCookie(viewerCookie, async () => {
    const projects = await req("/api/projects");
    assert(projects.projects.some((item) => item.id === project.id && item.permission === "read"), "viewer read project");
    const output = await req(`/api/projects/${project.id}/output`);
    assert(typeof output.output === "string", "viewer can read output");
    await expectHttpStatus(`/api/projects/${project.id}/input`, 403, {
      method: "POST",
      body: JSON.stringify({ data: "printf 'viewer-denied\\n'\\n", kind: "raw" })
    });
    await expectHttpStatus(`/ttyd/${project.slug}/`, 403);
    await verifyReadOnlyWebSocket(project.slug, viewerCookie);
  });

  cookie = adminCookie;
  await req(`/api/projects/${project.id}/grants`, {
    method: "POST",
    body: JSON.stringify({ userId: created.user.id, permission: "none" })
  });
  await withCookie(viewerCookie, async () => {
    const projects = await req("/api/projects");
    assert(!projects.projects.some((item) => item.id === project.id), "viewer permission revoked");
  });

  await req(`/api/users/${created.user.id}`, { method: "PATCH", body: JSON.stringify({ enabled: false }) });
  cleanupTasks.push(() => cleanupVerifyUser(created.user.id));
  const audit = await req("/api/audit");
  assert(audit.events.some((event) => event.action === "project_permission_revoked" && event.projectId === project.id), "permission revoke audit");
  assert(audit.events.some((event) => event.action === "user_disabled" && event.details?.userId === created.user.id), "user disabled audit");
}

async function cleanupVerifyUser(userId) {
  const db = new Database(databasePath);
  try {
    const row = db.prepare("SELECT username FROM users WHERE id = ?").get(userId);
    if (!row?.username?.startsWith("viewer_")) return;
    db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM project_permissions WHERE user_id = ?").run(userId);
    db.prepare("UPDATE audit_events SET actor_user_id = NULL WHERE actor_user_id = ?").run(userId);
    db.prepare("DELETE FROM users WHERE id = ?").run(userId);
  } finally {
    db.close();
  }
}

async function verifyWebSocket(slug) {
  const wsBase = baseUrl.replace(/^http/, "ws");
  const ws = new WebSocket(`${wsBase}/ws/terminal/${slug}`, {
    headers: { cookie }
  });
  let buffer = "";
  let sent = false;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("websocket verify timeout")), 8000);
    ws.on("message", (event) => {
      const msg = JSON.parse(event.toString());
      if (msg.type === "output") {
        buffer += msg.data;
      }
      if (!sent && buffer.length > 0) {
        sent = true;
        ws.send(JSON.stringify({ data: "printf 'mobile-terminal-ws-verify\\n'\r", kind: "raw" }));
      }
      if (buffer.includes("mobile-terminal-ws-verify")) {
        clearTimeout(timer);
        ws.close();
        resolve(undefined);
      }
    });
    ws.on("error", (event) => {
      clearTimeout(timer);
      reject(event);
    });
    ws.on("close", (code, reason) => {
      if (!buffer.includes("mobile-terminal-ws-verify")) {
        clearTimeout(timer);
        reject(new Error(`websocket closed before verify output: ${code} ${reason.toString()}`));
      }
    });
  });
}

async function verifyTtydWebSocket(slug) {
  const tokenRes = await fetch(`${baseUrl}/ttyd/${slug}/token`, { headers: { cookie } });
  assert(tokenRes.status === 200, `ttyd token status ${tokenRes.status}`);
  const token = (await tokenRes.text()).trim();
  const marker = `mobile-terminal-ttyd-verify-${Date.now()}`;
  const wsBase = baseUrl.replace(/^http/, "ws");
  const ws = new WebSocket(`${wsBase}/ttyd/${slug}/ws`, "tty", {
    headers: { cookie }
  });
  let buffer = "";
  let sent = false;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`ttyd websocket verify timeout: ${buffer.slice(-500)}`)), 8000);
    ws.on("open", () => {
      ws.send(JSON.stringify({ AuthToken: token, columns: 100, rows: 30 }));
    });
    ws.on("message", (event) => {
      buffer += event.toString();
      if (!sent) {
        sent = true;
        ws.send(Buffer.from(`0printf '${marker}\\n'\r`));
      }
      if (buffer.includes(marker)) {
        clearTimeout(timer);
        ws.close();
        resolve(undefined);
      }
    });
    ws.on("error", (event) => {
      clearTimeout(timer);
      reject(event);
    });
    ws.on("close", (code, reason) => {
      if (!buffer.includes(marker)) {
        clearTimeout(timer);
        reject(new Error(`ttyd websocket closed before verify output: ${code} ${reason.toString()}`));
      }
    });
  });
}

async function verifyReadOnlyWebSocket(slug, viewerCookie) {
  const wsBase = baseUrl.replace(/^http/, "ws");
  const ws = new WebSocket(`${wsBase}/ws/terminal/${slug}`, {
    headers: { cookie: viewerCookie }
  });
  await new Promise((resolve, reject) => {
    let settled = false;
    let timer;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };
    timer = setTimeout(() => finish(reject, new Error("readonly websocket verify timeout")), 8000);
    ws.on("message", (event) => {
      const msg = JSON.parse(event.toString());
      if (msg.type === "output") {
        ws.send(JSON.stringify({ data: "printf 'readonly-should-fail\\n'\r", kind: "raw" }));
      }
      if (msg.type === "error" && msg.message.includes("只读")) {
        ws.close();
        finish(resolve, undefined);
      }
    });
    ws.on("error", (event) => {
      finish(reject, event);
    });
    ws.on("close", (code, reason) => {
      finish(reject, new Error(`readonly websocket closed before error: ${code} ${reason.toString()}`));
    });
  });
}

function assert(value, message) {
  if (!value) throw new Error(`verify failed: ${message}`);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForOutput(projectId, marker, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  let output = { output: "" };
  while (Date.now() < deadline) {
    output = await req(`/api/projects/${projectId}/output`);
    if (output.output.includes(marker)) return output;
    await delay(250);
  }
  return output;
}

async function waitForSessionReady(projectId, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const output = await req(`/api/projects/${projectId}/output`);
    if (output.output.includes("$") || output.output.includes("#")) return;
    await delay(250);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
