import type { ParticleSystem } from './Particles';
import type { ScreenShake } from './ScreenShake';

/**
 * Combined feedback helpers: particles + screen shake pulses.
 * Audio stays in Game / AudioManager so Juice stays pure VFX.
 */
export class Juice {
  constructor(
    readonly particles: ParticleSystem,
    readonly shake: ScreenShake,
  ) {}

  /** Coin pickup: golden sparkle + tiny camera tick. */
  coinCollect(x: number, y: number, z = 0): void {
    this.particles.emitCoinSparkle(x, y, z);
    this.shake.addTrauma(0.06);
  }

  /** Enemy defeated: puff burst + short shake pulse. */
  enemyDeath(x: number, y: number, z = 0): void {
    this.particles.emitEnemyDeath(x, y, z);
    this.shake.addTrauma(0.22);
  }

  /** Leave ground: foot dust only (no shake). */
  jumpDust(x: number, y: number, z = 0): void {
    this.particles.emitJumpDust(x, y, z);
  }

  /**
   * Landing feedback scaled by impact speed.
   * `impactVy` is typically negative (downward).
   * Mild dust always; hard land adds impact spray + shake.
   */
  land(x: number, y: number, impactVy: number, z = 0): void {
    const speed = Math.abs(impactVy);
    // Soft land: light dust
    if (speed < 6) {
      this.particles.emitLandingDust(x, y, z, 0.5);
      return;
    }
    // Medium
    if (speed < 14) {
      const t = (speed - 6) / 8;
      this.particles.emitLandingDust(x, y, z, 0.7 + t * 0.6);
      if (speed >= 10) this.shake.addTrauma(0.08 + t * 0.08);
      return;
    }
    // Hard land
    const t = Math.min(2, (speed - 14) / 10 + 1);
    this.particles.emitLandingImpact(x, y, z, t);
    this.shake.addTrauma(0.14 + Math.min(0.2, (speed - 14) * 0.02));
  }

  /** Explicit hard-land shortcut. */
  hardLand(x: number, y: number, impactVy: number, z = 0): void {
    const speed = Math.max(14, Math.abs(impactVy));
    this.particles.emitLandingImpact(x, y, z, speed / 14);
    this.shake.addTrauma(0.18 + Math.min(0.25, (speed - 14) * 0.015));
  }

  /** Player hurt / death punch. */
  hurt(x: number, y: number, z = 0): void {
    this.particles.emitEnemyDeath(x, y, z);
    this.shake.addTrauma(0.35);
  }
}
