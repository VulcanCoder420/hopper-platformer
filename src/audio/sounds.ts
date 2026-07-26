/**
 * Sound id registry for Hopper.
 * Paths point at public/assets/audio (placeholder WAVs from scripts/generate-audio.mjs).
 */

export type SoundId =
  | 'jump'
  | 'land'
  | 'coin'
  | 'stomp'
  | 'death'
  | 'flag'
  | 'musicMain'
  | 'musicWin';

export interface SoundDef {
  id: SoundId;
  /** Path relative to site root (Vite public/). */
  src: string;
  /** Default volume 0–1. */
  volume?: number;
  /** Whether this is looping background music. */
  music?: boolean;
}

export const SOUNDS: Record<SoundId, SoundDef> = {
  jump: { id: 'jump', src: '/assets/audio/jump.wav', volume: 0.7 },
  land: { id: 'land', src: '/assets/audio/land.wav', volume: 0.55 },
  coin: { id: 'coin', src: '/assets/audio/coin.wav', volume: 0.65 },
  stomp: { id: 'stomp', src: '/assets/audio/stomp.wav', volume: 0.7 },
  death: { id: 'death', src: '/assets/audio/death.wav', volume: 0.75 },
  flag: { id: 'flag', src: '/assets/audio/flag.wav', volume: 0.7 },
  musicMain: {
    id: 'musicMain',
    src: '/assets/audio/music-main.wav',
    volume: 0.4,
    music: true,
  },
  musicWin: {
    id: 'musicWin',
    src: '/assets/audio/music-win.wav',
    volume: 0.45,
    music: true,
  },
};

export const SOUND_IDS = Object.keys(SOUNDS) as SoundId[];
