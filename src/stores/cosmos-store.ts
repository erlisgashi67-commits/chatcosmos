/**
 * ChatCosmos — global UI state (Zustand)
 * Holds the loaded dataset plus all cross-component interaction state:
 * selection, search, cluster visibility, and camera fly-to requests.
 */
import { create } from "zustand";
import type { CosmosData } from "@/lib/cosmos-types";

type Status = "idle" | "loading" | "ready" | "error";

interface CosmosState {
  // ---- data ----
  data: CosmosData | null;
  status: Status;
  error: string | null;
  setData: (data: CosmosData) => void;
  setStatus: (s: Status) => void;
  setError: (e: string | null) => void;

  // ---- selection (opens the detail drawer) ----
  selectedNodeId: number | null;
  selectNode: (id: number | null) => void;

  // ---- search ----
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  searchMatchIds: number[]; // node ids matching the query
  setSearchMatches: (ids: number[]) => void;
  searchActive: boolean; // true when a non-empty query is applied

  // ---- camera fly-to ----
  // when set, FlightControls lerps the camera toward this node then clears it
  flyToNodeId: number | null;
  requestFlyTo: (id: number) => void;
  consumeFlyTo: () => void;

  // ---- cluster visibility ----
  hiddenClusters: Set<number>;
  toggleCluster: (id: number) => void;
  showAllClusters: () => void;

  // ---- hover (for tooltip + cursor) ----
  hoveredNodeId: number | null;
  setHoveredNode: (id: number | null) => void;

  // ---- UI panels ----
  showHelp: boolean;
  toggleHelp: () => void;
  legendOpen: boolean;
  toggleLegend: () => void;
}

export const useCosmosStore = create<CosmosState>((set) => ({
  data: null,
  status: "idle",
  error: null,
  setData: (data) => set({ data, status: "ready", error: null }),
  setStatus: (status) => set({ status }),
  setError: (error) => set({ error, status: "error" }),

  selectedNodeId: null,
  selectNode: (id) => set({ selectedNodeId: id }),

  searchQuery: "",
  setSearchQuery: (q) => set({ searchQuery: q }),
  searchMatchIds: [],
  setSearchMatches: (ids) => set({ searchMatchIds: ids }),
  searchActive: false,

  flyToNodeId: null,
  requestFlyTo: (id) => set({ flyToNodeId: id }),
  consumeFlyTo: () => set({ flyToNodeId: null }),

  hiddenClusters: new Set<number>(),
  toggleCluster: (id) =>
    set((state) => {
      const next = new Set(state.hiddenClusters);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { hiddenClusters: next };
    }),
  showAllClusters: () => set({ hiddenClusters: new Set<number>() }),

  hoveredNodeId: null,
  setHoveredNode: (id) => set({ hoveredNodeId: id }),

  showHelp: false,
  toggleHelp: () => set((s) => ({ showHelp: !s.showHelp })),
  legendOpen: true,
  toggleLegend: () => set((s) => ({ legendOpen: !s.legendOpen })),
}));
