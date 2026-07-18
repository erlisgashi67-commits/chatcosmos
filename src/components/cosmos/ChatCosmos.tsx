"use client";
/**
 * ChatCosmos — top-level orchestrator.
 * Loads the galaxy dataset, shows a loading state, then mounts the 3D
 * scene + all UI overlays (search, legend, detail panel, HUD).
 */
import { useCosmosData } from "@/hooks/use-cosmos-data";
import { CosmosScene } from "./CosmosScene";
import { SearchOverlay } from "./SearchOverlay";
import { ClusterLegend } from "./ClusterLegend";
import { ChatDetailPanel } from "./ChatDetailPanel";
import { Hud } from "./Hud";
import { Sparkles } from "lucide-react";

export function ChatCosmos() {
  const { status, error } = useCosmosData();

  if (status === "error") {
    return (
      <div className="cosmos-loading">
        <div className="cosmos-loading-card">
          <h2>Failed to load the cosmos</h2>
          <p>{error ?? "Unknown error"}</p>
          <code>bun run scripts/generate-cosmos-data.ts</code>
        </div>
      </div>
    );
  }

  if (status !== "ready") {
    return (
      <div className="cosmos-loading">
        <div className="cosmos-loading-card">
          <div className="cosmos-loading-orbit">
            <Sparkles size={28} />
          </div>
          <h2>Charting your chat universe…</h2>
          <p>Embedding · clustering · projecting into 3D space</p>
        </div>
      </div>
    );
  }

  return (
    <div className="cosmos-root">
      <CosmosScene />
      <SearchOverlay />
      <ClusterLegend />
      <ChatDetailPanel />
      <Hud />
    </div>
  );
}
