import type { RefObject } from "react";
import { Folder, MagnifyingGlass, Plus, SidebarSimple, X } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Kbd } from "@/components/ui/kbd";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { basename, dirname, type Snapshot } from "@/types";
import { SourceIcon } from "./SourceIcon";
import { sourceHasIssue } from "./identity";
import type { SourceSelection } from "./useSourceSelection";

function shortHome(path: string) {
  return path.replace(/^\/Users\/[^/]+/, "~");
}

interface SourceSidebarProps {
  selection: SourceSelection;
  snapshot: Snapshot | null;
  loading: boolean;
  loadError: string;
  busy: boolean;
  isMobile: boolean;
  searchRef: RefObject<HTMLInputElement | null>;
  onCloseMobile: () => void;
  onChooseSource: (path: string) => void;
  onAddSource: (directory: boolean) => void;
  onAddRoot: () => void;
  onRemoveRoot: (path: string) => void;
}

export function SourceSidebar({ selection, snapshot, loading, loadError, busy, isMobile, searchRef, onCloseMobile, onChooseSource, onAddSource, onAddRoot, onRemoveRoot }: SourceSidebarProps) {
  const { source, query, setQuery, tagFilter, setTagFilter, selectedSources, setSelectedSources, selectMode, setSelectMode, allTags, shownSources, duplicateSourceNames, visibleSourcePaths, allVisibleSelected, toggleSource, selectVisibleSources, clearVisibleSources } = selection;
  return (
    <>
      {isMobile && <div className="sidebar-header"><Button variant="ghost" size="icon-sm" aria-label="收起侧栏" onClick={() => onCloseMobile()}><SidebarSimple size={17} /></Button></div>}
      <InputGroup className="sidebar-search">
        <InputGroupInput ref={searchRef} value={query} onChange={(event) => { setQuery(event.target.value); setSelectedSources([]); }} placeholder="搜索事实源" aria-label="搜索事实源" disabled={loading || Boolean(loadError)} />
        <InputGroupAddon align="inline-start"><MagnifyingGlass aria-hidden="true" /></InputGroupAddon>
        <InputGroupAddon align="inline-end"><Kbd>⌘ K</Kbd></InputGroupAddon>
      </InputGroup>
      <div className="group-title">
        <span>事实源 <small>{snapshot?.sources.length ?? (loading || loadError ? "—" : 0)}</small></span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label="添加事实源" disabled={loading || Boolean(loadError)}><Plus size={15} /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => onAddSource(false)}>添加文件</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onAddSource(true)}>添加文件夹</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => { if (selectMode) setSelectedSources([]); setSelectMode(!selectMode); }}>{selectMode ? "完成选择" : "批量选择"}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {allTags.length > 0 && <div className="sidebar-filter">
        <Select value={tagFilter || "all"} onValueChange={(value) => { setTagFilter(value === "all" ? "" : value); setSelectedSources([]); }}>
          <SelectTrigger aria-label="按标签筛选"><SelectValue placeholder="全部标签" /></SelectTrigger>
          <SelectContent><SelectItem value="all">全部标签</SelectItem>{allTags.map((tag) => <SelectItem key={tag} value={tag}>{tag}</SelectItem>)}</SelectContent>
        </Select>
      </div>}
      {selectMode && <div className="selection-bar"><span>选择事实源</span><Button variant="ghost" size="xs" onClick={allVisibleSelected ? clearVisibleSources : selectVisibleSources} disabled={!visibleSourcePaths.length}>{allVisibleSelected ? "取消全选" : "全选"}</Button></div>}
      <nav className="source-nav" aria-label="事实源列表">
        {shownSources.map((item) => {
          const duplicate = duplicateSourceNames.has(basename(item.path).toLocaleLowerCase());
          return <div key={item.path} className={`source-item ${item.path === source?.path ? "current" : ""}`} title={item.path}>
          {selectMode && <Checkbox aria-label={`选择事实源 ${duplicate ? item.path : basename(item.path)}`} checked={selectedSources.includes(item.path)} onCheckedChange={() => toggleSource(item.path)} />}
          <button type="button" className="source-open" aria-label={`打开事实源 ${duplicate ? item.path : basename(item.path)}${sourceHasIssue(item) ? "，有需处理的链接" : ""}`} onClick={() => onChooseSource(item.path)}>
            <SourceIcon kind={item.kind} size={16} /><span className="source-identity"><span className="source-name">{basename(item.path)}</span>{duplicate && <span className="source-parent path">{dirname(item.path)}</span>}</span>
            {sourceHasIssue(item) && <span className="source-warning" aria-hidden="true" />}
            <span className="source-count">{item.links.length}</span>
          </button>
        </div>; })}
        {!loading && !loadError && query && !shownSources.length && <p className="empty-search">没有匹配的事实源</p>}
        {!loading && !loadError && !query && tagFilter && !shownSources.length && <p className="empty-search">这个标签下没有事实源</p>}
      </nav>
      <div className="sidebar-bottom">
        <div className="group-title"><span>扫描目录 <small>{snapshot?.roots.length ?? (loading || loadError ? "—" : 0)}</small></span><Button variant="ghost" size="icon-sm" onClick={onAddRoot} disabled={busy || loading || Boolean(loadError)} aria-label="添加扫描目录"><Plus size={15} /></Button></div>
        {snapshot?.roots.map((root) => <div key={root} className="root-item" title={root}><Folder size={15} /><span className="path">{shortHome(root)}</span><Button variant="ghost" size="icon-xs" onClick={() => onRemoveRoot(root)} disabled={busy} aria-label={`移除扫描目录 ${root}`}><X size={13} /></Button></div>)}
        {!snapshot?.roots.length && !loading && !loadError && <Button variant="ghost" size="sm" onClick={onAddRoot}>选择项目目录以发现已有链接</Button>}
      </div>
    </>
  );

}
