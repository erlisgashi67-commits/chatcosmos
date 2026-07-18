"use client";
/**
 * SearchOverlay — top-center search bar with live results.
 * Filtering happens client-side (instant). Each result flies the camera
 * to the matched node and opens its detail panel.
 */
import { useMemo, useRef, useState, useEffect } from "react";
import { Search, X, Navigation } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useCosmosStore } from "@/stores/cosmos-store";
import { useCosmosData } from "@/hooks/use-cosmos-data";

export function SearchOverlay() {
  const data = useCosmosStore((s) => s.data);
  const searchQuery = useCosmosStore((s) => s.searchQuery);
  const setSearchQuery = useCosmosStore((s) => s.setSearchQuery);
  const searchMatchIds = useCosmosStore((s) => s.searchMatchIds);
  const searchActive = useCosmosStore((s) => s.searchActive);
  const requestFlyTo = useCosmosStore((s) => s.requestFlyTo);
  const selectNode = useCosmosStore((s) => s.selectNode);
  const { nodeById, clusterColorMap } = useCosmosData();

  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // keyboard shortcut: "/" focuses search
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      const typing =
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement;
      if (e.key === "/" && !typing) {
        e.preventDefault();
        inputRef.current?.focus();
      }
      if (e.key === "Escape" && typing) {
        inputRef.current?.blur();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const results = useMemo(() => {
    if (!searchActive) return [];
    return searchMatchIds.slice(0, 12).map((id) => nodeById.get(id)).filter(Boolean);
  }, [searchActive, searchMatchIds, nodeById]);

  const totalMatches = searchMatchIds.length;
  const showDropdown = focused && searchQuery.trim().length > 0;

  const pickResult = (id: number) => {
    selectNode(id);
    requestFlyTo(id);
    inputRef.current?.blur();
  };

  return (
    <div className="cosmos-search-wrap">
      <div className="cosmos-search-box">
        <Search className="cosmos-search-icon" size={18} />
        <Input
          ref={inputRef}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          placeholder="Search your chats…  (press /)"
          className="cosmos-search-input"
          aria-label="Search chats"
        />
        {searchQuery && (
          <button
            className="cosmos-search-clear"
            onClick={() => {
              setSearchQuery("");
              inputRef.current?.focus();
            }}
            aria-label="Clear search"
          >
            <X size={16} />
          </button>
        )}
      </div>

      {showDropdown && (
        <div className="cosmos-search-dropdown">
          <div className="cosmos-search-summary">
            {totalMatches > 0 ? (
              <span>
                {totalMatches} match{totalMatches !== 1 ? "es" : ""}
                {totalMatches > results.length && ` · showing first ${results.length}`}
              </span>
            ) : (
              <span>No matches found</span>
            )}
          </div>
          <div className="cosmos-search-list">
            {results.map((node) => {
              if (!node) return null;
              const color = clusterColorMap.get(node.clusterId) ?? "#888";
              return (
                <button
                  key={node.id}
                  className="cosmos-search-result"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pickResult(node.id);
                  }}
                >
                  <span
                    className="cosmos-result-dot"
                    style={{ background: color }}
                  />
                  <span className="cosmos-result-body">
                    <span className="cosmos-result-title">{node.title}</span>
                    <span className="cosmos-result-snippet">{node.snippet}</span>
                  </span>
                  <Navigation
                    size={14}
                    className="cosmos-result-fly"
                  />
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
