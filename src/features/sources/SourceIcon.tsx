import { FileText, Folder } from "@phosphor-icons/react";
import type { SourceView } from "@/types";

export function SourceIcon({ kind, size = 16 }: { kind: SourceView["kind"]; size?: number }) {
  return kind === "directory" ? (
    <Folder size={size} weight="regular" aria-hidden="true" />
  ) : (
    <FileText size={size} weight="regular" aria-hidden="true" />
  );
}
