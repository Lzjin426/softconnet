import { basename, type SourceView } from "@/types";

export function sourceHasIssue(source: SourceView) {
  return source.kind === "missing" || source.kind === "symlink" || source.links.some((link) => link.status !== "healthy");
}

export function sourceNameCollisions(sources: SourceView[]): Set<string> {
  const counts = new Map<string, number>();
  for (const source of sources) {
    const name = basename(source.path).toLocaleLowerCase();
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return new Set([...counts].filter(([, count]) => count > 1).map(([name]) => name));
}
