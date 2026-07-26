import { clamp } from '../utils/math';

/**
 * Trauma-based camera shake (GDC-style).
 * Add trauma pulses; shake magnitude = trauma² * maxOffset.
 * Trauma decays exponentially each frame.
 */
export class ScreenShake {
  /** 0–1 trauma accumulator. */
  trauma = 0;

  /** Max world-unit offset at trauma = 1. */
  maxOffset = 0.35;

  /** Trauma decay rate (higher = snappier settle). */
  decay = 3.2;

  /** Seeded-ish noise phase. */
  private time = 0;

  /** Current frame offsets (read after update). */
  offsetX = 0;
  offsetY = 0;

  /**
   * Add a trauma impulse (clamped so stacked events don't explode).
   * Typical: coin 0.05, land 0.12–0.25, stomp 0.2, death 0.4.
   */
  addTrauma(amount: number): void {
    this.trauma = clamp(this.trauma + amount, 0, 1);
  }

  /** Hard set (e.g. cutscenes). */
  setTrauma(value: number): void {
    this.trauma = clamp(value, 0, 1);
  }

  reset(): void {
    this.trauma = 0;
    this.offsetX = 0;
    this.offsetY = 0;
  }

  /**
   * Advance decay and recompute offsets.
   * Call once per frame after camera follow, then apply offsets to the camera.
   */
  update(dt: number): void {
    if (dt <= 0) {
      this.offsetX = 0;
      this.offsetY = 0;
      return;
    }

    this.time += dt;
    this.trauma = Math.max(0, this.trauma - this.decay * this.trauma * dt);
    // Also linear floor decay so tiny trauma dies cleanly
    this.trauma = Math.max(0, this.trauma - 0.15 * dt);

    if (this.trauma < 0.001) {
      this.trauma = 0;
      this.offsetX = 0;
      this.offsetY = 0;
      return;
    }

    const shake = this.trauma * this.trauma;
    // Multi-frequency noise (cheap sin stack, not true Perlin)
    const t = this.time;
    const nx =
      Math.sin(t * 37.1) * 0.45 +
      Math.sin(t * 61.3 + 1.7) * 0.35 +
      Math.sin(t * 97.0 + 0.4) * 0.2;
    const ny =
      Math.sin(t * 41.7 + 2.1) * 0.45 +
      Math.sin(t * 53.9 + 0.9) * 0.35 +
      Math.sin(t * 89.2 + 3.3) * 0.2;

    this.offsetX = nx * shake * this.maxOffset;
    this.offsetY = ny * shake * this.maxOffset * 0.85;
  }

  get offset(): { x: number; y: number } {
    return { x: this.offsetX, y: this.offsetY };
  }
}
