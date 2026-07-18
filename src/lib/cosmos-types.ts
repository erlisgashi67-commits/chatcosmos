/**
 * ChatCosmos — shared TypeScript types
 * Mirrors the JSON contract produced by the Python pipeline / demo generator.
 */

export interface CosmosCluster {
  id: number;
  label: string;
  keywords: string[];
  color: string; // hex e.g. "#22d3ee"
  count: number;
}

export interface CosmosNode {
  id: number;
  x: number;
  y: number;
  z: number;
  clusterId: number;
  title: string;
  snippet: string;
  fullText: string;
  role: "user" | "assistant";
  timestamp: string; // ISO
  wordCount: number;
  source: string;
}

export interface CosmosMetadata {
  totalNodes: number;
  totalClusters: number;
  generatedAt: string;
  source: string;
  dateRange: { start: string; end: string };
}

export interface CosmosData {
  metadata: CosmosMetadata;
  clusters: CosmosCluster[];
  nodes: CosmosNode[];
}
