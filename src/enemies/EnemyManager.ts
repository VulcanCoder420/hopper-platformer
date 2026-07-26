import type * as THREE from 'three';
import type { LevelDef, EnemySpawn, Solid } from '../levels/types';
import { aabbOverlap } from '../levels/Collision';
import type { Player } from '../player/Player';
import { Enemy } from './Enemy';
import { Bruiser } from './Bruiser';
import { Skimmer } from './Skimmer';

/** Result of one frame of player–enemy resolution. */
export interface EnemyContactResult {
  stomped: number;
  hurtPlayer: boolean;
}

export interface EnemyManagerHooks {
  onStomp?: (enemy: Enemy) => void;
  onPlayerHurt?: (enemy: Enemy) => void;
}

/**
 * Owns enemy lifecycle: spawn from LevelDef, update AI, player collision,
 * death cleanup.
 */
export class EnemyManager {
  private enemies: Enemy[] = [];
  private scene: THREE.Scene | null = null;
  private solids: readonly Solid[] = [];
  hooks: EnemyManagerHooks = {};

  /** Bounce impulse applied to player on successful stomp. */
  stompBounceVy = 9.5;

  setScene(scene: THREE.Scene): void {
    this.scene = scene;
  }

  setSolids(solids: readonly Solid[]): void {
    this.solids = solids;
  }

  setHooks(hooks: EnemyManagerHooks): void {
    this.hooks = hooks;
  }

  get list(): readonly Enemy[] {
    return this.enemies;
  }

  get aliveCount(): number {
    return this.enemies.filter((e) => e.alive).length;
  }

  /**
   * Clear existing enemies and spawn from level definition.
   */
  spawnFromLevel(def: LevelDef): void {
    this.clear();
    const spawns = def.enemies ?? [];
    for (const spawn of spawns) {
      const enemy = this.createFromSpawn(spawn);
      if (enemy) this.add(enemy);
    }
  }

  createFromSpawn(spawn: EnemySpawn): Enemy | null {
    const type = (spawn.type || 'bruiser').toLowerCase();
    const patrol = spawn.patrol ?? 0;

    switch (type) {
      case 'bruiser':
      case 'goomba':
      case 'koopa':
        return new Bruiser(spawn.x, spawn.y, patrol);
      case 'skimmer':
      case 'flyer':
      case 'fly':
        return new Skimmer(spawn.x, spawn.y, { patrol: patrol || 2.0 });
      default:
        // Unknown types default to ground walker so levels stay playable
        console.warn(`[EnemyManager] Unknown enemy type "${spawn.type}", using Bruiser`);
        return new Bruiser(spawn.x, spawn.y, patrol);
    }
  }

  add(enemy: Enemy): void {
    this.enemies.push(enemy);
    this.scene?.add(enemy.object3d);
  }

  clear(): void {
    for (const e of this.enemies) {
      e.dispose();
    }
    this.enemies.length = 0;
  }

  /**
   * Tick AI for all enemies, then prune fully-dead ones.
   */
  update(dt: number): void {
    for (const e of this.enemies) {
      e.update(dt, this.solids);
    }
    // Remove finished death anims
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i]!;
      if (e.shouldRemove) {
        e.dispose();
        this.enemies.splice(i, 1);
      }
    }
  }

  /**
   * Kill / remove enemies that fell below a death plane (performance + cleanup).
   */
  cullBelow(y: number): void {
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i]!;
      if (e.y < y) {
        e.dispose();
        this.enemies.splice(i, 1);
      }
    }
  }

  /**
   * Resolve player vs enemies: stomp from above kills, side contact hurts.
   * Call after player.update so positions are current.
   */
  resolvePlayer(player: Player): EnemyContactResult {
    const result: EnemyContactResult = { stomped: 0, hurtPlayer: false };
    if (!player) return result;

    const pBounds = player.controller.getBounds();
    const pVy = player.controller.vy;

    for (const enemy of this.enemies) {
      if (!enemy.alive) continue;
      const eBounds = enemy.getBounds();
      if (!aabbOverlap(pBounds, eBounds)) continue;

      const isStomp =
        enemy.stompable &&
        pVy < -0.8 &&
        // Player feet in upper portion of enemy box (coming from above)
        pBounds.minY >= eBounds.minY + (eBounds.maxY - eBounds.minY) * 0.28 &&
        // Player not mostly below
        pBounds.minY < eBounds.maxY + 0.15;

      if (isStomp) {
        const killed = enemy.hurt(1);
        if (killed) {
          result.stomped += 1;
          // Bounce player up
          player.controller.vy = this.stompBounceVy;
          // Ensure not stuck inside corpse
          const top = eBounds.maxY;
          if (player.controller.y < top) {
            player.controller.y = top;
          }
          this.hooks.onStomp?.(enemy);
          player.onStomp?.(pVy);
        }
        continue;
      }

      // Side / underside contact
      if (enemy.damagesOnTouch) {
        result.hurtPlayer = true;
        this.hooks.onPlayerHurt?.(enemy);
        // Only one hurt event per frame
        break;
      }
    }

    return result;
  }

  dispose(): void {
    this.clear();
    this.scene = null;
  }
}
