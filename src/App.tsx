import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { confirm, open } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import {
  ArrowClockwise,
  ArrowSquareOut,
  Check,
  FileText,
  Folder,
  LinkSimple,
  MagnifyingGlass,
  Moon,
  Plus,
  SidebarSimple,
  Sun,
  Tag,
  Trash,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  basename,
  statusText,
  type BatchOperationResult,
  type BatchPreview,
  type LinkView,
  type Snapshot,
  type SourceView,
} from "./types";

const ICON_WEIGHT = "regular" as const;
const outlineButton = "rounded-md border border-[var(--line)] bg-[var(--panel)] px-3 py-1.5 text-[11px] font-medium text-[var(--text)] transition-colors hover:bg-[var(--hover)] disabled:opacity-40";
const primaryButton = "rounded-md border border-[var(--button)] bg-[var(--button)] px-3 py-1.5 text-[11px] font-semibold text-[var(--button-text)] transition-opacity hover:opacity-90 disabled:opacity-40";
const fieldClass = "w-full rounded-md border border-[var(--line)] bg-[var(--base)] px-3 py-2 text-[11px] text-[var(--text)] outline-none placeholder:text-[var(--faint)]";

function errorText(error: unknown): string {
  return typeof error === "string" ? error : error instanceof Error ? error.message : String(error);
}

function isAbsolutePath(path: string): boolean {
  return path.startsWith("/") || path.startsWith("\\\\") || /^[A-Za-z]:[\\/]/.test(path);
}

function pathExample(name: string): string {
  return `例如 ${navigator.platform.startsWith("Win") ? `C:\\workspace\\${name}` : `/Users/you/${name}`}`;
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
    <span className={`link-status ${bad ? "problem" : "healthy"}`}>
      {bad ? <WarningCircle size={14} aria-hidden="true" /> : <Check size={14} aria-hidden="true" />}
      {statusText[status]}
    </span>
  );
}

function LoadingView() {
  return (
    <div className="source-loading" aria-label="正在读取链接">
      <Skeleton className="h-5 w-52" />
      <Skeleton className="mt-3 h-3 w-80 max-w-full" />
      <div className="mt-12 space-y-3">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    </div>
  );
}

function useViewportWidth() {
  const [width, setWidth] = useState(() => window.innerWidth);
  useEffect(() => {
    const update = () => setWidth(window.innerWidth);
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  return width;
}

function shortHome(path: string) {
  return path.replace(/^\/Users\/[^/]+/, "~");
}

function linkLocation(link: LinkView, roots: string[]) {
  const root = roots.filter((item) => link.path.startsWith(`${item.replace(/[\\/]$/, "")}/`) || link.path.startsWith(`${item.replace(/[\\/]$/, "")}\\`)).sort((a, b) => b.length - a.length)[0];
  return root ? link.path.slice(root.length).replace(/^[\\/]/, "") : link.path;
}

function sourceHasIssue(source: SourceView) {
  return source.kind === "missing" || source.kind === "symlink" || source.links.some((link) => link.status !== "healthy");
}

function LinkInspector({ link, busy, onClose, onReveal, onDelete }: {
  link: LinkView;
  busy: boolean;
  onClose: () => void;
  onReveal: (path: string) => void;
  onDelete: () => void;
}) {
  const unsafeToDelete = ["replaced", "link_missing", "retargeted"].includes(link.status);
  return <>
    <div className="inspector-top"><span>链接详情</span><Button variant="ghost" size="icon-sm" aria-label="关闭详情" onClick={onClose}><X size={15} /></Button></div>
    <h2>{link.project}</h2>
    <Status status={link.status} />
    <div className="inspector-field"><small>链接位置</small><p>{link.path}</p></div>
    <div className="inspector-field"><small>指向事实源</small><p>{link.target}</p></div>
    {link.status !== "healthy" && <div className="inspector-field"><small>状态说明</small><strong className="problem">{statusText[link.status]}</strong></div>}
    <div className="inspector-actions">
      <Button variant="outline" size="sm" onClick={() => onReveal(link.path)}><ArrowSquareOut size={15} />显示位置</Button>
      <Button variant="ghost" size="sm" disabled={busy || unsafeToDelete} onClick={onDelete} title={unsafeToDelete ? "此位置已改变，请先人工检查" : "只删除软链接"}><Trash size={15} />删除链接</Button>
    </div>
    <p className="inspector-note">删除只作用于软链接，事实源保持不变。</p>
  </>;
}

interface ModalFrameProps {
  heading: string;
  description?: string;
  busy: boolean;
  onClose: () => void;
  children: ReactNode;
}

function ModalFrame({ heading, description, busy, onClose, children }: ModalFrameProps) {
  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <DialogContent showCloseButton={false} className="max-h-[calc(100dvh-32px)] max-w-[500px] gap-0 overflow-y-auto p-6" onEscapeKeyDown={(event) => { if (busy) event.preventDefault(); }} onPointerDownOutside={(event) => { if (busy) event.preventDefault(); }}>
        <DialogHeader className="relative pr-8 text-left">
          <DialogTitle>{heading}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
          <Button type="button" variant="ghost" size="icon-sm" className="absolute -top-1 right-0" onClick={onClose} disabled={busy} aria-label="关闭"><X size={15} /></Button>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
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
            <Input id="source-path-input" value={path} onChange={(event) => { setPath(event.target.value); setError(""); }} placeholder={pathExample(kind === "directory" ? "notes" : "shared.md")} className={`${fieldClass} min-w-0 flex-1`} autoFocus />
            <Button type="button" className={outlineButton} onClick={choosePath} disabled={busy}>浏览</Button>
          </div>
        </div>
        {error && <p role="alert" className="text-[11px] text-[var(--warn)]">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" className={outlineButton} onClick={onClose} disabled={busy}>取消</Button>
          <Button type="submit" className={primaryButton} disabled={busy}>{busy ? "正在添加…" : "添加事实源"}</Button>
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
            <Input id="scan-path-input" value={path} onChange={(event) => { setPath(event.target.value); setError(""); }} placeholder={pathExample("projects")} className={`${fieldClass} min-w-0 flex-1`} autoFocus />
            <Button type="button" className={outlineButton} onClick={choosePath} disabled={busy}>浏览</Button>
          </div>
        </div>
        {error && <p role="alert" className="text-[11px] text-[var(--warn)]">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" className={outlineButton} onClick={onClose} disabled={busy}>取消</Button>
          <Button type="submit" className={primaryButton} disabled={busy}>{busy ? "正在扫描…" : "开始扫描"}</Button>
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
          <Input id="source-path" value={source.path} readOnly className={`${fieldClass} text-[var(--faint)]`} />
        </div>
        <div>
          <label className="mb-1.5 block text-[11px] font-medium text-[var(--muted)]" htmlFor="target-folder">目标文件夹绝对路径</label>
          <div className="flex gap-2">
            <Input id="target-folder" value={folder} onChange={(event) => { setFolder(event.target.value); setError(""); }} placeholder={pathExample("project")} className="min-w-0 flex-1 rounded-md border border-[var(--line)] bg-[var(--base)] px-3 py-2 text-[11px] text-[var(--text)] placeholder:text-[var(--faint)]" autoFocus />
            <Button type="button" className={outlineButton} onClick={chooseFolder} disabled={busy}>浏览</Button>
          </div>
        </div>
        <div>
          <label className="mb-1.5 block text-[11px] font-medium text-[var(--muted)]" htmlFor="link-name">链接名称</label>
          <Input id="link-name" value={name} onChange={(event) => setName(event.target.value)} className={fieldClass} />
          <p className="mt-1.5 text-[10px] text-[var(--faint)]">目标位置若已有同名文件或链接，应用会拒绝覆盖。</p>
        </div>
        {error && <p role="alert" className="text-[11px] text-[var(--warn)]">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" className={outlineButton} onClick={onClose} disabled={busy}>取消</Button>
          <Button type="submit" className={primaryButton} disabled={busy}>{busy ? "正在创建…" : "创建链接"}</Button>
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
            <Input id="batch-target-folder" value={folder} onChange={(event) => { setFolder(event.target.value); invalidatePreview(); setError(""); }} placeholder={pathExample("project")} className={`${fieldClass} min-w-0 flex-1`} autoFocus disabled={busy} />
            <Button type="button" className={outlineButton} onClick={chooseFolder} disabled={busy}>浏览</Button>
          </div>
        </div>
        {error && <p role="alert" className="text-[11px] text-[var(--warn)]">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" className={outlineButton} onClick={onClose} disabled={busy}>取消</Button>
          {!operation && <Button type="submit" className={primaryButton} disabled={busy}>{busy ? "正在预览…" : "预览冲突"}</Button>}
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
          {!operation && <Button type="button" className={`${primaryButton} mt-3 w-full`} onClick={execute} disabled={busy || readyCount === 0}>{busy ? "正在创建…" : "确认并创建"}</Button>}
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
          {!operation && <div className="mt-3 flex gap-2"><Button type="button" className={`${outlineButton} flex-1`} onClick={loadPreview} disabled={busy}>重新预览</Button><Button type="button" className={`${primaryButton} flex-1`} onClick={execute} disabled={busy || readyCount === 0}>{busy ? "正在删除…" : "确认并删除"}</Button></div>}
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
      {!preview && <div className="mt-5 flex justify-end"><Button type="button" className={outlineButton} onClick={onClose} disabled={busy}>取消</Button></div>}
      {operation && <div className="mt-5 flex justify-end"><Button type="button" className={outlineButton} onClick={onClose} disabled={busy}>完成</Button></div>}
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
  const [editing, setEditing] = useState(false);
  const savedTags = source.tags.join(", ");

  useEffect(() => {
    setDraft(savedTags);
    setError("");
  }, [source.path, savedTags]);

  async function save() {
    setError("");
    try {
      await onSave(parseTags(draft));
      setEditing(false);
    } catch (cause) {
      setError(errorText(cause));
    }
  }

  return (
    <section className="source-tags" aria-label="事实源标签">
      <div className="source-tags-summary"><Tag size={14} aria-hidden="true" />
        {source.tags.length ? source.tags.map((tag) => <span key={tag} className="tag-chip">{tag}</span>) : <span>无标签</span>}
        <Button type="button" variant="ghost" size="xs" onClick={() => setEditing((value) => !value)}>{editing ? "收起" : "编辑标签"}</Button>
      </div>
      {editing && <div className="source-tags-edit"><Input aria-label="事实源标签输入" value={draft} onChange={(event) => { setDraft(event.target.value); setError(""); }} placeholder="用逗号分隔标签" /><Button type="button" variant="outline" size="sm" onClick={save} disabled={busy}>保存标签</Button></div>}
      {error && <p role="alert" className="text-[11px] text-[var(--warn)]">{error}</p>}
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
  const [selectMode, setSelectMode] = useState(false);
  const [sideOpen, setSideOpen] = useState(true);
  const [mobileSideOpen, setMobileSideOpen] = useState(false);
  const [addSourceKind, setAddSourceKind] = useState<"file" | "directory" | null>(null);
  const [scanOpen, setScanOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [batchCreateOpen, setBatchCreateOpen] = useState(false);
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false);
  const [theme, setTheme] = useState<"dark" | "light">(() => localStorage.getItem("softconnet-theme") === "dark" ? "dark" : "light");
  const searchRef = useRef<HTMLInputElement>(null);
  const viewportWidth = useViewportWidth();
  const isMobile = viewportWidth <= 760;
  const isCompact = viewportWidth <= 1100;
  const sidebarVisible = isMobile ? mobileSideOpen : sideOpen;

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem("softconnet-theme", theme);
  }, [theme]);

  useEffect(() => {
    document.documentElement.classList.toggle("macos-overlay", /Mac/.test(navigator.platform) && "__TAURI_INTERNALS__" in window);
  }, []);

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
        if (window.innerWidth <= 760) setMobileSideOpen(true);
        else setSideOpen(true);
        window.requestAnimationFrame(() => searchRef.current?.focus());
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
  const link = source?.links.find((item) => item.path === selectedLinkPath) ?? null;
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

  function chooseSource(path: string) {
    setSelectedSourcePath(path);
    setSelectedLinkPath(null);
    setFilter("all");
    if (isMobile) setMobileSideOpen(false);
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

  const sidebar = (
    <>
      <div className="sidebar-header" data-tauri-drag-region>
        <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon-sm" aria-label="收起侧栏" onClick={() => isMobile ? setMobileSideOpen(false) : setSideOpen(false)}><SidebarSimple size={17} /></Button></TooltipTrigger><TooltipContent>收起侧栏</TooltipContent></Tooltip>
      </div>
      <div className="sidebar-search">
        <MagnifyingGlass size={15} aria-hidden="true" />
        <Input ref={searchRef} value={query} onChange={(event) => { setQuery(event.target.value); setSelectedSources([]); }} placeholder="搜索事实源" aria-label="搜索事实源" />
        <kbd>⌘ K</kbd>
      </div>
      <div className="group-title">
        <span>事实源 <small>{snapshot?.sources.length ?? 0}</small></span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label="添加事实源"><Plus size={15} /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => addSource(false)}>添加文件</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => addSource(true)}>添加文件夹</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => { if (selectMode) setSelectedSources([]); setSelectMode(!selectMode); }}>{selectMode ? "完成选择" : "批量选择"}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {allTags.length > 0 && <div className="sidebar-filter">
        <Select value={tagFilter || "all"} onValueChange={(value) => { setTagFilter(value === "all" ? "" : value); setSelectedSources([]); }}>
          <SelectTrigger aria-label="按标签筛选"><SelectValue placeholder="全部标签" /></SelectTrigger>
          <SelectContent><SelectItem value="all">全部标签</SelectItem>{allTags.map((tag) => <SelectItem key={tag} value={tag}>{tag}</SelectItem>)}</SelectContent>
        </Select>
      </div>}
      {selectMode && <div className="selection-bar"><span>选择事实源</span><Button variant="ghost" size="xs" onClick={allVisibleSelected ? clearVisibleSources : selectVisibleSources} disabled={!visibleSourcePaths.length}>{allVisibleSelected ? "取消全选" : "全选"}</Button></div>}
      <nav className="source-nav" aria-label="事实源列表">
        {shownSources.map((item) => <div key={item.path} className={`source-item ${item.path === source?.path ? "current" : ""}`} title={item.path}>
          {selectMode && <Checkbox aria-label={`选择事实源 ${basename(item.path)}`} checked={selectedSources.includes(item.path)} onCheckedChange={() => toggleSource(item.path)} />}
          <button type="button" className="source-open" aria-label={`打开事实源 ${basename(item.path)}${sourceHasIssue(item) ? "，有需处理的链接" : ""}`} onClick={() => chooseSource(item.path)}>
            <FileIcon kind={item.kind} size={16} /><span className="source-name">{basename(item.path)}</span>
            {sourceHasIssue(item) && <span className="source-warning" aria-hidden="true" />}
            <span className="source-count">{item.links.length}</span>
          </button>
        </div>)}
        {!loading && query && !shownSources.length && <p className="empty-search">没有匹配的事实源</p>}
        {!loading && !query && tagFilter && !shownSources.length && <p className="empty-search">这个标签下没有事实源</p>}
      </nav>
      <div className="sidebar-bottom">
        <div className="group-title"><span>扫描目录 <small>{snapshot?.roots.length ?? 0}</small></span><Button variant="ghost" size="icon-sm" onClick={addRoot} disabled={busy} aria-label="添加扫描目录"><Plus size={15} /></Button></div>
        {snapshot?.roots.map((root) => <div key={root} className="root-item" title={root}><Folder size={15} /><span className="path">{shortHome(root)}</span><Button variant="ghost" size="icon-xs" onClick={() => removeRoot(root)} disabled={busy} aria-label={`移除扫描目录 ${root}`}><X size={13} /></Button></div>)}
        {!snapshot?.roots.length && <Button variant="ghost" size="sm" onClick={addRoot}>选择项目目录以发现已有链接</Button>}
      </div>
    </>
  );

  return (
    <TooltipProvider>
      <div className={`app ${!sidebarVisible ? "side-collapsed" : ""} ${link && !isCompact ? "inspector-open" : ""}`}>
        {isMobile ? <Sheet open={mobileSideOpen} onOpenChange={setMobileSideOpen}><SheetContent side="left" showCloseButton={false} className="sidebar mobile-sidebar"><SheetTitle className="sr-only">事实源</SheetTitle>{sidebar}</SheetContent></Sheet> : sideOpen && <aside className="sidebar">{sidebar}</aside>}
        <div className="workspace">
          <header className="topbar" data-tauri-drag-region>
            {!sidebarVisible && <Button variant="ghost" size="icon-sm" aria-label="展开侧栏" onClick={() => isMobile ? setMobileSideOpen(true) : setSideOpen(true)}><SidebarSimple size={17} /></Button>}
            <span className="top-label">事实源</span>
            <div className="top-right flex items-center gap-1">
              <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon-sm" onClick={refresh} disabled={busy || loading} aria-label="刷新链接状态"><ArrowClockwise size={16} className={busy ? "animate-spin" : ""} /></Button></TooltipTrigger><TooltipContent>刷新链接状态</TooltipContent></Tooltip>
              <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon-sm" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} aria-label="切换外观">{theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}</Button></TooltipTrigger><TooltipContent>切换外观</TooltipContent></Tooltip>
            </div>
          </header>
          {error && <div role="alert" className="notice-line"><WarningCircle size={15} /><span>{error}</span><Button variant="ghost" size="icon-xs" onClick={() => setError("")} aria-label="关闭错误提示"><X size={13} /></Button></div>}
          {snapshot?.scanWarnings.map((warning) => <div key={warning} role="status" className="notice-line">{warning}</div>)}
          <div className="work-area">
            <main className="content">
              {selectedSources.length > 0 && <div className="batch-bar"><span>已选 {selectedSources.length} 个事实源</span><div><Button variant="outline" size="sm" onClick={openBatchCreate} disabled={busy}>批量创建链接</Button><Button variant="outline" size="sm" onClick={openBatchDelete} disabled={busy}>批量删除链接</Button><Button variant="ghost" size="sm" onClick={() => { setSelectedSources([]); setSelectMode(false); }}>取消选择</Button></div></div>}
              {loading ? <LoadingView /> : source ? <>
                <div className="source-head">
                  <div className="source-heading"><span className="heading-icon"><FileIcon kind={source.kind} size={23} /></span><div className="source-heading-copy"><h1>{basename(source.path)}</h1><span className="path" title={source.path}>{source.path}</span>{(source.kind === "missing" || source.kind === "symlink") && <p className="source-kind-warning">事实源 · {source.kind === "missing" ? "已缺失" : "已替换为软链接"}</p>}</div></div>
                  <div className="source-head-actions"><Button className="create-link" onClick={() => setCreateOpen(true)} disabled={busy || (source.kind !== "file" && source.kind !== "directory")}><Plus size={15} />新增链接</Button>{source.manual && source.links.length === 0 && <Button variant="ghost" size="sm" onClick={forgetSource} disabled={busy}>从列表移除</Button>}</div>
                </div>
                <SourceTagEditor source={source} busy={busy} onSave={saveTags} />
                <div className="content-section-head"><span>链接 <small>{source.links.length}</small></span><DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="sm" aria-label="筛选链接状态">{filter === "all" ? "全部状态" : filter === "healthy" ? "正常" : "需处理"}</Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onSelect={() => setFilter("all")}>全部状态</DropdownMenuItem><DropdownMenuItem onSelect={() => setFilter("healthy")}>正常</DropdownMenuItem><DropdownMenuItem onSelect={() => setFilter("issues")}>需处理</DropdownMenuItem></DropdownMenuContent></DropdownMenu></div>
                <div className="link-list"><div className="list-header"><span>项目</span><span>链接位置</span><span>状态</span></div>{shownLinks.length ? shownLinks.map((item) => <button key={item.path} type="button" className={`link-row ${link?.path === item.path ? "active" : ""}`} onClick={() => setSelectedLinkPath(item.path)} aria-label={`查看链接 ${item.project} ${item.path}`}><span className="project"><Folder size={16} aria-hidden="true" /><span className="path">{item.project}</span></span><span className="path" title={item.path}>{linkLocation(item, snapshot?.roots ?? [])}</span><Status status={item.status} /></button>) : <div className="empty-links"><LinkSimple size={19} /><strong>{source.links.length ? "此筛选条件下没有链接" : "还没有项目链接"}</strong><span>{source.links.length ? "切换状态筛选以查看其他链接" : "新增链接，将事实源用于项目"}</span></div>}</div>
              </> : <div className="empty-state"><LinkSimple size={25} /><h1>还没有事实源</h1><p>添加已有文件或文件夹，再为项目创建链接；也可以扫描项目目录，纳入已有软链接。</p><div><Button onClick={() => addSource(false)}>添加文件</Button><Button variant="outline" onClick={() => addSource(true)}>添加文件夹</Button><Button variant="outline" onClick={addRoot}>扫描目录</Button></div></div>}
            </main>
            {link && (isCompact ? <Sheet open onOpenChange={(open) => { if (!open) setSelectedLinkPath(null); }}><SheetContent side="right" showCloseButton={false} className="inspector compact-inspector"><SheetTitle className="sr-only">链接详情</SheetTitle><LinkInspector link={link} busy={busy} onClose={() => setSelectedLinkPath(null)} onReveal={reveal} onDelete={deleteLink} /></SheetContent></Sheet> : <aside className="inspector" aria-label="链接详情"><LinkInspector link={link} busy={busy} onClose={() => setSelectedLinkPath(null)} onReveal={reveal} onDelete={deleteLink} /></aside>)}
          </div>
        </div>
      {notice && <div role="status" className="fixed bottom-5 left-1/2 z-30 max-w-[calc(100vw-30px)] -translate-x-1/2 rounded-md bg-[var(--button)] px-3 py-2 text-[11px] text-[var(--button-text)] shadow-lg">{notice}</div>}
      {addSourceKind && <AddSourceDialog kind={addSourceKind} busy={busy} onClose={() => setAddSourceKind(null)} onAdd={(path) => addSourcePath(path, addSourceKind)} />}
      {scanOpen && <ScanRootDialog busy={busy} onClose={() => setScanOpen(false)} onAdd={addRootPath} />}
      {createOpen && source && <CreateLinkDialog source={source} busy={busy} onClose={() => setCreateOpen(false)} onCreate={createLink} />}
      {batchCreateOpen && <BatchCreateDialog sources={snapshot?.sources.filter((item) => batchSources.includes(item.path)) ?? []} busy={busy} onClose={() => setBatchCreateOpen(false)} onPreview={previewBatchCreate} onExecute={executeBatchCreate} />}
      {batchDeleteOpen && <BatchDeleteDialog sources={snapshot?.sources.filter((item) => batchSources.includes(item.path)) ?? []} busy={busy} onClose={() => setBatchDeleteOpen(false)} onPreview={previewBatchDelete} onExecute={executeBatchDelete} />}
      </div>
    </TooltipProvider>
  );
}

export default App;
