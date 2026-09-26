import { useState } from "react";
import { confirm } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { errorText } from "@/lib/errors";
import type { WorkspaceCommands } from "@/hooks/useWorkspaceCommands";
import type { SourceView } from "@/types";

export function useLinkActions(commands: WorkspaceCommands, source: SourceView | null) {
  const { snapshot, runSnapshot, setError } = commands;
  const [selectedLinkPath, setSelectedLinkPath] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const link = source?.links.find((item) => item.path === selectedLinkPath) ?? null;

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

  async function reveal(path: string) {
    try {
      await revealItemInDir(path);
    } catch (cause) {
      setError(`无法在文件管理器中显示：${errorText(cause)}`);
    }
  }

  return { link, selectedLinkPath, setSelectedLinkPath, createOpen, setCreateOpen, createLink, deleteLink, reveal, clearLink: () => setSelectedLinkPath(null) };
}
