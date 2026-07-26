/**
 * In-play heads-up display: score, lives, level, timer.
 */

export interface HUDSnapshot {
  score: number;
  lives: number;
  levelNumber: number;
  levelName?: string;
  /** Elapsed play time in seconds (this run / level). */
  timerSeconds: number;
}

function formatTime(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, '0')}`;
}

export class HUD {
  readonly root: HTMLElement;
  private scoreEl: HTMLElement;
  private livesEl: HTMLElement;
  private levelEl: HTMLElement;
  private timerEl: HTMLElement;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'hop-hud';
    this.root.setAttribute('aria-hidden', 'true');
    this.root.innerHTML = `
      <div class="hop-hud-bar" role="status" aria-live="polite">
        <div class="hop-hud-item score">
          <span class="label">Score</span>
          <span class="value" data-hud="score">0</span>
        </div>
        <div class="hop-hud-sep" aria-hidden="true"></div>
        <div class="hop-hud-item lives">
          <span class="label">Lives</span>
          <span class="value" data-hud="lives">3</span>
        </div>
        <div class="hop-hud-sep" aria-hidden="true"></div>
        <div class="hop-hud-item level">
          <span class="label">Level</span>
          <span class="value" data-hud="level">1</span>
        </div>
        <div class="hop-hud-sep" aria-hidden="true"></div>
        <div class="hop-hud-item timer">
          <span class="label">Time</span>
          <span class="value" data-hud="timer">0:00</span>
        </div>
      </div>
    `;

    this.scoreEl = this.root.querySelector('[data-hud="score"]')!;
    this.livesEl = this.root.querySelector('[data-hud="lives"]')!;
    this.levelEl = this.root.querySelector('[data-hud="level"]')!;
    this.timerEl = this.root.querySelector('[data-hud="timer"]')!;

    parent.appendChild(this.root);
  }

  setVisible(visible: boolean): void {
    this.root.classList.toggle('is-visible', visible);
    this.root.setAttribute('aria-hidden', visible ? 'false' : 'true');
  }

  update(snap: HUDSnapshot): void {
    this.scoreEl.textContent = String(snap.score);
    this.livesEl.textContent = String(snap.lives);
    this.levelEl.textContent = snap.levelName
      ? `${snap.levelNumber} · ${snap.levelName}`
      : String(snap.levelNumber);
    this.timerEl.textContent = formatTime(snap.timerSeconds);
  }

  dispose(): void {
    this.root.remove();
  }
}
