import { useState } from "react";
import type { WorkspaceCommands } from "@/hooks/useWorkspaceCommands";
import type { BatchOperationResult, BatchPreview } from "@/types";

export function useBatchActions(commands: WorkspaceCommands, selectedSources: string[]) {
  const { call, setSnapshot, setNotice } = commands;
  const [batchSources, setBatchSources] = useState<string[]>([]);
  const [batchCreateOpen, setBatchCreateOpen] = useState(false);
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false);

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

  return {
    batchSources, batchCreateOpen, setBatchCreateOpen, batchDeleteOpen, setBatchDeleteOpen,
    openBatchCreate, openBatchDelete, previewBatchCreate, executeBatchCreate, previewBatchDelete, executeBatchDelete,
  };
}
