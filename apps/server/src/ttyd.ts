import type { ChildProcess } from "node:child_process";
import { brotliDecompressSync, gunzipSync, inflateSync } from "node:zlib";
import httpProxy from "http-proxy";
import http from "node:http";
import type { IncomingMessage } from "node:http";
import net from "node:net";
import type { Socket } from "node:net";
import { nanoid } from "nanoid";
import WebSocket from "ws";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ProjectPermission } from "@mobile-terminal/shared";
import { config } from "./config.js";
import { spawnDetached } from "./process.js";
import { ensureSession, type ProjectRow } from "./tmux.js";

type TtydProcess = {
  projectId: string;
  port: number;
  token: string;
  process: ChildProcess;
  startedAt: string;
};

const running = new Map<string, TtydProcess>();
let nextPort = config.ttydPortStart;

const proxy = httpProxy.createProxyServer({ ws: true, xfwd: true, changeOrigin: true });

function rewriteUrl(originalUrl: string | undefined, slug: string): string {
  const original = originalUrl ?? "/";
  const prefix = `/ttyd/${slug}`;
  if (!original.startsWith(prefix)) return original;
  const next = original.slice(prefix.length);
  return next.length > 0 ? next : "/";
}

function allocatePort(): number {
  const port = nextPort;
  nextPort += 1;
  if (nextPort > config.ttydPortEnd) nextPort = config.ttydPortStart;
  return port;
}

export async function ensureTtyd(project: ProjectRow): Promise<TtydProcess> {
  const current = running.get(project.id);
  if (current && !current.process.killed) return current;

  await ensureSession(project);
  const port = allocatePort();
  const token = nanoid(24);
  const child = spawnDetached(
    "ttyd",
    [
      "-i",
      "127.0.0.1",
      "-p",
      String(port),
      "-W",
      "-O",
      "tmux",
      "attach",
      "-t",
      project.tmux_session
    ],
    { cwd: project.path }
  );

  const item: TtydProcess = {
    projectId: project.id,
    port,
    token,
    process: child,
    startedAt: new Date().toISOString()
  };
  running.set(project.id, item);

  child.once("exit", () => {
    if (running.get(project.id)?.process === child) {
      running.delete(project.id);
    }
  });
  await waitForPort(port);
  return item;
}

async function waitForPort(port: number): Promise<void> {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    if (await canConnect(port)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`ttyd 端口未就绪: ${port}`);
}

function canConnect(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
    socket.setTimeout(500, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

export function stopTtyd(projectId: string): void {
  const item = running.get(projectId);
  if (!item) return;
  item.process.kill("SIGTERM");
  running.delete(projectId);
}

export function ttydStatus(projectId: string): { port: number; startedAt: string } | null {
  const item = running.get(projectId);
  if (!item) return null;
  return { port: item.port, startedAt: item.startedAt };
}

export async function proxyTtyd(
  request: FastifyRequest,
  reply: FastifyReply,
  project: ProjectRow,
  slug: string,
  permission: ProjectPermission
): Promise<void> {
  if (!("ttyd_enabled" in project) || !project.ttyd_enabled) {
    reply.code(403).send({ error: "forbidden", message: "该项目未启用 ttyd 备用终端" });
    return;
  }

  if (permission === "read") {
    // ttyd itself is writable; read-only users are blocked from fallback ttyd.
    reply.code(403).send({ error: "forbidden", message: "只读用户不能打开可写 ttyd 终端，请使用自研终端只读模式" });
    return;
  }

  const item = await ensureTtyd(project);
  const target = `http://127.0.0.1:${item.port}`;
  request.raw.url = rewriteUrl(request.raw.url, slug);
  if (request.raw.method === "GET" && (request.raw.url === "/" || request.raw.url?.startsWith("/?"))) {
    await proxyTtydHtml(request, reply, target, project.id);
    return;
  }
  reply.hijack();
  proxy.web(request.raw, reply.raw, { target }, (error: Error) => {
    if (!reply.raw.headersSent) {
      reply.raw.writeHead(502);
    }
    reply.raw.end(error.message);
  });
}

function proxyTtydHtml(request: FastifyRequest, reply: FastifyReply, target: string, projectId: string): Promise<void> {
  return new Promise((resolve) => {
    const targetUrl = new URL(target);
    const upstream = http.request(
      {
        hostname: targetUrl.hostname,
        port: Number(targetUrl.port || 80),
        method: "GET",
        path: request.raw.url ?? "/",
        headers: { ...request.headers, host: targetUrl.host, "accept-encoding": "identity" }
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        res.on("end", () => {
          const type = String(res.headers["content-type"] ?? "");
          if (!type.includes("text/html")) {
            reply.code(res.statusCode ?? 200).headers(stripHopByHopHeaders(res.headers)).send(Buffer.concat(chunks));
            resolve();
            return;
          }
          const html = decodeHttpBody(Buffer.concat(chunks), String(res.headers["content-encoding"] ?? "")).toString("utf8");
          reply
            .code(res.statusCode ?? 200)
            .header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
            .header("Pragma", "no-cache")
            .header("Expires", "0")
            .type("text/html; charset=utf-8")
            .send(injectMobileTtydControls(html, projectId));
          resolve();
        });
      }
    );
    upstream.on("error", (error) => {
      reply.code(502).type("text/plain; charset=utf-8").send(error.message);
      resolve();
    });
    upstream.end();
  });
}

function decodeHttpBody(body: Buffer, encoding: string): Buffer {
  const normalized = encoding.toLowerCase();
  if (normalized.includes("gzip") || (body[0] === 0x1f && body[1] === 0x8b)) {
    return gunzipSync(body);
  }
  if (normalized.includes("br")) {
    return brotliDecompressSync(body);
  }
  if (normalized.includes("deflate")) {
    return inflateSync(body);
  }
  return body;
}

function stripHopByHopHeaders(headers: http.IncomingHttpHeaders): Record<string, string | string[]> {
  const blocked = new Set(["connection", "content-length", "transfer-encoding", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "upgrade"]);
  const next: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (blocked.has(key.toLowerCase()) || value === undefined) continue;
    next[key] = Array.isArray(value) ? value : String(value);
  }
  return next;
}

function injectMobileTtydControls(html: string, projectId: string): string {
  const controls = `
<style>
  #mt-ttyd-input-bar {
    position: fixed;
    left: 10px;
    bottom: 10px;
    width: min(320px, calc(100vw - 20px));
    z-index: 99999;
    display: grid;
    grid-template-columns: 1fr;
    gap: 6px;
    padding: 8px;
    background: rgba(17, 24, 39, 0.96);
    border: 1px solid rgba(255, 255, 255, 0.16);
    border-radius: 8px;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.38);
    box-sizing: border-box;
    touch-action: none;
  }
  #mt-ttyd-head {
    display: grid;
    grid-template-columns: 1fr auto auto;
    gap: 6px;
    align-items: stretch;
  }
  #mt-ttyd-drag {
    width: auto;
    min-width: 104px;
    min-height: 64px;
    border: 1px solid #6b7280;
    border-radius: 6px;
    background: #1f2937;
    color: #f9fafb;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: grab;
    user-select: none;
    touch-action: none;
    font: 36px system-ui, sans-serif;
    font-weight: 700;
    line-height: 1;
  }
  #mt-ttyd-drag:active {
    cursor: grabbing;
  }
  #mt-ttyd-input {
    width: 100%;
    min-height: 84px;
    max-height: 160px;
    resize: vertical;
    border: 1px solid #4b5563;
    border-radius: 6px;
    padding: 8px;
    background: #0b1020;
    color: transparent;
    caret-color: #f9fafb;
    font: 14px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    box-sizing: border-box;
  }
  #mt-ttyd-input::placeholder {
    color: #94a3b8;
  }
  #mt-ttyd-send, #mt-ttyd-collapse, .mt-ttyd-key {
    min-height: 40px;
    border: 1px solid #6b7280;
    border-radius: 6px;
    background: #f9fafb;
    color: #111827;
    padding: 0 10px;
    font: 13px system-ui, sans-serif;
    white-space: nowrap;
  }
  #mt-ttyd-status {
    min-height: 16px;
    color: #cbd5e1;
    font: 12px system-ui, sans-serif;
  }
  #mt-ttyd-keys {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 6px;
  }
  .mt-ttyd-key {
    width: 100%;
    padding: 0 6px;
  }
  .mt-ttyd-key.mt-ttyd-toggle-off {
    background: #374151;
    color: #f9fafb;
  }
  #mt-ttyd-input-bar.mt-ttyd-keyboard {
    gap: 5px;
  }
  #mt-ttyd-input-bar.mt-ttyd-keyboard #mt-ttyd-input {
    min-height: 64px;
    max-height: 88px;
  }
  #mt-ttyd-input-bar.mt-ttyd-keyboard #mt-ttyd-status,
  #mt-ttyd-input-bar.mt-ttyd-keyboard #mt-ttyd-keys {
    display: none;
  }
  html, body {
    width: 100%;
    height: 100%;
    margin: 0 !important;
    padding: 0 !important;
  }
  body { padding-bottom: 0 !important; }
  .xterm-viewport {
    overflow-y: auto !important;
    -webkit-overflow-scrolling: touch;
    touch-action: pan-y;
  }
  #mt-ttyd-input-bar.mt-ttyd-collapsed {
    width: auto;
    grid-template-columns: 1fr;
  }
  #mt-ttyd-input-bar.mt-ttyd-collapsed #mt-ttyd-head {
    grid-template-columns: auto auto;
  }
  #mt-ttyd-input-bar.mt-ttyd-collapsed #mt-ttyd-input,
  #mt-ttyd-input-bar.mt-ttyd-collapsed #mt-ttyd-send,
  #mt-ttyd-input-bar.mt-ttyd-collapsed #mt-ttyd-status,
  #mt-ttyd-input-bar.mt-ttyd-collapsed #mt-ttyd-keys {
    display: none;
  }
  #mt-ttyd-collapse {
    min-height: 38px;
    border: 1px solid #6b7280;
    border-radius: 6px;
    background: #374151;
    color: #f9fafb;
    padding: 0 10px;
    font: 13px system-ui, sans-serif;
  }
  #mt-ttyd-input-bar.mt-ttyd-collapsed #mt-ttyd-collapse {
    display: inline-flex;
    align-items: center;
  }
</style>
<div id="mt-ttyd-input-bar">
  <div id="mt-ttyd-head">
    <button id="mt-ttyd-drag" type="button" aria-label="拖动">≡</button>
    <button id="mt-ttyd-send" type="button">聚焦</button>
    <button id="mt-ttyd-collapse" type="button">收起</button>
  </div>
  <textarea id="mt-ttyd-input" rows="1" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="直通输入：输入即发送到终端"></textarea>
  <div id="mt-ttyd-status"></div>
  <div id="mt-ttyd-keys">
    <button class="mt-ttyd-key" type="button" data-key="Enter">Enter</button>
    <button class="mt-ttyd-key" type="button" data-key="Tab">Tab</button>
    <button class="mt-ttyd-key" type="button" data-key="Escape">Esc</button>
    <button class="mt-ttyd-key" type="button" id="mt-ttyd-gesture-toggle">滑动开</button>
    <button class="mt-ttyd-key" type="button" data-key="C-c">Ctrl-C</button>
    <button class="mt-ttyd-key" type="button" data-key="C-d">Ctrl-D</button>
    <button class="mt-ttyd-key" type="button" data-scroll="up">历史↑</button>
    <button class="mt-ttyd-key" type="button" data-key="Up">↑</button>
    <button class="mt-ttyd-key" type="button" data-scroll="down">历史↓</button>
    <button class="mt-ttyd-key" type="button" data-key="Left">←</button>
    <button class="mt-ttyd-key" type="button" data-key="Down">↓</button>
    <button class="mt-ttyd-key" type="button" data-key="Right">→</button>
  </div>
</div>
<script>
(function () {
  var projectId = ${JSON.stringify(projectId)};
  var bar = document.getElementById("mt-ttyd-input-bar");
  var drag = document.getElementById("mt-ttyd-drag");
  var status = document.getElementById("mt-ttyd-status");
  var collapse = document.getElementById("mt-ttyd-collapse");
  var gestureToggle = document.getElementById("mt-ttyd-gesture-toggle");
  var storageKey = "mt-ttyd-toolbar:" + location.pathname;
  var gestureStorageKey = storageKey + ":gesture-scroll";
  var gestureScrollEnabled = localStorage.getItem(gestureStorageKey) !== "off";
  var keyboardActive = false;
  var positionBeforeKeyboard = null;

  function viewportWidth() {
    return window.innerWidth;
  }
  function viewportHeight() {
    return window.innerHeight;
  }
  function currentBounds() {
    if (keyboardActive && window.visualViewport) {
      return {
        left: window.visualViewport.offsetLeft || 0,
        top: window.visualViewport.offsetTop || 0,
        width: window.visualViewport.width,
        height: window.visualViewport.height
      };
    }
    return { left: 0, top: 0, width: viewportWidth(), height: viewportHeight() };
  }
  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }
  function eventPoint(event) {
    return { x: event.clientX, y: event.clientY };
  }
  function place(left, top) {
    var rect = bar.getBoundingClientRect();
    var bounds = currentBounds();
    var minLeft = bounds.left + 8;
    var minTop = bounds.top + 8;
    var maxLeft = Math.max(minLeft, bounds.left + bounds.width - rect.width - 8);
    var maxTop = Math.max(minTop, bounds.top + bounds.height - rect.height - 8);
    bar.style.left = clamp(left, minLeft, maxLeft) + "px";
    bar.style.top = clamp(top, minTop, maxTop) + "px";
    bar.style.right = "auto";
    bar.style.bottom = "auto";
  }
  function currentPosition() {
    var rect = bar.getBoundingClientRect();
    return {
      left: rect.left,
      top: rect.top,
      collapsed: bar.classList.contains("mt-ttyd-collapsed")
    };
  }
  function savePosition() {
    if (keyboardActive) return;
    var rect = bar.getBoundingClientRect();
    localStorage.setItem(storageKey, JSON.stringify({
      left: rect.left,
      top: rect.top,
      collapsed: bar.classList.contains("mt-ttyd-collapsed")
    }));
  }
  function placeDefault() {
    requestAnimationFrame(function () {
      var rect = bar.getBoundingClientRect();
      place(10, viewportHeight() - rect.height - 10);
    });
  }
  function restorePositionForMode() {
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem(storageKey) || "null"); } catch (_) {}
    if (saved && typeof saved.left === "number" && typeof saved.top === "number") {
      if (typeof saved.collapsed === "boolean") setCollapsed(saved.collapsed);
      requestAnimationFrame(function () { place(saved.left, saved.top); });
      return;
    }
    placeDefault();
  }
  function restorePosition() {
    restorePositionForMode();
  }
  restorePosition();
  function clampCurrentPosition() {
    if (syncKeyboardLayout()) return;
    var rect = bar.getBoundingClientRect();
    place(rect.left, rect.top);
    savePosition();
  }
  window.addEventListener("resize", clampCurrentPosition);
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", syncKeyboardLayout);
    window.visualViewport.addEventListener("scroll", syncKeyboardLayout);
  }

  function setCollapsed(collapsed) {
    bar.classList.toggle("mt-ttyd-collapsed", collapsed);
    collapse.textContent = collapsed ? "展开" : "收起";
  }
  function notifyResize() {
    setTimeout(function () {
      window.dispatchEvent(new Event("resize"));
      var rect = bar.getBoundingClientRect();
      place(rect.left, rect.top);
    }, 250);
  }
  function isKeyboardOpen() {
    if (!window.visualViewport) return false;
    var active = document.activeElement;
    var inputFocused = active && active.id === "mt-ttyd-input";
    var hiddenHeight = window.innerHeight - window.visualViewport.height - (window.visualViewport.offsetTop || 0);
    return Boolean(inputFocused && (hiddenHeight > 120 || window.visualViewport.height < window.innerHeight * 0.78));
  }
  function placeForKeyboard() {
    if (!keyboardActive || !window.visualViewport) return;
    requestAnimationFrame(function () {
      var rect = bar.getBoundingClientRect();
      var bounds = currentBounds();
      var left = positionBeforeKeyboard && typeof positionBeforeKeyboard.left === "number" ? positionBeforeKeyboard.left : 10;
      var top = bounds.top + bounds.height - rect.height - 8;
      place(left, top);
    });
  }
  function syncKeyboardLayout() {
    var open = isKeyboardOpen();
    if (open) {
      if (!keyboardActive) {
        positionBeforeKeyboard = currentPosition();
        keyboardActive = true;
        bar.classList.add("mt-ttyd-keyboard");
      }
      placeForKeyboard();
      return true;
    }
    if (keyboardActive) {
      keyboardActive = false;
      bar.classList.remove("mt-ttyd-keyboard");
      if (positionBeforeKeyboard) {
        var saved = positionBeforeKeyboard;
        positionBeforeKeyboard = null;
        requestAnimationFrame(function () {
          place(saved.left, saved.top);
        });
      }
      return true;
    }
    return false;
  }
  function updateGestureToggle() {
    if (!gestureToggle) return;
    gestureToggle.textContent = gestureScrollEnabled ? "滑动开" : "滑动关";
    gestureToggle.classList.toggle("mt-ttyd-toggle-off", !gestureScrollEnabled);
  }
  if (gestureToggle) {
    updateGestureToggle();
    gestureToggle.addEventListener("click", function () {
      gestureScrollEnabled = !gestureScrollEnabled;
      localStorage.setItem(gestureStorageKey, gestureScrollEnabled ? "on" : "off");
      updateGestureToggle();
      showStatus(gestureScrollEnabled ? "滑动历史已开启" : "滑动历史已关闭");
      input.focus();
      resetCaptureInput();
    });
  }
  var historyScrollInFlight = false;
  var queuedHistoryLines = 0;
  var queuedHistoryDirection = null;
  function postHistoryScroll(direction, lines) {
    if (!lines) return;
    if (historyScrollInFlight) {
      if (queuedHistoryDirection === direction || queuedHistoryDirection === null) {
        queuedHistoryDirection = direction;
        queuedHistoryLines = Math.min(200, queuedHistoryLines + lines);
      } else {
        queuedHistoryDirection = direction;
        queuedHistoryLines = lines;
      }
      return;
    }
    historyScrollInFlight = true;
    fetch("/api/projects/" + encodeURIComponent(projectId) + "/scroll", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ direction: direction, lines: Math.min(200, lines) })
    }).catch(function (error) {
      showStatus("滚动失败: " + error.message.slice(0, 80));
    }).finally(function () {
      historyScrollInFlight = false;
      if (queuedHistoryDirection && queuedHistoryLines) {
        var nextDirection = queuedHistoryDirection;
        var nextLines = queuedHistoryLines;
        queuedHistoryDirection = null;
        queuedHistoryLines = 0;
        postHistoryScroll(nextDirection, nextLines);
      }
    });
  }
  function installViewportScrollBridge() {
    var lastY = null;
    var pendingPixels = 0;
    var pixelsPerLine = 18;
    function scrollTerminal(deltaY) {
      pendingPixels += deltaY;
      var lines = pendingPixels > 0 ? Math.floor(pendingPixels / pixelsPerLine) : Math.ceil(pendingPixels / pixelsPerLine);
      if (!lines) return false;
      pendingPixels -= lines * pixelsPerLine;
      postHistoryScroll(lines > 0 ? "up" : "down", Math.abs(lines));
      showStatus((lines > 0 ? "历史↑ " : "历史↓ ") + Math.abs(lines) + "行");
      return true;
    }
    document.addEventListener("touchstart", function (event) {
      if (!gestureScrollEnabled) return;
      if (event.target && bar.contains(event.target)) return;
      if (!event.touches || !event.touches.length) return;
      lastY = event.touches[0].clientY;
      pendingPixels = 0;
    }, { capture: true, passive: true });
    document.addEventListener("touchmove", function (event) {
      if (!gestureScrollEnabled) return;
      if (event.target && bar.contains(event.target)) return;
      if (lastY === null || !event.touches || !event.touches.length) return;
      var nextY = event.touches[0].clientY;
      if (scrollTerminal(lastY - nextY)) event.preventDefault();
      lastY = nextY;
    }, { capture: true, passive: false });
    document.addEventListener("touchend", function () {
      if (!gestureScrollEnabled) return;
      lastY = null;
      pendingPixels = 0;
    }, { capture: true, passive: true });
  }
  var dragging = null;
  drag.addEventListener("pointerdown", function (event) {
    var rect = bar.getBoundingClientRect();
    var point = eventPoint(event);
    dragging = {
      pointerId: event.pointerId,
      dx: point.x - rect.left,
      dy: point.y - rect.top
    };
    drag.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  drag.addEventListener("pointermove", function (event) {
    if (!dragging || dragging.pointerId !== event.pointerId) return;
    var point = eventPoint(event);
    place(point.x - dragging.dx, point.y - dragging.dy);
    event.preventDefault();
  });
  function stopDragging(event) {
    if (!dragging || dragging.pointerId !== event.pointerId) return;
    dragging = null;
    savePosition();
  }
  drag.addEventListener("pointerup", stopDragging);
  drag.addEventListener("pointercancel", stopDragging);

  collapse.addEventListener("click", function () {
    setCollapsed(!bar.classList.contains("mt-ttyd-collapsed"));
    requestAnimationFrame(function () {
      var rect = bar.getBoundingClientRect();
      place(rect.left, rect.top);
      savePosition();
    });
  });

  function showStatus(text) {
    status.textContent = text || "";
    if (text) setTimeout(function () { if (status.textContent === text) status.textContent = ""; }, 1600);
  }
  async function postInput(data, kind) {
    var response = await fetch("/api/projects/" + encodeURIComponent(projectId) + "/input", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: data, kind: kind || "raw" })
    });
    if (!response.ok) {
      var message = await response.text().catch(function () { return ""; });
      throw new Error(message || ("HTTP " + response.status));
    }
  }
  function sendText(text, kind, doneText) {
    if (!text) return;
    postInput(text, kind).then(function () {
      showStatus(doneText || "已发送");
    }).catch(function (error) {
      showStatus("发送失败: " + error.message.slice(0, 80));
    });
  }
  var input = document.getElementById("mt-ttyd-input");
  var send = document.getElementById("mt-ttyd-send");
  var composing = false;
  var sentinel = "\\u200b";
  var specialKeys = {
    Enter: "Enter",
    Tab: "Tab",
    Escape: "Escape",
    ArrowUp: "Up",
    ArrowDown: "Down",
    ArrowLeft: "Left",
    ArrowRight: "Right",
    Home: "Home",
    End: "End"
  };

  function resetCaptureInput() {
    input.value = sentinel;
    try { input.setSelectionRange(input.value.length, input.value.length); } catch (_) {}
  }
  function visibleInputValue() {
    return input.value.split(sentinel).join("");
  }
  function flushVisibleInput(doneText) {
    var value = visibleInputValue();
    if (value) sendText(value, "raw", doneText || "已输入");
    resetCaptureInput();
  }
  function flushInputSoon() {
    setTimeout(function () { flushVisibleInput("已输入"); }, 0);
  }
  send.addEventListener("click", function () {
    input.focus();
    resetCaptureInput();
  });
  input.addEventListener("focus", function () {
    resetCaptureInput();
    setTimeout(syncKeyboardLayout, 80);
    setTimeout(syncKeyboardLayout, 320);
  });
  input.addEventListener("blur", function () {
    setTimeout(syncKeyboardLayout, 120);
  });
  input.addEventListener("click", function () {
    resetCaptureInput();
    setTimeout(syncKeyboardLayout, 80);
  });
  input.addEventListener("compositionstart", function () {
    composing = true;
  });
  input.addEventListener("compositionend", function () {
    composing = false;
    flushVisibleInput("已输入");
  });
  input.addEventListener("beforeinput", function (event) {
    if (composing) return;
    if (event.inputType === "insertText" && event.data) {
      event.preventDefault();
      sendText(event.data, "raw", "已输入");
      resetCaptureInput();
      return;
    }
    if (event.inputType === "insertLineBreak" || event.inputType === "insertParagraph") {
      event.preventDefault();
      sendText("Enter", "key", "已执行 Enter");
      resetCaptureInput();
      return;
    }
    if (event.inputType === "deleteContentBackward") {
      event.preventDefault();
      sendText("BSpace", "key", "已退格");
      resetCaptureInput();
      return;
    }
    if (event.inputType === "deleteContentForward") {
      event.preventDefault();
      sendText("Delete", "key", "已删除");
      resetCaptureInput();
    }
  });
  input.addEventListener("input", function () {
    if (composing) return;
    flushVisibleInput("已输入");
  });
  input.addEventListener("keydown", function (event) {
    if (composing) return;
    if (event.ctrlKey && !event.altKey && !event.metaKey) {
      var ctrlKey = event.key.toLowerCase();
      if (ctrlKey === "c" || ctrlKey === "d") {
        event.preventDefault();
        sendText(ctrlKey === "c" ? "C-c" : "C-d", "key", "已发送按键");
        resetCaptureInput();
        return;
      }
    }
    var key = specialKeys[event.key];
    if (!key) return;
    event.preventDefault();
    sendText(key, "key", key === "Enter" ? "已执行 Enter" : "已发送按键");
    resetCaptureInput();
  });
  input.addEventListener("paste", function () {
    flushInputSoon();
  });
  document.querySelectorAll(".mt-ttyd-key").forEach(function (button) {
    button.addEventListener("click", function () {
      var scrollDirection = button.getAttribute("data-scroll");
      if (scrollDirection) {
        postHistoryScroll(scrollDirection, 10);
        input.focus();
        resetCaptureInput();
        return;
      }
      var key = button.getAttribute("data-key") || "";
      sendText(key, "key", key === "Enter" ? "已执行 Enter" : "已发送按键");
      input.focus();
      resetCaptureInput();
    });
  });
  installViewportScrollBridge();
  resetCaptureInput();
  input.focus();
})();
</script>`;
  if (html.includes("</body>")) return html.replace("</body>", `${controls}</body>`);
  return `${html}${controls}`;
}

export async function proxyTtydWebSocket(
  client: WebSocket,
  request: FastifyRequest,
  project: ProjectRow,
  permission: ProjectPermission
): Promise<void> {
  if (!("ttyd_enabled" in project) || !project.ttyd_enabled) {
    client.close(1008, "ttyd disabled");
    return;
  }
  if (permission === "read") {
    client.close(1008, "readonly users cannot open ttyd");
    return;
  }

  const item = await ensureTtyd(project);
  const protocols = String(request.headers["sec-websocket-protocol"] ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const upstream = new WebSocket(`ws://127.0.0.1:${item.port}/ws`, protocols.length > 0 ? protocols : undefined, {
    headers: {
      origin: `http://127.0.0.1:${item.port}`
    }
  });
  const pending: Array<{ data: WebSocket.RawData; binary: boolean }> = [];
  let closed = false;

  const closeBoth = (code = 1000, reason = "") => {
    if (closed) return;
    closed = true;
    const closeCode = normalizeCloseCode(code);
    const closeReason = reason.slice(0, 120);
    if (client.readyState === WebSocket.OPEN || client.readyState === WebSocket.CONNECTING) {
      client.close(closeCode, closeReason);
    }
    if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) {
      upstream.close(closeCode, closeReason);
    }
  };

  client.on("message", (data, isBinary) => {
    if (upstream.readyState === WebSocket.OPEN) {
      upstream.send(data, { binary: isBinary });
    } else if (upstream.readyState === WebSocket.CONNECTING) {
      pending.push({ data, binary: isBinary });
    }
  });

  upstream.on("open", () => {
    for (const item of pending.splice(0)) {
      upstream.send(item.data, { binary: item.binary });
    }
  });

  upstream.on("message", (data, isBinary) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data, { binary: isBinary });
    }
  });

  client.on("close", (code, buffer) => closeBoth(code, buffer.toString()));
  upstream.on("close", (code, buffer) => closeBoth(code, buffer.toString()));
  client.on("error", () => closeBoth(1011, "client error"));
  upstream.on("error", () => closeBoth(1011, "upstream error"));
}

function normalizeCloseCode(code: number): number {
  if (code >= 1000 && code < 5000 && ![1004, 1005, 1006].includes(code)) {
    return code;
  }
  return 1011;
}

export function registerTtydUpgrade(
  app: FastifyInstance,
  findProject: (slug: string, request: IncomingMessage) => Promise<{ project: ProjectRow; allowed: boolean } | null>
) {
  app.server.on("upgrade", async (request: IncomingMessage, socket: Socket, head: Buffer) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    const match = url.pathname.match(/^\/ttyd\/([^/]+)(\/.*)?$/);
    if (!match) return;
    const slug = match[1];
    const result = await findProject(slug, request);
    if (!result || !result.allowed || !("ttyd_enabled" in result.project) || !result.project.ttyd_enabled) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }
    const item = await ensureTtyd(result.project);
    request.url = rewriteUrl(request.url, slug);
    proxy.ws(request, socket, head, { target: `http://127.0.0.1:${item.port}` });
  });
}
