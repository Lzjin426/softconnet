import { Plus } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { basename, type SourceView } from "@/types";
import { SourceIcon } from "./SourceIcon";
import { SourceTagEditor } from "./SourceDialogs";

interface SourceDetailProps {
  source: SourceView;
  busy: boolean;
  outsideFilter: boolean;
  onClearFilter: () => void;
  onCreateLink: () => void;
  onForgetSource: () => void;
  onSaveTags: (tags: string[]) => Promise<void>;
}

export function SourceDetail({ source, busy, outsideFilter, onClearFilter, onCreateLink, onForgetSource, onSaveTags }: SourceDetailProps) {
  return <>
    {outsideFilter && <div className="filter-context"><span>当前事实源不在搜索或标签筛选结果中</span><Button variant="ghost" size="xs" onClick={onClearFilter}>清除筛选</Button></div>}
    <div className="source-head">
      <div className="source-heading"><span className="heading-icon"><SourceIcon kind={source.kind} size={23} /></span><div className="source-heading-copy"><h1>{basename(source.path)}</h1><span className="path" title={source.path}>{source.path}</span>{(source.kind === "missing" || source.kind === "symlink") && <p className="source-kind-warning">事实源 · {source.kind === "missing" ? "已缺失" : "已替换为软链接"}</p>}</div></div>
      <div className="source-head-actions"><Button className="create-link" onClick={onCreateLink} disabled={busy || (source.kind !== "file" && source.kind !== "directory")}><Plus size={15} />新增链接</Button>{source.manual && source.links.length === 0 && <Button variant="ghost" size="sm" onClick={onForgetSource} disabled={busy}>从列表移除</Button>}</div>
    </div>
    <SourceTagEditor source={source} busy={busy} onSave={onSaveTags} />
  </>;
}
