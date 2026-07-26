export type Action =
  | 'left'
  | 'right'
  | 'up'
  | 'down'
  | 'jump'
  | 'sprint';

const KEY_TO_ACTION: Record<string, Action> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
  KeyA: 'left',
  KeyD: 'right',
  KeyW: 'up',
  KeyS: 'down',
  Space: 'jump',
  ShiftLeft: 'sprint',
  ShiftRight: 'sprint',
};

/**
 * Keyboard + programmatic (touch) input with held + edge state.
 * Call `endFrame()` once per frame after gameplay reads edges.
 */
export class Input {
  private held = new Set<Action>();
  private pressedThisFrame = new Set<Action>();
  private releasedThisFrame = new Set<Action>();
  private bound = false;

  private onKeyDown = (e: KeyboardEvent): void => {
    const action = KEY_TO_ACTION[e.code];
    if (!action) return;
    // Prevent page scroll on arrows/space while playing.
    if (
      e.code === 'Space' ||
      e.code.startsWith('Arrow') ||
      e.code === 'KeyW' ||
      e.code === 'KeyA' ||
      e.code === 'KeyS' ||
      e.code === 'KeyD'
    ) {
      e.preventDefault();
    }
    this.setAction(action, true);
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    const action = KEY_TO_ACTION[e.code];
    if (!action) return;
    this.setAction(action, false);
  };

  private onBlur = (): void => {
    this.held.clear();
    this.pressedThisFrame.clear();
    this.releasedThisFrame.clear();
  };

  /**
   * Programmatic hold/release (virtual buttons, touch pads).
   * Safe to call repeatedly while held — only first press edges.
   */
  setAction(action: Action, isDown: boolean): void {
    if (isDown) {
      if (!this.held.has(action)) {
        this.held.add(action);
        this.pressedThisFrame.add(action);
      }
    } else if (this.held.has(action)) {
      this.held.delete(action);
      this.releasedThisFrame.add(action);
    }
  }

  /** Release every action (e.g. hide touch overlay / blur). */
  clearAll(): void {
    this.onBlur();
  }

  bind(target: Window = window): void {
    if (this.bound) return;
    this.bound = true;
    target.addEventListener('keydown', this.onKeyDown);
    target.addEventListener('keyup', this.onKeyUp);
    target.addEventListener('blur', this.onBlur);
  }

  unbind(target: Window = window): void {
    if (!this.bound) return;
    this.bound = false;
    target.removeEventListener('keydown', this.onKeyDown);
    target.removeEventListener('keyup', this.onKeyUp);
    target.removeEventListener('blur', this.onBlur);
    this.onBlur();
  }

  pressed(action: Action): boolean {
    return this.held.has(action);
  }

  justPressed(action: Action): boolean {
    return this.pressedThisFrame.has(action);
  }

  justReleased(action: Action): boolean {
    return this.releasedThisFrame.has(action);
  }

  /** Horizontal axis: -1 left, +1 right. */
  get axisX(): number {
    let x = 0;
    if (this.pressed('left')) x -= 1;
    if (this.pressed('right')) x += 1;
    return x;
  }

  /** Vertical axis: -1 down, +1 up. */
  get axisY(): number {
    let y = 0;
    if (this.pressed('down')) y -= 1;
    if (this.pressed('up')) y += 1;
    return y;
  }

  /** Clear edge sets; call at end of each frame. */
  endFrame(): void {
    this.pressedThisFrame.clear();
    this.releasedThisFrame.clear();
  }
}
