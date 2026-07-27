import * as THREE from 'three';
import type { Solid } from '../levels/types';
import { solidFromCenter } from '../levels/Collision';
import {
  spriteFromArt,
  type AnimatedSprite,
  type CharacterArt,
} from '../render/SpriteSheet';

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
  /** Animated sprite body — created by the subclass via setBody(). */
  protected sprite: AnimatedSprite | null = null;
  /** Clip played while alive. Subclasses set it ('walk', 'fly', …). */
  protected moveClip = 'walk';
  protected walkPhase = 0;
  protected squash = 1;
  private deathClipStarted = false;

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
    this.group.position.set(x, y, 0);
  }

  /**
   * Attach the animated sprite body. Feet sit at the group origin, which is the
   * bottom of the collision AABB.
   */
  protected setBody(art: CharacterArt, initialClip: string): void {
    this.sprite = spriteFromArt(art, initialClip, { castShadow: true });
    this.moveClip = initialClip;
    this.group.add(this.sprite.object3d);
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
    // The squash is authored in the death clip's frames — no scale hack needed.
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
    const sprite = this.sprite;
    if (!sprite) return;

    if (!this.deathClipStarted) {
      sprite.play('squash', true);
      sprite.setDeform(1);
      this.deathClipStarted = true;
    }
    sprite.update(dt);

    // Dissolve over the back half of the hold. setOpacity flips the material to
    // blended mode and flags a recompile, which the old scale-based fade skipped
    // — leaving the corpse fully opaque until it popped out of existence.
    const t = 1 - this.deathTimer / this.deathDuration;
    if (t > 0.55) {
      sprite.setOpacity(1 - (t - 0.55) / 0.45);
    }
  }

  protected syncMesh(dt: number): void {
    this.group.position.set(this.x, this.y, 0);
    const sprite = this.sprite;
    if (!sprite) return;

    this.walkPhase += dt * (6 + Math.abs(this.vx) * 0.8);
    this.squash += (1 - this.squash) * Math.min(1, 8 * dt);
    sprite.setFacing(this.facing);
    // Feet-anchored geometry: scaling about y=0 keeps them planted, so unlike the
    // old mesh body this needs no vertical compensation.
    sprite.setDeform(this.squash);
    sprite.play(this.moveClip);
    sprite.update(dt);
  }

  dispose(): void {
    this.sprite?.dispose();
    this.sprite = null;
    this.group.removeFromParent();
  }
}
