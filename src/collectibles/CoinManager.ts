import type * as THREE from 'three';
import type { LevelDef, CoinSpawn } from '../levels/types';
import { aabbOverlap } from '../levels/Collision';
import type { Player } from '../player/Player';
import { Coin } from './Coin';

export interface CoinCollectEvent {
  coin: Coin;
  x: number;
  y: number;
  z: number;
}

export interface CoinManagerHooks {
  onCollect?: (ev: CoinCollectEvent) => void;
}

/**
 * Owns coin lifecycle: spawn from LevelDef, animate, collect on player overlap.
 */
export class CoinManager {
  private coins: Coin[] = [];
  private scene: THREE.Scene | null = null;
  hooks: CoinManagerHooks = {};

  setScene(scene: THREE.Scene): void {
    this.scene = scene;
  }

  setHooks(hooks: CoinManagerHooks): void {
    this.hooks = hooks;
  }

  get list(): readonly Coin[] {
    return this.coins;
  }

  get remaining(): number {
    return this.coins.filter((c) => !c.collected).length;
  }

  get collectedCount(): number {
    return this.coins.filter((c) => c.collected).length;
  }

  spawnFromLevel(def: LevelDef): void {
    this.clear();
    for (const spawn of def.coins ?? []) {
      this.addFromSpawn(spawn);
    }
  }

  addFromSpawn(spawn: CoinSpawn): Coin {
    const coin = new Coin(spawn.x, spawn.y, spawn.z ?? 0);
    this.add(coin);
    return coin;
  }

  add(coin: Coin): void {
    this.coins.push(coin);
    this.scene?.add(coin.object3d);
  }

  clear(): void {
    for (const c of this.coins) {
      c.dispose();
    }
    this.coins.length = 0;
  }

  update(dt: number, elapsed: number): void {
    for (const c of this.coins) {
      if (!c.collected) c.update(dt, elapsed);
    }
  }

  /**
   * Collect any coins overlapping the player AABB.
   * Returns number collected this frame.
   */
  collectOverlapping(player: Player): number {
    const pBounds = player.controller.getBounds();
    let n = 0;

    for (const coin of this.coins) {
      if (coin.collected) continue;
      if (!aabbOverlap(pBounds, coin.getBounds())) continue;

      coin.collect();
      const pos = coin.position;
      this.hooks.onCollect?.({
        coin,
        x: pos.x,
        y: pos.y,
        z: pos.z,
      });
      // Detach mesh immediately so it doesn't linger in scene graph
      coin.object3d.removeFromParent();
      n += 1;
    }

    return n;
  }

  dispose(): void {
    this.clear();
    this.scene = null;
  }
}
