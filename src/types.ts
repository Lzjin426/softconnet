export type LinkStatus =
  | "healthy"
  | "source_missing"
  | "link_missing"
  | "replaced"
  | "retargeted"
  | "inaccessible";

export interface LinkView {
  path: string;
  target: string;
  project: string;
  status: LinkStatus;
}

export interface SourceView {
  path: string;
  kind: "file" | "directory" | "missing";
  manual: boolean;
  links: LinkView[];
}

export interface Snapshot {
  roots: string[];
  sources: SourceView[];
  scanWarnings: string[];
}

export const statusText: Record<LinkStatus, string> = {
  healthy: "正常",
  source_missing: "源文件缺失",
  link_missing: "链接已消失",
  replaced: "已变成普通文件",
  retargeted: "目标已改变",
  inaccessible: "无法访问",
};

export function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

export function dirname(path: string): string {
  const index = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return index < 0 ? path : path.slice(0, index);
}
