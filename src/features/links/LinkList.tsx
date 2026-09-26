import { useState } from "react";
import { Folder, LinkSimple } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { LinkView, SourceView } from "@/types";
import { Status } from "./LinkViews";

function linkLocation(link: LinkView, roots: string[]) {
  const root = roots.filter((item) => link.path.startsWith(`${item.replace(/[\\/]$/, "")}/`) || link.path.startsWith(`${item.replace(/[\\/]$/, "")}\\`)).sort((a, b) => b.length - a.length)[0];
  return root ? link.path.slice(root.length).replace(/^[\\/]/, "") : link.path;
}

interface LinkListProps {
  source: SourceView;
  roots: string[];
  selectedLinkPath: string | null;
  onSelectLink: (path: string) => void;
}

export function LinkList({ source, roots, selectedLinkPath, onSelectLink }: LinkListProps) {
  const [filter, setFilter] = useState<"all" | "healthy" | "issues">("all");
  const shownLinks = source.links.filter((item) => filter === "all" || (filter === "healthy" ? item.status === "healthy" : item.status !== "healthy"));

  return <>
    <div className="content-section-head"><span>链接 <small>{source.links.length}</small></span><DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="sm" aria-label="筛选链接状态">{filter === "all" ? "全部状态" : filter === "healthy" ? "正常" : "需处理"}</Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onSelect={() => setFilter("all")}>全部状态</DropdownMenuItem><DropdownMenuItem onSelect={() => setFilter("healthy")}>正常</DropdownMenuItem><DropdownMenuItem onSelect={() => setFilter("issues")}>需处理</DropdownMenuItem></DropdownMenuContent></DropdownMenu></div>
    <div className="link-list"><div className="list-header"><span>项目</span><span>链接位置</span><span>状态</span></div>{shownLinks.length ? shownLinks.map((item) => <button key={item.path} type="button" className={`link-row ${selectedLinkPath === item.path ? "active" : ""}`} onClick={() => onSelectLink(item.path)} aria-label={`查看链接 ${item.project} ${item.path}`}><span className="project"><Folder size={16} aria-hidden="true" /><span className="path">{item.project}</span></span><span className="path" title={item.path}>{linkLocation(item, roots)}</span><Status status={item.status} /></button>) : <div className="empty-links"><LinkSimple size={19} /><strong>{source.links.length ? "此筛选条件下没有链接" : "还没有项目链接"}</strong><span>{source.links.length ? "切换状态筛选以查看其他链接" : "新增链接，将事实源用于项目"}</span></div>}</div>
  </>;
}
