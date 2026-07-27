import type { Solid } from '../levels/types';
import { aabbOverlap } from '../levels/Collision';
import { Enemy } from './Enemy';
import { getBruiserArt } from './EnemyArt';

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

  /** Violet blob patroller — waddle cycle plus a stomp-squash death clip. */
  private buildMesh(): void {
    this.setBody(getBruiserArt(), 'walk');
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
