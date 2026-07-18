"use client";
/**
 * ClusterLegend — collapsible topic legend (top-left).
 * Each cluster shows its color, label, node count, and a visibility toggle.
 * Hidden clusters are dimmed; their stars fade to near-zero opacity in 3D.
 */
import { useState, useMemo } from "react";
import { Layers, ChevronDown, ChevronUp, Eye, EyeOff, Navigation } from "lucide-react";
import { useCosmosStore } from "@/stores/cosmos-store";
import { useCosmosData } from "@/hooks/use-cosmos-data";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export function ClusterLegend() {
  const data = useCosmosStore((s) => s.data);
  const legendOpen = useCosmosStore((s) => s.legendOpen);
  const toggleLegend = useCosmosStore((s) => s.toggleLegend);
  const hiddenClusters = useCosmosStore((s) => s.hiddenClusters);
  const toggleCluster = useCosmosStore((s) => s.toggleCluster);
  const showAllClusters = useCosmosStore((s) => s.showAllClusters);
  const requestFlyTo = useCosmosStore((s) => s.requestFlyTo);

  const clusters = data?.clusters ?? [];

  // approximate cluster center = average of its nodes (for fly-to)
  const clusterCenters = useMemo(() => {
    if (!data) return new Map<number, { x: number; y: number; z: number }>();
    const sums = new Map<
      number,
      { sx: number; sy: number; sz: number; n: number }
    >();
    for (const node of data.nodes) {
      const s = sums.get(node.clusterId) ?? { sx: 0, sy: 0, sz: 0, n: 0 };
      s.sx += node.x;
      s.sy += node.y;
      s.sz += node.z;
      s.n += 1;
      sums.set(node.clusterId, s);
    }
    const centers = new Map<number, { x: number; y: number; z: number }>();
    for (const [id, s] of sums) {
      centers.set(id, { x: s.sx / s.n, y: s.sy / s.n, z: s.sz / s.n });
    }
    return centers;
  }, [data]);

  if (!data) return null;

  return (
    <div className={`cosmos-legend ${legendOpen ? "open" : "closed"}`}>
      <button className="cosmos-legend-header" onClick={toggleLegend}>
        <Layers size={16} />
        <span>Topics</span>
        <Badge variant="secondary" className="cosmos-legend-count">
          {clusters.length}
        </Badge>
        <span className="cosmos-legend-chevron">
          {legendOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </span>
      </button>

      {legendOpen && (
        <>
          <div className="cosmos-legend-actions">
            <Button
              variant="ghost"
              size="sm"
              className="cosmos-legend-action"
              onClick={showAllClusters}
              disabled={hiddenClusters.size === 0}
            >
              <Eye size={14} /> Show all
            </Button>
            <span className="cosmos-legend-hidden">
              {hiddenClusters.size > 0
                ? `${hiddenClusters.size} hidden`
                : "all visible"}
            </span>
          </div>
          <div className="cosmos-legend-list">
            {clusters.map((c) => {
              const hidden = hiddenClusters.has(c.id);
              const center = clusterCenters.get(c.id);
              return (
                <div
                  key={c.id}
                  className={`cosmos-legend-item ${hidden ? "hidden" : ""}`}
                >
                  <button
                    className="cosmos-legend-toggle"
                    onClick={() => toggleCluster(c.id)}
                    aria-label={hidden ? `Show ${c.label}` : `Hide ${c.label}`}
                  >
                    {hidden ? <EyeOff size={13} /> : <Eye size={13} />}
                  </button>
                  <span
                    className="cosmos-legend-dot"
                    style={{
                      background: c.color,
                      opacity: hidden ? 0.25 : 1,
                    }}
                  />
                  <span className="cosmos-legend-label">{c.label}</span>
                  <span className="cosmos-legend-nodes">{c.count}</span>
                  <button
                    className="cosmos-legend-fly"
                    onClick={() => {
                      // fly to the first node of this cluster
                      const node = data.nodes.find(
                        (n) => n.clusterId === c.id
                      );
                      if (node) requestFlyTo(node.id);
                    }}
                    aria-label={`Fly to ${c.label}`}
                    title={`Fly to ${c.label}`}
                  >
                    <Navigation size={13} />
                  </button>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
