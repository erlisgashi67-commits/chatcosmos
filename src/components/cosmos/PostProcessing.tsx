"use client";
/**
 * PostProcessing — Bloom for the glowing-galaxy aesthetic.
 * Additive-blended stars above the luminance threshold bloom outward,
 * producing soft halos around bright clusters.
 */
import { EffectComposer, Bloom, Vignette } from "@react-three/postprocessing";

export function PostProcessing() {
  return (
    <EffectComposer multisampling={0}>
      <Bloom
        intensity={0.9}
        luminanceThreshold={0.18}
        luminanceSmoothing={0.35}
        mipmapBlur
        radius={0.7}
      />
      <Vignette eskil={false} offset={0.25} darkness={0.85} />
    </EffectComposer>
  );
}
