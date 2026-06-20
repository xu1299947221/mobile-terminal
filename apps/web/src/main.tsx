import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Link, Navigate, Route, BrowserRouter as Router, Routes, useNavigate, useParams } from "react-router-dom";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { Copy, Download, ExternalLink, LogOut, Maximize2, Minimize2, Play, Plus, RefreshCcw, Save, Send, Trash2, Users } from "lucide-react";
import type { DefaultCommand, ProjectWithPermission, Role, User } from "@mobile-terminal/shared";
import { api, type AdminContext } from "./api";
import "./styles.css";

type AuthState = { user: User | null; loading: boolean };
type GateState = { verified: boolean; username: string | null; loading: boolean };
type ProjectFormState = {
  name: string;
  slug: string;
  path: string;
  defaultCommand: DefaultCommand;
  tmuxSession: string;
  ttydEnabled: boolean;
};
type UserFormState = {
  username: string;
  displayName: string;
  password: string;
  role: Role;
};

const dateTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false
});

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "-";
  const time = new Date(value);
  if (Number.isNaN(time.getTime())) return value;
  return dateTimeFormatter.format(time);
}

function slugify(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "project";
}

function nextProjectIdentity(projects: ProjectWithPermission[], baseValue: string, command: DefaultCommand) {
  const base = slugify(baseValue.split("/").filter(Boolean).at(-1) ?? baseValue);
  const suffix = command === "shell" ? "sh" : command === "claude" ? "cc" : command;
  const root = slugify(`${base}-${suffix}`);
  const usedSlugs = new Set(projects.map((project) => project.slug));
  const usedSessions = new Set(projects.map((project) => project.tmuxSession));
  let index = 1;
  while (true) {
    const candidate = index === 1 ? root : `${root}-${index}`;
    const session = `mt_${candidate.replace(/-/g, "_")}`;
    if (!usedSlugs.has(candidate) && !usedSessions.has(session)) {
      return { slug: candidate, tmuxSession: session };
    }
    index += 1;
  }
}

function useAuth() {
  const [state, setState] = useState<AuthState>({ user: null, loading: true });
  const [gate, setGate] = useState<GateState>({ verified: false, username: null, loading: true });
  useEffect(() => {
    api
      .me()
      .then(({ user }) => {
        setState({ user, loading: false });
        setGate({ verified: true, username: user.username, loading: false });
      })
      .catch(() => {
        setState({ user: null, loading: false });
        api
          .gateStatus()
          .then((status) => setGate({ verified: status.verified, username: status.username, loading: false }))
          .catch(() => setGate({ verified: false, username: null, loading: false }));
      });
  }, []);
  return { ...state, gate, setState, setGate };
}

function Shell({ user, onLogout }: { user: User; onLogout: () => void }) {
  return (
    <div className="app">
      <header className="topbar">
        <Link to="/projects" className="brand">mobile-terminal</Link>
        <nav>
          <Link to="/projects">项目</Link>
          {(user.role === "admin" || user.hasProjectAdmin) && <Link to="/admin">管理</Link>}
          <button onClick={onLogout} title="退出"><LogOut size={18} /></button>
        </nav>
      </header>
      <main>
        <Routes>
          <Route path="/projects" element={<Projects user={user} />} />
          <Route path="/app/:slug" element={<TerminalPage />} />
          <Route path="/admin/*" element={user.role === "admin" || user.hasProjectAdmin ? <Admin /> : <Navigate to="/projects" />} />
          <Route path="*" element={<Navigate to="/projects" />} />
        </Routes>
      </main>
    </div>
  );
}

function AccessGate({ onVerified }: { onVerified: (username: string) => void }) {
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState("");
  return (
    <div className="login">
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setError("");
          try {
            const result = await api.verifyGate(answer);
            onVerified(result.username);
          } catch (err: any) {
            setError(err.message);
          }
        }}
      >
        <h1>访问验证</h1>
        <label>你是谁<input value={answer} onChange={(e) => setAnswer(e.target.value)} autoComplete="username" autoFocus required /></label>
        {error && <p className="error">{error}</p>}
        <button type="submit">继续</button>
      </form>
    </div>
  );
}

function Login({ username, onLogin }: { username: string; onLogin: (user: User) => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  return (
    <div className="login">
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setError("");
          if (!password) {
            setError("请输入密码");
            return;
          }
          try {
            const { user } = await api.login(username, password);
            onLogin(user);
          } catch (err: any) {
            setError(err.message);
          }
        }}
      >
        <h1>mobile-terminal</h1>
        <label>用户名<input value={username} readOnly autoComplete="username" /></label>
        <label>密码<input value={password} onChange={(e) => setPassword(e.target.value)} type="password" autoComplete="current-password" required /></label>
        {error && <p className="error">{error}</p>}
        <button type="submit">登录</button>
      </form>
    </div>
  );
}

function Projects({ user }: { user: User }) {
  const [projects, setProjects] = useState<ProjectWithPermission[]>([]);
  const [error, setError] = useState("");
  const load = () => api.projects().then((res) => setProjects(res.projects)).catch((err) => setError(err.message));
  useEffect(() => {
    void load();
  }, []);
  return (
    <section className="page">
      <div className="page-head">
        <h1>项目</h1>
        <button onClick={load}><RefreshCcw size={16} />刷新</button>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="project-list">
        {projects.map((project) => (
          <article className="project-row" key={project.id}>
            <div>
              <h2>{project.name}</h2>
              <p>{project.path}</p>
              <span>{project.defaultCommand} · {project.permission} · {project.status}</span>
            </div>
            <div className="actions">
              {project.ttydEnabled && project.permission !== "read" ? (
                <>
                  <a className="button" href={`/ttyd/${project.slug}/`} target="_blank"><ExternalLink size={16} />打开</a>
                  <Link className="button ghost" to={`/app/${project.slug}`}>备用</Link>
                </>
              ) : (
                <Link className="button" to={`/app/${project.slug}`}>打开</Link>
              )}
              {project.permission !== "read" && <StartButtons project={project} onChange={load} />}
            </div>
          </article>
        ))}
      </div>
      {projects.length === 0 && <p className="muted">{user.role === "admin" ? "还没有项目，到管理页添加。" : "暂无授权项目。"}</p>}
    </section>
  );
}

function StartButtons({ project, onChange }: { project: ProjectWithPermission; onChange: () => void | Promise<void> }) {
  const run = async (action: () => Promise<unknown>) => {
    await action();
    await onChange();
  };
  return (
    <>
      <button title="只确保 tmux 会话存在，不启动 Codex 或 Claude" onClick={() => run(() => api.ensureSession(project.id))}><Play size={16} />session</button>
      <button title="在该项目 tmux 会话里发送 codex 并回车" onClick={() => run(() => api.startCommand(project.id, "codex"))}>Codex</button>
      <button title="在该项目 tmux 会话里发送 cc 并回车" onClick={() => run(() => api.startCommand(project.id, "claude"))}>Claude</button>
      <button className="ghost" title="停止该项目对应的 tmux session" onClick={() => run(() => api.stopSession(project.id))}>停止</button>
    </>
  );
}

function TerminalPage() {
  const { slug = "" } = useParams();
  const [projects, setProjects] = useState<ProjectWithPermission[]>([]);
  const project = useMemo(() => projects.find((item) => item.slug === slug), [projects, slug]);
  useEffect(() => {
    api.projects().then((res) => setProjects(res.projects));
  }, []);
  if (!project) return <section className="page"><p>加载项目...</p></section>;
  return <TerminalView project={project} />;
}

function TerminalView({ project }: { project: ProjectWithPermission }) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [task, setTask] = useState("");
  const [recent, setRecent] = useState("");
  const [compact, setCompact] = useState(false);
  const writable = project.permission === "write" || project.permission === "admin";

  useEffect(() => {
    const term = new Terminal({ cursorBlink: true, fontSize: 14, convertEol: true, theme: { background: "#0b1020" } });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(terminalRef.current!);
    fit.fit();
    termRef.current = term;
    fitRef.current = fit;
    const protocol = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${protocol}://${location.host}/ws/terminal/${project.slug}`);
    wsRef.current = ws;
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === "output") term.write(msg.data);
      if (msg.type === "error") term.writeln(`\r\n[error] ${msg.message}`);
    };
    ws.onopen = () => {
      fit.fit();
      ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
    };
    term.onData((data) => {
      if (writable && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ data, kind: "raw" }));
    });
    const resize = () => {
      fit.fit();
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
    };
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
      ws.close();
      term.dispose();
    };
  }, [project.slug, writable]);

  const send = (data: string, kind: "raw" | "task" | "key" = "raw") => {
    if (!writable) return;
    wsRef.current?.send(JSON.stringify({ data, kind }));
  };
  const copyRecent = async () => {
    const res = await api.output(project.id);
    setRecent(res.output);
    await navigator.clipboard.writeText(res.output);
  };
  const downloadRecent = async () => {
    const res = await api.output(project.id);
    setRecent(res.output);
    const blob = new Blob([res.output], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${project.slug}-output.txt`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className={`terminal-page ${compact ? "compact" : ""}`}>
      <div className="terminal-head">
        <div>
          <h1>{project.name}</h1>
          <p>{project.path}</p>
        </div>
        <div className="actions">
          <button className="ghost" onClick={() => setCompact((value) => !value)}>{compact ? <Minimize2 size={16} /> : <Maximize2 size={16} />}{compact ? "标准" : "紧凑"}</button>
          {project.ttydEnabled && writable && <a className="button ghost" href={`/ttyd/${project.slug}/`} target="_blank">ttyd</a>}
        </div>
      </div>
      <div className="terminal" ref={terminalRef} />
      <div className="mobile-input">
        <textarea value={task} onChange={(e) => setTask(e.target.value)} placeholder="输入下一步任务..." disabled={!writable} />
        <div className="keybar">
          <button disabled={!writable} onClick={() => { send(task, "task"); setTask(""); }}><Send size={16} />发送</button>
          <button disabled={!writable} onClick={() => send("\r")}>Enter</button>
          <button disabled={!writable} onClick={() => send("\t")}>Tab</button>
          <button disabled={!writable} onClick={() => send("\x1b")}>Esc</button>
          <button disabled={!writable} onClick={() => send("\x03")}>Ctrl-C</button>
          <button disabled={!writable} onClick={() => send("\x04")}>Ctrl-D</button>
          <button disabled={!writable} onClick={() => send("\x1b[A")}>↑</button>
          <button disabled={!writable} onClick={() => send("\x1b[B")}>↓</button>
          <button onClick={copyRecent}><Copy size={16} />复制输出</button>
          <button onClick={downloadRecent}><Download size={16} />下载输出</button>
        </div>
      </div>
      {recent && <pre className="recent">{recent}</pre>}
    </section>
  );
}

function Admin() {
  const [section, setSection] = useState<"projects" | "users" | "grants" | "status">("projects");
  const [context, setContext] = useState<AdminContext | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api.adminContext().then(setContext).catch((err) => setError(err.message));
  }, []);
  const items = [
    { id: "projects", label: "项目", visible: true },
    { id: "users", label: "用户", visible: Boolean(context?.canManageUsers) },
    { id: "grants", label: "授权", visible: true },
    { id: "status", label: "状态", visible: Boolean(context?.isGlobalAdmin) }
  ] as const;
  const visibleItems = items.filter((item) => item.visible);
  useEffect(() => {
    if (context && !items.some((item) => item.visible && item.id === section)) {
      setSection("projects");
    }
  }, [context, section]);
  if (error) return <section className="page"><p className="error">{error}</p></section>;
  if (!context) return <section className="page"><p>加载管理权限...</p></section>;
  return (
    <section className="page">
      <h1>管理</h1>
      <div className="admin-layout">
        <div className="admin-menu" role="tablist" aria-label="管理菜单">
          {visibleItems.map((item) => (
            <button
              key={item.id}
              className={section === item.id ? "active" : "ghost"}
              type="button"
              role="tab"
              aria-selected={section === item.id}
              onClick={() => setSection(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="admin-content">
          {section === "projects" && <ProjectAdmin context={context} />}
          {section === "users" && <UserAdmin />}
          {section === "grants" && <GrantAdmin context={context} />}
          {section === "status" && <AuditPanel context={context} />}
        </div>
      </div>
    </section>
  );
}

function GrantAdmin({ context }: { context: AdminContext }) {
  const [projects, setProjects] = useState<ProjectWithPermission[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [projectId, setProjectId] = useState("");
  const [userId, setUserId] = useState("");
  const [permission, setPermission] = useState("read");
  const [grants, setGrants] = useState<any[]>([]);
  const [error, setError] = useState("");
  const selectedUser = users.find((user) => user.id === userId);
  const selectedUserIsViewer = selectedUser?.role === "viewer";
  const load = async () => {
    const [projectRes, userRes] = await Promise.all([api.projects(), api.users()]);
    const manageable = projectRes.projects.filter((project) => context.managedProjectIds.includes(project.id));
    setProjects(manageable);
    setUsers(userRes.users);
    setProjectId((current) => manageable.some((project) => project.id === current) ? current : manageable[0]?.id || "");
    setUserId((current) => current || userRes.users[0]?.id || "");
  };
  useEffect(() => {
    void load();
  }, []);
  useEffect(() => {
    if (projectId) {
      api.grants(projectId).then((res) => setGrants(res.grants)).catch((err) => setError(err.message));
    } else {
      setGrants([]);
    }
  }, [projectId]);
  useEffect(() => {
    if (selectedUserIsViewer && permission !== "none" && permission !== "read") {
      setPermission("read");
    }
  }, [permission, selectedUserIsViewer]);
  const refreshGrants = async () => {
    if (!projectId) {
      setGrants([]);
      return;
    }
    const res = await api.grants(projectId);
    setGrants(res.grants);
  };
  const saveGrant = async (targetUserId = userId, targetPermission = permission) => {
    if (!projectId || !targetUserId) return;
    setError("");
    try {
      await api.grant(projectId, targetUserId, targetPermission);
      await refreshGrants();
    } catch (err: any) {
      setError(err.message);
    }
  };
  return (
    <section className="panel">
      <h2>项目授权</h2>
      <div className="form-grid">
        <label>项目
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select>
        </label>
        <label>用户
          <select value={userId} onChange={(e) => setUserId(e.target.value)}>
            {users.map((user) => <option key={user.id} value={user.id}>{user.username} · {user.role}</option>)}
          </select>
        </label>
        <label>权限
          <select value={permission} onChange={(e) => setPermission(e.target.value)}>
            <option value="none">无权限</option>
            <option value="read">只读</option>
            <option value="write" disabled={selectedUserIsViewer}>可写</option>
            <option value="admin" disabled={selectedUserIsViewer}>项目管理</option>
          </select>
        </label>
      </div>
      {selectedUserIsViewer && <p className="muted">viewer 只能分配只读权限。</p>}
      {error && <p className="error">{error}</p>}
      <div className="actions">
        <button disabled={!projectId || !userId} onClick={() => saveGrant()}>{permission === "none" ? "移除授权" : "添加/更新授权"}</button>
      </div>
      <div className="admin-list grant-list">
        {grants.length === 0 && <p className="muted">当前项目暂无授权用户。</p>}
        {grants.map((grant) => (
          <div className="admin-row" key={`${grant.project_id}-${grant.user_id}`}>
            <div>
              <strong>{grant.display_name || grant.username}</strong>
              <span>{grant.username} · {grant.permission}</span>
            </div>
            <div className="actions">
              {(() => {
                const grantUser = users.find((user) => user.id === grant.user_id);
                const grantUserIsViewer = grantUser?.role === "viewer";
                return (
                  <>
                    <button className="ghost" onClick={() => saveGrant(grant.user_id, "read")}>只读</button>
                    <button className="ghost" disabled={grantUserIsViewer} onClick={() => saveGrant(grant.user_id, "write")}>可写</button>
                    <button className="ghost" disabled={grantUserIsViewer} onClick={() => saveGrant(grant.user_id, "admin")}>管理</button>
                    <button className="ghost danger" onClick={() => saveGrant(grant.user_id, "none")}>移除</button>
                  </>
                );
              })()}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function projectFormFromProject(project: ProjectWithPermission): ProjectFormState {
  return {
    name: project.name,
    slug: project.slug,
    path: project.path,
    defaultCommand: project.defaultCommand,
    tmuxSession: project.tmuxSession,
    ttydEnabled: project.ttydEnabled
  };
}

function newProjectForm(projects: ProjectWithPermission[], projectPath = "/home/data/connect", command: DefaultCommand = "shell"): ProjectFormState {
  const identity = nextProjectIdentity(projects, projectPath, command);
  return {
    name: identity.slug,
    slug: identity.slug,
    path: projectPath,
    defaultCommand: command,
    tmuxSession: identity.tmuxSession,
    ttydEnabled: true
  };
}

function ProjectFormFields({ form, onChange }: { form: ProjectFormState; onChange: (next: Partial<ProjectFormState>) => void }) {
  return (
    <div className="form-grid">
      <label>项目名称<input value={form.name} onChange={(e) => onChange({ name: e.target.value })} placeholder="名称" /></label>
      <label>访问标识<input value={form.slug} onChange={(e) => onChange({ slug: e.target.value })} placeholder="slug" /></label>
      <label>项目目录<input value={form.path} onChange={(e) => onChange({ path: e.target.value })} placeholder="目录" /></label>
      <label>默认命令
        <select value={form.defaultCommand} onChange={(e) => onChange({ defaultCommand: e.target.value as DefaultCommand })}>
          <option value="shell">shell</option>
          <option value="codex">codex</option>
          <option value="claude">claude</option>
        </select>
      </label>
      <label>tmux 会话<input value={form.tmuxSession} onChange={(e) => onChange({ tmuxSession: e.target.value })} placeholder="tmux session" /></label>
      <label className="inline-check"><input type="checkbox" checked={form.ttydEnabled} onChange={(e) => onChange({ ttydEnabled: e.target.checked })} />启用 ttyd</label>
    </div>
  );
}

function ProjectAdmin({ context }: { context: AdminContext }) {
  const [projects, setProjects] = useState<ProjectWithPermission[]>([]);
  const [createForm, setCreateForm] = useState<ProjectFormState>(() => newProjectForm([]));
  const [createError, setCreateError] = useState("");
  const load = async () => {
    const res = await api.projects();
    const manageable = res.projects.filter((project) => context.managedProjectIds.includes(project.id));
    setProjects(manageable);
    return manageable;
  };
  useEffect(() => {
    void load().then((items) => {
      setCreateForm((current) => {
        if (current.slug && current.tmuxSession && !items.some((project) => project.slug === current.slug || project.tmuxSession === current.tmuxSession)) {
          return current;
        }
        const identity = nextProjectIdentity(items, current.path, current.defaultCommand);
        return { ...current, name: identity.slug, slug: identity.slug, tmuxSession: identity.tmuxSession };
      });
    });
  }, []);
  const updateCreateForm = (next: Partial<ProjectFormState>) => {
    setCreateForm((current) => {
      const merged = { ...current, ...next };
      const shouldRegenerate = "path" in next || "name" in next || "defaultCommand" in next || !merged.slug || !merged.tmuxSession;
      if (!shouldRegenerate) return merged;
      const seed = "name" in next ? merged.name || merged.path : merged.path;
      const identity = nextProjectIdentity(projects, seed, merged.defaultCommand);
      return { ...merged, slug: identity.slug, tmuxSession: identity.tmuxSession };
    });
  };
  const create = async () => {
    setCreateError("");
    try {
      await api.createProject(createForm);
      const items = await load();
      const identity = nextProjectIdentity(items, createForm.path, createForm.defaultCommand);
      setCreateForm({ ...createForm, name: identity.slug, slug: identity.slug, tmuxSession: identity.tmuxSession });
    } catch (err: any) {
      setCreateError(err.message);
    }
  };
  const prepareSiblingSession = (project: ProjectWithPermission, command: DefaultCommand = project.defaultCommand) => {
    const identity = nextProjectIdentity(projects, project.path, command);
    setCreateForm({
      name: `${project.name} ${command === "claude" ? "cc" : command}`,
      slug: identity.slug,
      path: project.path,
      defaultCommand: command,
      tmuxSession: identity.tmuxSession,
      ttydEnabled: project.ttydEnabled
    });
    setCreateError("");
  };
  return (
    <>
      <section className="panel project-create-panel">
        <h2>新增项目</h2>
        {context.canCreateProjects ? (
          <>
            <ProjectFormFields form={createForm} onChange={updateCreateForm} />
            <p className="hint">同一个目录可以创建多个项目入口；每个入口需要不同的访问标识和 tmux 会话。</p>
            {createError && <p className="error">{createError}</p>}
            <div className="actions">
              <button onClick={create}><Plus size={16} />添加项目</button>
            </div>
          </>
        ) : (
          <p className="hint">你可以编辑、授权、停止和删除自己拥有项目管理权限的项目，但不能新增项目。</p>
        )}
      </section>
      <section className="panel project-list-panel">
        <h2>项目列表</h2>
        <div className="admin-list project-admin-list">
          {projects.map((project) => (
            <ProjectAdminRow
              key={project.id}
              project={project}
              canCreateProjects={context.canCreateProjects}
              onChange={load}
              onPrepareSibling={prepareSiblingSession}
            />
          ))}
        </div>
      </section>
    </>
  );
}

function ProjectAdminRow({
  project,
  canCreateProjects,
  onChange,
  onPrepareSibling
}: {
  project: ProjectWithPermission;
  canCreateProjects: boolean;
  onChange: () => Promise<ProjectWithPermission[]>;
  onPrepareSibling: (project: ProjectWithPermission, command: DefaultCommand) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<ProjectFormState>(() => projectFormFromProject(project));
  const [error, setError] = useState("");
  useEffect(() => {
    if (!editing) {
      setForm(projectFormFromProject(project));
    }
  }, [editing, project]);
  const save = async () => {
    setError("");
    try {
      await api.updateProject(project.id, form);
      setEditing(false);
      await onChange();
    } catch (err: any) {
      setError(err.message);
    }
  };
  const stop = async () => {
    setError("");
    try {
      await api.stopSession(project.id);
      await onChange();
    } catch (err: any) {
      setError(err.message);
    }
  };
  const remove = async () => {
    if (!confirm(`删除项目 ${project.name}？磁盘文件不会被删除。`)) return;
    setError("");
    try {
      await api.deleteProject(project.id);
      await onChange();
    } catch (err: any) {
      setError(err.message);
    }
  };
  if (editing) {
    return (
      <div className="admin-row project-edit-row">
        <div>
          <strong>编辑：{project.name}</strong>
          <ProjectFormFields form={form} onChange={(next) => setForm((current) => ({ ...current, ...next }))} />
          <p className="hint">修改目录或 tmux session 只影响后续连接；已有 session 是否复用取决于 tmux session 名称。</p>
          {error && <p className="error">{error}</p>}
        </div>
        <div className="actions">
          <button onClick={save}><Save size={16} />保存项目</button>
          <button className="ghost" onClick={() => { setForm(projectFormFromProject(project)); setEditing(false); setError(""); }}>取消</button>
          <button className="ghost" onClick={stop}>停止</button>
          <button className="ghost danger" onClick={remove}><Trash2 size={16} />删除</button>
        </div>
      </div>
    );
  }
  return (
    <div className="admin-row">
      <div>
        <strong>{project.name}</strong>
        <span>{project.slug} · {project.path}</span>
        <span>{project.defaultCommand} · {project.tmuxSession} · {project.status} · {project.ttydEnabled ? "ttyd 开" : "ttyd 关"}</span>
        {error && <p className="error">{error}</p>}
      </div>
      <div className="actions">
        <button className="ghost" onClick={() => { setEditing(true); setError(""); }}>编辑</button>
        {canCreateProjects && <button className="ghost" onClick={() => onPrepareSibling(project, "codex")}>同目录 Codex</button>}
        {canCreateProjects && <button className="ghost" onClick={() => onPrepareSibling(project, "claude")}>同目录 Claude</button>}
        <button className="ghost" onClick={stop}>停止</button>
        <button className="ghost danger" onClick={remove}><Trash2 size={16} />删除</button>
      </div>
    </div>
  );
}

function UserAdmin() {
  const [users, setUsers] = useState<User[]>([]);
  const [form, setForm] = useState<UserFormState>({ username: "", displayName: "", password: "", role: "member" });
  const [error, setError] = useState("");
  const load = () => api.users().then((res) => setUsers(res.users));
  useEffect(() => {
    void load();
  }, []);
  const create = async () => {
    setError("");
    try {
      await api.createUser(form);
      setForm({ username: "", displayName: "", password: "", role: "member" });
      await load();
    } catch (err: any) {
      setError(err.message);
    }
  };
  return (
    <section className="panel">
      <h2><Users size={18} />用户</h2>
      <div className="form-grid">
        <label>用户名
          <input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} placeholder="username" required />
        </label>
        <label>显示名
          <input value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} placeholder="显示给人的名字" required />
        </label>
        <label>密码
          <input value={form.password} type="password" onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="至少 6 位" minLength={6} required />
        </label>
        <label>角色
          <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
            <option value="admin">admin</option>
            <option value="member">member</option>
            <option value="viewer">viewer</option>
          </select>
        </label>
      </div>
      {error && <p className="error">{error}</p>}
      <button onClick={create}>添加用户</button>
      <div className="admin-list">
        {users.map((user) => <UserRow key={user.id} user={user} onChange={load} />)}
      </div>
    </section>
  );
}

function UserRow({ user, onChange }: { user: User; onChange: () => Promise<void> }) {
  const [displayName, setDisplayName] = useState(user.displayName);
  const [role, setRole] = useState<Role>(user.role);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    setDisplayName(user.displayName);
    setRole(user.role);
  }, [user.displayName, user.role]);
  const save = async (extra: Record<string, unknown> = {}) => {
    setError("");
    try {
      await api.updateUser(user.id, { displayName, role, ...(password ? { password } : {}), ...extra });
      setPassword("");
      await onChange();
    } catch (err: any) {
      setError(err.message);
    }
  };
  const remove = async () => {
    if (!confirm(`确认删除用户 ${user.username}？该用户的登录会话和项目授权会一并删除。`)) return;
    setError("");
    try {
      await api.deleteUser(user.id);
      await onChange();
    } catch (err: any) {
      setError(err.message);
    }
  };
  return (
    <div className="admin-row">
      <div className="form-grid">
        <strong>{user.username} · {user.enabled ? "启用" : "禁用"}</strong>
        <label>显示名
          <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="显示给人的名字" />
        </label>
        <label>角色
          <select value={role} onChange={(event) => setRole(event.target.value as Role)}>
            <option value="admin">admin</option>
            <option value="member">member</option>
            <option value="viewer">viewer</option>
          </select>
        </label>
        <label>新密码
          <input value={password} type="password" onChange={(event) => setPassword(event.target.value)} placeholder="留空不修改" />
        </label>
        {error && <p className="error">{error}</p>}
      </div>
      <div className="actions">
        <button className="ghost" onClick={() => save()}><Save size={16} />保存</button>
        <button className="ghost" onClick={() => save({ enabled: !user.enabled })}>{user.enabled ? "禁用" : "启用"}</button>
        <button className="ghost danger" onClick={remove}><Trash2 size={16} />删除</button>
      </div>
    </div>
  );
}

function AuditPanel({ context }: { context: AdminContext }) {
  const [doctor, setDoctor] = useState<any>(null);
  const [events, setEvents] = useState<any[]>([]);
  useEffect(() => {
    api.doctor().then(setDoctor);
    api.audit().then((res) => setEvents(res.events));
  }, []);
  return (
    <section className="panel">
      <h2>状态</h2>
      <pre>{doctor ? JSON.stringify(doctor, null, 2) : "加载中"}</pre>
      <h2>审计</h2>
      {events.slice(0, 20).map((event) => <p key={event.id}>{formatDateTime(event.createdAt)} · {event.actorUsername ?? "-"} · {event.action}</p>)}
    </section>
  );
}

function App() {
  const auth = useAuth();
  const navigate = useNavigate();
  if (auth.loading || auth.gate.loading) return <div className="loading">加载中</div>;
  if (!auth.user && !auth.gate.verified) {
    return <AccessGate onVerified={(username) => auth.setGate({ verified: true, username, loading: false })} />;
  }
  if (!auth.user) {
    return <Login username={auth.gate.username ?? ""} onLogin={(user) => { auth.setState({ user, loading: false }); auth.setGate({ verified: true, username: user.username, loading: false }); navigate("/projects"); }} />;
  }
  return <Shell user={auth.user} onLogout={async () => {
    try {
      await api.logout();
    } finally {
      auth.setState({ user: null, loading: false });
      auth.setGate({ verified: false, username: null, loading: false });
      navigate("/projects");
    }
  }} />;
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Router>
      <App />
    </Router>
  </React.StrictMode>
);
