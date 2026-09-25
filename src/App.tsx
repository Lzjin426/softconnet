import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
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
  Tag,
  Trash,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import {
  basename,
  dirname,
  statusText,
  type BatchOperationResult,
  type BatchPreview,
  type LinkView,
  type Snapshot,
  type SourceView,
} from "./types";

const ICON_WEIGHT = "regular" as const;
const subtleButton = "rounded-md px-2.5 py-1.5 text-[11px] text-[var(--muted)] transition-colors hover:bg-[var(--hover)] hover:text-[var(--text)] disabled:opacity-40";
const outlineButton = "rounded-md border border-[var(--line)] bg-[var(--panel)] px-3 py-1.5 text-[11px] font-medium text-[var(--text)] transition-colors hover:bg-[var(--hover)] disabled:opacity-40";
const primaryButton = "rounded-md border border-[var(--button)] bg-[var(--button)] px-3 py-1.5 text-[11px] font-semibold text-[var(--button-text)] transition-opacity hover:opacity-90 disabled:opacity-40";
const fieldClass = "w-full rounded-md border border-[var(--line)] bg-[var(--base)] px-3 py-2 text-[11px] text-[var(--text)] outline-none placeholder:text-[var(--faint)]";

function errorText(error: unknown): string {
  return typeof error === "string" ? error : error instanceof Error ? error.message : String(error);
}

function isAbsolutePath(path: string): boolean {
  return path.startsWith("/") || path.startsWith("\\\\") || /^[A-Za-z]:[\\/]/.test(path);
}

function parseTags(value: string): string[] {
  return Array.from(new Set(value.split(/[\n,，]/).map((tag) => tag.trim()).filter(Boolean)));
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

interface ModalFrameProps {
  heading: string;
  description?: string;
  busy: boolean;
  onClose: () => void;
  children: ReactNode;
}

function ModalFrame({ heading, description, busy, onClose, children }: ModalFrameProps) {
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    if (dialog && !dialog.contains(document.activeElement)) {
      (dialog.querySelector<HTMLElement>("input:not(:disabled), button:not(:disabled), select:not(:disabled)") ?? dialog).focus();
    }
    return () => previousFocus?.focus();
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) {
        event.preventDefault();
        onClose();
      }
      if (event.key !== "Tab") return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const controls = Array.from(dialog.querySelectorAll<HTMLElement>("input:not(:disabled), button:not(:disabled), select:not(:disabled)"));
      if (!controls.length) {
        event.preventDefault();
        dialog.focus();
      } else if (!dialog.contains(document.activeElement)) {
        event.preventDefault();
        controls[0].focus();
      } else if (event.shiftKey && document.activeElement === controls[0]) {
        event.preventDefault();
        controls.at(-1)?.focus();
      } else if (!event.shiftKey && document.activeElement === controls.at(-1)) {
        event.preventDefault();
        controls[0].focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);
  return (
    <div className="fixed inset-0 z-20 grid place-items-center bg-[#050607a8] px-4" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={`${heading}-heading`} tabIndex={-1} className="max-h-[calc(100dvh-32px)] w-full max-w-[500px] overflow-y-auto rounded-[10px] border border-[var(--line)] bg-[var(--panel)] p-6 shadow-[0_24px_70px_#0006]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id={`${heading}-heading`} className="text-base font-semibold">{heading}</h2>
            {description && <p className="mt-1 text-[11px] leading-relaxed text-[var(--muted)]">{description}</p>}
          </div>
          <button type="button" className={subtleButton} onClick={onClose} disabled={busy} aria-label="关闭"><X size={15} /></button>
        </div>
        {children}
      </section>
    </div>
  );
}

interface AddSourceDialogProps {
  kind: "file" | "directory";
  busy: boolean;
  onClose: () => void;
  onAdd: (path: string) => Promise<void>;
}

function AddSourceDialog({ kind, busy, onClose, onAdd }: AddSourceDialogProps) {
  const [path, setPath] = useState("");
  const [error, setError] = useState("");

  async function choosePath() {
    try {
      const result = await pickPath(kind === "directory");
      if (result) {
        setPath(result);
        setError("");
      }
    } catch (cause) {
      setError(errorText(cause));
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const value = path.trim();
    if (!value) {
      setError("请输入事实源的绝对路径");
      return;
    }
    if (!isAbsolutePath(value)) {
      setError("请输入绝对路径，例如 C:\\workspace\\notes 或 /workspace/notes");
      return;
    }
    setError("");
    try {
      await onAdd(value);
      onClose();
    } catch (cause) {
      setError(errorText(cause));
    }
  }

  return (
    <ModalFrame heading={kind === "directory" ? "添加文件夹事实源" : "添加文件事实源"} description="事实源保留在原位置，路径可以直接手输，也可以从文件管理器选择。" busy={busy} onClose={onClose}>
      <form onSubmit={submit} className="mt-5 space-y-4">
        <div>
          <label className="mb-1.5 block text-[11px] font-medium text-[var(--muted)]" htmlFor="source-path-input">事实源绝对路径</label>
          <div className="flex gap-2">
            <input id="source-path-input" value={path} onChange={(event) => { setPath(event.target.value); setError(""); }} placeholder={kind === "directory" ? "例如 C:\\workspace\\notes" : "例如 C:\\workspace\\shared.md"} className={`${fieldClass} min-w-0 flex-1`} autoFocus />
            <button type="button" className={outlineButton} onClick={choosePath} disabled={busy}>浏览</button>
          </div>
        </div>
        {error && <p role="alert" className="text-[11px] text-[var(--warn)]">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className={outlineButton} onClick={onClose} disabled={busy}>取消</button>
          <button type="submit" className={primaryButton} disabled={busy}>{busy ? "正在添加…" : "添加事实源"}</button>
        </div>
      </form>
    </ModalFrame>
  );
}

interface ScanRootDialogProps {
  busy: boolean;
  onClose: () => void;
  onAdd: (path: string) => Promise<void>;
}

function ScanRootDialog({ busy, onClose, onAdd }: ScanRootDialogProps) {
  const [path, setPath] = useState("");
  const [error, setError] = useState("");

  async function choosePath() {
    try {
      const result = await pickPath(true);
      if (result) {
        setPath(result);
        setError("");
      }
    } catch (cause) {
      setError(errorText(cause));
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const value = path.trim();
    if (!value) {
      setError("请输入扫描目录的绝对路径");
      return;
    }
    if (!isAbsolutePath(value)) {
      setError("请输入扫描目录的绝对路径，例如 C:\\workspace\\projects");
      return;
    }
    setError("");
    try {
      await onAdd(value);
      onClose();
    } catch (cause) {
      setError(errorText(cause));
    }
  }

  return (
    <ModalFrame heading="添加扫描目录" description="扫描目录用于发现已有软链接，不会移动或修改目录中的内容。" busy={busy} onClose={onClose}>
      <form onSubmit={submit} className="mt-5 space-y-4">
        <div>
          <label className="mb-1.5 block text-[11px] font-medium text-[var(--muted)]" htmlFor="scan-path-input">扫描目录绝对路径</label>
          <div className="flex gap-2">
            <input id="scan-path-input" value={path} onChange={(event) => { setPath(event.target.value); setError(""); }} placeholder="例如 C:\\workspace\\projects" className={`${fieldClass} min-w-0 flex-1`} autoFocus />
            <button type="button" className={outlineButton} onClick={choosePath} disabled={busy}>浏览</button>
          </div>
        </div>
        {error && <p role="alert" className="text-[11px] text-[var(--warn)]">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className={outlineButton} onClick={onClose} disabled={busy}>取消</button>
          <button type="submit" className={primaryButton} disabled={busy}>{busy ? "正在扫描…" : "开始扫描"}</button>
        </div>
      </form>
    </ModalFrame>
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

  async function chooseFolder() {
    try {
      const result = await pickPath(true);
      if (result) {
        setFolder(result);
        setError("");
      }
    } catch (cause) {
      setError(errorText(cause));
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const targetFolder = folder.trim();
    if (!targetFolder) {
      setError("请输入目标文件夹的绝对路径");
      return;
    }
    if (!isAbsolutePath(targetFolder)) {
      setError("请输入目标文件夹的绝对路径，例如 C:\\workspace\\project");
      return;
    }
    if (!name.trim()) {
      setError("请输入链接名称");
      return;
    }
    setError("");
    try {
      await onCreate(targetFolder, name.trim());
    } catch (cause) {
      setError(errorText(cause));
    }
  }

  return (
    <ModalFrame heading="新增链接" description="事实源保持在原位置，只在项目中创建入口。" busy={busy} onClose={onClose}>
      <form onSubmit={submit} className="mt-5 space-y-4">
        <div>
          <label className="mb-1.5 block text-[11px] font-medium text-[var(--muted)]" htmlFor="source-path">事实源</label>
          <input id="source-path" value={source.path} readOnly className={`${fieldClass} text-[var(--faint)]`} />
        </div>
        <div>
          <label className="mb-1.5 block text-[11px] font-medium text-[var(--muted)]" htmlFor="target-folder">目标文件夹绝对路径</label>
          <div className="flex gap-2">
            <input id="target-folder" value={folder} onChange={(event) => { setFolder(event.target.value); setError(""); }} placeholder="例如 C:\\workspace\\project" className="min-w-0 flex-1 rounded-md border border-[var(--line)] bg-[var(--base)] px-3 py-2 text-[11px] text-[var(--text)] placeholder:text-[var(--faint)]" autoFocus />
            <button type="button" className={outlineButton} onClick={chooseFolder} disabled={busy}>浏览</button>
          </div>
        </div>
        <div>
          <label className="mb-1.5 block text-[11px] font-medium text-[var(--muted)]" htmlFor="link-name">链接名称</label>
          <input id="link-name" value={name} onChange={(event) => setName(event.target.value)} className={fieldClass} />
          <p className="mt-1.5 text-[10px] text-[var(--faint)]">目标位置若已有同名文件或链接，应用会拒绝覆盖。</p>
        </div>
        {error && <p role="alert" className="text-[11px] text-[var(--warn)]">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className={outlineButton} onClick={onClose} disabled={busy}>取消</button>
          <button type="submit" className={primaryButton} disabled={busy}>{busy ? "正在创建…" : "创建链接"}</button>
        </div>
      </form>
    </ModalFrame>
  );
}

function PreviewStatus({ status }: { status: "ready" | "blocked" }) {
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap text-[10px] ${status === "ready" ? "text-[var(--muted)]" : "text-[var(--warn)]"}`}>
      <span className={`status-dot ${status === "blocked" ? "warn" : ""}`} />
      {status === "ready" ? "可执行" : "会被阻止"}
    </span>
  );
}

interface BatchCreateDialogProps {
  sources: SourceView[];
  busy: boolean;
  onClose: () => void;
  onPreview: (folder: string) => Promise<BatchPreview>;
  onExecute: (folder: string, sources: string[], total: number) => Promise<BatchOperationResult>;
}

function BatchCreateDialog({ sources, busy, onClose, onPreview, onExecute }: BatchCreateDialogProps) {
  const [folder, setFolder] = useState("");
  const [preview, setPreview] = useState<BatchPreview | null>(null);
  const [previewFolder, setPreviewFolder] = useState<string | null>(null);
  const [operation, setOperation] = useState<BatchOperationResult | null>(null);
  const [error, setError] = useState("");
  const previewRequest = useRef(0);

  function invalidatePreview() {
    previewRequest.current += 1;
    setPreview(null);
    setPreviewFolder(null);
    setOperation(null);
  }

  async function chooseFolder() {
    try {
      const result = await pickPath(true);
      if (result) {
        setFolder(result);
        invalidatePreview();
        setError("");
      }
    } catch (cause) {
      setError(errorText(cause));
    }
  }

  async function submitPreview(event: FormEvent) {
    event.preventDefault();
    const targetFolder = folder.trim();
    if (!targetFolder) {
      setError("请输入批量创建的目标文件夹绝对路径");
      return;
    }
    if (!isAbsolutePath(targetFolder)) {
      setError("请输入目标文件夹的绝对路径，例如 C:\\workspace\\project");
      return;
    }
    setError("");
    invalidatePreview();
    const request = previewRequest.current;
    try {
      const result = await onPreview(targetFolder);
      if (request === previewRequest.current) {
        setPreview(result);
        setPreviewFolder(targetFolder);
      }
    } catch (cause) {
      if (request === previewRequest.current) setError(errorText(cause));
    }
  }

  async function execute() {
    if (!preview || !previewFolder || !preview.items.some((item) => item.status === "ready")) return;
    setError("");
    try {
      const approved = preview.items.filter((item) => item.status === "ready");
      const result = await onExecute(previewFolder, approved.map((item) => item.source), preview.items.length);
      setOperation({
        ...result,
        items: [
          ...preview.items.filter((item) => item.status === "blocked").map((item) => ({ source: item.source, path: item.path, success: false, message: `预览已阻止：${item.message}` })),
          ...result.items,
        ],
      });
    } catch (cause) {
      setError(errorText(cause));
    }
  }

  const readyCount = preview?.items.filter((item) => item.status === "ready").length ?? 0;

  return (
    <ModalFrame heading="批量创建链接" description={`将为 ${sources.length} 个选中的事实源，在同一目标文件夹中创建链接。`} busy={busy} onClose={onClose}>
      <form onSubmit={submitPreview} className="mt-5 space-y-4">
        <div>
          <label className="mb-1.5 block text-[11px] font-medium text-[var(--muted)]" htmlFor="batch-target-folder">统一目标文件夹绝对路径</label>
          <div className="flex gap-2">
            <input id="batch-target-folder" value={folder} onChange={(event) => { setFolder(event.target.value); invalidatePreview(); setError(""); }} placeholder="例如 C:\\workspace\\project" className={`${fieldClass} min-w-0 flex-1`} autoFocus disabled={busy} />
            <button type="button" className={outlineButton} onClick={chooseFolder} disabled={busy}>浏览</button>
          </div>
        </div>
        {error && <p role="alert" className="text-[11px] text-[var(--warn)]">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className={outlineButton} onClick={onClose} disabled={busy}>取消</button>
          {!operation && <button type="submit" className={primaryButton} disabled={busy}>{busy ? "正在预览…" : "预览冲突"}</button>}
        </div>
      </form>

      {preview && (
        <section aria-label="批量创建预览" className="mt-5 rounded-md border border-[var(--line)] bg-[var(--base)] p-3">
          <div className="mb-2 flex items-center justify-between gap-3"><h3 className="text-[11px] font-semibold">预览结果</h3><span className="text-[10px] text-[var(--faint)]">{readyCount}/{preview.items.length} 可创建</span></div>
          <div className="divide-y divide-[var(--line)]">
            {preview.items.map((item) => (
              <div key={`${item.source}-${item.path}`} className="grid gap-1 py-2 first:pt-0 last:pb-0">
                <div className="flex items-center justify-between gap-3"><span className="min-w-0 truncate text-[11px] font-medium" title={item.source}>{basename(item.source)}</span><PreviewStatus status={item.status} /></div>
                <span className="truncate font-mono text-[10px] text-[var(--faint)]" title={item.path}>{item.path}</span>
                <span className="text-[10px] text-[var(--muted)]">{item.message}</span>
              </div>
            ))}
          </div>
          {!operation && <button type="button" className={`${primaryButton} mt-3 w-full`} onClick={execute} disabled={busy || readyCount === 0}>{busy ? "正在创建…" : "确认并创建"}</button>}
        </section>
      )}

      {operation && (
        <section aria-label="批量创建结果" className="mt-5 rounded-md border border-[var(--line)] bg-[var(--base)] p-3">
          <div className="mb-2 flex items-center justify-between gap-3"><h3 className="text-[11px] font-semibold">执行结果</h3><span className="text-[10px] text-[var(--faint)]">{operation.items.filter((item) => item.success).length}/{operation.items.length} 成功</span></div>
          <div className="divide-y divide-[var(--line)]">
            {operation.items.map((item) => (
              <div key={`${item.source}-${item.path}`} className="grid gap-1 py-2 first:pt-0 last:pb-0">
                <div className="flex items-center justify-between gap-3"><span className="min-w-0 truncate text-[11px] font-medium">{basename(item.source)}</span><span className={`text-[10px] ${item.success ? "text-[var(--muted)]" : "text-[var(--warn)]"}`}>{item.success ? "成功" : "失败"}</span></div>
                <span className="truncate font-mono text-[10px] text-[var(--faint)]" title={item.path}>{item.path}</span>
                <span className="text-[10px] text-[var(--muted)]">{item.message}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </ModalFrame>
  );
}

interface BatchDeleteDialogProps {
  sources: SourceView[];
  busy: boolean;
  onClose: () => void;
  onPreview: () => Promise<BatchPreview>;
  onExecute: (paths: string[], total: number) => Promise<BatchOperationResult>;
}

function BatchDeleteDialog({ sources, busy, onClose, onPreview, onExecute }: BatchDeleteDialogProps) {
  const [preview, setPreview] = useState<BatchPreview | null>(null);
  const [operation, setOperation] = useState<BatchOperationResult | null>(null);
  const [error, setError] = useState("");
  const previewRequest = useRef(0);

  async function loadPreview() {
    const request = ++previewRequest.current;
    setError("");
    setPreview(null);
    setOperation(null);
    try {
      const result = await onPreview();
      if (request === previewRequest.current) setPreview(result);
    } catch (cause) {
      if (request === previewRequest.current) setError(errorText(cause));
    }
  }

  useEffect(() => {
    void loadPreview();
    return () => { previewRequest.current += 1; };
  }, []);

  async function execute() {
    if (!preview || !preview.items.some((item) => item.status === "ready")) return;
    setError("");
    try {
      const approved = preview.items.filter((item) => item.status === "ready");
      const result = await onExecute(approved.map((item) => item.path), preview.items.length);
      setOperation({
        ...result,
        items: [
          ...preview.items.filter((item) => item.status === "blocked").map((item) => ({ source: item.source, path: item.path, success: false, message: `预览已阻止：${item.message}` })),
          ...result.items,
        ],
      });
    } catch (cause) {
      setError(errorText(cause));
    }
  }

  const readyCount = preview?.items.filter((item) => item.status === "ready").length ?? 0;

  return (
    <ModalFrame heading="批量删除链接" description={`将检查 ${sources.length} 个选中事实源的所有受管理链接，只删除安全可确认的软链接。`} busy={busy} onClose={onClose}>
      {error && <p role="alert" className="mt-5 text-[11px] text-[var(--warn)]">{error}</p>}
      {!preview && !error && <p className="mt-5 text-[11px] text-[var(--muted)]">正在预览可删除的链接…</p>}
      {preview && (
        <section aria-label="批量删除预览" className="mt-5 rounded-md border border-[var(--line)] bg-[var(--base)] p-3">
          <div className="mb-2 flex items-center justify-between gap-3"><h3 className="text-[11px] font-semibold">预览结果</h3><span className="text-[10px] text-[var(--faint)]">{readyCount}/{preview.items.length} 可删除</span></div>
          {preview.items.length ? <div className="divide-y divide-[var(--line)]">
            {preview.items.map((item) => (
              <div key={`${item.source}-${item.path}`} className="grid gap-1 py-2 first:pt-0 last:pb-0">
                <div className="flex items-center justify-between gap-3"><span className="min-w-0 truncate text-[11px] font-medium" title={item.source}>{basename(item.source)}</span><PreviewStatus status={item.status} /></div>
                <span className="truncate font-mono text-[10px] text-[var(--faint)]" title={item.path}>{item.path}</span>
                <span className="text-[10px] text-[var(--muted)]">{item.message}</span>
              </div>
            ))}
          </div> : <p className="py-3 text-[10px] text-[var(--faint)]">选中的事实源没有受管理链接。</p>}
          {!operation && <div className="mt-3 flex gap-2"><button type="button" className={`${outlineButton} flex-1`} onClick={loadPreview} disabled={busy}>重新预览</button><button type="button" className={`${primaryButton} flex-1`} onClick={execute} disabled={busy || readyCount === 0}>{busy ? "正在删除…" : "确认并删除"}</button></div>}
        </section>
      )}
      {operation && (
        <section aria-label="批量删除结果" className="mt-5 rounded-md border border-[var(--line)] bg-[var(--base)] p-3">
          <div className="mb-2 flex items-center justify-between gap-3"><h3 className="text-[11px] font-semibold">执行结果</h3><span className="text-[10px] text-[var(--faint)]">{operation.items.filter((item) => item.success).length}/{operation.items.length} 成功</span></div>
          <div className="divide-y divide-[var(--line)]">
            {operation.items.map((item) => (
              <div key={`${item.source}-${item.path}`} className="grid gap-1 py-2 first:pt-0 last:pb-0">
                <div className="flex items-center justify-between gap-3"><span className="min-w-0 truncate text-[11px] font-medium">{basename(item.source)}</span><span className={`text-[10px] ${item.success ? "text-[var(--muted)]" : "text-[var(--warn)]"}`}>{item.success ? "成功" : "失败"}</span></div>
                <span className="truncate font-mono text-[10px] text-[var(--faint)]" title={item.path}>{item.path}</span>
                <span className="text-[10px] text-[var(--muted)]">{item.message}</span>
              </div>
            ))}
          </div>
        </section>
      )}
      {!preview && <div className="mt-5 flex justify-end"><button type="button" className={outlineButton} onClick={onClose} disabled={busy}>取消</button></div>}
      {operation && <div className="mt-5 flex justify-end"><button type="button" className={outlineButton} onClick={onClose} disabled={busy}>完成</button></div>}
    </ModalFrame>
  );
}

interface SourceTagEditorProps {
  source: SourceView;
  busy: boolean;
  onSave: (tags: string[]) => Promise<void>;
}

function SourceTagEditor({ source, busy, onSave }: SourceTagEditorProps) {
  const [draft, setDraft] = useState(source.tags.join(", "));
  const [error, setError] = useState("");
  const savedTags = source.tags.join(", ");

  useEffect(() => {
    setDraft(savedTags);
    setError("");
  }, [source.path, savedTags]);

  async function save() {
    setError("");
    try {
      await onSave(parseTags(draft));
    } catch (cause) {
      setError(errorText(cause));
    }
  }

  return (
    <section className="mt-7 rounded-lg border border-[var(--line)] bg-[var(--panel)] p-4">
      <div className="flex items-start gap-2"><Tag size={15} className="mt-0.5 shrink-0 text-[var(--faint)]" /><div><h2 className="text-xs font-semibold">事实源标签</h2><p className="mt-1 text-[10px] leading-relaxed text-[var(--faint)]">用逗号分隔多个标签，标签会跟随事实源保存。</p></div></div>
      <div className="mt-3 flex gap-2 max-[520px]:flex-col"><input aria-label="事实源标签输入" value={draft} onChange={(event) => { setDraft(event.target.value); setError(""); }} placeholder="例如：文档，团队共享" className={`${fieldClass} min-w-0 flex-1`} /><button type="button" className={outlineButton} onClick={save} disabled={busy}>保存标签</button></div>
      <div className="mt-3 flex flex-wrap gap-1.5">{source.tags.length ? source.tags.map((tag) => <span key={tag} className="tag-chip">{tag}</span>) : <span className="text-[10px] text-[var(--faint)]">还没有标签</span>}</div>
      {error && <p role="alert" className="mt-2 text-[11px] text-[var(--warn)]">{error}</p>}
    </section>
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
  const [selectedSources, setSelectedSources] = useState<string[]>([]);
  const [batchSources, setBatchSources] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [filter, setFilter] = useState<"all" | "healthy" | "issues">("all");
  const [sourceMenuOpen, setSourceMenuOpen] = useState(false);
  const [addSourceKind, setAddSourceKind] = useState<"file" | "directory" | null>(null);
  const [scanOpen, setScanOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [batchCreateOpen, setBatchCreateOpen] = useState(false);
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false);
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
        if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
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
  const allTags = useMemo(() => Array.from(new Set(snapshot?.sources.flatMap((item) => item.tags ?? []) ?? [])).sort((left, right) => left.localeCompare(right)), [snapshot]);
  const shownSources = useMemo(() => snapshot?.sources.filter((item) => {
    const matchesQuery = basename(item.path).toLocaleLowerCase().includes(query.toLocaleLowerCase());
    const matchesTag = !tagFilter || (item.tags ?? []).includes(tagFilter);
    return matchesQuery && matchesTag;
  }) ?? [], [snapshot, query, tagFilter]);
  const shownLinks = source?.links.filter((item) => filter === "all" || (filter === "healthy" ? item.status === "healthy" : item.status !== "healthy")) ?? [];
  const visibleSourcePaths = shownSources.map((item) => item.path);
  const allVisibleSelected = visibleSourcePaths.length > 0 && visibleSourcePaths.every((path) => selectedSources.includes(path));

  useEffect(() => {
    if (tagFilter && !allTags.includes(tagFilter)) setTagFilter("");
  }, [allTags, tagFilter]);

  useEffect(() => {
    const validPaths = new Set(snapshot?.sources.map((item) => item.path) ?? []);
    setSelectedSources((current) => {
      const next = current.filter((path) => validPaths.has(path));
      return next.length === current.length ? current : next;
    });
  }, [snapshot]);

  async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
    setBusy(true);
    setError("");
    try {
      return args === undefined ? await invoke<T>(command) : await invoke<T>(command, args);
    } catch (cause) {
      setError(errorText(cause));
      throw cause;
    } finally {
      setBusy(false);
    }
  }

  async function runSnapshot(command: string, args?: Record<string, unknown>, success?: string): Promise<Snapshot> {
    const result = await call<Snapshot>(command, args);
    setSnapshot(result);
    if (success) setNotice(success);
    return result;
  }

  function addSource(directory: boolean) {
    setSourceMenuOpen(false);
    setAddSourceKind(directory ? "directory" : "file");
  }

  async function addSourcePath(path: string, expectedKind: "file" | "directory") {
    const previousPaths = new Set(snapshot?.sources.map((item) => item.path) ?? []);
    const result = await runSnapshot("add_source", { path, expectedKind }, "已添加事实源");
    const addedPath = result.selectedSourcePath ?? result.sources.find((item) => !previousPaths.has(item.path))?.path;
    if (addedPath) setSelectedSourcePath(addedPath);
    setSelectedLinkPath(null);
  }

  function addRoot() {
    setScanOpen(true);
  }

  async function addRootPath(path: string) {
    await runSnapshot("add_root", { path }, "扫描完成，已有链接已纳入管理");
  }

  async function removeRoot(path: string) {
    try {
      await runSnapshot("remove_root", { path }, "扫描目录已移除，磁盘内容未改变");
    } catch (cause) {
      setError(errorText(cause));
    }
  }

  async function refresh() {
    try {
      await runSnapshot("get_snapshot", undefined, "链接状态已刷新");
    } catch (cause) {
      setError(errorText(cause));
    }
  }

  async function createLink(folder: string, name: string) {
    if (!source) return;
    const existingPaths = new Set(snapshot?.sources.flatMap((item) => item.links.map((entry) => entry.path)) ?? []);
    const result = await runSnapshot("create_link", { source: source.path, folder, name }, "链接已创建");
    const created = result.sources.flatMap((item) => item.links).find((item) => !existingPaths.has(item.path));
    if (created) setSelectedLinkPath(created.path);
    setCreateOpen(false);
  }

  async function deleteLink() {
    if (!link) return;
    const approved = await confirm(`只删除这条软链接？\n\n${link.path}\n\n事实源 ${link.target} 会保留。`, { title: "删除链接", kind: "warning" });
    if (!approved) return;
    try {
      await runSnapshot("delete_link", { path: link.path }, "链接已删除，事实源保持不变");
      setSelectedLinkPath(null);
    } catch (cause) {
      setError(errorText(cause));
    }
  }

  async function forgetSource() {
    if (!source) return;
    try {
      await runSnapshot("forget_source", { path: source.path }, "事实源已从列表移除，磁盘内容未改变");
      setSelectedSourcePath(null);
      setSelectedSources((current) => current.filter((path) => path !== source.path));
    } catch (cause) {
      setError(errorText(cause));
    }
  }

  async function saveTags(tags: string[]) {
    if (!source) return;
    await runSnapshot("set_source_tags", { path: source.path, tags }, "标签已保存");
  }

  async function previewBatchCreate(folder: string): Promise<BatchPreview> {
    return call<BatchPreview>("preview_batch_create", { sources: batchSources, folder });
  }

  async function executeBatchCreate(folder: string, sources: string[], total: number): Promise<BatchOperationResult> {
    const result = await call<BatchOperationResult>("batch_create_links", { sources, folder });
    setSnapshot(result.snapshot);
    setNotice(`批量创建结束：${result.items.filter((item) => item.success).length}/${total} 项成功`);
    return result;
  }

  async function previewBatchDelete(): Promise<BatchPreview> {
    return call<BatchPreview>("preview_batch_delete", { sources: batchSources });
  }

  async function executeBatchDelete(paths: string[], total: number): Promise<BatchOperationResult> {
    const result = await call<BatchOperationResult>("batch_delete_links", { sources: batchSources, paths });
    setSnapshot(result.snapshot);
    setNotice(`批量删除结束：${result.items.filter((item) => item.success).length}/${total} 项成功，事实源保持不变`);
    return result;
  }

  async function reveal(path: string) {
    try {
      await revealItemInDir(path);
    } catch (cause) {
      setError(`无法在文件管理器中显示：${errorText(cause)}`);
    }
  }

  function toggleSource(path: string) {
    setSelectedSources((current) => current.includes(path) ? current.filter((item) => item !== path) : [...current, path]);
  }

  function selectVisibleSources() {
    setSelectedSources((current) => Array.from(new Set([...current, ...visibleSourcePaths])));
  }

  function clearVisibleSources() {
    const visible = new Set(visibleSourcePaths);
    setSelectedSources((current) => current.filter((path) => !visible.has(path)));
  }

  function openBatchCreate() {
    if (batchCreateOpen || batchDeleteOpen) return;
    setBatchSources([...selectedSources]);
    setBatchCreateOpen(true);
  }

  function openBatchDelete() {
    if (batchCreateOpen || batchDeleteOpen) return;
    setBatchSources([...selectedSources]);
    setBatchDeleteOpen(true);
  }

  return (
    <div className="grid min-h-[100dvh] grid-cols-[248px_minmax(0,1fr)] bg-[var(--base)] text-[var(--text)] max-[700px]:block">
      <aside className="flex min-w-0 flex-col border-r border-[var(--line)] bg-[var(--side)] px-2 pb-4 pt-3 max-[700px]:border-b max-[700px]:border-r-0 max-[700px]:pb-2">
        <div className="flex h-9 items-center gap-2.5 px-2 text-[13px] font-semibold tracking-tight"><span className="brand-mark" aria-hidden="true" />SoftConnet</div>
        <div className="mx-1 mb-5 mt-2 flex h-8 items-center gap-2 rounded-md border border-[var(--line)] px-2 text-[var(--faint)] max-[700px]:mb-3">
          <MagnifyingGlass size={14} weight={ICON_WEIGHT} aria-hidden="true" />
          <input ref={searchRef} value={query} onChange={(event) => { setQuery(event.target.value); setSelectedSources([]); }} placeholder="搜索事实源" aria-label="搜索事实源" className="min-w-0 flex-1 bg-transparent text-[11px] text-[var(--text)] outline-none placeholder:text-[var(--faint)]" />
          <span className="whitespace-nowrap text-[10px] max-[700px]:hidden">⌘ K</span>
        </div>
        <div className="relative mx-2 mb-1 flex h-7 items-center justify-between text-[10px] font-semibold text-[var(--faint)]">
          <span>事实源</span>
          <button onClick={() => setSourceMenuOpen(!sourceMenuOpen)} className={subtleButton} aria-label="添加事实源" aria-expanded={sourceMenuOpen}><Plus size={13} weight={ICON_WEIGHT} /></button>
          {sourceMenuOpen && <div className="absolute right-0 top-7 z-10 w-36 rounded-md border border-[var(--line)] bg-[var(--panel)] p-1 shadow-[0_12px_36px_#0004]"><button onClick={() => addSource(false)} className="w-full rounded px-2 py-2 text-left text-[11px] hover:bg-[var(--hover)]">添加文件</button><button onClick={() => addSource(true)} className="w-full rounded px-2 py-2 text-left text-[11px] hover:bg-[var(--hover)]">添加文件夹</button></div>}
        </div>
        <div className="mx-1 mb-2 flex items-center gap-1.5">
          <select aria-label="按标签筛选" value={tagFilter} onChange={(event) => { setTagFilter(event.target.value); setSelectedSources([]); }} className="min-w-0 flex-1 rounded-md border border-[var(--line)] bg-[var(--base)] px-2 py-1.5 text-[10px] text-[var(--muted)] outline-none">
            <option value="">全部标签</option>
            {allTags.map((tag) => <option key={tag} value={tag}>{tag}</option>)}
          </select>
          <button type="button" className={subtleButton} onClick={allVisibleSelected ? clearVisibleSources : selectVisibleSources} disabled={!visibleSourcePaths.length} title={allVisibleSelected ? "取消全选" : "全选筛选结果"}>{allVisibleSelected ? "清空" : "全选"}</button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto max-[700px]:flex max-[700px]:overflow-x-auto">
          {shownSources.map((item) => (
            <div key={item.path} className={`group flex min-h-[42px] w-full items-center gap-1 rounded-md px-1.5 max-[700px]:w-auto max-[700px]:min-w-44 max-[700px]:shrink-0 ${item.path === source?.path ? "bg-[var(--selected)]" : "hover:bg-[var(--hover)]"}`} title={item.path}>
              <input type="checkbox" aria-label={`选择事实源 ${basename(item.path)}`} checked={selectedSources.includes(item.path)} onChange={() => toggleSource(item.path)} className="ml-1 accent-[var(--accent)]" />
              <button type="button" onClick={() => { setSelectedSourcePath(item.path); setSelectedLinkPath(null); setFilter("all"); }} className={`flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-1.5 py-1.5 text-left text-[11px] ${item.path === source?.path ? "text-[var(--text)]" : "text-[var(--muted)] hover:text-[var(--text)]"}`} aria-label={`打开事实源 ${basename(item.path)}`}>
                <span className={item.path === source?.path ? "text-[var(--accent)]" : "text-[var(--faint)]"}><FileIcon kind={item.kind} size={15} /></span>
                <span className="min-w-0 flex-1"><span className="block truncate">{basename(item.path)}</span>{item.tags.length > 0 && <span className="mt-0.5 flex min-w-0 gap-1 overflow-hidden">{item.tags.slice(0, 2).map((tag) => <span key={tag} className="tag-chip max-w-20 truncate">{tag}</span>)}</span>}</span>
                <span className="text-[10px] text-[var(--faint)]">{item.links.length}</span>
              </button>
            </div>
          ))}
          {!loading && query && shownSources.length === 0 && <p className="px-3 py-4 text-[11px] text-[var(--faint)]">没有匹配的事实源</p>}
          {!loading && !query && tagFilter && shownSources.length === 0 && <p className="px-3 py-4 text-[11px] text-[var(--faint)]">这个标签下没有事实源</p>}
        </div>
        <div className="mt-auto max-[700px]:border-t max-[700px]:border-[var(--line)] max-[700px]:pt-2">
          <div className="mx-2 mb-1 flex h-7 items-center justify-between text-[10px] font-semibold text-[var(--faint)]"><span>扫描目录</span><button onClick={addRoot} disabled={busy} className={subtleButton} aria-label="添加扫描目录"><Plus size={13} /></button></div>
          {snapshot?.roots.map((root) => <div key={root} className="group flex h-8 items-center gap-2 rounded-md px-2.5 text-[11px] text-[var(--muted)] hover:bg-[var(--hover)]" title={root}><Folder size={14} className="shrink-0" /><span className="min-w-0 flex-1 truncate">{root}</span><button onClick={() => removeRoot(root)} disabled={busy} title="移除扫描目录" aria-label={`移除扫描目录 ${root}`} className="rounded p-0.5 text-[var(--faint)] opacity-0 transition-opacity hover:text-[var(--text)] focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 max-[700px]:opacity-100"><X size={12} /></button></div>)}
          {!snapshot?.roots.length && <button onClick={addRoot} className="px-2.5 py-2 text-left text-[11px] text-[var(--faint)] hover:text-[var(--text)]">选择项目目录以发现已有链接</button>}
        </div>
      </aside>

      <div className="grid min-w-0 grid-rows-[46px_minmax(0,1fr)] max-[700px]:grid-rows-[40px_minmax(0,1fr)]">
        <header className="flex min-w-0 items-center gap-2 border-b border-[var(--line)] px-7 text-[11px] text-[var(--muted)] max-[700px]:px-4"><span>事实源</span><span className="text-[var(--faint)]">/</span><strong className="min-w-0 truncate font-medium text-[var(--text)]">{source ? basename(source.path) : "概览"}</strong><div className="ml-auto flex shrink-0 items-center gap-1"><button onClick={refresh} disabled={busy || loading} className={subtleButton} title="刷新链接状态" aria-label="刷新链接状态"><ArrowClockwise size={14} className={busy ? "animate-spin" : ""} /></button><button onClick={() => setTheme(theme === "dark" ? "light" : "dark")} className={subtleButton} title="切换外观" aria-label="切换外观">{theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}</button></div></header>
        {error && <div role="alert" className="flex items-start gap-2 border-b border-[var(--line)] bg-[var(--panel)] px-7 py-2.5 text-[11px] text-[var(--warn)]"><WarningCircle size={15} className="mt-px shrink-0" /><span className="flex-1">{error}</span><button onClick={() => setError("")} aria-label="关闭错误提示"><X size={13} /></button></div>}
        {snapshot?.scanWarnings.map((warning) => <div key={warning} role="status" className="border-b border-[var(--line)] px-7 py-2 text-[11px] text-[var(--warn)]">{warning}</div>)}
        <div className="grid min-h-0 min-w-0 grid-cols-[minmax(0,1fr)_268px] max-[1050px]:grid-cols-1">
          <main className="min-w-0 overflow-y-auto">
            {selectedSources.length > 0 && <div className="mx-auto flex max-w-[1050px] items-center gap-3 border-b border-[var(--line)] px-10 py-3 max-[700px]:flex-wrap max-[700px]:px-4"><span className="text-[11px] text-[var(--muted)]">已选 {selectedSources.length} 个事实源</span><div className="ml-auto flex gap-2"><button type="button" className={outlineButton} onClick={openBatchCreate} disabled={busy}>批量创建链接</button><button type="button" className={outlineButton} onClick={openBatchDelete} disabled={busy}>批量删除链接</button></div></div>}
            {loading ? <LoadingView /> : source ? (
              <div className="mx-auto max-w-[1050px] px-10 py-9 max-[700px]:px-4 max-[700px]:py-7">
                <div className="flex flex-wrap items-start gap-3">
                  <div className="mt-0.5 flex h-9 w-8 shrink-0 items-center justify-center rounded-[5px] border border-[var(--faint)] text-[var(--muted)]"><FileIcon kind={source.kind} size={19} /></div>
                  <div className="min-w-0 flex-1"><h1 className="break-all text-[19px] leading-snug font-semibold tracking-tight">{basename(source.path)}</h1><p className="mt-1 break-all font-mono text-[10px] leading-relaxed text-[var(--faint)]">{source.path}</p></div>
                  <div className="flex gap-2 max-[700px]:ml-11 max-[700px]:w-full"><button onClick={() => setCreateOpen(true)} disabled={busy || (source.kind !== "file" && source.kind !== "directory")} className={`${primaryButton} inline-flex items-center gap-1.5`}><Plus size={13} />新增链接</button>{source.manual && source.links.length === 0 && <button onClick={forgetSource} disabled={busy} className={outlineButton}>从列表移除</button>}</div>
                </div>

                <SourceTagEditor source={source} busy={busy} onSave={saveTags} />

                <section className="mt-10"><div className="mb-4 flex items-center gap-3"><h2 className="text-xs font-semibold">引用关系</h2><span className="text-[10px] text-[var(--faint)]">源文件连接到 {source.links.length} 个位置</span></div><div className="grid min-h-42 grid-cols-[minmax(160px,.7fr)_64px_minmax(240px,1.3fr)] items-center rounded-lg border border-[var(--line)] bg-[var(--panel)] px-5 py-4 max-[700px]:grid-cols-1"><div className="min-w-0"><div className="mb-2 text-[9px] font-semibold tracking-wide text-[var(--faint)]">事实源 · {source.kind === "directory" ? "文件夹" : source.kind === "missing" ? "已缺失" : source.kind === "symlink" ? "已替换为软链接" : "文件"}</div><p className="truncate text-xs font-semibold">{basename(source.path)}</p><p className="mt-1 truncate font-mono text-[10px] text-[var(--faint)]">{dirname(source.path)}</p></div><div className="map-connector max-[700px]:hidden" /><div className="map-targets min-w-0 max-[700px]:mt-3">{source.links.length ? source.links.map((item) => <button key={item.path} onClick={() => setSelectedLinkPath(item.path)} className={`map-target flex h-[42px] w-full items-center gap-2.5 py-1 pr-1 pl-3 text-left max-[700px]:pl-0 ${item.path === link?.path ? "text-[var(--accent)]" : "text-[var(--text)]"}`}><div className="min-w-0 flex-1"><span className="block truncate text-[11px] font-medium">{item.project}</span><span className="mt-0.5 block truncate font-mono text-[9px] text-[var(--faint)]">{dirname(item.path)}</span></div><span className={`status-dot ${item.status === "healthy" ? "" : "warn"}`} /></button>) : <div className="py-7 text-center text-[11px] text-[var(--faint)]">还没有项目链接</div>}</div></div></section>

                <section className="mt-9"><div className="mb-3 flex items-center gap-3"><h2 className="text-xs font-semibold">链接</h2><span className="text-[10px] text-[var(--faint)]">{source.links.length}</span><div className="ml-auto flex items-center gap-0.5">{(["all", "healthy", "issues"] as const).map((item) => <button key={item} onClick={() => setFilter(item)} className={`rounded-md px-2 py-1.5 text-[10px] ${filter === item ? "bg-[var(--selected)] text-[var(--text)]" : "text-[var(--faint)] hover:bg-[var(--hover)] hover:text-[var(--text)]"}`}>{item === "all" ? "全部" : item === "healthy" ? "正常" : "需处理"}</button>)}</div></div><div className="border-t border-[var(--line)]"><div className="grid min-h-8 grid-cols-[minmax(105px,.8fr)_minmax(180px,2fr)_90px] items-center gap-3 border-b border-[var(--line)] px-3 text-[10px] text-[var(--faint)] max-[700px]:grid-cols-[minmax(85px,.8fr)_minmax(105px,1.2fr)_65px] max-[700px]:gap-1"><span>项目</span><span>链接路径</span><span>状态</span></div>{shownLinks.length ? shownLinks.map((item) => <button key={item.path} onClick={() => setSelectedLinkPath(item.path)} className={`grid min-h-11 w-full grid-cols-[minmax(105px,.8fr)_minmax(180px,2fr)_90px] items-center gap-3 border-b border-[var(--line)] px-3 text-left max-[700px]:grid-cols-[minmax(85px,.8fr)_minmax(105px,1.2fr)_65px] max-[700px]:gap-1 ${item.path === link?.path ? "bg-[var(--selected)]" : "hover:bg-[var(--hover)]"}`}><span className="truncate text-[11px] font-medium">{item.project}</span><span className="truncate font-mono text-[10px] text-[var(--muted)]" title={item.path}>{item.path}</span><Status status={item.status} /></button>) : <p className="py-8 text-center text-[11px] text-[var(--faint)]">此筛选条件下没有链接</p>}</div></section>
                {link && <section aria-label="窄窗口链接操作" className="mt-5 hidden border-t border-[var(--line)] pt-4 max-[1050px]:block"><p className="truncate font-mono text-[10px] text-[var(--muted)]" title={link.path}>{link.path}</p><div className="mt-3 flex flex-wrap gap-2"><button onClick={() => reveal(link.path)} className={`${outlineButton} inline-flex items-center gap-1.5`}><ArrowSquareOut size={13} />显示当前位置</button><button onClick={deleteLink} disabled={busy || ["replaced", "link_missing", "retargeted"].includes(link.status)} className={`${outlineButton} inline-flex items-center gap-1.5`} title={["replaced", "link_missing", "retargeted"].includes(link.status) ? "此位置已改变，请先人工检查" : "只删除软链接"}><Trash size={13} />删除当前链接</button></div></section>}
              </div>
            ) : <div className="mx-auto max-w-xl px-6 py-24 text-center"><LinkSimple size={26} weight="light" className="mx-auto text-[var(--faint)]" /><h1 className="mt-4 text-base font-semibold">还没有事实源</h1><p className="mt-2 text-xs leading-relaxed text-[var(--muted)]">添加已有文件或文件夹，再为项目创建链接；也可以扫描项目目录，纳入已有软链接。</p><div className="mt-6 flex justify-center gap-2"><button onClick={() => addSource(false)} className={primaryButton}>添加文件</button><button onClick={() => addSource(true)} className={outlineButton}>添加文件夹</button><button onClick={addRoot} className={outlineButton}>扫描目录</button></div></div>}
          </main>
          <aside className="min-w-0 border-l border-[var(--line)] px-5 py-6 max-[1050px]:hidden"><p className="mb-5 text-[10px] text-[var(--faint)]">链接详情</p>{link ? <><h2 className="mb-6 break-all text-[13px] font-semibold">{link.project}</h2><dl className="space-y-0"><div className="border-t border-[var(--line)] py-3.5"><dt className="mb-2 text-[10px] text-[var(--faint)]">状态</dt><dd><Status status={link.status} /></dd></div><div className="border-t border-[var(--line)] py-3.5"><dt className="mb-2 text-[10px] text-[var(--faint)]">链接位置</dt><dd className="break-all font-mono text-[10px] leading-relaxed text-[var(--muted)]">{link.path}</dd></div><div className="border-t border-[var(--line)] py-3.5"><dt className="mb-2 text-[10px] text-[var(--faint)]">指向</dt><dd className="break-all font-mono text-[10px] leading-relaxed text-[var(--muted)]">{link.target}</dd></div></dl><div className="mt-4 flex flex-wrap gap-2"><button onClick={() => reveal(link.path)} className={`${outlineButton} inline-flex items-center gap-1.5`}><ArrowSquareOut size={13} />显示位置</button><button onClick={deleteLink} disabled={busy || ["replaced", "link_missing", "retargeted"].includes(link.status)} className={`${outlineButton} inline-flex items-center gap-1.5`} title={["replaced", "link_missing", "retargeted"].includes(link.status) ? "此位置已改变，请先人工检查" : "只删除软链接"}><Trash size={13} />删除链接</button></div><p className="mt-6 text-[10px] leading-relaxed text-[var(--faint)]">删除只作用于软链接，事实源保持不变。</p></> : <p className="py-9 text-center text-[11px] text-[var(--faint)]">选择一条链接查看详情</p>}</aside>
        </div>
      </div>
      {notice && <div role="status" className="fixed bottom-5 left-1/2 z-30 max-w-[calc(100vw-30px)] -translate-x-1/2 rounded-md bg-[var(--button)] px-3 py-2 text-[11px] text-[var(--button-text)] shadow-lg">{notice}</div>}
      {addSourceKind && <AddSourceDialog kind={addSourceKind} busy={busy} onClose={() => setAddSourceKind(null)} onAdd={(path) => addSourcePath(path, addSourceKind)} />}
      {scanOpen && <ScanRootDialog busy={busy} onClose={() => setScanOpen(false)} onAdd={addRootPath} />}
      {createOpen && source && <CreateLinkDialog source={source} busy={busy} onClose={() => setCreateOpen(false)} onCreate={createLink} />}
      {batchCreateOpen && <BatchCreateDialog sources={snapshot?.sources.filter((item) => batchSources.includes(item.path)) ?? []} busy={busy} onClose={() => setBatchCreateOpen(false)} onPreview={previewBatchCreate} onExecute={executeBatchCreate} />}
      {batchDeleteOpen && <BatchDeleteDialog sources={snapshot?.sources.filter((item) => batchSources.includes(item.path)) ?? []} busy={busy} onClose={() => setBatchDeleteOpen(false)} onPreview={previewBatchDelete} onExecute={executeBatchDelete} />}
    </div>
  );
}

export default App;
