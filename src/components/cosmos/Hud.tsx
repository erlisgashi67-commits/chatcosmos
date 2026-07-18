"use client";
/**
 * Hud — bottom status bar + controls help overlay.
 * Shows dataset stats, active filters, and a togglable controls cheatsheet.
 */
import { useState, useEffect, useRef } from "react";
import { HelpCircle, Database, Sparkles, X } from "lucide-react";
import { useCosmosStore } from "@/stores/cosmos-store";
import { Button } from "@/components/ui/button";

export function Hud() {
  const data = useCosmosStore((s) => s.data);
  const showHelp = useCosmosStore((s) => s.showHelp);
  const toggleHelp = useCosmosStore((s) => s.toggleHelp);
  const hiddenClusters = useCosmosStore((s) => s.hiddenClusters);
  const searchActive = useCosmosStore((s) => s.searchActive);
  const searchMatchIds = useCosmosStore((s) => s.searchMatchIds);

  // lightweight FPS counter
  const [fps, setFps] = useState(0);
  const rafRef = useRef<number>(0);
  const frames = useRef(0);
  const last = useRef(performance.now());
  useEffect(() => {
    const loop = () => {
      frames.current++;
      const now = performance.now();
      if (now - last.current >= 1000) {
        setFps(frames.current);
        frames.current = 0;
        last.current = now;
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  if (!data) return null;

  return (
    <>
      <div className="cosmos-hud">
        <div className="cosmos-hud-left">
          <span className="cosmos-hud-brand">
            <Sparkles size={15} />
            <span>ChatCosmos</span>
          </span>
          <span className="cosmos-hud-sep" />
          <span className="cosmos-hud-stat">
            <Database size={13} />
            {data.metadata.totalNodes.toLocaleString()} chats
          </span>
          <span className="cosmos-hud-stat">{data.clusters.length} topics</span>
          {hiddenClusters.size > 0 && (
            <span className="cosmos-hud-stat cosmos-hud-warn">
              {hiddenClusters.size} hidden
            </span>
          )}
          {searchActive && (
            <span className="cosmos-hud-stat cosmos-hud-warn">
              {searchMatchIds.length} search hits
            </span>
          )}
        </div>

        <div className="cosmos-hud-right">
          <span className="cosmos-hud-fps">{fps} fps</span>
          <Button
            variant="ghost"
            size="sm"
            className="cosmos-hud-help"
            onClick={toggleHelp}
          >
            <HelpCircle size={15} /> Controls
          </Button>
        </div>
      </div>

      {showHelp && (
        <div className="cosmos-help-overlay" onClick={toggleHelp}>
          <div
            className="cosmos-help-card"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="cosmos-help-head">
              <span>Flight Controls</span>
              <button onClick={toggleHelp} aria-label="Close help">
                <X size={16} />
              </button>
            </div>
            <div className="cosmos-help-grid">
              <div className="cosmos-help-row">
                <span className="cosmos-key">Mouse drag</span>
                <span>Look around (yaw / pitch)</span>
              </div>
              <div className="cosmos-help-row">
                <span className="cosmos-key">Scroll</span>
                <span>Dolly forward / back</span>
              </div>
              <div className="cosmos-help-row">
                <span className="cosmos-key">W A S D</span>
                <span>Move forward / left / back / right</span>
              </div>
              <div className="cosmos-help-row">
                <span className="cosmos-key">E / Space</span>
                <span>Ascend</span>
              </div>
              <div className="cosmos-help-row">
                <span className="cosmos-key">Q / Ctrl</span>
                <span>Descend</span>
              </div>
              <div className="cosmos-help-row">
                <span className="cosmos-key">Shift</span>
                <span>Boost (faster)</span>
              </div>
              <div className="cosmos-help-row">
                <span className="cosmos-key">/</span>
                <span>Focus search bar</span>
              </div>
              <div className="cosmos-help-row">
                <span className="cosmos-key">Click star</span>
                <span>Read full chat</span>
              </div>
              <div className="cosmos-help-row">
                <span className="cosmos-key">Esc</span>
                <span>Blur search / close panel</span>
              </div>
            </div>
            <div className="cosmos-help-foot">
              You&apos;re bound to a sphere of radius 145 — explore freely
              without getting lost.
            </div>
          </div>
        </div>
      )}
    </>
  );
}
