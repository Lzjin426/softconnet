import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useWorkspaceCommands } from "@/hooks/useWorkspaceCommands";
import {
  ArrowClockwise,
  LinkSimple,
  Moon,
  SidebarSimple,
  Sun,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { BatchCreateDialog, BatchDeleteDialog } from "@/features/batch/BatchDialogs";
import { BatchBar } from "@/features/batch/BatchBar";
import { useBatchActions } from "@/features/batch/useBatchActions";
import { CreateLinkDialog } from "@/features/links/CreateLinkDialog";
import { LinkInspector } from "@/features/links/LinkViews";
import { LinkList } from "@/features/links/LinkList";
import { useLinkActions } from "@/features/links/useLinkActions";
import { AddSourceDialog, ScanRootDialog } from "@/features/sources/SourceDialogs";
import { SourceDetail } from "@/features/sources/SourceDetail";
import { SourceSidebar } from "@/features/sources/SourceSidebar";
import { useSourceSelection } from "@/features/sources/useSourceSelection";
import { useSourceActions } from "@/features/sources/useSourceActions";

function LoadingView() {
  return (
    <div className="source-loading" aria-label="正在读取链接">
      <Skeleton className="h-5 w-52" />
      <Skeleton className="mt-3 h-3 w-80 max-w-full" />
      <div className="mt-12 space-y-3">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    </div>
  );
}

function useViewportWidth() {
  const [width, setWidth] = useState(() => window.innerWidth);
  useEffect(() => {
    const update = () => setWidth(window.innerWidth);
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  return width;
}

function App() {
  const commands = useWorkspaceCommands();
  const { snapshot, loading, loadError, busy, error, setError, notice, retryLoad, runSnapshot } = commands;
  const selection = useSourceSelection(snapshot);
  const { source, selectedSources, setSelectedSourcePath, setQuery, setTagFilter, sourceOutsideFilter } = selection;
  const links = useLinkActions(commands, source);
  const { link, selectedLinkPath, setSelectedLinkPath, createOpen, setCreateOpen, createLink, deleteLink, reveal } = links;
  const sources = useSourceActions(commands, selection, links.clearLink);
  const { addSourceKind, setAddSourceKind, scanOpen, setScanOpen, openAddSource, openScan, addSourcePath, addRootPath, removeRoot, forgetSource, saveTags } = sources;
  const batch = useBatchActions(commands, selectedSources);
  const { batchSources, batchCreateOpen, setBatchCreateOpen, batchDeleteOpen, setBatchDeleteOpen, openBatchCreate, openBatchDelete, previewBatchCreate, executeBatchCreate, previewBatchDelete, executeBatchDelete } = batch;
  const [sideOpen, setSideOpen] = useState(true);
  const [mobileSideOpen, setMobileSideOpen] = useState(false);
  const [theme, setTheme] = useState<"dark" | "light">(() => localStorage.getItem("softconnet-theme") === "dark" ? "dark" : "light");
  const searchRef = useRef<HTMLInputElement>(null);
  const viewportWidth = useViewportWidth();
  const isMobile = viewportWidth <= 760;
  const isCompact = viewportWidth <= 1100;
  const sidebarVisible = isMobile ? mobileSideOpen : sideOpen;

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem("softconnet-theme", theme);
  }, [theme]);

  useEffect(() => {
    document.documentElement.classList.toggle("macos-overlay", /Mac/.test(navigator.platform) && "__TAURI_INTERNALS__" in window);
  }, []);

  useEffect(() => {
    if (/Mac/.test(navigator.platform) && "__TAURI_INTERNALS__" in window) {
      void invoke("set_sidebar_drag_state", { open: sideOpen });
    }
  }, [sideOpen]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
        event.preventDefault();
        if (window.innerWidth <= 760) setMobileSideOpen(true);
        else setSideOpen(true);
        window.requestAnimationFrame(() => searchRef.current?.focus());
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  async function refresh() {
    try {
      await runSnapshot("get_snapshot", undefined, "链接状态已刷新");
    } catch {
      // The request hook keeps the error visible in the workspace.
    }
  }

  function chooseSource(path: string) {
    setSelectedSourcePath(path);
    setSelectedLinkPath(null);
    if (isMobile) setMobileSideOpen(false);
  }

  const sidebar = <SourceSidebar selection={selection} snapshot={snapshot} loading={loading} loadError={loadError} busy={busy} isMobile={isMobile} searchRef={searchRef} onCloseMobile={() => setMobileSideOpen(false)} onChooseSource={chooseSource} onAddSource={openAddSource} onAddRoot={openScan} onRemoveRoot={removeRoot} />;

  return (
    <TooltipProvider>
      <div className={`app ${!sidebarVisible ? "side-collapsed" : ""} ${link && !isCompact ? "inspector-open" : ""}`}>
        <div className="window-chrome" data-tauri-drag-region>
          <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon-sm" className="sidebar-toggle" aria-label={sidebarVisible ? "收起侧栏" : "展开侧栏"} aria-expanded={sidebarVisible} onClick={() => isMobile ? setMobileSideOpen((value) => !value) : setSideOpen((value) => !value)}><SidebarSimple size={17} /></Button></TooltipTrigger><TooltipContent>{sidebarVisible ? "收起侧栏" : "展开侧栏"}</TooltipContent></Tooltip>
        </div>
        {isMobile ? <Sheet open={mobileSideOpen} onOpenChange={setMobileSideOpen}><SheetContent side="left" showCloseButton={false} className="sidebar mobile-sidebar"><SheetTitle className="sr-only">事实源</SheetTitle>{sidebar}</SheetContent></Sheet> : sideOpen && <aside className="sidebar">{sidebar}</aside>}
        <div className="workspace">
          <header className="topbar" data-tauri-drag-region>
            <span className="top-label">事实源</span>
            <div className="top-right flex items-center gap-1">
              <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon-sm" onClick={refresh} disabled={busy || loading || Boolean(loadError)} aria-label="刷新链接状态"><ArrowClockwise size={16} className={busy ? "animate-spin" : ""} /></Button></TooltipTrigger><TooltipContent>刷新链接状态</TooltipContent></Tooltip>
              <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon-sm" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} aria-label="切换外观">{theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}</Button></TooltipTrigger><TooltipContent>切换外观</TooltipContent></Tooltip>
            </div>
          </header>
          {error && <div role="alert" className="notice-line"><WarningCircle size={15} /><span>{error}</span><Button variant="ghost" size="icon-xs" onClick={() => setError("")} aria-label="关闭错误提示"><X size={13} /></Button></div>}
          {snapshot?.scanWarnings.map((warning) => <div key={warning} role="status" className="notice-line">{warning}</div>)}
          <div className="work-area">
            <main className="content">
              <BatchBar count={selectedSources.length} busy={busy} onCreate={openBatchCreate} onDelete={openBatchDelete} onCancel={selection.clearSelection} />
              {loading ? <LoadingView /> : loadError ? <div className="empty-state" role="alert"><WarningCircle size={25} /><h1>无法读取事实源</h1><p>{loadError}</p><Button onClick={retryLoad}>重试读取</Button></div> : source ? <>
                <SourceDetail source={source} busy={busy} outsideFilter={sourceOutsideFilter} onClearFilter={() => { setQuery(""); setTagFilter(""); }} onCreateLink={() => setCreateOpen(true)} onForgetSource={forgetSource} onSaveTags={saveTags} />
                <LinkList key={source.path} source={source} roots={snapshot?.roots ?? []} selectedLinkPath={selectedLinkPath} onSelectLink={setSelectedLinkPath} />
              </> : <div className="empty-state"><LinkSimple size={25} /><h1>还没有事实源</h1><p>添加已有文件或文件夹，再为项目创建链接；也可以扫描项目目录，纳入已有软链接。</p><div><Button onClick={() => openAddSource(false)}>添加文件</Button><Button variant="outline" onClick={() => openAddSource(true)}>添加文件夹</Button><Button variant="outline" onClick={openScan}>扫描目录</Button></div></div>}
            </main>
            {link && (isCompact ? <Sheet open onOpenChange={(open) => { if (!open) setSelectedLinkPath(null); }}><SheetContent side="right" showCloseButton={false} className="inspector compact-inspector"><SheetTitle className="sr-only">链接详情</SheetTitle><LinkInspector link={link} busy={busy} onClose={() => setSelectedLinkPath(null)} onReveal={reveal} onDelete={deleteLink} /></SheetContent></Sheet> : <aside className="inspector" aria-label="链接详情"><LinkInspector link={link} busy={busy} onClose={() => setSelectedLinkPath(null)} onReveal={reveal} onDelete={deleteLink} /></aside>)}
          </div>
        </div>
      {notice && <div role="status" className="fixed bottom-5 left-1/2 z-30 max-w-[calc(100vw-30px)] -translate-x-1/2 rounded-md bg-[var(--button)] px-3 py-2 text-[11px] text-[var(--button-text)] shadow-lg">{notice}</div>}
      {addSourceKind && <AddSourceDialog kind={addSourceKind} busy={busy} onClose={() => setAddSourceKind(null)} onAdd={(path) => addSourcePath(path, addSourceKind)} />}
      {scanOpen && <ScanRootDialog busy={busy} onClose={() => setScanOpen(false)} onAdd={addRootPath} />}
      {createOpen && source && <CreateLinkDialog source={source} busy={busy} onClose={() => setCreateOpen(false)} onCreate={createLink} />}
      {batchCreateOpen && <BatchCreateDialog sources={snapshot?.sources.filter((item) => batchSources.includes(item.path)) ?? []} busy={busy} onClose={() => setBatchCreateOpen(false)} onPreview={previewBatchCreate} onExecute={executeBatchCreate} />}
      {batchDeleteOpen && <BatchDeleteDialog sources={snapshot?.sources.filter((item) => batchSources.includes(item.path)) ?? []} busy={busy} onClose={() => setBatchDeleteOpen(false)} onPreview={previewBatchDelete} onExecute={executeBatchDelete} />}
      </div>
    </TooltipProvider>
  );
}

export default App;
