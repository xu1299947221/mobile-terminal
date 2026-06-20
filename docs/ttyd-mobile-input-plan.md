# ttyd 手机端输入体验优化方案

本文档用于指导下一轮 `ttyd` 手机端体验优化开发。目标是先在 Web 方案内尽量接近远控软件的输入体验，暂不进入 App 壳子开发。

## 当前稳定版本

当前优化前稳定版本已经打标签：

```text
pre-ttyd-input-web-20260620
```

查看标签：

```bash
git tag --list 'pre-ttyd-input-*'
```

如需回退到优化前版本：

```bash
git checkout pre-ttyd-input-web-20260620
```

如果要把主分支强制回到该版本，必须先确认没有未保存工作，再执行：

```bash
git switch main
git reset --hard pre-ttyd-input-web-20260620
```

注意：`git reset --hard` 会丢弃工作区未提交改动，平时不要随意执行。

## 背景判断

手机浏览器无法像原生 App 一样完全控制系统输入法。尤其在 iOS / iPadOS 上，即使用 Chrome，底层仍受 WebKit 和系统键盘行为限制，不能获得 Android Chrome 的全部能力。

但 Web 仍有一套值得实现的优化路径：

- Android Chromium 浏览器使用 `VirtualKeyboard API` 和 `interactive-widget=overlays-content`，尽量让键盘覆盖页面而不是挤压页面。
- iOS / iPadOS 使用 `VisualViewport API` 做兜底，把输入面板稳定移动到可视区域内。
- `ttyd` 主要负责显示终端画面，输入改由本系统注入的悬浮输入控制层负责。
- 方向键、Enter、Tab、Esc、Ctrl-C、Ctrl-D 等快捷键不触发系统输入法，直接通过后端 API 发送到 `tmux`。

## 当前实现现状

当前 `ttyd` 相关逻辑集中在：

```text
apps/server/src/ttyd.ts
```

关键流程：

```text
用户访问 /ttyd/:slug/
  -> 后端鉴权
  -> ensureTtyd(project)
  -> 启动 ttyd 绑定到 127.0.0.1:19000+
  -> 代理 ttyd HTML
  -> injectMobileTtydControls(html, projectId)
  -> 注入悬浮输入栏、快捷键、滑动历史等脚本
```

当前已具备：

- 悬浮输入栏。
- 拖动按钮。
- 聚焦输入框。
- 直通输入。
- Enter / Tab / Esc / Ctrl-C / Ctrl-D / 方向键按钮。
- 历史上/下按钮。
- 触摸滑动历史开关。
- 基于 `visualViewport` 的初步键盘避让。

当前主要问题：

- 输入框聚焦后，系统输入法仍会改变页面可视区域，导致布局抖动或遮挡。
- 输入层和终端画面耦合过强，输入框长期存在并参与布局感知。
- iOS / iPadOS 只能兜底适配，不能真正启用键盘覆盖模式。
- 当前脚本体积已经较大，应拆分为可维护的注入资源。

## 目标体验

### 用户视角

打开 `ttyd` 后默认看到完整终端画面。

右侧或底部有一个小型悬浮控制器：

```text
[键盘] [快捷键] [历史] [收起]
```

点击键盘按钮后：

- Android Chrome 优先让输入法覆盖页面，不挤压终端区域。
- iOS / iPadOS 将输入面板贴到可视区域底部，尽量不挡住当前输入位置。
- 终端画面不因为输入法弹出而整体错乱。
- 输入完成后可以一键收起键盘。

快捷键按钮不弹出系统输入法：

```text
Enter
Tab
Esc
Ctrl-C
Ctrl-D
↑ ↓ ← →
历史↑
历史↓
```

中文输入要可用：

- 拼音组合期间不发送半成品。
- 候选词确认后一次性发送最终文本。
- 删除键发送 Backspace。
- 回车可选择发送 Enter。

### 工程目标

- 保持 `ttyd` 作为主力终端显示方式。
- 不破坏当前鉴权、项目权限、`tmux` session 复用逻辑。
- 不直接暴露裸 `ttyd` 端口。
- 尽量不改 ttyd 源码，通过代理 HTML 注入实现。
- 先优化 Web 体验，不引入 iOS 打包/签名复杂度。

## 技术路线

### 分层结构

```text
ttyd 原始页面
  ├─ ttyd / xterm.js：负责终端显示和 WebSocket 输出
  └─ mobile-terminal 注入层：
       ├─ 视口和键盘策略
       ├─ 悬浮输入控制器
       ├─ 快捷键按钮
       ├─ 输入捕获 textarea
       ├─ 历史滚动桥接
       └─ API 输入转发
```

输入转发链路：

```text
悬浮输入层
  -> POST /api/projects/:projectId/input
  -> sendTerminalInput()
  -> tmux send-keys / paste-buffer
  -> 同一个 tmux session
  -> ttyd 画面显示结果
```

历史滚动链路：

```text
触摸滑动 / 历史按钮
  -> POST /api/projects/:projectId/scroll
  -> tmux copy-mode / send-keys
  -> ttyd 画面更新
```

### 浏览器能力分层

启动时做能力检测：

```js
const supportsVirtualKeyboard = "virtualKeyboard" in navigator;
const supportsVisualViewport = "visualViewport" in window;
```

模式划分：

```text
enhanced-overlay:
  Android Chromium 优先。
  使用 VirtualKeyboard API + interactive-widget=overlays-content。

visual-viewport:
  iOS / iPadOS / 不支持 VirtualKeyboard 的浏览器。
  使用 VisualViewport API 监听 resize/scroll。

basic:
  老浏览器兜底。
  不承诺键盘避让，只保留快捷键和输入转发。
```

### Android Chromium 增强模式

注入或修正 viewport meta：

```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, interactive-widget=overlays-content">
```

启用 VirtualKeyboard 覆盖模式：

```js
if ("virtualKeyboard" in navigator) {
  navigator.virtualKeyboard.overlaysContent = true;
}
```

监听键盘几何变化：

```js
navigator.virtualKeyboard.addEventListener("geometrychange", () => {
  const rect = navigator.virtualKeyboard.boundingRect;
  // 根据 rect.height 调整输入面板位置
});
```

预期效果：

- 系统输入法覆盖页面。
- Layout Viewport 不被压缩。
- 终端显示区域不跟随键盘大幅抖动。
- 悬浮输入面板根据键盘高度移动到键盘上方或保持在可见区域。

### iOS / iPadOS 兜底模式

iOS 不能依赖 VirtualKeyboard API。使用：

```js
window.visualViewport.addEventListener("resize", syncLayout);
window.visualViewport.addEventListener("scroll", syncLayout);
```

关键计算：

```js
const vv = window.visualViewport;
const visibleLeft = vv.offsetLeft;
const visibleTop = vv.offsetTop;
const visibleWidth = vv.width;
const visibleHeight = vv.height;
```

策略：

- 输入框聚焦后，把悬浮输入面板限制在 visual viewport 内。
- 输入完成后提供明显的“收键盘”按钮，主动 `input.blur()`。
- 不强行改变 ttyd 终端尺寸，避免横竖屏和键盘切换时反复重排。
- iPad 横屏重点验证悬浮面板不变形、不只允许横向移动。

## 计划改造内容

### 1. 拆分注入资源

当前 `injectMobileTtydControls()` 内联 HTML/CSS/JS 太长，后续维护困难。

建议新增：

```text
apps/server/src/ttyd-mobile-controls.ts
```

职责：

- 输出注入 HTML。
- 输出注入 CSS。
- 输出注入 JS。
- 保留纯字符串生成，避免复杂构建流程。

`apps/server/src/ttyd.ts` 只保留：

```ts
import { injectMobileTtydControls } from "./ttyd-mobile-controls.js";
```

### 2. 注入 viewport 配置

在 HTML 注入时处理 `<head>`：

- 如果已有 viewport meta，则追加或替换 `interactive-widget=overlays-content`。
- 如果没有，则插入新的 viewport meta。
- 保持 `width=device-width, initial-scale=1.0`。

注意：

- 这主要对 Android Chromium 有效。
- iOS 不保证支持，但插入后不应破坏页面。

### 3. 重做悬浮控制器形态

改成两层：

```text
迷你控制器：
  小尺寸，默认贴右侧或右下角。
  按钮：键盘、快捷键、历史、收起/展开。

输入面板：
  只有点键盘时出现。
  包含隐藏/半隐藏 textarea、发送状态、收键盘按钮。
```

不要让大输入框默认常驻底部。

建议布局：

```text
竖屏：
  右下角迷你控制器
  输入面板浮在底部或键盘上方

横屏：
  右侧竖向控制器
  输入面板靠右或靠下，但必须可拖动
```

拖动要求：

- 拖动手柄面积足够大。
- `pointerdown/pointermove/pointerup` 支持触摸。
- 横竖屏切换后重新 clamp 到可见区域。
- 位置按 pathname 存 localStorage。

### 4. 输入捕获策略

核心原则：

```text
系统输入法只负责产出文本。
终端输入由我们发送给 tmux。
```

textarea 设置：

```html
autocomplete="off"
autocapitalize="off"
autocorrect="off"
spellcheck="false"
enterkeyhint="send"
```

保留 sentinel 技术，避免输入框中残留内容影响后续输入。

事件处理：

- `compositionstart`：进入中文组合态，不发送。
- `compositionend`：发送最终确认文本。
- `beforeinput insertText`：非组合态立即发送字符。
- `beforeinput deleteContentBackward`：发送 `BSpace`。
- `beforeinput insertLineBreak`：发送 `Enter`。
- `keydown`：捕获方向键、Tab、Esc、Ctrl-C、Ctrl-D。
- `paste`：短延迟读取最终文本并发送。

要避免：

- 中文候选词未确认就发送半成品。
- iOS 标点/空格被吞。
- `input` 和 `compositionend` 双发。

### 5. 快捷键面板

快捷键按钮不聚焦 textarea，除非用户明确点击“键盘”。

按钮分组：

```text
基础：
  Enter Tab Esc

控制：
  Ctrl-C Ctrl-D

方向：
      ↑
  ←   ↓   →

历史：
  历史↑ 历史↓ 滑动历史开关

键盘：
  打开键盘 收起键盘
```

点击快捷键后：

```text
POST /api/projects/:projectId/input
{ "kind": "key", "data": "Enter" }
```

不要让按钮点击触发系统输入法。

### 6. 键盘状态机

建议显式维护状态：

```text
idle:
  没有打开输入法，迷你控制器显示。

keyboard-opening:
  用户点击键盘，textarea focus，等待 viewport/geometry 变化。

keyboard-open:
  输入法已打开，输入面板进入键盘模式。

keyboard-closing:
  用户点击收键盘或 textarea blur。
```

状态来源：

- `document.activeElement`
- `visualViewport.height`
- `visualViewport.offsetTop`
- `navigator.virtualKeyboard.boundingRect`
- 定时兜底检测

目标：

- 避免现在这种“只根据一次 visualViewport resize 判断”的不稳定状态。
- 横竖屏和键盘收起后能回到原位置。

### 7. 终端画面保护

Web 侧不强制缩放整个 ttyd 终端。

建议：

- `html, body` 保持 `height: 100%`。
- 尽量不动态改 `.terminal` 高度。
- 不把输入面板作为普通文档流元素。
- 所有控制器使用 `position: fixed`。
- 键盘打开时只移动控制器，不重排 ttyd 主体。

Android 增强模式下：

- 让键盘覆盖页面。
- 终端主体保持原布局。

iOS 兜底模式下：

- 控制器保持在 visual viewport 内。
- 终端被系统行为影响时，尽量不追加二次扰动。

### 8. 历史滚动

保留两种方式：

- 历史按钮：稳定可用。
- 触摸滑动：可开关。

触摸滑动原则：

- 默认可先关闭，避免和页面滚动/选中文本冲突；也可以保留当前默认开启，但必须有状态按钮。
- 滑动只在非控制器区域生效。
- 移动方向要和用户直觉一致：
  - 手指上滑：查看更早历史。
  - 手指下滑：回到更新内容。

实现继续走：

```text
POST /api/projects/:projectId/scroll
```

### 9. PWA 增强

虽然不做 App 壳子，但可以强化 PWA：

- `manifest.webmanifest`
- `display: fullscreen` 或 `standalone`
- `theme_color`
- iOS `apple-mobile-web-app-capable`
- iOS `apple-mobile-web-app-status-bar-style`

目标是：

- 手机添加到桌面后打开更像 App。
- 减少浏览器地址栏对视口高度的影响。

这不是输入法控制的根本方案，但能改善可用空间。

## 验收标准

### Android Chrome

必须验证：

- 打开 ttyd 默认终端全屏可见。
- 点击键盘按钮后，键盘弹出不明显挤乱终端布局。
- 输入中文后，候选词确认才发送到终端。
- Backspace 可删除终端字符。
- Enter / Tab / Esc / Ctrl-C / Ctrl-D / 方向键按钮可用。
- 输入法收起后，悬浮控制器回到合理位置。
- 横屏下控制器不变形，可拖动到可见区域。
- 历史按钮可看历史。
- 滑动历史开关生效。

### iPhone / iPad Safari 或 Chrome

必须验证：

- 页面不白屏。
- 点击键盘后输入面板不跑出可视区域。
- 输入中文可用。
- 收键盘后布局恢复。
- 横竖屏切换后控制器仍在可见范围。
- 快捷键按钮不弹输入法，且能发到终端。

允许残留：

- iOS 键盘弹出时页面可视区域仍有系统级变化。
- iOS 不能保证和 Android Chrome 一样完全覆盖不挤压。

### 回归验证

必须验证：

- 登录和前置验证仍正常。
- 只读用户仍不能打开可写 ttyd。
- 项目权限不变。
- `tmux` session 不被重建或误杀。
- `npm run build -w @mobile-terminal/shared && npm run build -w @mobile-terminal/server && npm run build -w @mobile-terminal/web` 通过。
- `systemctl --user restart mobile-terminal` 后公网入口可打开。

## 开发步骤建议

### 阶段一：结构整理

1. 新增 `apps/server/src/ttyd-mobile-controls.ts`。
2. 把当前注入 HTML/CSS/JS 从 `ttyd.ts` 迁移过去。
3. 保持行为完全一致。
4. 构建并验证 ttyd 仍可打开。

这一阶段只做搬迁，便于后续修改。

### 阶段二：viewport 和能力检测

1. 注入或更新 viewport meta。
2. 增加能力检测脚本。
3. 页面上临时显示调试状态，例如：

```text
VK: on/off
VV: on/off
mode: enhanced-overlay / visual-viewport / basic
```

4. 调试状态后续可收进隐藏 debug 面板。

### 阶段三：控制器重做

1. 大输入框不再默认常驻。
2. 默认显示迷你控制器。
3. 点击键盘按钮才展开输入面板并 focus textarea。
4. 收键盘按钮 blur textarea。
5. 快捷键按钮不 focus textarea。

### 阶段四：输入状态机

1. 实现 `idle/opening/open/closing`。
2. Android 走 `VirtualKeyboard.geometrychange`。
3. iOS 走 `VisualViewport.resize/scroll`。
4. 增加定时兜底检测。
5. 修复横竖屏切换后位置 clamp。

### 阶段五：输入事件加固

1. 梳理 `beforeinput`、`input`、`compositionend` 的发送顺序。
2. 防止双发。
3. 针对 iOS 标点、空格、中文候选词做兜底。
4. 粘贴多行时走 raw 输入，不自动附加 Enter。

### 阶段六：真实设备验证和调参

优先顺序：

1. Android Chrome 手机。
2. Android Chrome 横屏。
3. iPad Safari / Chrome。
4. iPhone Safari / Chrome。

每轮验证后记录问题，再小步修。

## 不做事项

本轮不做：

- 不开发 React Native / Flutter / uni-app App 壳子。
- 不修改 ttyd 源码。
- 不替换 ttyd 为其他 Web terminal。
- 不重写完整自研 xterm 终端。
- 不新增公网端口。
- 不改变 Cloudflare Tunnel 结构。

## 可参考项目和资料

### ttyd

`ttyd` 是当前使用的核心工具，负责把终端通过 Web 暴露出来，前端基于 xterm.js。

```text
https://github.com/tsl0922/ttyd
https://tsl0922.github.io/ttyd/
```

参考点：

- ttyd 页面结构。
- xterm.js 终端容器。
- WebSocket 终端传输模型。

### xterm.js

`ttyd` 和很多 Web 终端都基于 xterm.js。xterm.js 官方说明支持 tmux、bash、curses 应用，也支持 CJK、emoji、IME。

```text
https://github.com/xtermjs/xterm.js/
https://xtermjs.org/
```

参考点：

- IME 输入难点。
- Web 终端在移动端的限制。
- 是否存在可借鉴的 CompositionHelper 思路。

### WeTTY

WeTTY 是另一个基于 xterm.js 和 WebSocket 的 Web terminal。

```text
https://github.com/butlerx/wetty
```

参考点：

- Web terminal 结构。
- 浏览器内终端输入和 WebSocket 交互。

### GoTTY

GoTTY 是把命令行工具变成 Web 应用的方案。

```text
https://github.com/sorenisanerd/gotty
```

参考点：

- Web terminal 安全边界。
- 不直接裸露终端服务的重要性。

### VirtualKeyboard API

用于让支持的浏览器把虚拟键盘作为覆盖层处理，而不是自动压缩 viewport。

```text
https://developer.mozilla.org/en-US/docs/Web/API/VirtualKeyboard_API
https://developer.mozilla.org/en-US/docs/Web/API/VirtualKeyboard/overlaysContent
```

参考点：

- `navigator.virtualKeyboard.overlaysContent = true`
- `navigator.virtualKeyboard.boundingRect`
- `geometrychange`

### viewport interactive-widget

Chrome 支持通过 viewport meta 控制键盘出现时 viewport 的变化方式。

```text
https://developer.chrome.com/blog/viewport-resize-behavior
https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/meta/name/viewport
```

参考点：

```text
interactive-widget=overlays-content
interactive-widget=resizes-visual
interactive-widget=resizes-content
```

### VisualViewport API

用于 iOS / Android 兜底检测键盘弹出后的可视区域。

```text
https://developer.mozilla.org/en-US/docs/Web/API/VisualViewport
```

参考点：

- `visualViewport.width`
- `visualViewport.height`
- `visualViewport.offsetTop`
- `resize`
- `scroll`

## 风险和边界

### iOS 无法做到完全一致

iOS / iPadOS 上即使使用 Chrome，也不能等同于 Android Chrome。很多输入法和 viewport 行为由 WebKit 与系统控制，Web 页面只能适配。

验收时不能要求 iOS 达到 Android Chromium 的 `overlays-content` 体验。

### 中文输入法不可完全模拟

不能用网页自绘键盘替代系统中文输入法。拼音、候选词、语音输入、第三方输入法行为都应交给系统 IME。

本方案只捕获最终输入结果并转发到终端。

### ttyd 原生输入仍存在

ttyd 自己的 xterm 输入机制仍在页面里。我们的注入层需要尽量避免和 ttyd 原生输入抢焦点。

建议：

- 默认不主动 focus ttyd 内部输入。
- 所有文字输入走注入 textarea。
- 快捷键走后端 API。

### 网络延迟影响输入手感

通过 `/api/projects/:id/input` 发送按键比直接在 ttyd WebSocket 内输入多一层 HTTP 请求。对文字输入可能有延迟。

如果延迟明显，后续可以考虑：

- 复用现有 WebSocket 输入通道。
- 增加批量输入队列。
- 对连续字符做短时间合并。

本轮先保持现有 API，降低改动风险。

## 推荐 goal 文案

后续可以这样启动开发：

```text
请按 docs/ttyd-mobile-input-plan.md 开发 ttyd 手机端输入体验优化。
要求先完成结构拆分，再实现 Web 输入法增强和悬浮控制器重做。
完成后构建、重启服务、验证公网入口，并提交推送。
```
