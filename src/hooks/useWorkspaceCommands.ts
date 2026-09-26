import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { errorText } from "@/lib/errors";
import type { Snapshot } from "@/types";

export function useWorkspaceCommands() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let live = true;
    setLoading(true);
    setLoadError("");
    invoke<Snapshot>("get_snapshot")
      .then((result) => { if (live) setSnapshot(result); })
      .catch((cause) => { if (live) setLoadError(errorText(cause)); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [loadAttempt]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 3200);
    return () => window.clearTimeout(timer);
  }, [notice]);

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

  return {
    snapshot, setSnapshot, loading, loadError, busy, error, setError, notice, setNotice,
    retryLoad: () => setLoadAttempt((value) => value + 1), call, runSnapshot,
  };
}

export type WorkspaceCommands = ReturnType<typeof useWorkspaceCommands>;
