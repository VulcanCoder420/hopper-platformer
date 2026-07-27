/**
 * Level data types for Hopper Stage 3.
 * Coordinates are world XY; Z is cosmetic for the 2.5D strip.
 */

/** Axis-aligned solid used for grounded probes and collision separation. */
export interface Solid {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** Visual + collision material hint for platforms / blocks. */
export type PlatformStyle =
  | 'grass'
  | 'stone'
  | 'brick'
  | 'metal'
  | 'dirt'
  | 'question'
  | 'pipe'
  | 'wood';

/** What a hit-from-below prize block ejects. Clean-room names (not Nintendo). */
export type PrizeContents = 'coin' | 'multiCoin' | 'powerUp' | 'none';

/** Multi-coin window: coins keep coming on hits until duration or max is spent. */
export interface MultiCoinRules {
  /** Seconds after first hit while further hits still yield coins. */
  durationSec: number;
  /** Hard cap on coins ejected from this block. */
  maxCoins: number;
}

/**
 * Rectangular platform or block. Position is top-surface center for floating
 * platforms, or box center for solid blocks — LevelLoader interprets by kind.
 */
export interface PlatformDef {
  /** World X of the platform center. */
  x: number;
  /** World Y of the top surface (feet rest here). */
  y: number;
  /** Full width along X. */
  w: number;
  /** Full height of the solid body (down from y). */
  h: number;
  /** Optional Z offset for 2.5D depth (default 0). */
  z?: number;
  /** Depth along Z for mesh (default WORLD.platformDepth-ish). */
  depth?: number;
  style?: PlatformStyle;
  /** If false, mesh only — no collision (decor). Default true. */
  solid?: boolean;
  /** Kind influences mesh construction. */
  kind?: 'ground' | 'platform' | 'block' | 'pipe' | 'stair' | 'ledge';
  /**
   * Prize contents when hit from below. Question-style blocks default to
   * `'coin'` when this is omitted; brick/other blocks only prize if set.
   */
  contents?: PrizeContents;
  /** Required when contents is multiCoin (defaults applied by manager if absent). */
  multiCoin?: MultiCoinRules;
}

/**
 * Enemy spawn marker.
 * Canonical types: bruiser (ground), skimmer (flyer).
 * Aliases: goomba/koopa → bruiser, flyer/fly → skimmer.
 */
export interface EnemySpawn {
  x: number;
  y: number;
  type: 'bruiser' | 'skimmer' | 'goomba' | 'koopa' | 'flyer' | 'fly' | string;
  /** Patrol half-width or behavior hint. */
  patrol?: number;
}

/** Coin / collectible spawn marker. */
export interface CoinSpawn {
  x: number;
  y: number;
  z?: number;
}

export interface LevelBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface LevelGoal {
  /** Base of the flag pole (ground contact). */
  x: number;
  y: number;
  /** Pole height. */
  height?: number;
}

export interface LevelDef {
  id: string;
  name: string;
  /** Player feet spawn. */
  spawn: { x: number; y: number };
  /** Camera / soft play bounds. */
  bounds: LevelBounds;
  /** Death plane — player respawns when y falls below this. */
  deathY: number;
  platforms: PlatformDef[];
  coins?: CoinSpawn[];
  enemies?: EnemySpawn[];
  goal: LevelGoal;
  /** Optional sky / fog tint overrides later. */
  theme?: 'meadow' | 'cave' | 'sunset';
}
