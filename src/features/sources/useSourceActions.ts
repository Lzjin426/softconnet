import { useState } from "react";
import { errorText } from "@/lib/errors";
import type { WorkspaceCommands } from "@/hooks/useWorkspaceCommands";
import type { SourceSelection } from "./useSourceSelection";

export function useSourceActions(commands: WorkspaceCommands, selection: SourceSelection, clearLink: () => void) {
  const { snapshot, runSnapshot, setError } = commands;
  const { source, setSelectedSourcePath, setSelectedSources } = selection;
  const [addSourceKind, setAddSourceKind] = useState<"file" | "directory" | null>(null);
  const [scanOpen, setScanOpen] = useState(false);

  async function addSourcePath(path: string, expectedKind: "file" | "directory") {
    const previousPaths = new Set(snapshot?.sources.map((item) => item.path) ?? []);
    const result = await runSnapshot("add_source", { path, expectedKind }, "已添加事实源");
    const addedPath = result.selectedSourcePath ?? result.sources.find((item) => !previousPaths.has(item.path))?.path;
    if (addedPath) setSelectedSourcePath(addedPath);
    clearLink();
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

  return {
    addSourceKind, setAddSourceKind, scanOpen, setScanOpen,
    openAddSource: (directory: boolean) => setAddSourceKind(directory ? "directory" : "file"),
    openScan: () => setScanOpen(true), addSourcePath, addRootPath, removeRoot, forgetSource, saveTags,
  };
}
