/**
 * High-level game flow states for Hopper.
 * Physics / AI only tick while `Playing`.
 */
export enum GameState {
  Menu = 'Menu',
  Playing = 'Playing',
  Paused = 'Paused',
  Dead = 'Dead',
  Win = 'Win',
  LevelComplete = 'LevelComplete',
}

export const STARTING_LIVES = 3;

/** Brief death overlay before respawn (seconds). */
export const DEATH_OVERLAY_DURATION = 1.15;

/** Level-complete hold before loading next / victory (seconds). */
export const LEVEL_COMPLETE_DURATION = 2.0;

/** Game-over hold before returning to menu (seconds). */
export const GAME_OVER_DURATION = 2.4;
