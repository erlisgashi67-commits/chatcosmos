"use client";
/**
 * FlightControls — custom first-person flight camera.
 *
 * Controls:
 *   • Mouse drag (left button)  → yaw / pitch look
 *   • W A S D / Arrow keys      → move forward/left/back/right
 *   • E / Space  ·  Q / Ctrl    → move up / down
 *   • Shift                     → boost (faster)
 *   • Mouse wheel               → dolly forward/back along view dir
 *
 * Movement uses smoothed velocity (momentum) for a gliding feel.
 * Camera position is clamped to a spherical shell [MIN_R, MAX_R] so the
 * user can never get lost in empty space or fly through the core.
 *
 * A "fly-to" target (set by the search panel / legend) smoothly lerps +
 * slerps the camera to a node, then releases control back to the user.
 */
import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useCosmosStore } from "@/stores/cosmos-store";

const MAX_R = 145;
const MIN_R = 4;
const LOOK_TARGET = new THREE.Vector3(0, 0, 0);

function clampPosition(pos: THREE.Vector3) {
  const r = pos.length();
  if (r > MAX_R) pos.multiplyScalar(MAX_R / r);
  else if (r < MIN_R) pos.multiplyScalar(MIN_R / r);
}

export function FlightControls() {
  const { camera, gl } = useThree();
  const flyToNodeId = useCosmosStore((s) => s.flyToNodeId);
  const consumeFlyTo = useCosmosStore((s) => s.consumeFlyTo);

  const keys = useRef<Record<string, boolean>>({});
  const velocity = useRef(new THREE.Vector3());
  const yaw = useRef(0);
  const pitch = useRef(0);
  const isDragging = useRef(false);
  const lastPointer = useRef({ x: 0, y: 0 });
  // pos = where the camera should end up; look = the node to look at
  const flyTarget = useRef<{
    pos: THREE.Vector3;
    look: THREE.Vector3;
    t: number;
  } | null>(null);

  // --- initial camera placement: look at galaxy center ---
  useEffect(() => {
    camera.position.set(0, 26, 96);
    camera.lookAt(LOOK_TARGET);
    const euler = new THREE.Euler().setFromQuaternion(camera.quaternion, "YXZ");
    yaw.current = euler.y;
    pitch.current = euler.x;
    document.body.style.cursor = "grab";
  }, [camera, gl]);

  // --- input listeners ---
  useEffect(() => {
    const dom = gl.domElement;
    const isTyping = () => {
      const el = document.activeElement;
      return (
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        el instanceof HTMLSelectElement
      );
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (isTyping()) return;
      keys.current[e.code] = true;
      // prevent page scroll on space/arrows
      if (
        ["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(
          e.code
        )
      ) {
        e.preventDefault();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      keys.current[e.code] = false;
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      isDragging.current = true;
      lastPointer.current = { x: e.clientX, y: e.clientY };
      document.body.style.cursor = "grabbing";
    };
    const onPointerUp = () => {
      isDragging.current = false;
      document.body.style.cursor = "grab";
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!isDragging.current) return;
      const dx = e.clientX - lastPointer.current.x;
      const dy = e.clientY - lastPointer.current.y;
      lastPointer.current = { x: e.clientX, y: e.clientY };
      yaw.current -= dx * 0.0028;
      pitch.current -= dy * 0.0028;
      const lim = Math.PI / 2 - 0.08;
      pitch.current = Math.max(-lim, Math.min(lim, pitch.current));
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const dir = new THREE.Vector3();
      camera.getWorldDirection(dir);
      const step = e.deltaY > 0 ? -3.2 : 3.2;
      camera.position.addScaledVector(dir, step);
      clampPosition(camera.position);
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    dom.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointermove", onPointerMove);
    dom.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      dom.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointermove", onPointerMove);
      dom.removeEventListener("wheel", onWheel);
    };
  }, [camera, gl]);

  // --- handle fly-to requests (from search / legend) ---
  useEffect(() => {
    if (flyToNodeId === null) return;
    const data = useCosmosStore.getState().data;
    if (!data) return;
    const node = data.nodes[flyToNodeId];
    if (!node) {
      consumeFlyTo();
      return;
    }
    // approach from the camera's current side, 13 units back from the node
    const nodePos = new THREE.Vector3(node.x, node.y, node.z);
    const offsetDir = camera.position.clone().sub(nodePos);
    if (offsetDir.lengthSq() < 0.01) offsetDir.set(0, 0, 1);
    offsetDir.normalize().multiplyScalar(13);
    flyTarget.current = {
      pos: nodePos.clone().add(offsetDir),
      look: nodePos.clone(),
      t: 0,
    };
    consumeFlyTo();
  }, [flyToNodeId, consumeFlyTo, camera]);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05);

    // ---- fly-to animation takes priority ----
    if (flyTarget.current) {
      const ft = flyTarget.current;
      camera.position.lerp(ft.pos, Math.min(1, dt * 2.2));
      // slerp orientation to look at the node
      const lookM = new THREE.Matrix4().lookAt(
        camera.position,
        ft.look,
        new THREE.Vector3(0, 1, 0)
      );
      const targetQ = new THREE.Quaternion().setFromRotationMatrix(lookM);
      camera.quaternion.slerp(targetQ, Math.min(1, dt * 3));
      // sync yaw/pitch so manual control resumes smoothly
      const euler = new THREE.Euler().setFromQuaternion(camera.quaternion, "YXZ");
      yaw.current = euler.y;
      pitch.current = euler.x;
      ft.t += dt;
      if (ft.t > 1.6) flyTarget.current = null;
      return;
    }

    // ---- manual flight ----
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    const right = new THREE.Vector3()
      .crossVectors(dir, new THREE.Vector3(0, 1, 0))
      .normalize();
    const up = new THREE.Vector3(0, 1, 0);

    const boost = keys.current["ShiftLeft"] || keys.current["ShiftRight"] ? 2.4 : 1;
    const accel = 32 * boost;
    const target = new THREE.Vector3();
    if (keys.current["KeyW"] || keys.current["ArrowUp"]) target.add(dir);
    if (keys.current["KeyS"] || keys.current["ArrowDown"]) target.sub(dir);
    if (keys.current["KeyD"] || keys.current["ArrowRight"]) target.add(right);
    if (keys.current["KeyA"] || keys.current["ArrowLeft"]) target.sub(right);
    if (keys.current["KeyE"] || keys.current["Space"]) target.add(up);
    if (keys.current["KeyQ"] || keys.current["ControlLeft"]) target.sub(up);
    if (target.lengthSq() > 0) target.normalize().multiplyScalar(accel);

    // smoothed velocity (momentum / deceleration)
    velocity.current.lerp(target, Math.min(1, dt * 5.5));
    camera.position.addScaledVector(velocity.current, dt);
    clampPosition(camera.position);

    // apply look orientation from accumulated yaw/pitch
    const euler = new THREE.Euler(pitch.current, yaw.current, 0, "YXZ");
    const q = new THREE.Quaternion().setFromEuler(euler);
    camera.quaternion.slerp(q, Math.min(1, dt * 12));
  });

  return null;
}
