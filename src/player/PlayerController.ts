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
  /**
   * Fired once per frame when the head hits a solid from below (ceiling).
   * `solid` is the first ceiling solid contacted this frame.
   */
  onCeilingHit?: (solid: Solid) => void;
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
  /**
   * True on the frame a jump launches. A release edge from *before* the launch
   * (the button was tapped mid-air and the jump came out of the buffer) must not
   * cut the jump it never applied to.
   */
  private jumpStartedThisFrame = false;
  /** Swallow one land hook after a teleport so respawns don't thud. */
  private suppressLandOnce = false;
  /** Velocity at the moment of last ground contact (for land/stomp hooks). */
  private landImpactVy = 0;

  private solids: readonly Solid[] = [];
  private hooks: PlayerControllerHooks = {};

  /** Mutable so powered form / crouch can resize the AABB at runtime. */
  halfW: number = PLAYER.halfWidth;
  height: number = PLAYER.height;
  /** Jump launch speed (raised while powered). */
  jumpSpeed: number = PLAYER.jumpSpeed;

  private powered = false;
  private crouching = false;

  /** True if the head struck a solid from below at any sub-step this frame. */
  hitCeilingThisFrame = false;
  /** First ceiling solid contacted this frame (if any). */
  ceilingSolid: Solid | null = null;

  setSolids(solids: readonly Solid[]): void {
    this.solids = solids;
  }

  setHooks(hooks: PlayerControllerHooks): void {
    this.hooks = hooks;
  }

  setPosition(x: number, y: number): void {
    this.x = x;
    this.y = y;
    // A teleport is not a landing, and timers from the old position are stale.
    this.coyoteTimer = 0;
    this.jumpBufferTimer = 0;
    this.jumpHeld = false;
    this.landImpactVy = 0;
    this.suppressLandOnce = true;
  }

  /**
   * Full reset for a respawn or level load: clears velocity and every transient
   * timer so a buffered jump can't fire on the first frame at the new spawn.
   *
   * `groundedAtRest` seeds the grounded flag — pass true when the destination is
   * a spawn point resting on a solid, so the rising-edge land hook stays quiet
   * and the player can jump immediately.
   */
  resetMotionState(groundedAtRest = false): void {
    this.vx = 0;
    this.vy = 0;
    this.coyoteTimer = 0;
    this.jumpBufferTimer = 0;
    this.jumpHeld = false;
    this.jumpStartedThisFrame = false;
    this.landImpactVy = 0;
    this.suppressLandOnce = true;
    this.grounded = groundedAtRest;
    this.wasGrounded = groundedAtRest;
    // A crouch held at the old position must not follow the player to the new one.
    this.crouching = false;
    this.applySize();
  }

  get isGrounded(): boolean {
    return this.grounded;
  }

  get isCrouching(): boolean {
    return this.crouching;
  }

  /** Full standing height for the current power tier (ignores crouch). */
  private get standHeight(): number {
    return PLAYER.height * (this.powered ? PLAYER.poweredHeightScale : 1);
  }

  /**
   * True if a box `h` tall at the current position would intersect a solid.
   * The floor is excluded: its top sits exactly at `y`, and the tiny lift keeps
   * float error from reading it as a collision.
   */
  private blockedAt(h: number, halfW = this.halfW): boolean {
    const box: Solid = {
      minX: this.x - halfW,
      maxX: this.x + halfW,
      minY: this.y + PLAYER.skin * 0.5,
      maxY: this.y + h,
    };
    for (const s of this.solids) {
      if (aabbOverlap(box, s)) return true;
    }
    return false;
  }

  /** Recompute the AABB from the power tier and crouch state. Feet stay at y. */
  private applySize(): void {
    this.halfW =
      PLAYER.halfWidth * (this.powered ? PLAYER.poweredHalfWidthScale : 1);
    this.height = this.crouching
      ? this.standHeight * PLAYER.crouchHeightScale
      : this.standHeight;
    this.jumpSpeed = this.powered ? PLAYER.poweredJumpSpeed : PLAYER.jumpSpeed;
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
  /**
   * Apply or clear Super form sizing / jump boost.
   *
   * Growing under a low ceiling would otherwise embed the player in it, so the
   * bigger form starts out ducked and stands up on its own once there is
   * headroom (see the crouch resolution in update()).
   */
  setPowered(powered: boolean): void {
    this.powered = powered;
    if (powered && this.blockedAt(this.standHeight, PLAYER.halfWidth * PLAYER.poweredHalfWidthScale)) {
      this.crouching = true;
    }
    this.applySize();
  }

  update(dt: number, input: Input): void {
    if (dt <= 0) return;

    this.wasGrounded = this.grounded;
    this.jumpStartedThisFrame = false;
    this.hitCeilingThisFrame = false;
    this.ceilingSolid = null;

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

    // --- Crouch ---
    // Ducking shrinks the box from the head down, so entering a crouch can never
    // embed the player. Standing back up can, so it only happens with headroom —
    // which also means a crouch entered under a ceiling persists until the
    // player crawls out, instead of snapping upright into the geometry.
    const wantCrouch = input.pressed('down');
    this.crouching = wantCrouch || this.blockedAt(this.standHeight);
    this.applySize();

    // --- Horizontal intent ---
    const axis = input.axisX;
    if (axis !== 0) {
      this.facing = axis > 0 ? 1 : -1;
    }

    const sprint = input.pressed('sprint');
    const maxSpeed = this.crouching
      ? PLAYER.maxRunSpeed * PLAYER.crouchSpeedScale
      : sprint
        ? PLAYER.maxSprintSpeed
        : PLAYER.maxRunSpeed;
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
      this.vy = this.jumpSpeed;
      this.grounded = false;
      this.coyoteTimer = 0;
      this.jumpBufferTimer = 0;
      this.jumpHeld = true;
      this.jumpStartedThisFrame = true;
      // Leaving the ground under our own power — a real landing must be heard.
      this.suppressLandOnce = false;
      this.hooks.onJump?.();
    }

    // Variable jump: a release *after* launch cuts upward velocity.
    // Only an actual release edge counts. Testing `!pressed` instead would
    // retroactively apply a pre-launch release to a buffered jump and cut it to
    // 40% on its very first frame, turning a 2.9u jump into a 0.4u stumble.
    if (this.jumpHeld && !this.jumpStartedThisFrame && input.justReleased('jump')) {
      if (this.vy > 0) {
        this.vy *= PLAYER.jumpCutMultiplier;
      }
      this.jumpHeld = false;
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
      if (this.suppressLandOnce) {
        this.suppressLandOnce = false;
      } else {
        const impact = this.landImpactVy;
        this.hooks.onLand?.(impact);
        if (impact <= PLAYER.stompMinVy) {
          this.hooks.onStomp?.(impact);
        }
      }
    }

    if (this.hitCeilingThisFrame && this.ceilingSolid) {
      this.hooks.onCeilingHit?.(this.ceilingSolid);
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
        if (this.vy > 0) {
          this.vy = 0;
          this.hitCeilingThisFrame = true;
          if (!this.ceilingSolid) this.ceilingSolid = s;
        }
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
