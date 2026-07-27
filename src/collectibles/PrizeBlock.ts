/**
 * Hit-from-below prize block (question / brick with contents).
 * Idle → eject on ceiling hit → empty (used solid, no further prizes).
 */

import * as THREE from 'three';
import { PRIZE } from '../game/config';
import type { MultiCoinRules, PlatformDef, PrizeContents, Solid } from '../levels/types';
import { solidFromTop } from '../levels/Collision';
import { surfaceMaterial } from '../levels/surfaces';

export type PrizeBlockState = 'active' | 'empty';

export interface PrizeEjectEvent {
  block: PrizeBlock;
  contents: PrizeContents;
  x: number;
  /** World Y of the top of the block (spawn above this). */
  topY: number;
  z: number;
}

function resolveContents(p: PlatformDef): PrizeContents {
  if (p.contents) return p.contents;
  // Question style defaults to a single coin when contents omitted.
  if (p.style === 'question') return 'coin';
  return 'none';
}

/**
 * Interactive prize solid. Collision still comes from the level solids list;
 * this class owns state, bounce animation, and used visual.
 */
export class PrizeBlock {
  readonly x: number;
  readonly topY: number;
  readonly size: number;
  readonly z: number;
  readonly solid: Solid;
  readonly contents: PrizeContents;
  readonly multi: MultiCoinRules;

  state: PrizeBlockState = 'active';
  /** Coins already ejected (multi-coin). */
  coinsEjected = 0;
  /** Seconds remaining in multi-coin window after first hit; -1 = not started. */
  multiWindowLeft = -1;

  readonly group: THREE.Group;
  private readonly bodyMesh: THREE.Mesh;
  private readonly faceMat: THREE.MeshStandardMaterial;
  private bounceT = 0;
  private hitCooldown = 0;
  private readonly restY: number;
  /** Local clock — the idle pulse must stop when the world does. */
  private age = 0;
  /** Shared cache material shown once spent; never mutated, never disposed here. */
  private readonly spentMat: THREE.MeshStandardMaterial;
  private readonly rimMat: THREE.MeshStandardMaterial;

  constructor(def: PlatformDef) {
    this.x = def.x;
    this.topY = def.y;
    this.size = Math.max(def.w, def.h);
    this.z = def.z ?? 0;
    this.solid = solidFromTop(def.x, def.y, this.size, this.size);
    this.contents = resolveContents(def);
    this.multi = def.multiCoin ?? {
      durationSec: PRIZE.multiCoinDefaultDuration,
      maxCoins: PRIZE.multiCoinDefaultMax,
    };

    this.group = new THREE.Group();
    this.group.name = this.contents === 'none' ? 'Block' : 'PrizeBlock';
    this.restY = def.y - this.size * 0.5;

    const isQ = def.style === 'question' || this.contents !== 'none';
    // Clone the cached surface material so this block owns its emissive pulse.
    // The clone shares the texture, so the "?" and the world's other blocks stay
    // one look — mutating the cache entry directly would bleed across levels.
    this.faceMat = surfaceMaterial(
      isQ ? 'question' : 'brick',
      'top',
      this.size,
      this.size,
    ).clone();
    this.faceMat.emissive.setHex(isQ ? 0xffa000 : 0x000000);
    this.faceMat.emissiveIntensity = isQ ? 0.42 : 0;
    this.spentMat = surfaceMaterial('stone', 'body', this.size, this.size);

    this.bodyMesh = new THREE.Mesh(
      new THREE.BoxGeometry(this.size, this.size, Math.min(def.depth ?? this.size, this.size * 1.1)),
      this.faceMat,
    );
    this.bodyMesh.castShadow = true;
    this.bodyMesh.receiveShadow = true;
    this.bodyMesh.position.set(0, 0, 0);
    this.group.add(this.bodyMesh);

    // No separate "?" plane: the question surface texture already carries the
    // glyph on every face. The old plane was also positioned off `def.depth`
    // while the body clamps its depth, so it could float clear of the block.

    // Rim
    this.rimMat = new THREE.MeshStandardMaterial({
      color: isQ ? 0xe65100 : 0x8b3a2a,
      roughness: 0.7,
      metalness: 0.1,
    });
    const rim = new THREE.Mesh(
      new THREE.BoxGeometry(this.size * 1.02, this.size * 0.12, this.size * 1.02),
      this.rimMat,
    );
    rim.position.set(0, this.size * 0.4, 0);
    rim.castShadow = true;
    this.group.add(rim);

    this.group.position.set(this.x, this.restY, this.z);
  }

  get object3d(): THREE.Object3D {
    return this.group;
  }

  get isActive(): boolean {
    return this.state === 'active' && this.contents !== 'none';
  }

  /**
   * True if this solid matches the ceiling contact AABB (shared refs or near-equal).
   */
  matchesSolid(s: Solid, eps = 0.08): boolean {
    return (
      Math.abs(s.minX - this.solid.minX) < eps &&
      Math.abs(s.maxX - this.solid.maxX) < eps &&
      Math.abs(s.minY - this.solid.minY) < eps &&
      Math.abs(s.maxY - this.solid.maxY) < eps
    );
  }

  /**
   * Attempt a hit from below. Returns eject event or null if nothing ejected.
   */
  tryHit(): PrizeEjectEvent | null {
    if (!this.isActive) return null;
    if (this.hitCooldown > 0) return null;

    if (this.contents === 'multiCoin') {
      if (this.multiWindowLeft < 0) {
        this.multiWindowLeft = this.multi.durationSec;
      }
      if (this.multiWindowLeft <= 0 || this.coinsEjected >= this.multi.maxCoins) {
        this.setEmpty();
        return null;
      }
      this.coinsEjected += 1;
      this.hitCooldown = PRIZE.hitCooldown;
      this.bounceT = PRIZE.bounceDuration;
      const last =
        this.coinsEjected >= this.multi.maxCoins || this.multiWindowLeft <= PRIZE.hitCooldown;
      if (last) this.setEmpty();
      return {
        block: this,
        contents: 'coin',
        x: this.x,
        topY: this.topY,
        z: this.z,
      };
    }

    // Single coin or power-up — one shot then empty.
    const kind = this.contents;
    this.hitCooldown = PRIZE.hitCooldown;
    this.bounceT = PRIZE.bounceDuration;
    this.setEmpty();
    return {
      block: this,
      contents: kind,
      x: this.x,
      topY: this.topY,
      z: this.z,
    };
  }

  private setEmpty(): void {
    this.state = 'empty';
    // Swap to the spent look rather than recolouring: the active material carries
    // the "?" in its texture, which no amount of tinting removes.
    this.bodyMesh.material = this.spentMat;
    const glyph = this.group.getObjectByName('PrizeGlyph');
    if (glyph) glyph.visible = false;
  }

  update(dt: number): void {
    this.age += dt;
    if (this.hitCooldown > 0) this.hitCooldown = Math.max(0, this.hitCooldown - dt);

    if (this.multiWindowLeft > 0 && this.state === 'active') {
      this.multiWindowLeft = Math.max(0, this.multiWindowLeft - dt);
      if (this.multiWindowLeft <= 0 && this.coinsEjected > 0) {
        this.setEmpty();
      }
    }

    if (this.bounceT > 0) {
      this.bounceT = Math.max(0, this.bounceT - dt);
      const t = 1 - this.bounceT / PRIZE.bounceDuration;
      // Up then back: sin curve
      const lift = Math.sin(t * Math.PI) * PRIZE.bounceHeight;
      this.group.position.y = this.restY + lift;
    } else {
      this.group.position.y = this.restY;
    }

    // Idle pulse on active question blocks, off the local clock so a paused
    // world holds still instead of pulsing behind the panel.
    if (this.state === 'active' && this.contents !== 'none') {
      this.faceMat.emissiveIntensity =
        0.35 + Math.sin(this.age * 6 + this.x) * 0.12;
    }
  }

  dispose(): void {
    this.group.traverse((obj) => {
      if (obj instanceof THREE.Mesh) obj.geometry?.dispose();
    });
    // Only the per-block clone and the rim material belong to us — cached
    // surface materials are shared process-wide and disposeSurfaces() owns them.
    this.faceMat.dispose();
    this.rimMat.dispose();
    this.group.removeFromParent();
  }
}
