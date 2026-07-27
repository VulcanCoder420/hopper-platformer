/**
 * Bloom — original grow power-up (mushroom-like).
 * Emerge from a prize block → slide on ground → collect for Super form.
 */

import * as THREE from 'three';
import { BLOOM } from '../game/config';
import type { Solid } from '../levels/types';
import { aabbOverlap } from '../levels/Collision';

export type BloomPhase = 'emerge' | 'slide' | 'collected';

/**
 * Procedural red-capped bloom (no Nintendo mushroom art).
 * Position is feet/bottom-center while sliding; during emerge Y lerps up.
 */
export class Bloom {
  x: number;
  y: number;
  z: number;
  vx = 0;
  vy = 0;
  facing: 1 | -1 = 1;
  phase: BloomPhase = 'emerge';
  collected = false;

  readonly group: THREE.Group;
  private emergeT = 0;
  private readonly emergeFromY: number;
  private readonly targetY: number;
  private readonly body: THREE.Group;

  constructor(x: number, blockTopY: number, z = 0, initialFacing: 1 | -1 = 1) {
    this.x = x;
    this.emergeFromY = blockTopY;
    this.targetY = blockTopY + BLOOM.emergeHeight;
    this.y = blockTopY;
    this.z = z;
    this.facing = initialFacing;
    this.vx = BLOOM.slideSpeed * initialFacing;

    this.group = new THREE.Group();
    this.group.name = 'Bloom';
    this.body = this.buildMesh();
    this.group.add(this.body);
    this.group.position.set(x, this.y, z);
  }

  private buildMesh(): THREE.Group {
    const g = new THREE.Group();

    // Stem
    const stem = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.14, 0.22, 10),
      new THREE.MeshStandardMaterial({
        color: 0xfff3e0,
        roughness: 0.75,
        metalness: 0.05,
      }),
    );
    stem.position.y = 0.12;
    stem.castShadow = true;
    g.add(stem);

    // Cap — warm coral (original, not Nintendo red/white)
    const cap = new THREE.Mesh(
      new THREE.SphereGeometry(0.28, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55),
      new THREE.MeshStandardMaterial({
        color: 0xff6b4a,
        roughness: 0.45,
        metalness: 0.12,
        emissive: 0xc62828,
        emissiveIntensity: 0.35,
      }),
    );
    cap.position.y = 0.28;
    cap.castShadow = true;
    g.add(cap);

    // Spots
    const spotMat = new THREE.MeshStandardMaterial({
      color: 0xffe082,
      roughness: 0.5,
      emissive: 0xffc107,
      emissiveIntensity: 0.4,
    });
    for (const [sx, sy, sr] of [
      [-0.1, 0.34, 0.07],
      [0.12, 0.3, 0.06],
      [0.02, 0.4, 0.05],
    ] as const) {
      const spot = new THREE.Mesh(new THREE.SphereGeometry(sr, 8, 6), spotMat);
      spot.position.set(sx, sy, 0.18);
      g.add(spot);
    }

    return g;
  }

  get object3d(): THREE.Object3D {
    return this.group;
  }

  getBounds(): Solid {
    return {
      minX: this.x - BLOOM.halfW,
      maxX: this.x + BLOOM.halfW,
      minY: this.y,
      maxY: this.y + BLOOM.height,
    };
  }

  update(dt: number, solids: readonly Solid[]): void {
    if (this.collected || this.phase === 'collected') return;

    if (this.phase === 'emerge') {
      this.emergeT += dt;
      const t = Math.min(1, this.emergeT / BLOOM.emergeDuration);
      // Ease out
      const e = 1 - (1 - t) * (1 - t);
      this.y = this.emergeFromY + (this.targetY - this.emergeFromY) * e;
      this.group.position.set(this.x, this.y, this.z);
      this.group.scale.setScalar(0.55 + 0.45 * e);
      if (t >= 1) {
        this.phase = 'slide';
        this.y = this.targetY;
        this.group.scale.setScalar(1);
      }
      return;
    }

    // Slide on ground with simple gravity + wall/edge turn
    this.vy -= BLOOM.gravity * dt;
    if (this.vy < -BLOOM.terminal) this.vy = -BLOOM.terminal;

    this.x += this.vx * dt;
    this.resolveHorizontal(solids);

    this.y += this.vy * dt;
    this.resolveVertical(solids);

    this.group.position.set(this.x, this.y, this.z);
    this.group.scale.x = this.facing;
    // Gentle bob
    this.body.position.y = Math.sin(performance.now() * 0.008) * 0.03;
  }

  private resolveHorizontal(solids: readonly Solid[]): void {
    const b = this.getBounds();
    for (const s of solids) {
      if (!aabbOverlap(b, s)) continue;
      const overlapL = b.maxX - s.minX;
      const overlapR = s.maxX - b.minX;
      if (overlapL < overlapR) {
        this.x -= overlapL + 0.02;
        this.turn();
      } else {
        this.x += overlapR + 0.02;
        this.turn();
      }
      Object.assign(b, this.getBounds());
    }
  }

  private resolveVertical(solids: readonly Solid[]): void {
    const b = this.getBounds();
    for (const s of solids) {
      if (!aabbOverlap(b, s)) continue;
      const overlapB = b.maxY - s.minY;
      const overlapT = s.maxY - b.minY;
      if (overlapT < overlapB) {
        this.y += overlapT;
        this.vy = 0;
      } else {
        this.y -= overlapB;
        if (this.vy > 0) this.vy = 0;
      }
      Object.assign(b, this.getBounds());
    }

    // Ledge turn: if no ground ahead, reverse
    if (this.vy <= 0.01) {
      const probeX = this.x + this.facing * (BLOOM.halfW + 0.12);
      const feetY = this.y - 0.08;
      let ground = false;
      for (const s of solids) {
        if (probeX >= s.minX && probeX <= s.maxX && feetY <= s.maxY && feetY >= s.maxY - 0.35) {
          ground = true;
          break;
        }
      }
      if (!ground) this.turn();
    }
  }

  private turn(): void {
    this.facing = (this.facing === 1 ? -1 : 1) as 1 | -1;
    this.vx = BLOOM.slideSpeed * this.facing;
  }

  collect(): void {
    this.collected = true;
    this.phase = 'collected';
    this.group.visible = false;
  }

  dispose(): void {
    this.group.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry?.dispose();
        const m = obj.material;
        if (Array.isArray(m)) m.forEach((mm) => mm.dispose());
        else m?.dispose();
      }
    });
    this.group.removeFromParent();
  }
}
