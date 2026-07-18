"use client";
/**
 * StarTooltip — floating info card anchored to the hovered star.
 * Uses drei <Html> to project the node's 3D position to screen space.
 * Only one tooltip exists at a time, so performance is a non-issue.
 */
import { Html } from "@react-three/drei";
import { useCosmosStore } from "@/stores/cosmos-store";

export function StarTooltip() {
  const data = useCosmosStore((s) => s.data);
  const hoveredNodeId = useCosmosStore((s) => s.hoveredNodeId);
  if (!data || hoveredNodeId === null) return null;
  const node = data.nodes[hoveredNodeId];
  if (!node) return null;
  const cluster = data.clusters.find((c) => c.id === node.clusterId);
  const date = new Date(node.timestamp);
  const dateStr = date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return (
    <Html
      position={[node.x, node.y, node.z]}
      center
      zIndexRange={[50, 0]}
      style={{ pointerEvents: "none" }}
      distanceFactor={undefined}
    >
      <div
        className="cosmos-tooltip"
        style={{ borderColor: cluster?.color ?? "#888" }}
      >
        <div className="cosmos-tooltip-header">
          <span
            className="cosmos-tooltip-dot"
            style={{ background: cluster?.color ?? "#888" }}
          />
          <span className="cosmos-tooltip-label">
            {cluster?.label ?? "Unknown"}
          </span>
          <span className="cosmos-tooltip-id">#{node.id}</span>
        </div>
        <div className="cosmos-tooltip-title">{node.title}</div>
        <div className="cosmos-tooltip-snippet">{node.snippet}</div>
        <div className="cosmos-tooltip-meta">
          <span>{node.wordCount} words</span>
          <span>·</span>
          <span>{dateStr}</span>
          <span>·</span>
          <span>{node.source}</span>
        </div>
        <div className="cosmos-tooltip-hint">Click to read full chat</div>
      </div>
    </Html>
  );
}
