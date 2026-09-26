import { useEffect, useMemo, useState } from "react";
import { sourceNameCollisions } from "./identity";
import type { Snapshot } from "@/types";

export function useSourceSelection(snapshot: Snapshot | null) {
  const [selectedSourcePath, setSelectedSourcePath] = useState<string | null>(null);
  const [selectedSources, setSelectedSources] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [selectMode, setSelectMode] = useState(false);

  const source = snapshot?.sources.find((item) => item.path === selectedSourcePath) ?? snapshot?.sources[0] ?? null;
  const allTags = useMemo(() => Array.from(new Set(snapshot?.sources.flatMap((item) => item.tags ?? []) ?? [])).sort((left, right) => left.localeCompare(right)), [snapshot]);
  const shownSources = useMemo(() => snapshot?.sources.filter((item) => {
    const matchesQuery = item.path.toLocaleLowerCase().includes(query.toLocaleLowerCase());
    const matchesTag = !tagFilter || (item.tags ?? []).includes(tagFilter);
    return matchesQuery && matchesTag;
  }) ?? [], [snapshot, query, tagFilter]);
  const sourceOutsideFilter = Boolean(source && (query || tagFilter) && !shownSources.some((item) => item.path === source.path));
  const duplicateSourceNames = useMemo(() => sourceNameCollisions(snapshot?.sources ?? []), [snapshot]);
  const visibleSourcePaths = shownSources.map((item) => item.path);
  const allVisibleSelected = visibleSourcePaths.length > 0 && visibleSourcePaths.every((path) => selectedSources.includes(path));

  useEffect(() => {
    if (tagFilter && !allTags.includes(tagFilter)) setTagFilter("");
  }, [allTags, tagFilter]);

  useEffect(() => {
    const validPaths = new Set(snapshot?.sources.map((item) => item.path) ?? []);
    setSelectedSources((current) => {
      const next = current.filter((path) => validPaths.has(path));
      return next.length === current.length ? current : next;
    });
  }, [snapshot]);

  function toggleSource(path: string) {
    setSelectedSources((current) => current.includes(path) ? current.filter((item) => item !== path) : [...current, path]);
  }

  function selectVisibleSources() {
    setSelectedSources((current) => Array.from(new Set([...current, ...visibleSourcePaths])));
  }

  function clearVisibleSources() {
    const visible = new Set(visibleSourcePaths);
    setSelectedSources((current) => current.filter((path) => !visible.has(path)));
  }

  function clearSelection() {
    setSelectedSources([]);
    setSelectMode(false);
  }

  return {
    source, selectedSourcePath, setSelectedSourcePath, selectedSources, setSelectedSources,
    query, setQuery, tagFilter, setTagFilter, selectMode, setSelectMode,
    allTags, shownSources, sourceOutsideFilter, duplicateSourceNames,
    visibleSourcePaths, allVisibleSelected, toggleSource, selectVisibleSources,
    clearVisibleSources, clearSelection,
  };
}

export type SourceSelection = ReturnType<typeof useSourceSelection>;
