import { useEffect, useState, type FormEvent } from "react";
import { Tag } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { FieldError, FieldGroup } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ModalFrame, PathPickerField } from "@/components/WorkspaceFields";
import { errorText } from "@/lib/errors";
import { isAbsolutePath, pathExample, pickPath } from "@/lib/paths";
import type { SourceView } from "@/types";

function parseTags(value: string): string[] {
  return Array.from(new Set(value.split(/[\n,，]/).map((tag) => tag.trim()).filter(Boolean)));
}

interface AddSourceDialogProps {
  kind: "file" | "directory";
  busy: boolean;
  onClose: () => void;
  onAdd: (path: string) => Promise<void>;
}

export function AddSourceDialog({ kind, busy, onClose, onAdd }: AddSourceDialogProps) {
  const [path, setPath] = useState("");
  const [error, setError] = useState("");
  const [pathInvalid, setPathInvalid] = useState(false);

  async function choosePath() {
    try {
      const result = await pickPath(kind === "directory");
      if (result) {
        setPath(result);
        setError("");
        setPathInvalid(false);
      }
    } catch (cause) {
      setError(errorText(cause));
      setPathInvalid(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const value = path.trim();
    if (!value) {
      setError("请输入事实源的绝对路径");
      setPathInvalid(true);
      return;
    }
    if (!isAbsolutePath(value)) {
      setError("请输入绝对路径，例如 C:\\workspace\\notes 或 /workspace/notes");
      setPathInvalid(true);
      return;
    }
    setError("");
    setPathInvalid(false);
    try {
      await onAdd(value);
      onClose();
    } catch (cause) {
      setError(errorText(cause));
      setPathInvalid(false);
    }
  }

  return (
    <ModalFrame heading={kind === "directory" ? "添加文件夹事实源" : "添加文件事实源"} description="事实源保留在原位置，路径可以直接手输，也可以从文件管理器选择。" busy={busy} onClose={onClose}>
      <form onSubmit={submit} className="mt-5 flex flex-col gap-4">
        <FieldGroup>
          <PathPickerField id="source-path-input" label="事实源绝对路径" value={path} onChange={(value) => { setPath(value); setError(""); setPathInvalid(false); }} onBrowse={choosePath} placeholder={pathExample(kind === "directory" ? "notes" : "shared.md")} error={pathInvalid ? error : undefined} busy={busy} autoFocus />
        </FieldGroup>
        {error && !pathInvalid && <FieldError>{error}</FieldError>}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={busy}>取消</Button>
          <Button type="submit" size="sm" disabled={busy}>{busy ? "正在添加…" : "添加事实源"}</Button>
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

export function ScanRootDialog({ busy, onClose, onAdd }: ScanRootDialogProps) {
  const [path, setPath] = useState("");
  const [error, setError] = useState("");
  const [pathInvalid, setPathInvalid] = useState(false);

  async function choosePath() {
    try {
      const result = await pickPath(true);
      if (result) {
        setPath(result);
        setError("");
        setPathInvalid(false);
      }
    } catch (cause) {
      setError(errorText(cause));
      setPathInvalid(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const value = path.trim();
    if (!value) {
      setError("请输入扫描目录的绝对路径");
      setPathInvalid(true);
      return;
    }
    if (!isAbsolutePath(value)) {
      setError("请输入扫描目录的绝对路径，例如 C:\\workspace\\projects");
      setPathInvalid(true);
      return;
    }
    setError("");
    setPathInvalid(false);
    try {
      await onAdd(value);
      onClose();
    } catch (cause) {
      setError(errorText(cause));
      setPathInvalid(false);
    }
  }

  return (
    <ModalFrame heading="添加扫描目录" description="扫描目录用于发现已有软链接，不会移动或修改目录中的内容。" busy={busy} onClose={onClose}>
      <form onSubmit={submit} className="mt-5 flex flex-col gap-4">
        <FieldGroup>
          <PathPickerField id="scan-path-input" label="扫描目录绝对路径" value={path} onChange={(value) => { setPath(value); setError(""); setPathInvalid(false); }} onBrowse={choosePath} placeholder={pathExample("projects")} error={pathInvalid ? error : undefined} busy={busy} autoFocus />
        </FieldGroup>
        {error && !pathInvalid && <FieldError>{error}</FieldError>}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={busy}>取消</Button>
          <Button type="submit" size="sm" disabled={busy}>{busy ? "正在扫描…" : "开始扫描"}</Button>
        </div>
      </form>
    </ModalFrame>
  );
}

interface SourceTagEditorProps {
  source: SourceView;
  busy: boolean;
  onSave: (tags: string[]) => Promise<void>;
}

export function SourceTagEditor({ source, busy, onSave }: SourceTagEditorProps) {
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
