import { ArrowSquareOut, Check, Trash, WarningCircle, X } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { statusText, type LinkView } from "@/types";

export function Status({ status }: { status: LinkView["status"] }) {
  const bad = status !== "healthy";
  return (
    <span className={`link-status ${bad ? "problem" : "healthy"}`}>
      {bad ? <WarningCircle size={14} aria-hidden="true" /> : <Check size={14} aria-hidden="true" />}
      {statusText[status]}
    </span>
  );
}

export function LinkInspector({ link, busy, onClose, onReveal, onDelete }: {
  link: LinkView;
  busy: boolean;
  onClose: () => void;
  onReveal: (path: string) => void;
  onDelete: () => void;
}) {
  const unsafeToDelete = ["replaced", "link_missing", "retargeted"].includes(link.status);
  return <>
    <div className="inspector-top"><span>链接详情</span><Button variant="ghost" size="icon-sm" aria-label="关闭详情" onClick={onClose}><X size={15} /></Button></div>
    <h2>{link.project}</h2>
    <Status status={link.status} />
    <div className="inspector-field"><small>链接位置</small><p>{link.path}</p></div>
    <div className="inspector-field"><small>指向事实源</small><p>{link.target}</p></div>
    {link.status !== "healthy" && <div className="inspector-field"><small>状态说明</small><strong className="problem">{statusText[link.status]}</strong></div>}
    <div className="inspector-actions">
      <Button variant="outline" size="sm" onClick={() => onReveal(link.path)}><ArrowSquareOut size={15} />显示位置</Button>
      <Button variant="ghost" size="sm" disabled={busy || unsafeToDelete} onClick={onDelete} title={unsafeToDelete ? "此位置已改变，请先人工检查" : "只删除软链接"}><Trash size={15} />删除链接</Button>
    </div>
    <p className="inspector-note">删除只作用于软链接，事实源保持不变。</p>
  </>;
}
