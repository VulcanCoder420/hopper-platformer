import type { Input } from '../game/Input';
import {
  PlayerController,
  type PlayerControllerHooks,
  type Solid,
} from './PlayerController';
import { PlayerVisual } from './PlayerVisual';

export type { Solid, PlayerControllerHooks };

/**
 * Hopper player: physics controller + stylized mesh + gameplay hooks.
 */
export class Player {
  readonly controller: PlayerController;
  readonly visual: PlayerVisual;

  /** External hooks (audio / VFX / combat later). */
  onLand?: (impactVy: number) => void;
  onJump?: () => void;
  onStomp?: (impactVy: number) => void;

  private justLanded = false;
  private justJumped = false;

  constructor(x = 0, y = 0) {
    this.controller = new PlayerController();
    this.controller.setPosition(x, y);
    this.visual = new PlayerVisual();
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
    });
  }

  /** THREE object to add to the scene. */
  get object3d() {
    return this.visual.object3d;
  }

  dispose(): void {
    this.visual.dispose();
  }
}
