import type { Input } from '../game/Input';
import { PLAYER } from '../game/config';
import {
  PlayerController,
  type PlayerControllerHooks,
  type Solid,
} from './PlayerController';
import { HopperSprite } from './HopperSprite';

export type { Solid, PlayerControllerHooks };

/** Clean-room power tiers — no intermediate damage while Normal. */
export type PowerState = 'normal' | 'powered';

/**
 * Hopper player: physics controller + stylized mesh + gameplay hooks.
 */
export class Player {
  readonly controller: PlayerController;
  readonly visual: HopperSprite;

  /** External hooks (audio / VFX / combat later). */
  onLand?: (impactVy: number) => void;
  onJump?: () => void;
  onStomp?: (impactVy: number) => void;
  onCeilingHit?: (solid: Solid) => void;

  private justLanded = false;
  private justJumped = false;
  private power: PowerState = 'normal';
  /** Visual scale lerp toward powered/normal size. */
  private visualScale = 1;

  constructor(x = 0, y = 0) {
    this.controller = new PlayerController();
    this.controller.setPosition(x, y);
    this.visual = new HopperSprite();
    this.visual.setPosition(x, y, 0);

    this.controller.setHooks({
      onJump: () => {
        this.justJumped = true;
        this.onJump?.();
      },
      onLand: (impactVy) => {
        this.justLanded = true;
        this.onLand?.(impactVy);
      },
      onStomp: (impactVy) => {
        this.onStomp?.(impactVy);
      },
      onCeilingHit: (solid) => {
        this.onCeilingHit?.(solid);
      },
    });
  }

  get position() {
    return { x: this.controller.x, y: this.controller.y };
  }

  get velocity() {
    return { x: this.controller.vx, y: this.controller.vy };
  }

  get isGrounded(): boolean {
    return this.controller.isGrounded;
  }

  get facing(): 1 | -1 {
    return this.controller.facing;
  }

  get isCrouching(): boolean {
    return this.controller.isCrouching;
  }

  get powerState(): PowerState {
    return this.power;
  }

  get isPowered(): boolean {
    return this.power === 'powered';
  }

  /**
   * True when falling fast enough that a stomp could register this frame
   * (callers still need an enemy overlap check).
   */
  get canStomp(): boolean {
    return !this.controller.isGrounded && this.controller.vy < -6;
  }

  setSolids(solids: readonly Solid[]): void {
    this.controller.setSolids(solids);
  }

  setPosition(x: number, y: number): void {
    this.controller.setPosition(x, y);
    this.visual.setPosition(x, y, 0);
  }

  /** Grant Super form (Bloom pickup). Safe to call when already powered. */
  grantPower(): void {
    this.power = 'powered';
    this.controller.setPowered(true);
  }

  /**
   * Drop Super form after a hazard hit. Returns true if power was lost
   * (caller should NOT kill). Returns false if already normal (caller kills).
   */
  tryLosePower(): boolean {
    if (this.power !== 'powered') return false;
    this.power = 'normal';
    this.controller.setPowered(false);
    return true;
  }

  /** Full strip on death / level reset. */
  resetPower(): void {
    this.power = 'normal';
    this.controller.setPowered(false);
    this.visualScale = 1;
    this.visual.object3d.scale.set(1, 1, 1);
  }

  update(dt: number, input: Input): void {
    this.justLanded = false;
    this.justJumped = false;

    this.controller.update(dt, input);

    const { x, y, vx, vy, facing, grounded } = this.controller.state;
    this.visual.setPosition(x, y, 0);
    this.visual.setFacing(facing);
    this.visual.update(dt, {
      grounded,
      vx,
      vy,
      justLanded: this.justLanded,
      justJumped: this.justJumped,
      crouching: this.controller.isCrouching,
    });

    // Smooth grow / shrink so the pickup reads as a transformation, not a pop.
    const target = this.power === 'powered' ? PLAYER.poweredVisualScale : 1;
    this.visualScale += (target - this.visualScale) * Math.min(1, 10 * dt);
    this.visual.object3d.scale.set(this.visualScale, this.visualScale, 1);
  }

  /** THREE object to add to the scene. */
  get object3d() {
    return this.visual.object3d;
  }

  dispose(): void {
    this.visual.dispose();
  }
}
