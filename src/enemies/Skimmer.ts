import type { Solid } from '../levels/types';
import { Enemy } from './Enemy';
import { getSkimmerArt } from './EnemyArt';

/**
 * Flying skimmer — glides on a horizontal path with a gentle sine bob.
 * Stompable from above; side contact damages the player.
 * Stylized teal finned flyer (original design).
 */
export class Skimmer extends Enemy {
  private readonly spawnX: number;
  private readonly spawnY: number;
  /** Horizontal patrol half-width. */
  patrolHalf: number;
  /** Sine bob amplitude (world units). */
  bobAmp: number;
  /** Sine bob frequency (rad/s-ish via phase). */
  bobSpeed: number;
  private phase = 0;
  private readonly baseSpeed: number;

  constructor(
    x: number,
    y: number,
    opts: {
      patrol?: number;
      bobAmp?: number;
      bobSpeed?: number;
      speed?: number;
    } = {},
  ) {
    super('skimmer', x, y, { halfW: 0.42, height: 0.55, hp: 1 });
    this.spawnX = x;
    this.spawnY = Math.max(y, 1.2);
    this.y = this.spawnY;
    this.patrolHalf = opts.patrol ?? 2.2;
    this.bobAmp = opts.bobAmp ?? 0.45;
    this.bobSpeed = opts.bobSpeed ?? 2.4;
    this.baseSpeed = opts.speed ?? 2.4;
    this.vx = this.baseSpeed;
    this.facing = 1;
    this.stompable = true;
    this.buildMesh();
  }

  /** Teal finned flyer — full wing-beat cycle plus a crumple death clip. */
  private buildMesh(): void {
    this.setBody(getSkimmerArt(), 'fly');
  }

  protected updateAlive(dt: number, _solids: readonly Solid[]): void {
    this.phase += dt * this.bobSpeed;

    // Horizontal patrol
    this.x += this.vx * dt;
    if (this.x > this.spawnX + this.patrolHalf) {
      this.x = this.spawnX + this.patrolHalf;
      this.vx = -this.baseSpeed;
      this.facing = -1;
    } else if (this.x < this.spawnX - this.patrolHalf) {
      this.x = this.spawnX - this.patrolHalf;
      this.vx = this.baseSpeed;
      this.facing = 1;
    }

    // Sine bob around spawn Y
    this.y = this.spawnY + Math.sin(this.phase) * this.bobAmp;
    this.vy = Math.cos(this.phase) * this.bobAmp * this.bobSpeed;
  }

  protected override syncMesh(dt: number): void {
    super.syncMesh(dt);
    // A slow roll layered over the sheet's wing-beat, so the glide reads as a
    // long arc rather than a rigid horizontal slide.
    const sprite = this.sprite;
    if (sprite) {
      sprite.mesh.rotation.z = Math.sin(this.walkPhase * 0.5) * 0.06 * this.facing;
    }
  }
}
