import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ModalFrame, PathPickerField } from "@/components/WorkspaceFields";
import { errorText } from "@/lib/errors";
import { isAbsolutePath, pathExample, pickPath } from "@/lib/paths";
import { basename, type SourceView } from "@/types";

interface CreateLinkDialogProps {
  source: SourceView;
  busy: boolean;
  onClose: () => void;
  onCreate: (folder: string, name: string) => Promise<void>;
}

export function CreateLinkDialog({ source, busy, onClose, onCreate }: CreateLinkDialogProps) {
  const [folder, setFolder] = useState("");
  const [name, setName] = useState(basename(source.path));
  const [error, setError] = useState("");
  const [errorField, setErrorField] = useState<"folder" | "name" | null>(null);

  async function chooseFolder() {
    try {
      const result = await pickPath(true);
      if (result) {
        setFolder(result);
        setError("");
        setErrorField(null);
      }
    } catch (cause) {
      setError(errorText(cause));
      setErrorField(null);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const targetFolder = folder.trim();
    if (!targetFolder) {
      setError("请输入目标文件夹的绝对路径");
      setErrorField("folder");
      return;
    }
    if (!isAbsolutePath(targetFolder)) {
      setError("请输入目标文件夹的绝对路径，例如 C:\\workspace\\project");
      setErrorField("folder");
      return;
    }
    if (!name.trim()) {
      setError("请输入链接名称");
      setErrorField("name");
      return;
    }
    setError("");
    setErrorField(null);
    try {
      await onCreate(targetFolder, name.trim());
    } catch (cause) {
      setError(errorText(cause));
      setErrorField(null);
    }
  }

  return (
    <ModalFrame heading="新增链接" description="事实源保持在原位置，只在项目中创建入口。" busy={busy} onClose={onClose}>
      <form onSubmit={submit} className="mt-5 flex flex-col gap-4">
        <FieldGroup className="gap-4">
          <Field>
            <FieldLabel htmlFor="source-path">事实源</FieldLabel>
            <Input id="source-path" value={source.path} readOnly />
          </Field>
          <PathPickerField id="target-folder" label="目标文件夹绝对路径" value={folder} onChange={(value) => { setFolder(value); setError(""); setErrorField(null); }} onBrowse={chooseFolder} placeholder={pathExample("project")} error={errorField === "folder" ? error : undefined} busy={busy} autoFocus />
          <Field data-invalid={errorField === "name"}>
            <FieldLabel htmlFor="link-name">链接名称</FieldLabel>
            <Input id="link-name" value={name} onChange={(event) => { setName(event.target.value); setError(""); setErrorField(null); }} aria-invalid={errorField === "name"} aria-describedby={errorField === "name" ? "link-name-description link-name-error" : "link-name-description"} />
            <FieldDescription id="link-name-description">目标位置若已有同名文件或链接，应用会拒绝覆盖。</FieldDescription>
            {errorField === "name" && <FieldError id="link-name-error">{error}</FieldError>}
          </Field>
        </FieldGroup>
        {error && errorField === null && <FieldError>{error}</FieldError>}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={busy}>取消</Button>
          <Button type="submit" size="sm" disabled={busy}>{busy ? "正在创建…" : "创建链接"}</Button>
        </div>
      </form>
    </ModalFrame>
  );
}
