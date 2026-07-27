import { Howl, Howler } from 'howler';
import { SOUNDS, type SoundId } from './sounds';

const DEFAULT_MASTER = 0.8;
const DEFAULT_SFX = 1;
const DEFAULT_MUSIC = 1;
const VOLUME_STEP = 0.1;

/**
 * Howler-based audio manager.
 * - Master + optional SFX/Music category gains
 * - Unlock on first pointer/key (browser autoplay policy)
 * - Music does not restart if the same track is already playing
 * - play() is fire-and-forget; missing assets never throw
 */
export class AudioManager {
  private masterVolume = DEFAULT_MASTER;
  private sfxVolume = DEFAULT_SFX;
  private musicVolume = DEFAULT_MUSIC;
  private muted = false;
  private unlocked = false;
  private howls = new Map<SoundId, Howl>();
  private musicId: SoundId | null = null;
  private unlockBound = false;
  private volumeKeysBound = false;
  private musicStarted = false;

  constructor() {
    this.applyMasterGain();
  }

  // --- Volume ---

  /** 0–1 master gain (Howler global). */
  setMasterVolume(v: number): void {
    this.masterVolume = clamp01(v);
    this.applyMasterGain();
  }

  getMasterVolume(): number {
    return this.masterVolume;
  }

  /** Nudge master volume by delta (e.g. ±0.1 for [ / ]). */
  adjustMasterVolume(delta: number): number {
    this.setMasterVolume(this.masterVolume + delta);
    return this.masterVolume;
  }

  setSfxVolume(v: number): void {
    this.sfxVolume = clamp01(v);
    this.refreshHowlVolumes();
  }

  getSfxVolume(): number {
    return this.sfxVolume;
  }

  setMusicVolume(v: number): void {
    this.musicVolume = clamp01(v);
    this.refreshHowlVolumes();
  }

  getMusicVolume(): number {
    return this.musicVolume;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyMasterGain();
  }

  isMuted(): boolean {
    return this.muted;
  }

  private applyMasterGain(): void {
    try {
      Howler.volume(this.muted ? 0 : this.masterVolume);
    } catch {
      // ignore
    }
  }

  private categoryGain(id: SoundId): number {
    const def = SOUNDS[id];
    return def?.music ? this.musicVolume : this.sfxVolume;
  }

  private effectiveHowlVolume(id: SoundId): number {
    const def = SOUNDS[id];
    const base = def?.volume ?? 1;
    return clamp01(base * this.categoryGain(id));
  }

  private refreshHowlVolumes(): void {
    for (const [id, howl] of this.howls) {
      try {
        howl.volume(this.effectiveHowlVolume(id));
      } catch {
        // ignore
      }
    }
  }

  // --- Unlock / autoplay ---

  /**
   * Bind first user gesture to unlock WebAudio (autoplay policies).
   * Safe to call multiple times.
   */
  bindUnlock(target: EventTarget = window): void {
    if (this.unlockBound) return;
    this.unlockBound = true;

    const unlock = () => {
      this.unlock();
      // Resume/start BGM after gesture if gameplay already requested it.
      if (this.musicStarted) {
        this.ensureGameplayMusic();
      }
      target.removeEventListener('pointerdown', unlock);
      target.removeEventListener('keydown', unlock);
    };

    target.addEventListener('pointerdown', unlock);
    target.addEventListener('keydown', unlock);
  }

  /**
   * Keyboard master volume: `[` lower, `]` raise.
   * Bound once on window; UI can mirror getMasterVolume() later.
   */
  bindVolumeKeys(target: Window = window): void {
    if (this.volumeKeysBound) return;
    this.volumeKeysBound = true;

    target.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.code === 'BracketLeft') {
        e.preventDefault();
        const v = this.adjustMasterVolume(-VOLUME_STEP);
        console.info(`[Audio] master volume ${Math.round(v * 100)}%`);
      } else if (e.code === 'BracketRight') {
        e.preventDefault();
        const v = this.adjustMasterVolume(VOLUME_STEP);
        console.info(`[Audio] master volume ${Math.round(v * 100)}%`);
      } else if (e.code === 'KeyM' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        // Optional mute toggle — handy while developing
        this.setMuted(!this.muted);
        console.info(`[Audio] ${this.muted ? 'muted' : 'unmuted'}`);
      }
    });
  }

  unlock(): void {
    if (this.unlocked) return;
    this.unlocked = true;
    try {
      Howler.ctx?.resume?.();
    } catch {
      // Context may not exist yet.
    }
  }

  isUnlocked(): boolean {
    return this.unlocked;
  }

  // --- Load / play ---

  /** Preload a sound; swallow load errors if the file is missing. */
  load(id: SoundId): void {
    if (this.howls.has(id)) return;
    const def = SOUNDS[id];
    if (!def) return;

    try {
      const howl = new Howl({
        src: [def.src],
        volume: this.effectiveHowlVolume(id),
        loop: Boolean(def.music),
        preload: true,
        html5: Boolean(def.music),
        onloaderror: (_soundId, err) => {
          console.warn(`[AudioManager] Failed to load "${id}" (${def.src}):`, err);
        },
        onplayerror: (_soundId, err) => {
          console.warn(`[AudioManager] Play error for "${id}":`, err);
          try {
            howl.once('unlock', () => {
              try {
                howl.play();
              } catch {
                // ignore retry failure
              }
            });
          } catch {
            // ignore
          }
        },
      });
      this.howls.set(id, howl);
    } catch (err) {
      console.warn(`[AudioManager] Could not create Howl for "${id}":`, err);
    }
  }

  /** Load every registered sound. */
  loadAll(): void {
    for (const id of Object.keys(SOUNDS) as SoundId[]) {
      this.load(id);
    }
  }

  /**
   * Fire-and-forget SFX (or one-shot). Never throws.
   * Returns Howler sound id or null.
   */
  play(id: SoundId): number | null {
    try {
      this.unlock();
      let howl = this.howls.get(id);
      if (!howl) {
        this.load(id);
        howl = this.howls.get(id);
      }
      if (!howl) return null;
      howl.volume(this.effectiveHowlVolume(id));
      return howl.play() ?? null;
    } catch (err) {
      console.warn(`[AudioManager] play("${id}") failed:`, err);
      return null;
    }
  }

  /**
   * Looping (or one-shot) music. If `id` is already the current track and
   * still playing, does nothing — safe across level reloads.
   */
  playMusic(id: SoundId, loop = true): void {
    try {
      this.unlock();
      this.musicStarted = true;

      if (this.musicId === id) {
        const existing = this.howls.get(id);
        if (existing) {
          try {
            if (existing.playing()) return;
            // Same track stopped — resume without recreating
            existing.loop(loop);
            existing.volume(this.effectiveHowlVolume(id));
            existing.play();
            return;
          } catch {
            // fall through to full start
          }
        }
      }

      this.stopMusic();

      let howl = this.howls.get(id);
      if (!howl) {
        this.load(id);
        howl = this.howls.get(id);
      }
      if (!howl) return;

      howl.loop(loop);
      howl.volume(this.effectiveHowlVolume(id));
      howl.play();
      this.musicId = id;
    } catch (err) {
      console.warn(`[AudioManager] playMusic("${id}") failed:`, err);
    }
  }

  /**
   * Start main BGM if not already running (gameplay begin / first input).
   * Does not interrupt a different track (e.g. win fanfare) — callers that
   * want main after win should stopMusic() first.
   * Never restarts mid-track if musicMain is already playing.
   */
  ensureGameplayMusic(): void {
    this.musicStarted = true;
    const howl = this.howls.get('musicMain');
    if (this.musicId === 'musicMain' && howl) {
      try {
        if (howl.playing()) return;
        // Same track stopped or blocked by autoplay — resume without recreating Howl
        howl.loop(true);
        howl.volume(this.effectiveHowlVolume('musicMain'));
        howl.play();
        return;
      } catch {
        // fall through
      }
    }
    // Another track is active (e.g. win music) — leave it alone
    if (this.musicId && this.musicId !== 'musicMain') return;
    this.playMusic('musicMain', true);
  }

  getCurrentMusicId(): SoundId | null {
    return this.musicId;
  }

  /**
   * Flip the loop flag on the track that is already playing, without restarting
   * it. Howler only honours this while the sound is still active, so callers
   * must check isMusicPlaying() and fall back to a fresh playMusic() if not.
   */
  setMusicLoop(loop: boolean): void {
    if (!this.musicId) return;
    const howl = this.howls.get(this.musicId);
    if (!howl) return;
    try {
      howl.loop(loop);
    } catch {
      // ignore
    }
  }

  isMusicPlaying(): boolean {
    if (!this.musicId) return false;
    const howl = this.howls.get(this.musicId);
    try {
      return Boolean(howl?.playing());
    } catch {
      return false;
    }
  }

  stopMusic(): void {
    if (!this.musicId) return;
    const howl = this.howls.get(this.musicId);
    if (howl) {
      try {
        howl.stop();
      } catch {
        // ignore
      }
    }
    this.musicId = null;
  }

  stop(id: SoundId): void {
    const howl = this.howls.get(id);
    if (!howl) return;
    try {
      howl.stop();
    } catch {
      // ignore
    }
    if (this.musicId === id) this.musicId = null;
  }

  unload(id?: SoundId): void {
    if (id) {
      const howl = this.howls.get(id);
      if (howl) {
        try {
          howl.unload();
        } catch {
          // ignore
        }
        this.howls.delete(id);
      }
      if (this.musicId === id) this.musicId = null;
      return;
    }

    for (const [, howl] of this.howls) {
      try {
        howl.unload();
      } catch {
        // ignore
      }
    }
    this.howls.clear();
    this.musicId = null;
  }
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

export const audioManager = new AudioManager();
