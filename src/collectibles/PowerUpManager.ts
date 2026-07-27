import type * as THREE from 'three';
import type { Solid } from '../levels/types';
import { aabbOverlap } from '../levels/Collision';
import type { Player } from '../player/Player';
import { Bloom } from './Bloom';

export interface PowerUpCollectEvent {
  bloom: Bloom;
  x: number;
  y: number;
  z: number;
}

export interface PowerUpManagerHooks {
  onCollect?: (ev: PowerUpCollectEvent) => void;
}

/**
 * Owns Bloom power-ups: spawn from prize ejects, slide AI, player collect.
 */
export class PowerUpManager {
  private blooms: Bloom[] = [];
  private scene: THREE.Scene | null = null;
  private solids: readonly Solid[] = [];
  hooks: PowerUpManagerHooks = {};

  setScene(scene: THREE.Scene): void {
    this.scene = scene;
  }

  setSolids(solids: readonly Solid[]): void {
    this.solids = solids;
  }

  setHooks(hooks: PowerUpManagerHooks): void {
    this.hooks = hooks;
  }

  get list(): readonly Bloom[] {
    return this.blooms;
  }

  /** Spawn a Bloom emerging from a prize block. */
  spawnBloom(x: number, blockTopY: number, z = 0, facing: 1 | -1 = 1): Bloom {
    const bloom = new Bloom(x, blockTopY, z, facing);
    this.blooms.push(bloom);
    this.scene?.add(bloom.object3d);
    return bloom;
  }

  update(dt: number): void {
    for (const b of this.blooms) {
      if (!b.collected) b.update(dt, this.solids);
    }
    // Prune collected
    for (let i = this.blooms.length - 1; i >= 0; i--) {
      const b = this.blooms[i]!;
      if (b.collected) {
        b.dispose();
        this.blooms.splice(i, 1);
      }
    }
  }

  collectOverlapping(player: Player): number {
    const pBounds = player.controller.getBounds();
    let n = 0;
    for (const b of this.blooms) {
      if (b.collected || b.phase === 'emerge') continue;
      if (!aabbOverlap(pBounds, b.getBounds())) continue;
      b.collect();
      this.hooks.onCollect?.({
        bloom: b,
        x: b.x,
        y: b.y + 0.3,
        z: b.z,
      });
      n += 1;
    }
    return n;
  }

  clear(): void {
    for (const b of this.blooms) b.dispose();
    this.blooms.length = 0;
  }

  dispose(): void {
    this.clear();
    this.scene = null;
  }
}
