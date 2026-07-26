import { PLAYER, WORLD } from '../game/config';
import { approach, clamp } from '../utils/math';
import type { Input } from '../game/Input';
import type { Solid } from '../levels/types';
import { aabbOverlap } from '../levels/Collision';

export type { Solid };

export interface PlayerControllerHooks {
  onJump?: () => void;
  onLand?: (impactVy: number) => void;
  /** Fired when landing with strong downward velocity (enemy stomp later). */
  onStomp?: (impactVy: number) => void;
}

export interface PlayerControllerState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** +1 right, -1 left — last non-zero horizontal intent. */
  facing: 1 | -1;
  grounded: boolean;
}

/**
 * Mario-style movement brain: accel/decel, coyote, jump buffer,
 * variable jump height, asymmetric gravity, AABB vs solids.
 */
export class PlayerController {
  x = 0;
  y = 0;
  vx = 0;
  vy = 0;
  facing: 1 | -1 = 1;

  private grounded = false;
  private wasGrounded = false;
  private coyoteTimer = 0;
  private jumpBufferTimer = 0;
  private jumpHeld = false;
  /** Velocity at the moment of last ground contact (for land/stomp hooks). */
  private landImpactVy = 0;

  private solids: readonly Solid[] = [];
  private hooks: PlayerControllerHooks = {};

  readonly halfW = PLAYER.halfWidth;
  readonly height = PLAYER.height;

  setSolids(solids: readonly Solid[]): void {
    this.solids = solids;
  }

  setHooks(hooks: PlayerControllerHooks): void {
    this.hooks = hooks;
  }

  setPosition(x: number, y: number): void {
    this.x = x;
    this.y = y;
  }

  get isGrounded(): boolean {
    return this.grounded;
  }

  get state(): PlayerControllerState {
    return {
      x: this.x,
      y: this.y,
      vx: this.vx,
      vy: this.vy,
      facing: this.facing,
      grounded: this.grounded,
    };
  }

  /** Feet-based AABB (position is bottom-center). */
  getBounds(ox = this.x, oy = this.y): Solid {
    return {
      minX: ox - this.halfW,
      maxX: ox + this.halfW,
      minY: oy,
      maxY: oy + this.height,
    };
  }

  /**
   * Integrate one frame of movement against the current solid list.
   */
  update(dt: number, input: Input): void {
    if (dt <= 0) return;

    this.wasGrounded = this.grounded;

    // --- Timers ---
    if (this.grounded) {
      this.coyoteTimer = PLAYER.coyoteTime;
    } else {
      this.coyoteTimer = Math.max(0, this.coyoteTimer - dt);
    }

    if (input.justPressed('jump')) {
      this.jumpBufferTimer = PLAYER.jumpBuffer;
    } else {
      this.jumpBufferTimer = Math.max(0, this.jumpBufferTimer - dt);
    }

    // --- Horizontal intent ---
    const axis = input.axisX;
    if (axis !== 0) {
      this.facing = axis > 0 ? 1 : -1;
    }

    const sprint = input.pressed('sprint');
    const maxSpeed = sprint ? PLAYER.maxSprintSpeed : PLAYER.maxRunSpeed;
    const targetVx = axis * maxSpeed;

    const onGround = this.grounded;
    const accel = onGround ? PLAYER.groundAccel : PLAYER.airAccel;
    const decel = onGround ? PLAYER.groundDecel : PLAYER.airDecel;

    if (axis === 0) {
      this.vx = approach(this.vx, 0, decel * dt);
    } else {
      // If reversing, use stronger decel feel then accelerate toward target.
      const sameDir = this.vx === 0 || Math.sign(this.vx) === Math.sign(targetVx);
      const rate = sameDir ? accel : decel + accel * 0.55;
      this.vx = approach(this.vx, targetVx, rate * dt);
    }

    // Soft cap (air can slightly overshoot from carry)
    const hardCap = PLAYER.maxSprintSpeed * 1.05;
    this.vx = clamp(this.vx, -hardCap, hardCap);

    // --- Jump start (buffer + coyote) ---
    const canJump = this.grounded || this.coyoteTimer > 0;
    if (this.jumpBufferTimer > 0 && canJump) {
      this.vy = PLAYER.jumpSpeed;
      this.grounded = false;
      this.coyoteTimer = 0;
      this.jumpBufferTimer = 0;
      this.jumpHeld = true;
      this.hooks.onJump?.();
    }

    // Variable jump: release cuts upward velocity
    if (this.jumpHeld) {
      if (input.justReleased('jump') || !input.pressed('jump')) {
        if (this.vy > 0) {
          this.vy *= PLAYER.jumpCutMultiplier;
        }
        this.jumpHeld = false;
      }
    }
    if (!input.pressed('jump')) {
      this.jumpHeld = false;
    }

    // --- Gravity (heavier when falling) ---
    const g = this.vy > 0 && this.jumpHeld ? WORLD.gravityRise * 0.92 : this.vy > 0 ? WORLD.gravityRise : WORLD.gravityFall;
    this.vy -= g * dt;
    if (this.vy < -WORLD.terminalVelocity) {
      this.vy = -WORLD.terminalVelocity;
    }

    // --- Integrate with sub-steps (anti-tunnel) ---
    const speed = Math.hypot(this.vx, this.vy);
    const maxStep = PLAYER.maxStepDistance;
    const steps = Math.max(1, Math.ceil((speed * dt) / maxStep));
    const stepDt = dt / steps;

    this.grounded = false;
    for (let i = 0; i < steps; i++) {
      this.integrateStep(stepDt);
    }

    // Land / stomp hooks (rising edge of grounded)
    if (this.grounded && !this.wasGrounded) {
      const impact = this.landImpactVy;
      this.hooks.onLand?.(impact);
      if (impact <= PLAYER.stompMinVy) {
        this.hooks.onStomp?.(impact);
      }
    }
  }

  private integrateStep(dt: number): void {
    // Horizontal first
    this.x += this.vx * dt;
    this.resolveHorizontal();

    // Vertical second
    this.y += this.vy * dt;
    this.resolveVertical();

    // Ground probe (even if vy ~ 0 after resolve)
    if (this.vy <= 0.01) {
      this.probeGround();
    }
  }

  private resolveHorizontal(): void {
    const b = this.getBounds();
    for (const s of this.solids) {
      if (!aabbOverlap(b, s)) continue;

      const overlapL = b.maxX - s.minX;
      const overlapR = s.maxX - b.minX;
      if (overlapL < overlapR) {
        this.x -= overlapL + PLAYER.skin * 0.25;
        if (this.vx > 0) this.vx = 0;
      } else {
        this.x += overlapR + PLAYER.skin * 0.25;
        if (this.vx < 0) this.vx = 0;
      }
      // Refresh bounds for multi-solid
      Object.assign(b, this.getBounds());
    }
  }

  private resolveVertical(): void {
    const b = this.getBounds();
    for (const s of this.solids) {
      if (!aabbOverlap(b, s)) continue;

      const overlapB = b.maxY - s.minY;
      const overlapT = s.maxY - b.minY;

      if (overlapT < overlapB) {
        // Hit from above — land on top
        this.y += overlapT;
        if (this.vy < 0) {
          this.landImpactVy = this.vy;
          this.vy = 0;
          this.grounded = true;
        }
      } else {
        // Hit ceiling
        this.y -= overlapB;
        if (this.vy > 0) this.vy = 0;
        this.jumpHeld = false;
      }
      Object.assign(b, this.getBounds());
    }
  }

  private probeGround(): void {
    const skin = PLAYER.skin;
    const feet: Solid = {
      minX: this.x - this.halfW * 0.9,
      maxX: this.x + this.halfW * 0.9,
      minY: this.y - skin * 2,
      maxY: this.y + skin,
    };

    for (const s of this.solids) {
      if (feet.maxX <= s.minX || feet.minX >= s.maxX) continue;
      if (feet.maxY < s.maxY || feet.minY > s.maxY + skin * 3) continue;
      // Standing on top surface
      if (this.y <= s.maxY + skin * 2 && this.y >= s.maxY - skin * 2) {
        this.y = s.maxY;
        this.grounded = true;
        if (this.vy < 0) {
          this.landImpactVy = this.vy;
          this.vy = 0;
        }
        return;
      }
    }
  }
}
