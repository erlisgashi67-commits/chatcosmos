/**
 * ChatCosmos — data fetching hook
 * Loads the processed galaxy dataset from /api/cosmos into the Zustand store.
 * Runs the search locally (instant, no round-trip) and exposes helpers.
 */
"use client";

import { useEffect, useMemo, useRef } from "react";
import { useCosmosStore } from "@/stores/cosmos-store";
import type { CosmosData, CosmosNode } from "@/lib/cosmos-types";

export function useCosmosData() {
  const data = useCosmosStore((s) => s.data);
  const status = useCosmosStore((s) => s.status);
  const error = useCosmosStore((s) => s.error);
  const setData = useCosmosStore((s) => s.setData);
  const setStatus = useCosmosStore((s) => s.setStatus);
  const setError = useCosmosStore((s) => s.setError);

  const searchQuery = useCosmosStore((s) => s.searchQuery);
  const setSearchMatches = useCosmosStore((s) => s.setSearchMatches);

  // ---- load once (resilient to HMR remounts: never cancel, skip if already loaded) ----
  // The store is global, so a setData call after unmount is harmless. We deliberately
  // avoid a cancelled-flag cleanup because HMR can remount the component and leave the
  // store stuck in "loading" if the last fetch is aborted.
  const initiated = useRef(false);
  useEffect(() => {
    if (initiated.current) return;
    initiated.current = true;
    // already loaded by a previous mount? skip entirely
    if (useCosmosStore.getState().data) return;
    setStatus("loading");
    fetch("/api/cosmos")
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return (await r.json()) as CosmosData;
      })
      .then((json) => {
        // always set — the store is global and survives remounts
        useCosmosStore.getState().setData(json);
      })
      .catch((e) => {
        useCosmosStore.getState().setError(
          e instanceof Error ? e.message : "Failed to load"
        );
      });
  }, [setStatus]);

  // ---- local search (debounced via useMemo on query) ----
  useEffect(() => {
    if (!data) return;
    const q = searchQuery.trim().toLowerCase();
    if (!q) {
      setSearchMatches([]);
      useCosmosStore.setState({ searchActive: false });
      return;
    }
    useCosmosStore.setState({ searchActive: true });
    const matches: number[] = [];
    for (const node of data.nodes) {
      if (
        node.title.toLowerCase().includes(q) ||
        node.snippet.toLowerCase().includes(q) ||
        node.fullText.toLowerCase().includes(q)
      ) {
        matches.push(node.id);
        if (matches.length >= 200) break; // cap for performance
      }
    }
    setSearchMatches(matches);
  }, [searchQuery, data, setSearchMatches]);

  // ---- derived helpers ----
  const clusterColorMap = useMemo(() => {
    const m = new Map<number, string>();
    data?.clusters.forEach((c) => m.set(c.id, c.color));
    return m;
  }, [data]);

  const nodeById = useMemo(() => {
    const m = new Map<number, CosmosNode>();
    data?.nodes.forEach((n) => m.set(n.id, n));
    return m;
  }, [data]);

  return { data, status, error, clusterColorMap, nodeById };
}
