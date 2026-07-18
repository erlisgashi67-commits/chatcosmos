"use client";
/**
 * StarHighlights — overlay point cloud for the hovered & selected stars.
 * Rendered as a separate (much smaller) Points object on top of StarField
 * so the main field never needs per-frame updates. Draws a bright core +
 * pulsing ring + glow for clear visual focus.
 */
import { useMemo } from "react";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { useRef } from "react";
import * as THREE from "three";
import { useCosmosStore } from "@/stores/cosmos-store";

const vertexShader = /* glsl */ `
  attribute vec3 aColor;
  attribute float aHovered;
  varying vec3 vColor;
  varying float vHovered;
  uniform float uTime;
  uniform float uPixelRatio;
  void main() {
    vColor = aColor;
    vHovered = aHovered;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    float depth = -mvPosition.z;
    float pulse = 1.0 + 0.35 * sin(uTime * 3.5);
    float base = vHovered > 0.5 ? 16.0 : 11.0;
    gl_PointSize = base * pulse * uPixelRatio * (260.0 / depth);
    gl_PointSize = clamp(gl_PointSize, 5.0, 220.0);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const fragmentShader = /* glsl */ `
  precision mediump float;
  varying vec3 vColor;
  varying float vHovered;
  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float dist = length(uv);
    if (dist > 0.5) discard;
    float ring = smoothstep(0.5, 0.44, dist) - smoothstep(0.44, 0.36, dist);
    float core = smoothstep(0.16, 0.0, dist);
    float glow = exp(-dist * 4.5) * 0.45;
    float alpha = max(ring * 0.95, max(core, glow));
    vec3 col = mix(vColor, vec3(1.0), core * 0.85);
    gl_FragColor = vec4(col, alpha);
  }
`;

export function StarHighlights() {
  const data = useCosmosStore((s) => s.data);
  const hoveredNodeId = useCosmosStore((s) => s.hoveredNodeId);
  const selectedNodeId = useCosmosStore((s) => s.selectedNodeId);
  const selectNode = useCosmosStore((s) => s.selectNode);
  const pointsRef = useRef<THREE.Points>(null);

  const ids = useMemo(() => {
    const set = new Set<number>();
    if (hoveredNodeId !== null) set.add(hoveredNodeId);
    if (selectedNodeId !== null) set.add(selectedNodeId);
    return [...set];
  }, [hoveredNodeId, selectedNodeId]);

  const built = useMemo(() => {
    if (!data || ids.length === 0) return null;
    const positions = new Float32Array(ids.length * 3);
    const colors = new Float32Array(ids.length * 3);
    const hovered = new Float32Array(ids.length);
    const colorMap = new Map(
      data.clusters.map((c) => [c.id, new THREE.Color(c.color)])
    );
    ids.forEach((id, i) => {
      const node = data.nodes[id];
      if (!node) return;
      positions[i * 3] = node.x;
      positions[i * 3 + 1] = node.y;
      positions[i * 3 + 2] = node.z;
      const col = colorMap.get(node.clusterId) ?? new THREE.Color("#ffffff");
      colors[i * 3] = col.r;
      colors[i * 3 + 1] = col.g;
      colors[i * 3 + 2] = col.b;
      hovered[i] = id === hoveredNodeId ? 1.0 : 0.0;
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute("aHovered", new THREE.BufferAttribute(hovered, 1));
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
      },
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    });
    return { geometry, material };
  }, [data, ids, hoveredNodeId]);

  useFrame((state) => {
    const mat = pointsRef.current?.material as THREE.ShaderMaterial | undefined;
    if (mat && mat.uniforms) mat.uniforms.uTime.value = state.clock.elapsedTime;
  });

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (e.index === undefined) return;
    const id = ids[e.index];
    if (id !== undefined) selectNode(id);
  };

  if (!built) return null;
  return (
    <points
      ref={pointsRef}
      geometry={built.geometry}
      material={built.material}
      onClick={handleClick}
      frustumCulled={false}
    />
  );
}
