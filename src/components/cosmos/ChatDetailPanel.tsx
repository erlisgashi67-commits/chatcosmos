"use client";
/**
 * ChatDetailPanel — full message reader (right-side Sheet).
 * Opens when a star is selected. Shows the complete chat chunk, topic,
 * timestamp, word count, and a "fly to" action.
 */
import { useMemo } from "react";
import { Navigation, Clock, FileText, Tag, Hash, X } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useCosmosStore } from "@/stores/cosmos-store";

export function ChatDetailPanel() {
  const data = useCosmosStore((s) => s.data);
  const selectedNodeId = useCosmosStore((s) => s.selectedNodeId);
  const selectNode = useCosmosStore((s) => s.selectNode);
  const requestFlyTo = useCosmosStore((s) => s.requestFlyTo);

  const node = useMemo(() => {
    if (selectedNodeId === null || !data) return null;
    return data.nodes[selectedNodeId] ?? null;
  }, [selectedNodeId, data]);

  const cluster = useMemo(() => {
    if (!node || !data) return null;
    return data.clusters.find((c) => c.id === node.clusterId) ?? null;
  }, [node, data]);

  const open = node !== null;

  // split fullText into user/assistant turns for nice rendering
  const turns = useMemo(() => {
    if (!node) return [];
    return node.fullText
      .split(/\n(?=(?:User|Assistant):)/g)
      .map((t) => {
        const m = t.match(/^(User|Assistant):\s*([\s\S]*)$/);
        return m
          ? { role: m[1].toLowerCase() as "user" | "assistant", text: m[2].trim() }
          : { role: "user" as const, text: t.trim() };
      })
      .filter((t) => t.text.length > 0);
  }, [node]);

  return (
    <Sheet open={open} onOpenChange={(o) => !o && selectNode(null)}>
      <SheetContent className="cosmos-detail-panel" side="right">
        {node && (
          <>
            <SheetHeader className="cosmos-detail-header">
              <div className="cosmos-detail-titlerow">
                <SheetTitle className="cosmos-detail-title">
                  {node.title}
                </SheetTitle>
                <Button
                  variant="ghost"
                  size="icon"
                  className="cosmos-detail-close"
                  onClick={() => selectNode(null)}
                >
                  <X size={18} />
                </Button>
              </div>
              <SheetDescription className="cosmos-detail-desc">
                Chat chunk from your archive
              </SheetDescription>
            </SheetHeader>

            <div className="cosmos-detail-meta">
              {cluster && (
                <Badge
                  className="cosmos-detail-badge"
                  style={{
                    background: `${cluster.color}22`,
                    color: cluster.color,
                    borderColor: `${cluster.color}55`,
                  }}
                >
                  <span
                    className="cosmos-detail-dot"
                    style={{ background: cluster.color }}
                  />
                  {cluster.label}
                </Badge>
              )}
              <div className="cosmos-detail-meta-row">
                <span className="cosmos-meta-item">
                  <Hash size={13} /> {node.id}
                </span>
                <span className="cosmos-meta-item">
                  <FileText size={13} /> {node.wordCount} words
                </span>
                <span className="cosmos-meta-item">
                  <Clock size={13} />{" "}
                  {new Date(node.timestamp).toLocaleString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
                <span className="cosmos-meta-item">
                  <Tag size={13} /> {node.source}
                </span>
              </div>
            </div>

            <Separator />

            <ScrollArea className="cosmos-detail-scroll">
              <div className="cosmos-detail-turns">
                {turns.map((turn, i) => (
                  <div key={i} className={`cosmos-turn cosmos-turn-${turn.role}`}>
                    <div className="cosmos-turn-role">{turn.role}</div>
                    <div className="cosmos-turn-text">{turn.text}</div>
                  </div>
                ))}
              </div>
            </ScrollArea>

            <div className="cosmos-detail-footer">
              <Button
                className="cosmos-detail-fly"
                onClick={() => requestFlyTo(node.id)}
              >
                <Navigation size={15} /> Fly to this star
              </Button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
