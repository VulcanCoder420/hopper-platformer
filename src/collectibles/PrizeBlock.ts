/**
 * Hit-from-below prize block (question / brick with contents).
 * Idle → eject on ceiling hit → empty (used solid, no further prizes).
 */

import * as THREE from 'three';
import { PRIZE } from '../game/config';
import type { MultiCoinRules, PlatformDef, PrizeContents, Solid } from '../levels/types';
import { solidFromTop } from '../levels/Collision';

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
    this.faceMat = new THREE.MeshStandardMaterial({
      color: isQ ? 0xffc107 : 0xc45c3e,
      roughness: isQ ? 0.45 : 0.78,
      metalness: isQ ? 0.25 : 0.05,
      emissive: isQ ? 0xffa000 : 0x000000,
      emissiveIntensity: isQ ? 0.42 : 0,
    });

    this.bodyMesh = new THREE.Mesh(
      new THREE.BoxGeometry(this.size, this.size, Math.min(def.depth ?? this.size, this.size * 1.1)),
      this.faceMat,
    );
    this.bodyMesh.castShadow = true;
    this.bodyMesh.receiveShadow = true;
    this.bodyMesh.position.set(0, 0, 0);
    this.group.add(this.bodyMesh);

    // "?" glyph plane for active question look
    if (isQ && this.contents !== 'none') {
      const glyph = this.makeGlyph();
      glyph.position.set(0, 0, (def.depth ?? this.size) * 0.52);
      this.group.add(glyph);
    }

    // Rim
    const rim = new THREE.Mesh(
      new THREE.BoxGeometry(this.size * 1.02, this.size * 0.12, this.size * 1.02),
      new THREE.MeshStandardMaterial({
        color: isQ ? 0xe65100 : 0x8b3a2a,
        roughness: 0.7,
        metalness: 0.1,
      }),
    );
    rim.position.set(0, this.size * 0.4, 0);
    rim.castShadow = true;
    this.group.add(rim);

    this.group.position.set(this.x, this.restY, this.z);
  }

  private makeGlyph(): THREE.Mesh {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, 64, 64);
    ctx.fillStyle = '#fff8e1';
    ctx.strokeStyle = '#5d4037';
    ctx.lineWidth = 3;
    ctx.font = 'bold 48px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.strokeText('?', 32, 34);
    ctx.fillText('?', 32, 34);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(this.size * 0.7, this.size * 0.7), mat);
    mesh.name = 'PrizeGlyph';
    return mesh;
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
    this.faceMat.color.setHex(0x8d8d8d);
    this.faceMat.emissive.setHex(0x000000);
    this.faceMat.emissiveIntensity = 0;
    this.faceMat.roughness = 0.9;
    this.faceMat.metalness = 0.05;
    // Hide "?" glyph
    const glyph = this.group.getObjectByName('PrizeGlyph');
    if (glyph) glyph.visible = false;
  }

  update(dt: number): void {
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

    // Idle pulse on active question blocks
    if (this.state === 'active' && this.contents !== 'none') {
      this.faceMat.emissiveIntensity =
        0.35 + Math.sin(performance.now() * 0.006 + this.x) * 0.12;
    }
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
