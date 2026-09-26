import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { FieldError, FieldGroup } from "@/components/ui/field";
import { ModalFrame, PathPickerField } from "@/components/WorkspaceFields";
import { errorText } from "@/lib/errors";
import { isAbsolutePath, pathExample, pickPath } from "@/lib/paths";
import { basename, type BatchOperationResult, type BatchPreview, type SourceView } from "@/types";
import { sourceNameCollisions } from "@/features/sources";

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

export function BatchCreateDialog({ sources, busy, onClose, onPreview, onExecute }: BatchCreateDialogProps) {
  const [sourceCount] = useState(sources.length);
  const [duplicateNames] = useState(() => sourceNameCollisions(sources));
  const [folder, setFolder] = useState("");
  const [preview, setPreview] = useState<BatchPreview | null>(null);
  const [previewFolder, setPreviewFolder] = useState<string | null>(null);
  const [operation, setOperation] = useState<BatchOperationResult | null>(null);
  const [error, setError] = useState("");
  const [pathInvalid, setPathInvalid] = useState(false);
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
        setPathInvalid(false);
      }
    } catch (cause) {
      setError(errorText(cause));
      setPathInvalid(false);
    }
  }

  async function submitPreview(event: FormEvent) {
    event.preventDefault();
    const targetFolder = folder.trim();
    if (!targetFolder) {
      setError("请输入批量创建的目标文件夹绝对路径");
      setPathInvalid(true);
      return;
    }
    if (!isAbsolutePath(targetFolder)) {
      setError("请输入目标文件夹的绝对路径，例如 C:\\workspace\\project");
      setPathInvalid(true);
      return;
    }
    setError("");
    setPathInvalid(false);
    invalidatePreview();
    const request = previewRequest.current;
    try {
      const result = await onPreview(targetFolder);
      if (request === previewRequest.current) {
        setPreview(result);
        setPreviewFolder(targetFolder);
      }
    } catch (cause) {
      if (request === previewRequest.current) {
        setError(errorText(cause));
        setPathInvalid(false);
      }
    }
  }

  async function execute() {
    if (!preview || !previewFolder || !preview.items.some((item) => item.status === "ready")) return;
    setError("");
    setPathInvalid(false);
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
      setPathInvalid(false);
    }
  }

  const readyCount = preview?.items.filter((item) => item.status === "ready").length ?? 0;

  return (
    <ModalFrame heading="批量创建链接" description={`将为 ${sourceCount} 个选中的事实源，在同一目标文件夹中创建链接。`} busy={busy} onClose={onClose} footer={<>
      <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={busy}>{operation ? "完成" : "取消"}</Button>
      {!operation && <Button type="submit" form="batch-create-form" variant={preview ? "outline" : "default"} size="sm" disabled={busy}>{preview ? "重新预览" : busy ? "正在预览…" : "预览冲突"}</Button>}
      {preview && !operation && <Button type="button" size="sm" onClick={execute} disabled={busy || readyCount === 0}>{busy ? "正在创建…" : "确认并创建"}</Button>}
    </>}>
      <form id="batch-create-form" onSubmit={submitPreview} className="mt-5 flex flex-col gap-4">
        <FieldGroup>
          <PathPickerField id="batch-target-folder" label="统一目标文件夹绝对路径" value={folder} onChange={(value) => { setFolder(value); invalidatePreview(); setError(""); setPathInvalid(false); }} onBrowse={chooseFolder} placeholder={pathExample("project")} error={pathInvalid ? error : undefined} busy={busy} autoFocus />
        </FieldGroup>
        {error && !pathInvalid && <FieldError>{error}</FieldError>}
      </form>

      {preview && (
        <section aria-label="批量创建预览" className="mt-5 min-w-0 rounded-md border border-[var(--line)] bg-[var(--base)] p-3">
          <div className="mb-2 flex items-center justify-between gap-3"><h3 className="text-[11px] font-semibold">预览结果</h3><span className="text-[10px] text-[var(--faint)]">{readyCount}/{preview.items.length} 可创建</span></div>
          <div className="min-w-0 divide-y divide-[var(--line)]">
            {preview.items.map((item) => (
              <div key={`${item.source}-${item.path}`} className="grid min-w-0 gap-1 py-2 first:pt-0 last:pb-0">
                <div className="flex min-w-0 items-center justify-between gap-3"><span className="min-w-0 break-all text-[11px] font-medium">{basename(item.source)}</span><PreviewStatus status={item.status} /></div>
                {duplicateNames.has(basename(item.source).toLocaleLowerCase()) && <span className="min-w-0 break-all text-[10px] text-[var(--muted)]">事实源：{item.source}</span>}
                <span className="min-w-0 break-all font-mono text-[10px] text-[var(--faint)]">{item.path}</span>
                <span className="min-w-0 break-words text-[10px] text-[var(--muted)]">{item.message}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {operation && (
        <section aria-label="批量创建结果" className="mt-5 min-w-0 rounded-md border border-[var(--line)] bg-[var(--base)] p-3">
          <div className="mb-2 flex items-center justify-between gap-3"><h3 className="text-[11px] font-semibold">执行结果</h3><span className="text-[10px] text-[var(--faint)]">{operation.items.filter((item) => item.success).length}/{operation.items.length} 成功</span></div>
          <div className="min-w-0 divide-y divide-[var(--line)]">
            {operation.items.map((item) => (
              <div key={`${item.source}-${item.path}`} className="grid min-w-0 gap-1 py-2 first:pt-0 last:pb-0">
                <div className="flex min-w-0 items-center justify-between gap-3"><span className="min-w-0 break-all text-[11px] font-medium">{basename(item.source)}</span><span className={`shrink-0 text-[10px] ${item.success ? "text-[var(--muted)]" : "text-[var(--warn)]"}`}>{item.success ? "成功" : "失败"}</span></div>
                {duplicateNames.has(basename(item.source).toLocaleLowerCase()) && <span className="min-w-0 break-all text-[10px] text-[var(--muted)]">事实源：{item.source}</span>}
                <span className="min-w-0 break-all font-mono text-[10px] text-[var(--faint)]">{item.path}</span>
                <span className="min-w-0 break-words text-[10px] text-[var(--muted)]">{item.message}</span>
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

export function BatchDeleteDialog({ sources, busy, onClose, onPreview, onExecute }: BatchDeleteDialogProps) {
  const [sourceCount] = useState(sources.length);
  const [duplicateNames] = useState(() => sourceNameCollisions(sources));
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
    <ModalFrame heading="批量删除链接" description={`将检查 ${sourceCount} 个选中事实源的所有受管理链接，只删除安全可确认的软链接。`} busy={busy} onClose={onClose} footer={<>
      <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={busy}>{operation ? "完成" : "取消"}</Button>
      {error && !preview && <Button type="button" size="sm" onClick={loadPreview} disabled={busy}>重试预览</Button>}
      {preview && !operation && <Button type="button" variant="outline" size="sm" onClick={loadPreview} disabled={busy}>重新预览</Button>}
      {preview && !operation && <Button type="button" size="sm" onClick={execute} disabled={busy || readyCount === 0}>{busy ? "正在删除…" : "确认并删除"}</Button>}
    </>}>
      {error && <p role="alert" className="mt-5 text-[11px] text-[var(--warn)]">{error}</p>}
      {!preview && !error && <p className="mt-5 text-[11px] text-[var(--muted)]">正在预览可删除的链接…</p>}
      {preview && (
        <section aria-label="批量删除预览" className="mt-5 min-w-0 rounded-md border border-[var(--line)] bg-[var(--base)] p-3">
          <div className="mb-2 flex items-center justify-between gap-3"><h3 className="text-[11px] font-semibold">预览结果</h3><span className="text-[10px] text-[var(--faint)]">{readyCount}/{preview.items.length} 可删除</span></div>
          {preview.items.length ? <div className="min-w-0 divide-y divide-[var(--line)]">
            {preview.items.map((item) => (
              <div key={`${item.source}-${item.path}`} className="grid min-w-0 gap-1 py-2 first:pt-0 last:pb-0">
                <div className="flex min-w-0 items-center justify-between gap-3"><span className="min-w-0 break-all text-[11px] font-medium">{basename(item.source)}</span><PreviewStatus status={item.status} /></div>
                {duplicateNames.has(basename(item.source).toLocaleLowerCase()) && <span className="min-w-0 break-all text-[10px] text-[var(--muted)]">事实源：{item.source}</span>}
                <span className="min-w-0 break-all font-mono text-[10px] text-[var(--faint)]">{item.path}</span>
                <span className="min-w-0 break-words text-[10px] text-[var(--muted)]">{item.message}</span>
              </div>
            ))}
          </div> : <p className="py-3 text-[10px] text-[var(--faint)]">选中的事实源没有受管理链接。</p>}
        </section>
      )}
      {operation && (
        <section aria-label="批量删除结果" className="mt-5 min-w-0 rounded-md border border-[var(--line)] bg-[var(--base)] p-3">
          <div className="mb-2 flex items-center justify-between gap-3"><h3 className="text-[11px] font-semibold">执行结果</h3><span className="text-[10px] text-[var(--faint)]">{operation.items.filter((item) => item.success).length}/{operation.items.length} 成功</span></div>
          <div className="min-w-0 divide-y divide-[var(--line)]">
            {operation.items.map((item) => (
              <div key={`${item.source}-${item.path}`} className="grid min-w-0 gap-1 py-2 first:pt-0 last:pb-0">
                <div className="flex min-w-0 items-center justify-between gap-3"><span className="min-w-0 break-all text-[11px] font-medium">{basename(item.source)}</span><span className={`shrink-0 text-[10px] ${item.success ? "text-[var(--muted)]" : "text-[var(--warn)]"}`}>{item.success ? "成功" : "失败"}</span></div>
                {duplicateNames.has(basename(item.source).toLocaleLowerCase()) && <span className="min-w-0 break-all text-[10px] text-[var(--muted)]">事实源：{item.source}</span>}
                <span className="min-w-0 break-all font-mono text-[10px] text-[var(--faint)]">{item.path}</span>
                <span className="min-w-0 break-words text-[10px] text-[var(--muted)]">{item.message}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </ModalFrame>
  );
}
