"use client";
/**
 * StarField — the core point cloud.
 * Renders every chat node as a glowing star using a single THREE.Points
 * object with a custom ShaderMaterial (soft circular glow + twinkle + fog).
 * Additive blending + Bloom postprocessing produce the galaxy look.
 *
 * Raycasting (via R3F pointer events) handles hover → tooltip and
 * click → open detail drawer. The opacity attribute is recomputed when
 * search filtering or cluster visibility changes (cheap, one pass).
 */
import { useRef, useMemo, useEffect } from "react";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import { useCosmosStore } from "@/stores/cosmos-store";

const vertexShader = /* glsl */ `
  attribute float aSize;
  attribute float aOpacity;
  attribute vec3 aColor;
  varying vec3 vColor;
  varying float vOpacity;
  varying float vFog;
  uniform float uTime;
  uniform float uPixelRatio;
  void main() {
    vColor = aColor;
    vOpacity = aOpacity;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    float depth = -mvPosition.z;
    vFog = 1.0 - exp(-0.0055 * depth); // 0 near camera → 1 far
    // twinkle: deterministic per-point phase
    float seed = position.x * 0.31 + position.y * 0.17 + position.z * 0.23;
    float twinkle = 0.82 + 0.18 * sin(uTime * 1.4 + seed);
    gl_PointSize = aSize * uPixelRatio * twinkle * (260.0 / depth);
    gl_PointSize = clamp(gl_PointSize, 1.0, 70.0);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const fragmentShader = /* glsl */ `
  precision mediump float;
  varying vec3 vColor;
  varying float vOpacity;
  varying float vFog;
  uniform vec3 uFogColor;
  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float dist = length(uv);
    if (dist > 0.5) discard;
    float core = smoothstep(0.5, 0.0, dist);
    float glow = exp(-dist * 5.0) * 0.55;
    float alpha = (core + glow) * vOpacity;
    vec3 col = vColor * (1.0 + glow * 1.8);
    // depth fog toward background
    col = mix(col, uFogColor, vFog * 0.55);
    gl_FragColor = vec4(col, alpha);
  }
`;

export function StarField() {
  const data = useCosmosStore((s) => s.data);
  const selectNode = useCosmosStore((s) => s.selectNode);
  const setHoveredNode = useCosmosStore((s) => s.setHoveredNode);
  const hiddenClusters = useCosmosStore((s) => s.hiddenClusters);
  const searchActive = useCosmosStore((s) => s.searchActive);
  const searchMatchIds = useCosmosStore((s) => s.searchMatchIds);
  const pointsRef = useRef<THREE.Points>(null);
  const { raycaster, gl } = useThree();

  // raycaster hit radius for points (world units) — standard three.js API
  useEffect(() => {
    /* eslint-disable react-hooks/immutability */
    const params = raycaster.params as { Points?: { threshold: number } };
    if (!params.Points) params.Points = { threshold: 1.1 };
    params.Points.threshold = 1.1;
    /* eslint-enable react-hooks/immutability */
  }, [raycaster]);

  // build geometry + material once data arrives
  const built = useMemo(() => {
    if (!data) return null;
    const n = data.nodes.length;
    const positions = new Float32Array(n * 3);
    const colors = new Float32Array(n * 3);
    const sizes = new Float32Array(n);
    const opacities = new Float32Array(n);
    const colorMap = new Map(
      data.clusters.map((c) => [c.id, new THREE.Color(c.color)])
    );
    for (let i = 0; i < n; i++) {
      const node = data.nodes[i];
      positions[i * 3] = node.x;
      positions[i * 3 + 1] = node.y;
      positions[i * 3 + 2] = node.z;
      const col = colorMap.get(node.clusterId) ?? new THREE.Color("#ffffff");
      colors[i * 3] = col.r;
      colors[i * 3 + 1] = col.g;
      colors[i * 3 + 2] = col.b;
      // deterministic size variation 0.7–1.3
      sizes[i] = 0.7 + ((node.id * 9301 + 49297) % 1000) / 1000 * 0.6;
      opacities[i] = 1.0;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute("aOpacity", new THREE.BufferAttribute(opacities, 1));
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uPixelRatio: { value: Math.min(gl.getPixelRatio(), 2) },
        uFogColor: { value: new THREE.Color("#05060f") },
      },
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    return { geometry, material };
  }, [data, gl]);

  // recompute opacity when search / cluster visibility changes
  useEffect(() => {
    if (!built || !data) return;
    const attr = built.geometry.getAttribute("aOpacity") as THREE.BufferAttribute;
    const matchSet = searchActive ? new Set(searchMatchIds) : null;
    for (let i = 0; i < data.nodes.length; i++) {
      const node = data.nodes[i];
      let op = 1.0;
      if (hiddenClusters.has(node.clusterId)) op = 0.0;
      else if (matchSet) op = matchSet.has(node.id) ? 1.0 : 0.07;
      attr.setX(i, op);
    }
    attr.needsUpdate = true;
  }, [built, data, hiddenClusters, searchActive, searchMatchIds]);

  useFrame((state) => {
    const mat = pointsRef.current?.material as THREE.ShaderMaterial | undefined;
    if (mat && mat.uniforms) mat.uniforms.uTime.value = state.clock.elapsedTime;
  });

  const handleMove = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    if (e.index === undefined) return;
    setHoveredNode(e.index);
    document.body.style.cursor = "pointer";
  };
  const handleOut = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    setHoveredNode(null);
    document.body.style.cursor = "grab";
  };
  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (e.index === undefined) return;
    selectNode(e.index);
  };

  if (!built) return null;
  return (
    <points
      ref={pointsRef}
      geometry={built.geometry}
      material={built.material}
      onPointerMove={handleMove}
      onPointerOut={handleOut}
      onClick={handleClick}
      frustumCulled={false}
    />
  );
}
