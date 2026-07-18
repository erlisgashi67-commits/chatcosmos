"use client";
/**
 * CosmosScene — the R3F Canvas + scene graph.
 * Hosts the star field, highlight overlay, tooltip, flight controls,
 * and post-processing. The dark background + additive stars produce
 * the deep-space look.
 */
import { Canvas } from "@react-three/fiber";
import * as THREE from "three";
import { StarField } from "./StarField";
import { StarHighlights } from "./StarHighlights";
import { StarTooltip } from "./StarTooltip";
import { FlightControls } from "./FlightControls";
import { PostProcessing } from "./PostProcessing";

export function CosmosScene() {
  return (
    <Canvas
      camera={{ position: [0, 26, 96], fov: 60, near: 0.1, far: 2000 }}
      gl={{
        antialias: true,
        alpha: false,
        powerPreference: "high-performance",
        toneMapping: THREE.ACESFilmicToneMapping,
      }}
      dpr={[1, 2]}
      onCreated={({ scene }) => {
        scene.background = new THREE.Color("#05060f");
      }}
    >
      <ambientLight intensity={0.5} />
      <StarField />
      <StarHighlights />
      <StarTooltip />
      <FlightControls />
      <PostProcessing />
    </Canvas>
  );
}
