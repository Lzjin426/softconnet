import { Button } from "@/components/ui/button";

interface BatchBarProps {
  count: number;
  busy: boolean;
  onCreate: () => void;
  onDelete: () => void;
  onCancel: () => void;
}

export function BatchBar({ count, busy, onCreate, onDelete, onCancel }: BatchBarProps) {
  if (count === 0) return null;
  return <div className="batch-bar"><span>已选 {count} 个事实源</span><div><Button variant="outline" size="sm" onClick={onCreate} disabled={busy}>批量创建链接</Button><Button variant="outline" size="sm" onClick={onDelete} disabled={busy}>批量删除链接</Button><Button variant="ghost" size="sm" onClick={onCancel}>取消选择</Button></div></div>;
}
