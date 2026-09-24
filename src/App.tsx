import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { confirm, open } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import {
  ArrowClockwise,
  ArrowSquareOut,
  FileText,
  Folder,
  LinkSimple,
  MagnifyingGlass,
  Moon,
  Plus,
  Sun,
  Trash,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { basename, dirname, statusText, type LinkView, type Snapshot, type SourceView } from "./types";

const ICON_WEIGHT = "regular" as const;
const subtleButton = "rounded-md px-2.5 py-1.5 text-[11px] text-[var(--muted)] transition-colors hover:bg-[var(--hover)] hover:text-[var(--text)] disabled:opacity-40";
const outlineButton = "rounded-md border border-[var(--line)] bg-[var(--panel)] px-3 py-1.5 text-[11px] font-medium text-[var(--text)] transition-colors hover:bg-[var(--hover)] disabled:opacity-40";
const primaryButton = "rounded-md border border-[var(--button)] bg-[var(--button)] px-3 py-1.5 text-[11px] font-semibold text-[var(--button-text)] transition-opacity hover:opacity-90 disabled:opacity-40";

function errorText(error: unknown): string {
  return typeof error === "string" ? error : error instanceof Error ? error.message : String(error);
}

function pickPath(directory: boolean): Promise<string | null> {
  return open({ directory, multiple: false }).then((result) =>
    typeof result === "string" ? result : null,
  );
}

function FileIcon({ kind, size = 16 }: { kind: SourceView["kind"]; size?: number }) {
  return kind === "directory" ? (
    <Folder size={size} weight={ICON_WEIGHT} aria-hidden="true" />
  ) : (
    <FileText size={size} weight={ICON_WEIGHT} aria-hidden="true" />
  );
}

function Status({ status }: { status: LinkView["status"] }) {
  const bad = status !== "healthy";
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap text-[10px] ${bad ? "text-[var(--warn)]" : "text-[var(--muted)]"}`}>
      <span className={`status-dot ${bad ? "warn" : ""}`} />
      {statusText[status]}
    </span>
  );
}

function LoadingView() {
  return (
    <div className="mx-auto max-w-[1050px] animate-pulse px-10 py-10" aria-label="正在读取链接">
      <div className="mb-3 h-5 w-52 rounded bg-[var(--hover)]" />
      <div className="h-3 w-96 max-w-full rounded bg-[var(--hover)]" />
      <div className="mt-12 h-44 rounded-lg border border-[var(--line)] bg-[var(--panel)]" />
      <div className="mt-12 space-y-3">
        <div className="h-10 rounded bg-[var(--hover)]" />
        <div className="h-10 rounded bg-[var(--hover)]" />
        <div className="h-10 rounded bg-[var(--hover)]" />
      </div>
    </div>
  );
}

interface CreateLinkDialogProps {
  source: SourceView;
  busy: boolean;
  onClose: () => void;
  onCreate: (folder: string, name: string) => Promise<void>;
}

function CreateLinkDialog({ source, busy, onClose, onCreate }: CreateLinkDialogProps) {
  const [folder, setFolder] = useState("");
  const [name, setName] = useState(basename(source.path));
  const [error, setError] = useState("");

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  async function chooseFolder() {
    try {
      const result = await pickPath(true);
      if (result) setFolder(result);
    } catch (cause) {
      setError(errorText(cause));
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!folder) {
      setError("请选择放置软链接的项目文件夹");
      return;
    }
    if (!name.trim()) {
      setError("请输入链接名称");
      return;
    }
    setError("");
    try {
      await onCreate(folder, name.trim());
    } catch (cause) {
      setError(errorText(cause));
    }
  }

  return (
    <div className="fixed inset-0 z-20 grid place-items-center bg-[#050607a8] px-4" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="create-heading" className="w-full max-w-[430px] rounded-[10px] border border-[var(--line)] bg-[var(--panel)] p-6 shadow-[0_24px_70px_#0006]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="create-heading" className="text-base font-semibold">新增链接</h2>
            <p className="mt-1 text-[11px] leading-relaxed text-[var(--muted)]">事实源保持在原位置，只在项目中创建入口。</p>
          </div>
          <button className={subtleButton} onClick={onClose} disabled={busy} aria-label="关闭"><X size={15} /></button>
        </div>
        <form onSubmit={submit} className="mt-5 space-y-4">
          <div>
            <label className="mb-1.5 block text-[11px] font-medium text-[var(--muted)]" htmlFor="source-path">事实源</label>
            <input id="source-path" value={source.path} readOnly className="w-full rounded-md border border-[var(--line)] bg-[var(--base)] px-3 py-2 text-[11px] text-[var(--faint)]" />
          </div>
          <div>
            <label className="mb-1.5 block text-[11px] font-medium text-[var(--muted)]" htmlFor="target-folder">目标文件夹</label>
            <div className="flex gap-2">
              <input id="target-folder" value={folder} readOnly placeholder="选择项目文件夹" className="min-w-0 flex-1 rounded-md border border-[var(--line)] bg-[var(--base)] px-3 py-2 text-[11px] text-[var(--text)] placeholder:text-[var(--faint)]" />
              <button type="button" className={outlineButton} onClick={chooseFolder} disabled={busy}>浏览</button>
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-[11px] font-medium text-[var(--muted)]" htmlFor="link-name">链接名称</label>
            <input id="link-name" value={name} onChange={(event) => setName(event.target.value)} className="w-full rounded-md border border-[var(--line)] bg-[var(--base)] px-3 py-2 text-[11px] text-[var(--text)]" />
            <p className="mt-1.5 text-[10px] text-[var(--faint)]">目标位置若已有同名文件或链接，应用会拒绝覆盖。</p>
          </div>
          {error && <p role="alert" className="text-[11px] text-[var(--warn)]">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" className={outlineButton} onClick={onClose} disabled={busy}>取消</button>
            <button type="submit" className={primaryButton} disabled={busy}>{busy ? "正在创建…" : "创建链接"}</button>
          </div>
        </form>
      </section>
    </div>
  );
}

function App() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selectedSourcePath, setSelectedSourcePath] = useState<string | null>(null);
  const [selectedLinkPath, setSelectedLinkPath] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "healthy" | "issues">("all");
  const [sourceMenuOpen, setSourceMenuOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [theme, setTheme] = useState<"dark" | "light">(() => localStorage.getItem("softconnet-theme") === "light" ? "light" : "dark");
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("softconnet-theme", theme);
  }, [theme]);

  useEffect(() => {
    let live = true;
    invoke<Snapshot>("get_snapshot")
      .then((result) => { if (live) setSnapshot(result); })
      .catch((cause) => { if (live) setError(errorText(cause)); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 3200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const source = snapshot?.sources.find((item) => item.path === selectedSourcePath) ?? snapshot?.sources[0] ?? null;
  const link = source?.links.find((item) => item.path === selectedLinkPath) ?? source?.links[0] ?? null;
  const shownSources = useMemo(() => snapshot?.sources.filter((item) => basename(item.path).toLocaleLowerCase().includes(query.toLocaleLowerCase())) ?? [], [snapshot, query]);
  const shownLinks = source?.links.filter((item) => filter === "all" || (filter === "healthy" ? item.status === "healthy" : item.status !== "healthy")) ?? [];

  async function run(command: string, args?: Record<string, unknown>, success?: string): Promise<Snapshot> {
    setBusy(true);
    setError("");
    try {
      const result = await invoke<Snapshot>(command, args);
      setSnapshot(result);
      if (success) setNotice(success);
      return result;
    } catch (cause) {
      const message = errorText(cause);
      setError(message);
      throw cause;
    } finally {
      setBusy(false);
    }
  }

  async function addSource(directory: boolean) {
    setSourceMenuOpen(false);
    try {
      const path = await pickPath(directory);
      if (!path) return;
      const result = await run("add_source", { path }, "已添加事实源");
      setSelectedSourcePath(result.sources.find((item) => item.path === path)?.path ?? path);
      setSelectedLinkPath(null);
    } catch (cause) {
      setError(errorText(cause));
    }
  }

  async function addRoot() {
    try {
      const path = await pickPath(true);
      if (path) await run("add_root", { path }, "扫描完成，已有链接已纳入管理");
    } catch (cause) {
      setError(errorText(cause));
    }
  }

  async function removeRoot(path: string) {
    try {
      await run("remove_root", { path }, "扫描目录已移除，磁盘内容未改变");
    } catch (cause) {
      setError(errorText(cause));
    }
  }

  async function refresh() {
    try {
      await run("get_snapshot", undefined, "链接状态已刷新");
    } catch (cause) {
      setError(errorText(cause));
    }
  }

  async function createLink(folder: string, name: string) {
    if (!source) return;
    const existingPaths = new Set(snapshot?.sources.flatMap((item) => item.links.map((entry) => entry.path)) ?? []);
    const result = await run("create_link", { source: source.path, folder, name }, "链接已创建");
    const created = result.sources.flatMap((item) => item.links).find((item) => !existingPaths.has(item.path));
    if (created) setSelectedLinkPath(created.path);
    setCreateOpen(false);
  }

  async function deleteLink() {
    if (!link) return;
    const approved = await confirm(`只删除这条软链接？\n\n${link.path}\n\n事实源 ${link.target} 会保留。`, { title: "删除链接", kind: "warning" });
    if (!approved) return;
    try {
      await run("delete_link", { path: link.path }, "链接已删除，事实源保持不变");
      setSelectedLinkPath(null);
    } catch (cause) {
      setError(errorText(cause));
    }
  }

  async function forgetSource() {
    if (!source) return;
    try {
      await run("forget_source", { path: source.path }, "事实源已从列表移除，磁盘内容未改变");
      setSelectedSourcePath(null);
    } catch (cause) {
      setError(errorText(cause));
    }
  }

  async function reveal(path: string) {
    try {
      await revealItemInDir(path);
    } catch (cause) {
      setError(`无法在文件管理器中显示：${errorText(cause)}`);
    }
  }

  return (
    <div className="grid min-h-[100dvh] grid-cols-[228px_minmax(0,1fr)] bg-[var(--base)] text-[var(--text)] max-[700px]:block">
      <aside className="flex min-w-0 flex-col border-r border-[var(--line)] bg-[var(--side)] px-2 pb-4 pt-3 max-[700px]:border-b max-[700px]:border-r-0 max-[700px]:pb-2">
        <div className="flex h-9 items-center gap-2.5 px-2 text-[13px] font-semibold tracking-tight"><span className="brand-mark" aria-hidden="true" />SoftConnet</div>
        <div className="mx-1 mb-6 mt-2 flex h-8 items-center gap-2 rounded-md border border-[var(--line)] px-2 text-[var(--faint)] max-[700px]:hidden">
          <MagnifyingGlass size={14} weight={ICON_WEIGHT} aria-hidden="true" />
          <input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索事实源" aria-label="搜索事实源" className="min-w-0 flex-1 bg-transparent text-[11px] text-[var(--text)] outline-none placeholder:text-[var(--faint)]" />
          <span className="whitespace-nowrap text-[10px]">⌘ K</span>
        </div>
        <div className="relative mx-2 mb-1 flex h-7 items-center justify-between text-[10px] font-semibold text-[var(--faint)]">
          <span>事实源</span>
          <button onClick={() => setSourceMenuOpen(!sourceMenuOpen)} className={subtleButton} aria-label="添加事实源" aria-expanded={sourceMenuOpen}><Plus size={13} weight={ICON_WEIGHT} /></button>
          {sourceMenuOpen && <div className="absolute right-0 top-7 z-10 w-36 rounded-md border border-[var(--line)] bg-[var(--panel)] p-1 shadow-[0_12px_36px_#0004]"><button onClick={() => addSource(false)} className="w-full rounded px-2 py-2 text-left text-[11px] hover:bg-[var(--hover)]">添加文件</button><button onClick={() => addSource(true)} className="w-full rounded px-2 py-2 text-left text-[11px] hover:bg-[var(--hover)]">添加文件夹</button></div>}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto max-[700px]:flex max-[700px]:overflow-x-auto">
          {shownSources.map((item) => (
            <button key={item.path} onClick={() => { setSelectedSourcePath(item.path); setSelectedLinkPath(null); setFilter("all"); }} title={item.path} className={`flex h-[34px] w-full items-center gap-2.5 rounded-md px-2.5 text-left text-[11px] max-[700px]:w-auto max-[700px]:min-w-36 max-[700px]:shrink-0 ${item.path === source?.path ? "bg-[var(--selected)] text-[var(--text)]" : "text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]"}`}>
              <span className={item.path === source?.path ? "text-[var(--accent)]" : "text-[var(--faint)]"}><FileIcon kind={item.kind} size={15} /></span>
              <span className="min-w-0 flex-1 truncate">{basename(item.path)}</span>
              <span className="text-[10px] text-[var(--faint)]">{item.links.length}</span>
            </button>
          ))}
          {!loading && query && shownSources.length === 0 && <p className="px-3 py-4 text-[11px] text-[var(--faint)]">没有匹配的事实源</p>}
        </div>
        <div className="mt-auto max-[700px]:hidden">
          <div className="mx-2 mb-1 flex h-7 items-center justify-between text-[10px] font-semibold text-[var(--faint)]"><span>扫描目录</span><button onClick={addRoot} disabled={busy} className={subtleButton} aria-label="添加扫描目录"><Plus size={13} /></button></div>
          {snapshot?.roots.map((root) => <div key={root} className="group flex h-8 items-center gap-2 rounded-md px-2.5 text-[11px] text-[var(--muted)] hover:bg-[var(--hover)]" title={root}><Folder size={14} className="shrink-0" /><span className="min-w-0 flex-1 truncate">{root}</span><button onClick={() => removeRoot(root)} disabled={busy} title="移除扫描目录" aria-label={`移除扫描目录 ${root}`} className="invisible rounded p-0.5 text-[var(--faint)] hover:text-[var(--text)] group-hover:visible"><X size={12} /></button></div>)}
          {!snapshot?.roots.length && <button onClick={addRoot} className="px-2.5 py-2 text-left text-[11px] text-[var(--faint)] hover:text-[var(--text)]">选择项目目录以发现已有链接</button>}
        </div>
      </aside>

      <div className="grid min-w-0 grid-rows-[46px_minmax(0,1fr)] max-[700px]:grid-rows-[40px_minmax(0,1fr)]">
        <header className="flex min-w-0 items-center gap-2 border-b border-[var(--line)] px-7 text-[11px] text-[var(--muted)] max-[700px]:px-4"><span>事实源</span><span className="text-[var(--faint)]">/</span><strong className="min-w-0 truncate font-medium text-[var(--text)]">{source ? basename(source.path) : "概览"}</strong><div className="ml-auto flex shrink-0 items-center gap-1"><button onClick={refresh} disabled={busy || loading} className={subtleButton} title="刷新链接状态" aria-label="刷新链接状态"><ArrowClockwise size={14} className={busy ? "animate-spin" : ""} /></button><button onClick={() => setTheme(theme === "dark" ? "light" : "dark")} className={subtleButton} title="切换外观" aria-label="切换外观">{theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}</button></div></header>
        {error && <div role="alert" className="flex items-start gap-2 border-b border-[var(--line)] bg-[var(--panel)] px-7 py-2.5 text-[11px] text-[var(--warn)]"><WarningCircle size={15} className="mt-px shrink-0" /><span className="flex-1">{error}</span><button onClick={() => setError("")} aria-label="关闭错误提示"><X size={13} /></button></div>}
        {snapshot?.scanWarnings.map((warning) => <div key={warning} role="status" className="border-b border-[var(--line)] px-7 py-2 text-[11px] text-[var(--warn)]">{warning}</div>)}
        <div className="grid min-h-0 min-w-0 grid-cols-[minmax(0,1fr)_268px] max-[1050px]:grid-cols-1">
          <main className="min-w-0 overflow-y-auto">
            {loading ? <LoadingView /> : source ? (
              <div className="mx-auto max-w-[1050px] px-10 py-9 max-[700px]:px-4 max-[700px]:py-7">
                <div className="flex flex-wrap items-start gap-3">
                  <div className="mt-0.5 flex h-9 w-8 shrink-0 items-center justify-center rounded-[5px] border border-[var(--faint)] text-[var(--muted)]"><FileIcon kind={source.kind} size={19} /></div>
                  <div className="min-w-0 flex-1"><h1 className="break-all text-[19px] leading-snug font-semibold tracking-tight">{basename(source.path)}</h1><p className="mt-1 break-all font-mono text-[10px] leading-relaxed text-[var(--faint)]">{source.path}</p></div>
                  <div className="flex gap-2 max-[700px]:ml-11 max-[700px]:w-full"><button onClick={() => setCreateOpen(true)} disabled={busy || source.kind === "missing"} className={`${primaryButton} inline-flex items-center gap-1.5`}><Plus size={13} />新增链接</button>{source.manual && source.links.length === 0 && <button onClick={forgetSource} disabled={busy} className={outlineButton}>从列表移除</button>}</div>
                </div>

                <section className="mt-10"><div className="mb-4 flex items-center gap-3"><h2 className="text-xs font-semibold">引用关系</h2><span className="text-[10px] text-[var(--faint)]">源文件连接到 {source.links.length} 个位置</span></div><div className="grid min-h-42 grid-cols-[minmax(160px,.7fr)_64px_minmax(240px,1.3fr)] items-center rounded-lg border border-[var(--line)] bg-[var(--panel)] px-5 py-4 max-[700px]:grid-cols-1"><div className="min-w-0"><div className="mb-2 text-[9px] font-semibold tracking-wide text-[var(--faint)]">事实源 · {source.kind === "directory" ? "文件夹" : source.kind === "missing" ? "已缺失" : "文件"}</div><p className="truncate text-xs font-semibold">{basename(source.path)}</p><p className="mt-1 truncate font-mono text-[10px] text-[var(--faint)]">{dirname(source.path)}</p></div><div className="map-connector max-[700px]:hidden" /><div className="map-targets min-w-0 max-[700px]:mt-3">{source.links.length ? source.links.map((item) => <button key={item.path} onClick={() => setSelectedLinkPath(item.path)} className={`map-target flex h-[42px] w-full items-center gap-2.5 py-1 pr-1 pl-3 text-left max-[700px]:pl-0 ${item.path === link?.path ? "text-[var(--accent)]" : "text-[var(--text)]"}`}><div className="min-w-0 flex-1"><span className="block truncate text-[11px] font-medium">{item.project}</span><span className="mt-0.5 block truncate font-mono text-[9px] text-[var(--faint)]">{dirname(item.path)}</span></div><span className={`status-dot ${item.status === "healthy" ? "" : "warn"}`} /></button>) : <div className="py-7 text-center text-[11px] text-[var(--faint)]">还没有项目链接</div>}</div></div></section>

                <section className="mt-9"><div className="mb-3 flex items-center gap-3"><h2 className="text-xs font-semibold">链接</h2><span className="text-[10px] text-[var(--faint)]">{source.links.length}</span><div className="ml-auto flex items-center gap-0.5">{(["all", "healthy", "issues"] as const).map((item) => <button key={item} onClick={() => setFilter(item)} className={`rounded-md px-2 py-1.5 text-[10px] ${filter === item ? "bg-[var(--selected)] text-[var(--text)]" : "text-[var(--faint)] hover:bg-[var(--hover)] hover:text-[var(--text)]"}`}>{item === "all" ? "全部" : item === "healthy" ? "正常" : "需处理"}</button>)}</div></div><div className="border-t border-[var(--line)]"><div className="grid min-h-8 grid-cols-[minmax(105px,.8fr)_minmax(180px,2fr)_90px] items-center gap-3 border-b border-[var(--line)] px-3 text-[10px] text-[var(--faint)] max-[700px]:grid-cols-[minmax(85px,.8fr)_minmax(105px,1.2fr)_65px] max-[700px]:gap-1"><span>项目</span><span>链接路径</span><span>状态</span></div>{shownLinks.length ? shownLinks.map((item) => <button key={item.path} onClick={() => setSelectedLinkPath(item.path)} className={`grid min-h-11 w-full grid-cols-[minmax(105px,.8fr)_minmax(180px,2fr)_90px] items-center gap-3 border-b border-[var(--line)] px-3 text-left max-[700px]:grid-cols-[minmax(85px,.8fr)_minmax(105px,1.2fr)_65px] max-[700px]:gap-1 ${item.path === link?.path ? "bg-[var(--selected)]" : "hover:bg-[var(--hover)]"}`}><span className="truncate text-[11px] font-medium">{item.project}</span><span className="truncate font-mono text-[10px] text-[var(--muted)]" title={item.path}>{item.path}</span><Status status={item.status} /></button>) : <p className="py-8 text-center text-[11px] text-[var(--faint)]">此筛选条件下没有链接</p>}</div></section>
              </div>
            ) : <div className="mx-auto max-w-xl px-6 py-24 text-center"><LinkSimple size={26} weight="light" className="mx-auto text-[var(--faint)]" /><h1 className="mt-4 text-base font-semibold">还没有事实源</h1><p className="mt-2 text-xs leading-relaxed text-[var(--muted)]">添加已有文件或文件夹，再为项目创建链接；也可以扫描项目目录，纳入已有软链接。</p><div className="mt-6 flex justify-center gap-2"><button onClick={() => addSource(false)} className={primaryButton}>添加文件</button><button onClick={() => addSource(true)} className={outlineButton}>添加文件夹</button><button onClick={addRoot} className={outlineButton}>扫描目录</button></div></div>}
          </main>
          <aside className="min-w-0 border-l border-[var(--line)] px-5 py-6 max-[1050px]:hidden"><p className="mb-5 text-[10px] text-[var(--faint)]">链接详情</p>{link ? <><h2 className="mb-6 break-all text-[13px] font-semibold">{link.project}</h2><dl className="space-y-0"><div className="border-t border-[var(--line)] py-3.5"><dt className="mb-2 text-[10px] text-[var(--faint)]">状态</dt><dd><Status status={link.status} /></dd></div><div className="border-t border-[var(--line)] py-3.5"><dt className="mb-2 text-[10px] text-[var(--faint)]">链接位置</dt><dd className="break-all font-mono text-[10px] leading-relaxed text-[var(--muted)]">{link.path}</dd></div><div className="border-t border-[var(--line)] py-3.5"><dt className="mb-2 text-[10px] text-[var(--faint)]">指向</dt><dd className="break-all font-mono text-[10px] leading-relaxed text-[var(--muted)]">{link.target}</dd></div></dl><div className="mt-4 flex flex-wrap gap-2"><button onClick={() => reveal(link.path)} className={`${outlineButton} inline-flex items-center gap-1.5`}><ArrowSquareOut size={13} />显示位置</button><button onClick={deleteLink} disabled={busy || ["replaced", "link_missing", "retargeted"].includes(link.status)} className={`${outlineButton} inline-flex items-center gap-1.5`} title={["replaced", "link_missing", "retargeted"].includes(link.status) ? "此位置已改变，请先人工检查" : "只删除软链接"}><Trash size={13} />删除链接</button></div><p className="mt-6 text-[10px] leading-relaxed text-[var(--faint)]">删除只作用于软链接，事实源保持不变。</p></> : <p className="py-9 text-center text-[11px] text-[var(--faint)]">选择一条链接查看详情</p>}</aside>
        </div>
      </div>
      {notice && <div role="status" className="fixed bottom-5 left-1/2 z-30 max-w-[calc(100vw-30px)] -translate-x-1/2 rounded-md bg-[var(--button)] px-3 py-2 text-[11px] text-[var(--button-text)] shadow-lg">{notice}</div>}
      {createOpen && source && <CreateLinkDialog source={source} busy={busy} onClose={() => setCreateOpen(false)} onCreate={createLink} />}
    </div>
  );
}

export default App;
