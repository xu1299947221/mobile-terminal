function ensureHeadTag(html: string, pattern: RegExp, tag: string): string {
  if (pattern.test(html)) return html;
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head[^>]*>/i, (match) => `${match}\n${tag}`);
  }
  return `${tag}\n${html}`;
}

function injectViewportMeta(html: string): string {
  const viewport = '<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover, interactive-widget=overlays-content">';
  const viewportPattern = /<meta\s+[^>]*name=["']viewport["'][^>]*>/i;
  let next = html;
  if (viewportPattern.test(html)) {
    next = html.replace(viewportPattern, viewport);
  } else {
    next = ensureHeadTag(next, viewportPattern, viewport);
  }
  next = ensureHeadTag(next, /<meta\s+[^>]*name=["']theme-color["'][^>]*>/i, '<meta name="theme-color" content="#111827">');
  next = ensureHeadTag(next, /<meta\s+[^>]*name=["']apple-mobile-web-app-capable["'][^>]*>/i, '<meta name="apple-mobile-web-app-capable" content="yes">');
  next = ensureHeadTag(next, /<meta\s+[^>]*name=["']apple-mobile-web-app-status-bar-style["'][^>]*>/i, '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">');
  next = ensureHeadTag(next, /<meta\s+[^>]*name=["']apple-mobile-web-app-title["'][^>]*>/i, '<meta name="apple-mobile-web-app-title" content="Terminal">');
  next = ensureHeadTag(next, /<link\s+[^>]*rel=["']manifest["'][^>]*>/i, '<link rel="manifest" href="/manifest.webmanifest">');
  return next;
}

function appendBeforeBody(html: string, controls: string): string {
  if (html.includes("</body>")) return html.replace("</body>", `${controls}</body>`);
  return `${html}${controls}`;
}

function mobileControls(projectId: string): string {
  return `
<style>
  :root {
    --mt-safe-bottom: env(safe-area-inset-bottom, 0px);
    --mt-safe-right: env(safe-area-inset-right, 0px);
  }
  html,
  body {
    width: 100%;
    height: 100%;
    margin: 0 !important;
    padding: 0 !important;
    overflow: hidden;
    overscroll-behavior: none;
    touch-action: none;
  }
  body { padding-bottom: 0 !important; }
  .xterm-viewport {
    overflow-y: auto !important;
    -webkit-overflow-scrolling: touch;
    overscroll-behavior: contain;
    touch-action: none;
  }
  body.mt-keyboard-fit #terminal-container,
  body.mt-ios-keyboard-fit #terminal-container {
    height: var(--mt-keyboard-visible-height, 100vh) !important;
  }
  body.mt-keyboard-fit #terminal-container .terminal,
  body.mt-ios-keyboard-fit #terminal-container .terminal {
    height: calc(var(--mt-keyboard-visible-height, 100vh) - 10px) !important;
  }
  #mt-ttyd-controller {
    position: fixed;
    right: calc(10px + var(--mt-safe-right));
    bottom: calc(10px + var(--mt-safe-bottom));
    z-index: 2147483647;
    width: min(336px, calc(100vw - 20px));
    max-width: calc(100vw - 20px);
    display: grid;
    gap: 6px;
    padding: 7px;
    border: 1px solid rgba(148, 163, 184, 0.48);
    border-radius: 8px;
    background: rgba(15, 23, 42, 0.96);
    box-shadow: 0 16px 34px rgba(0, 0, 0, 0.42);
    box-sizing: border-box;
    color: #f8fafc;
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
    font: 13px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }
  #mt-ttyd-controller.mt-collapsed {
    width: auto;
    max-width: calc(100vw - 20px);
    padding: 6px;
  }
  #mt-ttyd-controller.mt-keyboard-open {
    gap: 5px;
  }
  #mt-ttyd-strip {
    display: grid;
    grid-template-columns: 64px repeat(4, minmax(52px, 1fr));
    gap: 6px;
    align-items: stretch;
  }
  #mt-ttyd-controller.mt-collapsed #mt-ttyd-strip {
    grid-template-columns: 72px 64px;
  }
  #mt-ttyd-controller.mt-collapsed .mt-hide-collapsed,
  #mt-ttyd-controller.mt-collapsed #mt-ttyd-status,
  #mt-ttyd-controller.mt-collapsed .mt-panel {
    display: none !important;
  }
  #mt-ttyd-drag {
    min-width: 64px;
    min-height: 58px;
    font-size: 30px;
    font-weight: 700;
    cursor: grab;
    touch-action: none;
  }
  #mt-ttyd-drag:active {
    cursor: grabbing;
  }
  .mt-btn,
  .mt-key {
    min-height: 42px;
    border: 1px solid #64748b;
    border-radius: 6px;
    background: #f8fafc;
    color: #0f172a;
    padding: 0 8px;
    font: 13px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    white-space: nowrap;
    touch-action: manipulation;
  }
  .mt-btn:active,
  .mt-key:active {
    transform: translateY(1px);
  }
  .mt-btn-secondary {
    background: #334155;
    color: #f8fafc;
  }
  .mt-btn-active {
    background: #22c55e;
    border-color: #86efac;
    color: #052e16;
  }
  .mt-toggle-off {
    background: #475569;
    color: #f8fafc;
  }
  #mt-ttyd-status {
    min-height: 16px;
    overflow: hidden;
    color: #cbd5e1;
    font-size: 12px;
    line-height: 16px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .mt-panel {
    display: none;
    gap: 6px;
  }
  #mt-ttyd-controller.mt-input-open #mt-ttyd-input-panel,
  #mt-ttyd-controller.mt-quick-open #mt-ttyd-quick-panel,
  #mt-ttyd-controller.mt-history-open #mt-ttyd-history-panel {
    display: grid;
  }
  #mt-ttyd-input {
    width: 100%;
    min-height: 62px;
    max-height: 96px;
    resize: none;
    border: 1px solid #475569;
    border-radius: 6px;
    padding: 8px;
    background: #020617;
    color: transparent;
    caret-color: #f8fafc;
    font: 15px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    box-sizing: border-box;
    outline: none;
  }
  #mt-ttyd-input::placeholder {
    color: #94a3b8;
  }
  #mt-ttyd-controller.mt-keyboard-open #mt-ttyd-input {
    min-height: 54px;
    max-height: 70px;
  }
  .mt-row {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 6px;
  }
  .mt-row-3 {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
  .mt-dpad {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 6px;
  }
  .mt-dpad .mt-empty {
    min-height: 42px;
  }
  @media (orientation: landscape) and (max-height: 520px) {
    #mt-ttyd-controller {
      width: min(420px, calc(100vw - 20px));
    }
    #mt-ttyd-controller.mt-keyboard-open #mt-ttyd-quick-panel,
    #mt-ttyd-controller.mt-keyboard-open #mt-ttyd-history-panel {
      display: none;
    }
    .mt-btn,
    .mt-key {
      min-height: 38px;
    }
    #mt-ttyd-drag {
      min-height: 50px;
    }
  }
</style>
<div id="mt-ttyd-controller" aria-label="mobile-terminal 控制器">
  <div id="mt-ttyd-strip">
    <button id="mt-ttyd-drag" class="mt-btn mt-btn-secondary" type="button" aria-label="拖动">≡</button>
    <button id="mt-ttyd-keyboard" class="mt-btn mt-hide-collapsed" type="button">键盘</button>
    <button id="mt-ttyd-quick" class="mt-btn mt-hide-collapsed" type="button">快捷</button>
    <button id="mt-ttyd-history" class="mt-btn mt-hide-collapsed" type="button">历史</button>
    <button id="mt-ttyd-collapse" class="mt-btn mt-btn-secondary" type="button">收起</button>
  </div>
  <div id="mt-ttyd-status"></div>
  <div id="mt-ttyd-input-panel" class="mt-panel">
    <textarea id="mt-ttyd-input" rows="2" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="send" placeholder="输入文字，确认后直通到终端"></textarea>
    <div class="mt-row">
      <button class="mt-key" type="button" data-key="Enter">Enter</button>
      <button class="mt-key" type="button" data-key="Tab">Tab</button>
      <button class="mt-key" type="button" data-key="Escape">Esc</button>
      <button id="mt-ttyd-hide-keyboard" class="mt-key mt-btn-secondary" type="button">收键盘</button>
    </div>
  </div>
  <div id="mt-ttyd-quick-panel" class="mt-panel">
    <div class="mt-row">
      <button id="mt-ttyd-reconnect" class="mt-key" type="button">重连</button>
      <button class="mt-key" type="button" data-key="C-c">Ctrl-C</button>
      <button class="mt-key" type="button" data-key="C-d">Ctrl-D</button>
      <button class="mt-key" type="button" data-key="Home">Home</button>
    </div>
    <div class="mt-row">
      <button class="mt-key" type="button" data-key="End">End</button>
      <button class="mt-key" type="button" data-key="Escape">Esc</button>
      <button class="mt-key" type="button" data-key="Tab">Tab</button>
      <button class="mt-key" type="button" data-key="S-Tab">Shift-Tab</button>
    </div>
    <div class="mt-dpad">
      <span class="mt-empty"></span>
      <button class="mt-key" type="button" data-key="Up">↑</button>
      <span class="mt-empty"></span>
      <button class="mt-key" type="button" data-key="Left">←</button>
      <button class="mt-key" type="button" data-key="Down">↓</button>
      <button class="mt-key" type="button" data-key="Right">→</button>
    </div>
  </div>
  <div id="mt-ttyd-history-panel" class="mt-panel">
    <div class="mt-row mt-row-3">
      <button class="mt-key" type="button" data-scroll="up">历史↑</button>
      <button class="mt-key" type="button" data-scroll="down">历史↓</button>
      <button id="mt-ttyd-gesture-toggle" class="mt-key" type="button">滑动关</button>
    </div>
  </div>
</div>
<script>
(function () {
  var projectId = ${JSON.stringify(projectId)};
  var controller = document.getElementById("mt-ttyd-controller");
  var drag = document.getElementById("mt-ttyd-drag");
  var keyboardButton = document.getElementById("mt-ttyd-keyboard");
  var quickButton = document.getElementById("mt-ttyd-quick");
  var historyButton = document.getElementById("mt-ttyd-history");
  var collapseButton = document.getElementById("mt-ttyd-collapse");
  var hideKeyboardButton = document.getElementById("mt-ttyd-hide-keyboard");
  var reconnectButton = document.getElementById("mt-ttyd-reconnect");
  var gestureToggle = document.getElementById("mt-ttyd-gesture-toggle");
  var status = document.getElementById("mt-ttyd-status");
  var input = document.getElementById("mt-ttyd-input");
  var storageKey = "mt-ttyd-controller:" + location.pathname;
  var gestureStorageKey = storageKey + ":gesture-scroll";
  var gestureScrollEnabled = localStorage.getItem(gestureStorageKey) === "on";
  var supportsVisualViewport = Boolean(window.visualViewport);
  var supportsVirtualKeyboard = Boolean(navigator.virtualKeyboard);
  var keyboardState = "idle";
  var keyboardMode = supportsVirtualKeyboard ? "enhanced-overlay" : supportsVisualViewport ? "visual-viewport" : "basic";
  var keyboardRect = null;
  var dragging = null;
  var composing = false;
  var ignoreNextInput = false;
  var sentinel = "\\u200b";
  var statusTimer = null;
  var lastLayoutWidth = window.innerWidth;
  var lastLayoutHeight = window.innerHeight;
  var autoReconnectStorageKey = storageKey + ":auto-reconnect-at";
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

  function showStatus(text) {
    status.textContent = text || "";
    if (statusTimer) clearTimeout(statusTimer);
    if (text) statusTimer = setTimeout(function () {
      if (status.textContent === text) status.textContent = "";
    }, 1800);
  }

  function setModeStatus() {
    controller.setAttribute("data-keyboard-mode", keyboardMode);
  }

  function tryEnableVirtualKeyboard() {
    if (!supportsVirtualKeyboard) return;
    try {
      navigator.virtualKeyboard.overlaysContent = true;
      navigator.virtualKeyboard.addEventListener("geometrychange", function () {
        keyboardRect = navigator.virtualKeyboard.boundingRect;
        syncKeyboardLayout();
      });
    } catch (_) {
      keyboardMode = supportsVisualViewport ? "visual-viewport" : "basic";
    }
  }

  function viewportBounds() {
    var focused = isTerminalInputFocused();
    if (focused && keyboardRect && keyboardRect.height > 80) {
      return {
        left: 0,
        top: 0,
        width: window.innerWidth,
        height: Math.max(160, window.innerHeight - keyboardRect.height)
      };
    }
    if (focused && window.visualViewport) {
      var visibleBottom = Math.min(window.innerHeight, (window.visualViewport.offsetTop || 0) + window.visualViewport.height);
      return {
        left: 0,
        top: 0,
        width: window.innerWidth,
        height: Math.max(160, visibleBottom)
      };
    }
    return { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
  }

  function visibleViewportHeight() {
    if (keyboardRect && keyboardRect.height > 80) return Math.max(160, window.innerHeight - keyboardRect.height);
    if (!window.visualViewport) return window.innerHeight;
    return Math.max(160, Math.min(window.innerHeight, (window.visualViewport.offsetTop || 0) + window.visualViewport.height));
  }

  function notifyTerminalResize() {
    setTimeout(function () {
      window.dispatchEvent(new Event("resize"));
    }, 60);
  }

  function setTerminalKeyboardFit(enabled) {
    if (supportsVirtualKeyboard && !(keyboardRect && keyboardRect.height > 80)) return;
    document.body.classList.toggle("mt-keyboard-fit", enabled);
    document.body.classList.toggle("mt-ios-keyboard-fit", enabled);
    if (enabled) {
      document.documentElement.style.setProperty("--mt-keyboard-visible-height", visibleViewportHeight() + "px");
    } else {
      document.documentElement.style.removeProperty("--mt-keyboard-visible-height");
    }
    notifyTerminalResize();
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function place(left, top) {
    var rect = controller.getBoundingClientRect();
    var bounds = viewportBounds();
    var minLeft = bounds.left + 8;
    var minTop = bounds.top + 8;
    var maxLeft = Math.max(minLeft, bounds.left + bounds.width - rect.width - 8);
    var maxTop = Math.max(minTop, bounds.top + bounds.height - rect.height - 8);
    controller.style.left = clamp(left, minLeft, maxLeft) + "px";
    controller.style.top = clamp(top, minTop, maxTop) + "px";
    controller.style.right = "auto";
    controller.style.bottom = "auto";
  }

  function placeDefault() {
    requestAnimationFrame(function () {
      var rect = controller.getBoundingClientRect();
      place(window.innerWidth - rect.width - 10, window.innerHeight - rect.height - 10);
    });
  }

  function savePosition() {
    if (keyboardState === "keyboard-open" || keyboardState === "keyboard-opening") return;
    var rect = controller.getBoundingClientRect();
    localStorage.setItem(storageKey, JSON.stringify({
      left: rect.left,
      top: rect.top,
      collapsed: controller.classList.contains("mt-collapsed")
    }));
  }

  function restorePosition() {
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem(storageKey) || "null"); } catch (_) {}
    if (saved && typeof saved.left === "number" && typeof saved.top === "number") {
      setCollapsed(Boolean(saved.collapsed));
      requestAnimationFrame(function () { place(saved.left, saved.top); });
      return;
    }
    placeDefault();
  }

  function clampCurrentPosition() {
    requestAnimationFrame(function () {
      var rect = controller.getBoundingClientRect();
      place(rect.left, rect.top);
    });
  }

  function setCollapsed(collapsed) {
    controller.classList.toggle("mt-collapsed", collapsed);
    collapseButton.textContent = collapsed ? "展开" : "收起";
    if (collapsed) {
      closePanels();
      input.blur();
    }
  }

  function closePanels() {
    controller.classList.remove("mt-input-open", "mt-quick-open", "mt-history-open");
    keyboardButton.classList.remove("mt-btn-active");
    quickButton.classList.remove("mt-btn-active");
    historyButton.classList.remove("mt-btn-active");
  }

  function openPanel(name) {
    var isInput = name === "input";
    var isQuick = name === "quick";
    var isHistory = name === "history";
    controller.classList.toggle("mt-input-open", isInput);
    controller.classList.toggle("mt-quick-open", isQuick);
    controller.classList.toggle("mt-history-open", isHistory);
    keyboardButton.classList.toggle("mt-btn-active", isInput);
    quickButton.classList.toggle("mt-btn-active", isQuick);
    historyButton.classList.toggle("mt-btn-active", isHistory);
    controller.classList.remove("mt-collapsed");
    collapseButton.textContent = "收起";
    clampCurrentPosition();
  }

  function keyboardVisible() {
    if (!isTerminalInputFocused()) return false;
    if (keyboardRect && keyboardRect.height > 80) return true;
    if (!window.visualViewport) return false;
    var hiddenHeight = window.innerHeight - window.visualViewport.height - (window.visualViewport.offsetTop || 0);
    return hiddenHeight > 120 || window.visualViewport.height < window.innerHeight * 0.78;
  }

  function setKeyboardState(next) {
    if (keyboardState === next) return;
    keyboardState = next;
    controller.classList.toggle("mt-keyboard-open", next === "keyboard-open" || next === "keyboard-opening");
    controller.setAttribute("data-keyboard-state", next);
  }

  function placeForKeyboard() {
    requestAnimationFrame(function () {
      var rect = controller.getBoundingClientRect();
      var bounds = viewportBounds();
      var left = clamp(rect.left, bounds.left + 8, Math.max(bounds.left + 8, bounds.left + bounds.width - rect.width - 8));
      var top = bounds.top + bounds.height - rect.height - 8;
      place(left, top);
    });
  }

  function followKeyboardViewport() {
    if (!keyboardVisible()) return;
    setTerminalKeyboardFit(true);
    placeForKeyboard();
  }

  function syncKeyboardLayout() {
    if (document.activeElement === input && !keyboardVisible()) {
      if (keyboardState !== "keyboard-opening") setKeyboardState("keyboard-opening");
      return;
    }
    if (keyboardVisible()) {
      setKeyboardState("keyboard-open");
      setTerminalKeyboardFit(true);
      placeForKeyboard();
      return;
    }
    if (keyboardState !== "idle") {
      setKeyboardState("idle");
      setTerminalKeyboardFit(false);
    }
  }

  function openKeyboard() {
    openPanel("input");
    setKeyboardState("keyboard-opening");
    resetCaptureInput();
    input.focus({ preventScroll: true });
    showStatus("键盘模式: " + keyboardMode);
    setTimeout(syncKeyboardLayout, 80);
    setTimeout(syncKeyboardLayout, 320);
    setTimeout(syncKeyboardLayout, 700);
  }

  function hideKeyboard() {
    input.blur();
    setKeyboardState("idle");
    setTerminalKeyboardFit(false);
    showStatus("键盘已收起");
    setTimeout(clampCurrentPosition, 120);
  }

  function isNativeXtermInput(target) {
    return Boolean(target && target !== input && target.classList && target.classList.contains("xterm-helper-textarea"));
  }

  function isTerminalInputFocused() {
    return document.activeElement === input || isNativeXtermInput(document.activeElement);
  }

  function syncNativeTerminalKeyboard() {
    if (isNativeXtermInput(document.activeElement)) {
      setKeyboardState("keyboard-opening");
      setTimeout(syncKeyboardLayout, 80);
      setTimeout(syncKeyboardLayout, 320);
      setTimeout(syncKeyboardLayout, 700);
      setTimeout(syncKeyboardLayout, 1100);
      return;
    }
    if (document.activeElement !== input && keyboardState !== "idle") {
      setKeyboardState("idle");
      setTerminalKeyboardFit(false);
    }
  }

  function installNativeInputFit() {
    document.addEventListener("focusin", function (event) {
      if (!isNativeXtermInput(event.target)) return;
      syncNativeTerminalKeyboard();
    }, { capture: true });
    document.addEventListener("focusout", function (event) {
      if (!isNativeXtermInput(event.target)) return;
      setTimeout(syncNativeTerminalKeyboard, 80);
    }, { capture: true });
  }

  function resetCaptureInput() {
    input.value = sentinel;
    try { input.setSelectionRange(input.value.length, input.value.length); } catch (_) {}
  }

  function visibleInputValue() {
    return input.value.split(sentinel).join("");
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

  function flushVisibleInput(doneText) {
    var value = visibleInputValue();
    if (value) sendText(value, "raw", doneText || "已输入");
    resetCaptureInput();
  }

  function sendKey(key, doneText) {
    sendText(key, "key", doneText || (key === "Enter" ? "已执行 Enter" : "已发送按键"));
  }

  function keepCurrentFocus(event) {
    event.preventDefault();
  }

  function reconnectTtyd() {
    showStatus("正在重连...");
    window.setTimeout(function () {
      window.location.reload();
    }, 60);
  }

  function autoReconnectTtyd(reason) {
    var now = Date.now();
    var previous = Number(sessionStorage.getItem(autoReconnectStorageKey) || "0");
    if (previous && now - previous < 15000) return;
    sessionStorage.setItem(autoReconnectStorageKey, String(now));
    showStatus(reason || "连接异常，正在重连...");
    window.setTimeout(function () {
      window.location.reload();
    }, 350);
  }

  function hasTtydReconnectPrompt() {
    var text = document.body ? document.body.innerText || "" : "";
    return /press\\s+.*reconnect/i.test(text);
  }

  function checkTtydConnection(reason) {
    if (document.hidden) return;
    if (hasTtydReconnectPrompt()) {
      autoReconnectTtyd("检测到 ttyd 断开，正在重连...");
    }
  }

  function scheduleConnectionCheck(reason, delay) {
    window.setTimeout(function () {
      checkTtydConnection(reason);
    }, delay || 1200);
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

  function updateGestureToggle() {
    if (!gestureToggle) return;
    gestureToggle.textContent = gestureScrollEnabled ? "滑动开" : "滑动关";
    gestureToggle.classList.toggle("mt-toggle-off", !gestureScrollEnabled);
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
    function shouldOwnTouch(event) {
      return !(event.target && controller.contains(event.target));
    }
    document.addEventListener("touchstart", function (event) {
      if (!shouldOwnTouch(event)) return;
      if (!event.touches || !event.touches.length) return;
      lastY = event.touches[0].clientY;
      pendingPixels = 0;
    }, { capture: true, passive: true });
    document.addEventListener("touchmove", function (event) {
      if (!shouldOwnTouch(event)) return;
      event.preventDefault();
      if (lastY === null || !event.touches || !event.touches.length) return;
      if (!gestureScrollEnabled) return;
      var nextY = event.touches[0].clientY;
      scrollTerminal(nextY - lastY);
      lastY = nextY;
    }, { capture: true, passive: false });
    document.addEventListener("touchend", function () {
      lastY = null;
      pendingPixels = 0;
    }, { capture: true, passive: true });
    document.addEventListener("touchcancel", function () {
      lastY = null;
      pendingPixels = 0;
    }, { capture: true, passive: true });
  }

  drag.addEventListener("pointerdown", function (event) {
    var rect = controller.getBoundingClientRect();
    dragging = {
      pointerId: event.pointerId,
      dx: event.clientX - rect.left,
      dy: event.clientY - rect.top
    };
    drag.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  drag.addEventListener("pointermove", function (event) {
    if (!dragging || dragging.pointerId !== event.pointerId) return;
    place(event.clientX - dragging.dx, event.clientY - dragging.dy);
    event.preventDefault();
  });
  function stopDragging(event) {
    if (!dragging || dragging.pointerId !== event.pointerId) return;
    dragging = null;
    savePosition();
  }
  drag.addEventListener("pointerup", stopDragging);
  drag.addEventListener("pointercancel", stopDragging);

  keyboardButton.addEventListener("click", function () {
    openKeyboard();
  });
  quickButton.addEventListener("click", function () {
    input.blur();
    if (controller.classList.contains("mt-quick-open")) {
      closePanels();
    } else {
      openPanel("quick");
    }
  });
  historyButton.addEventListener("click", function () {
    input.blur();
    if (controller.classList.contains("mt-history-open")) {
      closePanels();
    } else {
      openPanel("history");
    }
  });
  collapseButton.addEventListener("click", function () {
    setCollapsed(!controller.classList.contains("mt-collapsed"));
    requestAnimationFrame(function () {
      clampCurrentPosition();
      savePosition();
    });
  });
  hideKeyboardButton.addEventListener("click", function () {
    hideKeyboard();
  });
  if (reconnectButton) {
    reconnectButton.addEventListener("pointerdown", keepCurrentFocus);
    reconnectButton.addEventListener("mousedown", keepCurrentFocus);
    reconnectButton.addEventListener("click", function () {
      reconnectTtyd();
    });
  }
  if (gestureToggle) {
    updateGestureToggle();
    gestureToggle.addEventListener("click", function () {
      gestureScrollEnabled = !gestureScrollEnabled;
      localStorage.setItem(gestureStorageKey, gestureScrollEnabled ? "on" : "off");
      updateGestureToggle();
      showStatus(gestureScrollEnabled ? "滑动历史已开启" : "滑动历史已关闭");
    });
  }

  input.addEventListener("focus", function () {
    openPanel("input");
    setKeyboardState("keyboard-opening");
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
    ignoreNextInput = true;
    flushVisibleInput("已输入");
    setTimeout(function () { ignoreNextInput = false; }, 0);
  });
  input.addEventListener("beforeinput", function (event) {
    if (composing || event.inputType === "insertCompositionText") return;
    if (event.inputType === "insertText" && event.data) {
      event.preventDefault();
      sendText(event.data, "raw", "已输入");
      resetCaptureInput();
      return;
    }
    if (event.inputType === "insertLineBreak" || event.inputType === "insertParagraph") {
      event.preventDefault();
      sendKey("Enter", "已执行 Enter");
      resetCaptureInput();
      return;
    }
    if (event.inputType === "deleteContentBackward") {
      event.preventDefault();
      sendKey("BSpace", "已退格");
      resetCaptureInput();
      return;
    }
    if (event.inputType === "deleteContentForward") {
      event.preventDefault();
      sendKey("Delete", "已删除");
      resetCaptureInput();
    }
  });
  input.addEventListener("input", function () {
    if (composing) return;
    if (ignoreNextInput) {
      ignoreNextInput = false;
      return;
    }
    flushVisibleInput("已输入");
  });
  input.addEventListener("keydown", function (event) {
    if (composing) return;
    if (event.ctrlKey && !event.altKey && !event.metaKey) {
      var ctrlKey = event.key.toLowerCase();
      if (ctrlKey === "c" || ctrlKey === "d") {
        event.preventDefault();
        sendKey(ctrlKey === "c" ? "C-c" : "C-d", "已发送按键");
        resetCaptureInput();
        return;
      }
    }
    if (event.key === "Tab" && event.shiftKey) {
      event.preventDefault();
      sendKey("S-Tab", "已发送按键");
      resetCaptureInput();
      return;
    }
    var key = specialKeys[event.key];
    if (!key) return;
    event.preventDefault();
    sendKey(key, key === "Enter" ? "已执行 Enter" : "已发送按键");
    resetCaptureInput();
  });
  input.addEventListener("paste", function () {
    setTimeout(function () { flushVisibleInput("已粘贴"); }, 0);
  });

  document.addEventListener("dblclick", function (event) {
    if (event.target && controller.contains(event.target)) return;
    event.preventDefault();
    reconnectTtyd();
  }, { capture: true });
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) scheduleConnectionCheck("页面恢复后检测到连接异常，正在重连...", 800);
  });
  window.addEventListener("pageshow", function () {
    scheduleConnectionCheck("页面恢复后检测到连接异常，正在重连...", 800);
  });

  document.querySelectorAll("#mt-ttyd-controller [data-key]").forEach(function (button) {
    button.addEventListener("pointerdown", keepCurrentFocus);
    button.addEventListener("mousedown", keepCurrentFocus);
    button.addEventListener("click", function () {
      sendKey(button.getAttribute("data-key") || "", "已发送按键");
    });
  });
  document.querySelectorAll("#mt-ttyd-controller [data-scroll]").forEach(function (button) {
    button.addEventListener("pointerdown", keepCurrentFocus);
    button.addEventListener("mousedown", keepCurrentFocus);
    button.addEventListener("click", function () {
      postHistoryScroll(button.getAttribute("data-scroll") || "up", 10);
    });
  });

  window.addEventListener("resize", function () {
    var nextWidth = window.innerWidth;
    var nextHeight = window.innerHeight;
    if (nextWidth === lastLayoutWidth && nextHeight === lastLayoutHeight) return;
    lastLayoutWidth = nextWidth;
    lastLayoutHeight = nextHeight;
    setTimeout(clampCurrentPosition, 80);
  });
  window.addEventListener("orientationchange", function () {
    setTimeout(clampCurrentPosition, 250);
  });
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", function () {
      syncKeyboardLayout();
      followKeyboardViewport();
    });
    window.visualViewport.addEventListener("scroll", function () {
      followKeyboardViewport();
    });
  }

  tryEnableVirtualKeyboard();
  setModeStatus();
  installNativeInputFit();
  installViewportScrollBridge();
  resetCaptureInput();
  restorePosition();
})();
</script>`;
}

export function injectMobileTtydControls(html: string, projectId: string): string {
  return appendBeforeBody(injectViewportMeta(html), mobileControls(projectId));
}
