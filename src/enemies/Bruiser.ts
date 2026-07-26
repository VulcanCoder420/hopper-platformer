import * as THREE from 'three';
import type { Solid } from '../levels/types';
import { aabbOverlap } from '../levels/Collision';
import { Enemy } from './Enemy';

const WALK_SPEED = 1.85;
const GRAVITY = 48;
const TERMINAL = 28;

/**
 * Ground walker — patrols back and forth, ledge-aware, turns at walls/edges.
 * Stylized non-infringing "bruiser blob" with stubby legs and a grumpy face.
 */
export class Bruiser extends Enemy {
  /** Optional hard patrol half-width from spawn; 0 = free (ledge/wall only). */
  patrolHalf = 0;
  private readonly spawnX: number;
  private grounded = false;

  constructor(x: number, y: number, patrolHalf = 0) {
    super('bruiser', x, y, { halfW: 0.4, height: 0.7, hp: 1 });
    this.spawnX = x;
    this.patrolHalf = patrolHalf;
    this.vx = WALK_SPEED;
    this.facing = 1;
    this.buildMesh();
  }

  private buildMesh(): void {
    // Body — round violet/plum blob (original palette, not Mario-branded)
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x7b4fd6,
      roughness: 0.45,
      metalness: 0.08,
      emissive: 0x2a1450,
      emissiveIntensity: 0.12,
    });
    const bellyMat = new THREE.MeshStandardMaterial({
      color: 0xc9a0ff,
      roughness: 0.5,
      metalness: 0.04,
    });
    const eyeMat = new THREE.MeshStandardMaterial({
      color: 0x1a1a2e,
      roughness: 0.3,
      metalness: 0,
    });
    const accentMat = new THREE.MeshStandardMaterial({
      color: 0xff8a5c,
      roughness: 0.4,
      metalness: 0.1,
      emissive: 0xff8a5c,
      emissiveIntensity: 0.1,
    });
    const footMat = new THREE.MeshStandardMaterial({
      color: 0x4a3080,
      roughness: 0.55,
      metalness: 0.05,
    });

    const body = new THREE.Mesh(new THREE.SphereGeometry(0.38, 16, 14), bodyMat);
    body.position.y = 0.4;
    body.scale.set(1.05, 0.92, 0.95);
    body.castShadow = true;
    body.receiveShadow = true;
    this.bodyRoot.add(body);

    // Soft belly patch
    const belly = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 10), bellyMat);
    belly.position.set(0.12, 0.34, 0);
    belly.scale.set(0.7, 0.85, 0.9);
    belly.castShadow = true;
    this.bodyRoot.add(belly);

    // Brow ridge (grumpy)
    const brow = new THREE.Mesh(
      new THREE.BoxGeometry(0.32, 0.06, 0.28),
      accentMat,
    );
    brow.position.set(0.18, 0.52, 0);
    brow.rotation.z = -0.12;
    brow.castShadow = true;
    this.bodyRoot.add(brow);

    // Eyes face +X
    const eyeGeo = new THREE.SphereGeometry(0.07, 10, 8);
    const eyeL = new THREE.Mesh(eyeGeo, eyeMat);
    eyeL.position.set(0.28, 0.44, 0.12);
    const eyeR = new THREE.Mesh(eyeGeo, eyeMat);
    eyeR.position.set(0.28, 0.44, -0.12);
    this.bodyRoot.add(eyeL, eyeR);

    // Stubby feet
    const footGeo = new THREE.BoxGeometry(0.22, 0.12, 0.18);
    const footL = new THREE.Mesh(footGeo, footMat);
    footL.position.set(0.02, 0.06, 0.16);
    footL.castShadow = true;
    const footR = new THREE.Mesh(footGeo, footMat);
    footR.position.set(0.02, 0.06, -0.16);
    footR.castShadow = true;
    this.bodyRoot.add(footL, footR);

    // Tiny horns / spikes for silhouette (non-infringing)
    const spikeGeo = new THREE.ConeGeometry(0.07, 0.16, 6);
    const spikeL = new THREE.Mesh(spikeGeo, accentMat);
    spikeL.position.set(-0.05, 0.72, 0.12);
    spikeL.rotation.z = -0.25;
    spikeL.castShadow = true;
    const spikeR = new THREE.Mesh(spikeGeo, accentMat);
    spikeR.position.set(-0.05, 0.72, -0.12);
    spikeR.rotation.z = -0.25;
    spikeR.castShadow = true;
    this.bodyRoot.add(spikeL, spikeR);
  }

  protected updateAlive(dt: number, solids: readonly Solid[]): void {
    // Gravity
    this.vy -= GRAVITY * dt;
    if (this.vy < -TERMINAL) this.vy = -TERMINAL;

    // Desired horizontal speed
    const speed = WALK_SPEED * this.facing;
    this.vx = speed;

    // Integrate X then resolve walls
    this.x += this.vx * dt;
    if (this.resolveHorizontal(solids)) {
      this.turn();
    }

    // Hard patrol bounds
    if (this.patrolHalf > 0) {
      if (this.x > this.spawnX + this.patrolHalf) {
        this.x = this.spawnX + this.patrolHalf;
        this.turn();
      } else if (this.x < this.spawnX - this.patrolHalf) {
        this.x = this.spawnX - this.patrolHalf;
        this.turn();
      }
    }

    // Integrate Y + ground
    this.y += this.vy * dt;
    this.grounded = false;
    this.resolveVertical(solids);
    if (this.vy <= 0.01) {
      this.probeGround(solids);
    }

    // Ledge awareness: if grounded and no ground ahead, turn
    if (this.grounded && this.wouldFallOff(solids)) {
      this.turn();
      // Nudge back so we don't oscillate on the lip
      this.x -= this.facing * 0.08;
    }
  }

  private turn(): void {
    this.facing = (this.facing === 1 ? -1 : 1) as 1 | -1;
    this.vx = WALK_SPEED * this.facing;
  }

  private resolveHorizontal(solids: readonly Solid[]): boolean {
    const b = this.getBounds();
    let hit = false;
    for (const s of solids) {
      if (!aabbOverlap(b, s)) continue;
      const overlapL = b.maxX - s.minX;
      const overlapR = s.maxX - b.minX;
      if (overlapL < overlapR) {
        this.x -= overlapL + 0.01;
        if (this.vx > 0) hit = true;
      } else {
        this.x += overlapR + 0.01;
        if (this.vx < 0) hit = true;
      }
      Object.assign(b, this.getBounds());
    }
    return hit;
  }

  private resolveVertical(solids: readonly Solid[]): void {
    const b = this.getBounds();
    for (const s of solids) {
      if (!aabbOverlap(b, s)) continue;
      const overlapB = b.maxY - s.minY;
      const overlapT = s.maxY - b.minY;
      if (overlapT < overlapB) {
        this.y += overlapT;
        if (this.vy < 0) {
          this.vy = 0;
          this.grounded = true;
        }
      } else {
        this.y -= overlapB;
        if (this.vy > 0) this.vy = 0;
      }
      Object.assign(b, this.getBounds());
    }
  }

  private probeGround(solids: readonly Solid[]): void {
    const skin = 0.03;
    const feet: Solid = {
      minX: this.x - this.halfW * 0.85,
      maxX: this.x + this.halfW * 0.85,
      minY: this.y - skin * 2,
      maxY: this.y + skin,
    };
    for (const s of solids) {
      if (feet.maxX <= s.minX || feet.minX >= s.maxX) continue;
      if (this.y <= s.maxY + skin * 2 && this.y >= s.maxY - skin * 2) {
        this.y = s.maxY;
        this.grounded = true;
        if (this.vy < 0) this.vy = 0;
        return;
      }
    }
  }

  /** True if stepping forward would leave solid ground. */
  private wouldFallOff(solids: readonly Solid[]): boolean {
    const probeX = this.x + this.facing * (this.halfW + 0.12);
    const probe: Solid = {
      minX: probeX - 0.08,
      maxX: probeX + 0.08,
      minY: this.y - 0.25,
      maxY: this.y + 0.05,
    };
    for (const s of solids) {
      // Ground under probe if top surface is near feet and X overlaps
      if (probe.maxX <= s.minX || probe.minX >= s.maxX) continue;
      if (s.maxY <= this.y + 0.08 && s.maxY >= this.y - 0.35) {
        return false;
      }
    }
    return true;
  }
}
