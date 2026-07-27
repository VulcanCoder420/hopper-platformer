import type * as THREE from 'three';
import type { LevelDef, PlatformDef, Solid } from '../levels/types';
import { PrizeBlock, type PrizeEjectEvent } from './PrizeBlock';

export interface PrizeBlockManagerHooks {
  onEject?: (ev: PrizeEjectEvent) => void;
}

function isPrizePlatform(p: PlatformDef): boolean {
  if (p.solid === false) return false;
  if (p.contents && p.contents !== 'none') return true;
  // Question blocks always prize (default coin) unless contents: 'none'
  if (p.style === 'question' && p.contents !== 'none') return true;
  return false;
}

/**
 * Owns interactive prize blocks for a level: spawn, hit-from-below, bounce, empty.
 * Collision solids are shared with the level list so the player still bonks them.
 */
export class PrizeBlockManager {
  private blocks: PrizeBlock[] = [];
  private scene: THREE.Scene | null = null;
  hooks: PrizeBlockManagerHooks = {};

  setScene(scene: THREE.Scene): void {
    this.scene = scene;
  }

  setHooks(hooks: PrizeBlockManagerHooks): void {
    this.hooks = hooks;
  }

  get list(): readonly PrizeBlock[] {
    return this.blocks;
  }

  /**
   * Clear and rebuild from level platforms that carry prizes.
   * Returns solids to merge into the level solid list for collision.
   */
  spawnFromLevel(def: LevelDef): Solid[] {
    this.clear();
    const solids: Solid[] = [];
    for (const p of def.platforms) {
      if (!isPrizePlatform(p)) continue;
      const block = new PrizeBlock(p);
      this.blocks.push(block);
      this.scene?.add(block.object3d);
      solids.push(block.solid);
    }
    return solids;
  }

  /**
   * Platforms that PrizeBlockManager will own (LevelLoader should skip meshing them
   * to avoid double geometry — solids still come from here).
   */
  static isOwnedPlatform(p: PlatformDef): boolean {
    return isPrizePlatform(p);
  }

  /**
   * Try to hit the prize block matching a ceiling solid.
   * Returns the eject event if something popped out.
   */
  handleCeilingHit(solid: Solid): PrizeEjectEvent | null {
    for (const b of this.blocks) {
      if (!b.matchesSolid(solid)) continue;
      const ev = b.tryHit();
      if (ev) this.hooks.onEject?.(ev);
      return ev;
    }
    // Fallback: head-near-underside match (if solid refs don't align)
    return null;
  }

  /**
   * Also try spatial match using player head position (more robust than solid equality).
   */
  tryHitAt(headX: number, headTopY: number): PrizeEjectEvent | null {
    for (const b of this.blocks) {
      if (!b.isActive) continue;
      const underside = b.topY - b.size;
      if (headTopY < underside - 0.15 || headTopY > underside + 0.35) continue;
      if (headX < b.solid.minX - 0.05 || headX > b.solid.maxX + 0.05) continue;
      const ev = b.tryHit();
      if (ev) this.hooks.onEject?.(ev);
      return ev;
    }
    return null;
  }

  update(dt: number): void {
    for (const b of this.blocks) b.update(dt);
  }

  clear(): void {
    for (const b of this.blocks) b.dispose();
    this.blocks.length = 0;
  }

  dispose(): void {
    this.clear();
    this.scene = null;
  }
}
