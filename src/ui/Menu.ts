/**
 * Title menu, pause, death, level-complete, and victory overlays.
 */

export type MenuScreen =
  | 'hidden'
  | 'title'
  | 'pause'
  | 'death'
  | 'gameover'
  | 'levelComplete'
  | 'victory';

export interface MenuCallbacks {
  onStart: () => void;
  onResume: () => void;
  onRestart: () => void;
  onQuitToMenu: () => void;
  onVolumeChange: (master01: number) => void;
}

export interface VictorySummary {
  score: number;
  lives: number;
  timeSeconds: number;
  levelsCleared: number;
}

function formatTime(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, '0')}`;
}

export class Menu {
  readonly root: HTMLElement;
  private panel: HTMLElement;
  private screen: MenuScreen = 'hidden';
  private readonly callbacks: MenuCallbacks;
  private volumeInput: HTMLInputElement | null = null;

  constructor(parent: HTMLElement, callbacks: MenuCallbacks) {
    this.callbacks = callbacks;

    this.root = document.createElement('div');
    this.root.className = 'hop-overlay';
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.setAttribute('aria-hidden', 'true');

    this.panel = document.createElement('div');
    this.panel.className = 'hop-panel';
    this.root.appendChild(this.panel);

    this.root.addEventListener('click', this.onClick);
    this.root.addEventListener('input', this.onInput);

    parent.appendChild(this.root);
  }

  get currentScreen(): MenuScreen {
    return this.screen;
  }

  showTitle(masterVolume: number): void {
    this.screen = 'title';
    this.root.classList.remove('is-light', 'death-flash');
    this.panel.innerHTML = `
      <h1 class="hop-title">Hopper</h1>
      <p class="hop-subtitle">A sky-island platformer</p>
      <div class="hop-volume">
        <label for="hop-master-vol">
          Volume
          <span class="pct" data-vol-pct>${Math.round(masterVolume * 100)}%</span>
        </label>
        <input
          id="hop-master-vol"
          type="range"
          min="0"
          max="100"
          step="1"
          value="${Math.round(masterVolume * 100)}"
          aria-label="Master volume"
        />
      </div>
      <div class="hop-actions">
        <button type="button" class="hop-btn" data-action="start">Start</button>
      </div>
      <p class="hop-hint">
        <span class="hop-hint-desktop"><kbd>A</kbd><kbd>D</kbd> move · <kbd>Space</kbd> jump ·
        <kbd>Shift</kbd> sprint · <kbd>Esc</kbd> pause</span>
        <span class="hop-hint-touch">On phone: ◀ ▶ move · JUMP · RUN · pause button</span>
      </p>
    `;
    this.volumeInput = this.panel.querySelector('#hop-master-vol');
    this.setVisible(true);
  }

  showPause(masterVolume: number): void {
    this.screen = 'pause';
    this.root.classList.add('is-light');
    this.root.classList.remove('death-flash');
    this.panel.innerHTML = `
      <h2 class="hop-heading">Paused</h2>
      <p class="hop-message">Take a breather — the world is frozen.</p>
      <div class="hop-volume">
        <label for="hop-master-vol-pause">
          Volume
          <span class="pct" data-vol-pct>${Math.round(masterVolume * 100)}%</span>
        </label>
        <input
          id="hop-master-vol-pause"
          type="range"
          min="0"
          max="100"
          step="1"
          value="${Math.round(masterVolume * 100)}"
          aria-label="Master volume"
        />
      </div>
      <div class="hop-actions">
        <button type="button" class="hop-btn" data-action="resume">Resume</button>
        <button type="button" class="hop-btn secondary" data-action="quit">Menu</button>
      </div>
      <p class="hop-hint">Press <kbd>Esc</kbd> to resume</p>
    `;
    this.volumeInput = this.panel.querySelector('#hop-master-vol-pause');
    this.setVisible(true);
  }

  showDeath(livesRemaining: number): void {
    this.screen = 'death';
    this.root.classList.remove('is-light');
    this.root.classList.add('death-flash');
    this.panel.innerHTML = `
      <h2 class="hop-heading danger">Ouch!</h2>
      <p class="hop-message">
        ${
          livesRemaining > 0
            ? `Lives left: <strong style="color:var(--hop-coral)">${livesRemaining}</strong>`
            : 'That was the last one…'
        }
      </p>
    `;
    this.volumeInput = null;
    this.setVisible(true);
  }

  showGameOver(score: number): void {
    this.screen = 'gameover';
    this.root.classList.remove('is-light', 'death-flash');
    this.panel.innerHTML = `
      <h2 class="hop-heading danger">Game Over</h2>
      <p class="hop-message">Hopper took one hop too many.</p>
      <div class="hop-stats">
        <div class="hop-stat-row"><span class="k">Final score</span><span class="v">${score}</span></div>
      </div>
      <div class="hop-actions">
        <button type="button" class="hop-btn" data-action="restart">Try Again</button>
        <button type="button" class="hop-btn secondary" data-action="quit">Menu</button>
      </div>
    `;
    this.volumeInput = null;
    this.setVisible(true);
  }

  showLevelComplete(levelNumber: number, levelName: string, score: number): void {
    this.screen = 'levelComplete';
    this.root.classList.add('is-light');
    this.root.classList.remove('death-flash');
    this.panel.innerHTML = `
      <h2 class="hop-heading success">Level Clear!</h2>
      <p class="hop-message">
        ${levelName || `Level ${levelNumber}`} complete
      </p>
      <div class="hop-stats">
        <div class="hop-stat-row"><span class="k">Score</span><span class="v">${score}</span></div>
      </div>
      <p class="hop-hint">Next stage loading…</p>
    `;
    this.volumeInput = null;
    this.setVisible(true);
  }

  showVictory(summary: VictorySummary): void {
    this.screen = 'victory';
    this.root.classList.remove('is-light', 'death-flash');
    this.panel.innerHTML = `
      <h1 class="hop-title" style="font-size:2.2rem">Victory!</h1>
      <p class="hop-subtitle">You cleared every sky-island</p>
      <div class="hop-stats">
        <div class="hop-stat-row"><span class="k">Score</span><span class="v">${summary.score}</span></div>
        <div class="hop-stat-row"><span class="k">Lives left</span><span class="v">${summary.lives}</span></div>
        <div class="hop-stat-row"><span class="k">Time</span><span class="v">${formatTime(summary.timeSeconds)}</span></div>
        <div class="hop-stat-row"><span class="k">Levels</span><span class="v">${summary.levelsCleared}</span></div>
      </div>
      <div class="hop-actions">
        <button type="button" class="hop-btn" data-action="restart">Restart</button>
        <button type="button" class="hop-btn secondary" data-action="quit">Menu</button>
      </div>
    `;
    this.volumeInput = null;
    this.setVisible(true);
  }

  hide(): void {
    this.screen = 'hidden';
    this.setVisible(false);
    this.volumeInput = null;
  }

  /** Sync slider if master volume changed via keys. */
  syncVolume(master01: number): void {
    if (!this.volumeInput) return;
    const pct = Math.round(Math.min(1, Math.max(0, master01)) * 100);
    this.volumeInput.value = String(pct);
    const label = this.panel.querySelector('[data-vol-pct]');
    if (label) label.textContent = `${pct}%`;
  }

  private setVisible(visible: boolean): void {
    this.root.classList.toggle('is-visible', visible);
    this.root.setAttribute('aria-hidden', visible ? 'false' : 'true');
  }

  private onClick = (e: Event): void => {
    const target = e.target as HTMLElement | null;
    if (!target) return;
    const btn = target.closest('[data-action]') as HTMLElement | null;
    if (!btn) return;
    const action = btn.getAttribute('data-action');
    switch (action) {
      case 'start':
        this.callbacks.onStart();
        break;
      case 'resume':
        this.callbacks.onResume();
        break;
      case 'restart':
        this.callbacks.onRestart();
        break;
      case 'quit':
        this.callbacks.onQuitToMenu();
        break;
      default:
        break;
    }
  };

  private onInput = (e: Event): void => {
    const t = e.target as HTMLInputElement | null;
    if (!t || t.type !== 'range') return;
    const pct = Number(t.value);
    const v = Math.min(100, Math.max(0, pct)) / 100;
    const label = this.panel.querySelector('[data-vol-pct]');
    if (label) label.textContent = `${Math.round(v * 100)}%`;
    this.callbacks.onVolumeChange(v);
  };

  dispose(): void {
    this.root.removeEventListener('click', this.onClick);
    this.root.removeEventListener('input', this.onInput);
    this.root.remove();
  }
}
