import * as THREE from 'three';
import type { Solid } from '../levels/types';
import { solidFromCenter } from '../levels/Collision';

export type EnemyKind = 'bruiser' | 'skimmer';

/**
 * Base enemy: position, velocity, HP, AABB, mesh, death squash.
 * Subclasses implement AI in update().
 * Position is bottom-center (feet), matching the player.
 */
export abstract class Enemy {
  readonly kind: EnemyKind;
  x: number;
  y: number;
  vx = 0;
  vy = 0;
  hp: number;
  alive = true;
  /** Facing for mesh flip: +1 right, -1 left. */
  facing: 1 | -1 = 1;

  /** Half-width / height of collision AABB (feet at y). */
  halfW: number;
  height: number;

  /** Whether the player can stomp this enemy from above. */
  stompable = true;
  /** Whether side contact damages the player. */
  damagesOnTouch = true;

  /** Seconds remaining in death squash before mesh can be removed. */
  deathTimer = 0;
  readonly deathDuration = 0.38;

  readonly group: THREE.Group;
  protected readonly bodyRoot: THREE.Group;
  protected walkPhase = 0;
  protected squash = 1;

  constructor(
    kind: EnemyKind,
    x: number,
    y: number,
    opts: { halfW?: number; height?: number; hp?: number } = {},
  ) {
    this.kind = kind;
    this.x = x;
    this.y = y;
    this.halfW = opts.halfW ?? 0.38;
    this.height = opts.height ?? 0.72;
    this.hp = opts.hp ?? 1;

    this.group = new THREE.Group();
    this.group.name = `Enemy_${kind}`;
    this.bodyRoot = new THREE.Group();
    this.group.add(this.bodyRoot);
    this.group.position.set(x, y, 0);
  }

  get object3d(): THREE.Object3D {
    return this.group;
  }

  /** True while alive or still playing death anim (mesh present). */
  get active(): boolean {
    return this.alive || this.deathTimer > 0;
  }

  /** True when fully finished (dead + anim done) — safe to remove. */
  get shouldRemove(): boolean {
    return !this.alive && this.deathTimer <= 0;
  }

  /** Feet-based AABB. */
  getBounds(ox = this.x, oy = this.y): Solid {
    return {
      minX: ox - this.halfW,
      maxX: ox + this.halfW,
      minY: oy,
      maxY: oy + this.height,
    };
  }

  /** Center-based solid (convenience). */
  getCenterBounds(): Solid {
    return solidFromCenter(this.x, this.y + this.height * 0.5, this.halfW * 2, this.height);
  }

  /**
   * Take damage; hp <= 0 triggers kill().
   * Returns true if this hit killed the enemy.
   */
  hurt(amount = 1): boolean {
    if (!this.alive) return false;
    this.hp -= amount;
    if (this.hp <= 0) {
      this.kill();
      return true;
    }
    return false;
  }

  /** Instant death with squash animation. */
  kill(): void {
    if (!this.alive) return;
    this.alive = false;
    this.hp = 0;
    this.vx = 0;
    this.vy = 0;
    this.deathTimer = this.deathDuration;
    this.squash = 0.35;
  }

  setPosition(x: number, y: number): void {
    this.x = x;
    this.y = y;
    this.group.position.set(x, y, 0);
  }

  /**
   * AI + physics. Dead enemies only tick death squash.
   */
  update(dt: number, solids: readonly Solid[]): void {
    if (!this.alive) {
      this.tickDeath(dt);
      return;
    }
    this.updateAlive(dt, solids);
    this.syncMesh(dt);
  }

  protected abstract updateAlive(dt: number, solids: readonly Solid[]): void;

  protected tickDeath(dt: number): void {
    this.deathTimer = Math.max(0, this.deathTimer - dt);
    // Squash flat and sink slightly
    const t = 1 - this.deathTimer / this.deathDuration;
    const sy = Math.max(0.08, 0.35 * (1 - t) + 0.08);
    const sxz = 1.35 + t * 0.4;
    this.bodyRoot.scale.set(sxz * this.facing, sy, sxz);
    this.bodyRoot.position.y = (1 - sy) * this.height * 0.15;
    // Fade-ish via opacity if materials support it
    if (t > 0.55) {
      this.group.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          const mat = obj.material as THREE.MeshStandardMaterial;
          if (mat && 'opacity' in mat) {
            mat.transparent = true;
            mat.opacity = Math.max(0, 1 - (t - 0.55) / 0.45);
          }
        }
      });
    }
  }

  protected syncMesh(dt: number): void {
    this.group.position.set(this.x, this.y, 0);
    // Bob / walk juice
    this.walkPhase += dt * (6 + Math.abs(this.vx) * 0.8);
    const bob = Math.sin(this.walkPhase) * 0.03;
    this.squash += (1 - this.squash) * Math.min(1, 8 * dt);
    const sy = this.squash;
    const sxz = 1 / Math.sqrt(Math.max(sy, 0.5));
    this.bodyRoot.scale.set(sxz * this.facing, sy, sxz);
    this.bodyRoot.position.y = bob + (1 - sy) * 0.2;
  }

  dispose(): void {
    this.group.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry?.dispose();
        const mat = obj.material;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else mat?.dispose();
      }
    });
    this.group.removeFromParent();
  }
}
