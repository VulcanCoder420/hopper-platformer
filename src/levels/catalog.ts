/**
 * Hopper campaign — 20 stages, Mario-style teaching curve (clean-room).
 * Outline from deep-research: introduce → practice → expand → test.
 *
 * Placement rules (from shipped levels + research):
 * - Early gaps ~2–4u; later death gaps ~4–5u
 * - Overhead blocks clear platform top by > player height (1.28)
 * - Free coins left of the goal flag
 * - Original names only
 */

import type {
  CoinSpawn,
  EnemySpawn,
  LevelDef,
  PlatformDef,
  PrizeContents,
} from './types';

// --- Compact builders -------------------------------------------------------

const g = (
  x: number,
  y: number,
  w: number,
  h = 1.8,
  style: PlatformDef['style'] = 'grass',
): PlatformDef => ({
  kind: 'ground',
  style,
  x,
  y,
  w,
  h,
  depth: 6,
});

const plat = (
  x: number,
  y: number,
  w: number,
  style: PlatformDef['style'] = 'stone',
  h = 0.85,
): PlatformDef => ({
  kind: 'platform',
  style,
  x,
  y,
  w,
  h,
  depth: Math.min(2.8, w),
});

const pipe = (x: number, y: number, h: number, w = 1.55): PlatformDef => ({
  kind: 'pipe',
  style: 'pipe',
  x,
  y,
  w,
  h,
});

const stair = (
  x: number,
  y: number,
  w: number,
  h: number,
  style: PlatformDef['style'] = 'stone',
): PlatformDef => ({
  kind: 'stair',
  style,
  x,
  y,
  w,
  h,
  depth: 2.4,
});

const block = (
  x: number,
  y: number,
  style: PlatformDef['style'] = 'brick',
  contents?: PrizeContents,
  multi?: { durationSec: number; maxCoins: number },
): PlatformDef => ({
  kind: 'block',
  style,
  x,
  y,
  w: 0.95,
  h: 0.95,
  depth: 0.95,
  ...(contents ? { contents } : {}),
  ...(multi ? { multiCoin: multi } : {}),
});

/** Question prize block (default coin). */
const q = (
  x: number,
  y: number,
  contents: PrizeContents = 'coin',
  multi?: { durationSec: number; maxCoins: number },
): PlatformDef => block(x, y, 'question', contents, multi);

const ledge = (
  x: number,
  y: number,
  w: number,
  style: PlatformDef['style'] = 'stone',
): PlatformDef => ({
  kind: 'ledge',
  style,
  x,
  y,
  w,
  h: 0.85,
  depth: 2.4,
});

function coins(list: Array<[number, number]>): CoinSpawn[] {
  return list.map(([x, y]) => ({ x, y }));
}

function enemies(
  list: Array<[number, number, string, number?]>,
): EnemySpawn[] {
  return list.map(([x, y, type, patrol]) => ({
    x,
    y,
    type,
    ...(patrol !== undefined ? { patrol } : {}),
  }));
}

function level(
  partial: Omit<LevelDef, 'bounds' | 'deathY'> & {
    bounds?: LevelDef['bounds'];
    deathY?: number;
    width?: number;
    maxY?: number;
  },
): LevelDef {
  const width = partial.width ?? 72;
  const maxY = partial.maxY ?? 22;
  return {
    id: partial.id,
    name: partial.name,
    theme: partial.theme ?? 'meadow',
    spawn: partial.spawn,
    bounds: partial.bounds ?? {
      minX: -4,
      maxX: width + 6,
      minY: -8,
      maxY,
    },
    deathY: partial.deathY ?? -5,
    platforms: partial.platforms,
    coins: partial.coins,
    enemies: partial.enemies,
    goal: partial.goal,
  };
}

// --- 20 stages --------------------------------------------------------------

/**
 * 1 — Meadow Run (Opus-polished tutorial, restored).
 * Question blocks + Skimmer ("bird") + full geometry from sprite-overhaul branch.
 */
const level01 = level({
  id: 'level01',
  name: 'Meadow Run',
  theme: 'meadow',
  spawn: { x: 1.5, y: 0 },
  width: 72,
  goal: { x: 64, y: 0, height: 5.5 },
  platforms: [
    g(6, 0, 16),
    block(10, 1.1, 'stone'),
    block(11.1, 1.1, 'stone'),
    plat(16, 1.5, 3.4),
    // Clearance: platform y=1.5 + player 1.28 → underside must be ≥ ~2.8; top at 4.0
    q(16, 4.0, 'coin'),
    g(24, 0, 10),
    plat(28, 2.6, 2.8, 'brick'),
    plat(32.5, 2.8, 2.4, 'stone'),
    g(38, 0, 8),
    q(36.5, 2.6, 'coin'),
    block(37.5, 2.6, 'brick'),
    q(38.5, 2.6, 'coin'),
    stair(43, 2.4, 4, 2.4),
    plat(48, 2.4, 4.5, 'grass', 1.0),
    plat(53.5, 1.6, 3.0, 'stone'),
    g(62, 0, 14),
    pipe(57.5, 2.0, 2.0, 1.6),
  ],
  coins: coins([
    [4, 1.3],
    [5.2, 1.3],
    [6.4, 1.3],
    [10, 2.0],
    [11.1, 2.0],
    [15.2, 2.3],
    [16, 2.3],
    [16.8, 2.3],
    [16, 4.85],
    [19.5, 1.8],
    [21, 1.5],
    [22.5, 1.3],
    [24, 1.3],
    [25.5, 1.3],
    [27, 1.3],
    [28, 2.9],
    [30.2, 3.2],
    [32.5, 3.7],
    [36.5, 3.6],
    [37.5, 3.6],
    [38.5, 3.6],
    [38, 1.3],
    [39.5, 1.3],
    [43, 2.0],
    [44.2, 2.8],
    [45.5, 3.4],
    [47, 3.3],
    [48, 3.3],
    [49, 3.3],
    [51.5, 2.8],
    [53.5, 2.5],
    [55.5, 2.2],
    [57.5, 3.0],
    [58.8, 1.4],
    [60.0, 1.4],
    [61.2, 1.4],
    [62.4, 1.4],
    [63.4, 1.4],
  ]),
  enemies: enemies([
    [26, 0, 'bruiser', 1.8],
    [39, 0, 'bruiser', 1.6],
    [48.5, 2.4, 'bruiser', 1.1],
    // Flying Skimmer (the "bird") over mid path
    [31, 3.8, 'skimmer', 1.6],
    [59.5, 0, 'bruiser', 1.5],
  ]),
});

/**
 * 2 — Pipe Primer: dual-height pipes + prize blocks + Skimmer restored.
 * Low path always completable; high path for coins.
 */
const level02 = level({
  id: 'level02',
  name: 'Pipe Primer',
  theme: 'meadow',
  spawn: { x: 1.2, y: 0 },
  width: 74,
  goal: { x: 66, y: 0, height: 5.5 },
  platforms: [
    g(5, 0, 12),
    pipe(10, 2.0, 2.0),
    // Prize intro on low path (easy bonk)
    q(7, 2.5, 'coin'),
    q(8.1, 2.5, 'coin'),
    g(16, 0, 7),
    // High path (optional)
    plat(14, 3.2, 2.6, 'wood'),
    plat(18.5, 3.6, 2.4, 'wood'),
    q(18.5, 6.2, 'coin'),
    plat(23, 3.2, 2.8, 'stone'),
    pipe(20.5, 1.6, 1.6),
    g(28, 0, 9),
    pipe(26, 2.4, 2.4),
    pipe(31, 1.8, 1.8),
    q(29, 2.5, 'coin'),
    g(40, 0, 10),
    plat(42, 2.8, 3.0, 'brick'),
    q(42, 5.4, 'coin'),
    pipe(48, 2.2, 2.2),
    plat(52, 1.6, 2.6, 'stone'),
    g(60, 0, 16),
  ],
  coins: coins([
    [4, 1.3],
    [7, 1.3],
    [10, 2.9],
    [14, 4.0],
    [18.5, 4.5],
    [23, 4.1],
    [16, 1.3],
    [28, 1.3],
    [31, 2.7],
    [36, 1.3],
    [40, 1.3],
    [42, 3.7],
    [48, 3.1],
    [52, 2.5],
    [58, 1.3],
    [62, 1.3],
  ]),
  enemies: enemies([
    [17, 0, 'bruiser', 1.5],
    [35, 0, 'bruiser', 1.8],
    [42, 2.8, 'bruiser', 0.9],
    // Skimmer over high path
    [18, 4.6, 'skimmer', 1.6],
    [54, 0, 'bruiser', 1.4],
  ]),
});

/** 3 — Brick Lesson: first prize blocks */
const level03 = level({
  id: 'level03',
  name: 'Brick Lesson',
  theme: 'meadow',
  spawn: { x: 1.5, y: 0 },
  width: 68,
  goal: { x: 60, y: 0, height: 5.5 },
  platforms: [
    g(6, 0, 14),
    // Teach bonk: platform under, Q above with clearance > 1.28
    plat(12, 1.4, 3.0),
    q(12, 3.9, 'coin'),
    g(22, 0, 10),
    q(20, 2.5, 'coin'),
    q(21.1, 2.5, 'coin'),
    block(22.2, 2.5, 'brick'),
    plat(28, 2.2, 2.6, 'brick'),
    q(28, 4.7, 'coin'),
    g(36, 0, 8),
    q(35, 2.5, 'coin'),
    q(36.1, 2.5, 'coin'),
    q(37.2, 2.5, 'coin'),
    stair(42, 2.4, 4, 2.4),
    plat(48, 2.4, 3.5, 'grass'),
    g(56, 0, 14),
  ],
  coins: coins([
    [4, 1.3],
    [8, 1.3],
    [12, 2.2],
    [18, 1.3],
    [24, 1.3],
    [28, 3.1],
    [34, 1.3],
    [42, 1.8],
    [48, 3.3],
    [54, 1.3],
  ]),
  enemies: enemies([
    [24, 0, 'bruiser', 1.5],
    [38, 0, 'bruiser', 1.6],
    [49, 2.4, 'bruiser', 1.0],
  ]),
});

/**
 * 4 — Trail Jumps: coin-trail hops + stairs.
 * Gaps kept to ~2.2–3.0u; continuous recovery ground so a miss isn't a soft-lock.
 */
const level04 = level({
  id: 'level04',
  name: 'Trail Jumps',
  theme: 'meadow',
  spawn: { x: 1.2, y: 0 },
  width: 78,
  goal: { x: 70, y: 0, height: 5.5 },
  platforms: [
    // Spawn strip → first hop chain (centers ~3u apart, platform width 2.4 → edge gap ~1.8u)
    g(5, 0, 10),
    plat(12.5, 1.4, 2.4),
    plat(16.5, 1.9, 2.4),
    plat(20.5, 1.5, 2.4),
    // Landing strip
    g(28, 0, 10),
    // Gentle stair (shorter rise) then short hops with safety ground below
    stair(34, 2.2, 4, 2.2),
    plat(39, 2.2, 2.8, 'grass'),
    q(39, 4.8, 'coin'),
    plat(43.5, 1.8, 2.4, 'stone'),
    plat(48, 1.4, 2.4, 'stone'),
    // Mid recovery ground under the hop chain (fall = retry, not death)
    g(44, 0, 12),
    // Final approach
    plat(54, 1.5, 2.6, 'stone'),
    g(62, 0, 8),
    pipe(66, 1.8, 1.8),
    g(72, 0, 10),
  ],
  coins: coins([
    [4, 1.3],
    [8, 1.3],
    [12.5, 2.3],
    [14.5, 2.5],
    [16.5, 2.8],
    [18.5, 2.6],
    [20.5, 2.4],
    [24, 1.5],
    [28, 1.3],
    [34, 1.6],
    [36, 2.2],
    [39, 3.1],
    [43.5, 2.7],
    [48, 2.3],
    [54, 2.4],
    [62, 1.3],
    [68, 1.3],
  ]),
  enemies: enemies([
    [30, 0, 'bruiser', 1.5],
    [39, 2.2, 'bruiser', 0.8],
    [46, 0, 'bruiser', 1.4],
    [50, 2.8, 'skimmer', 1.4],
  ]),
});

/**
 * 5 — Fork Field: high-risk upper route / safe lower route.
 *
 * Physics budget: full jump height ~2.8u, comfortable run-gap ~2–3.5u.
 * Previous version had ~5u death gaps on the “safe” path and a high path
 * starting at y=3.4 (unreachable from ground) — both made the stage feel soft-locked.
 */
const level05 = level({
  id: 'level05',
  name: 'Fork Field',
  theme: 'meadow',
  spawn: { x: 1.2, y: 0 },
  width: 80,
  goal: { x: 70, y: 0, height: 5.5 },
  platforms: [
    // —— Low / safe path: short pits (~2.5–3.5u edge-to-edge), wide islands ——
    g(5, 0, 12), // [-1 .. 11]
    g(16.5, 0, 6), // [13.5 .. 19.5]  gap ~2.5u
    g(26, 0, 6), // [23 .. 29]      gap ~3.5u
    g(36, 0, 7), // [32.5 .. 39.5]  gap ~3.5u
    g(46, 0, 8), // [42 .. 50]      gap ~2.5u

    // —— High path: stepped entry (1.4 → 2.4 → 3.2) then hop chain ——
    plat(12, 1.4, 2.4, 'wood'),
    plat(16, 2.4, 2.4, 'wood'),
    plat(20.5, 3.2, 2.4, 'metal'),
    plat(25, 3.6, 2.2, 'metal'),
    plat(29.5, 3.4, 2.4, 'brick'),
    q(29.5, 6.0, 'coin'),
    plat(34, 3.0, 2.4, 'metal'),
    // Drop assist back toward low path
    plat(39, 1.8, 2.4, 'stone'),

    // —— Merge → goal (ground under flag) ——
    stair(53, 2.0, 3.5, 2.0), // [51.25 .. 54.75]
    g(64, 0, 22), // [53 .. 75] stair foot through flag
    pipe(58, 1.8, 1.8),
  ],
  coins: coins([
    [4, 1.3],
    [8, 1.3],
    // High trail
    [12, 2.3],
    [16, 3.3],
    [20.5, 4.1],
    [25, 4.5],
    [29.5, 4.3],
    [34, 3.9],
    // Low path
    [16.5, 1.3],
    [26, 1.3],
    [36, 1.3],
    [46, 1.3],
    [54, 1.6],
    [64, 1.3],
    [68, 1.3],
  ]),
  enemies: enemies([
    // Low path — room to approach/stomp on each island
    [17, 0, 'bruiser', 1.4],
    [27, 0, 'bruiser', 1.4],
    [38, 0, 'bruiser', 1.5],
    // High path skimmer (optional risk)
    [25, 4.6, 'skimmer', 1.4],
    [48, 0, 'bruiser', 1.6],
  ]),
});

/** 6 — Grow Grove: first Bloom power-up (hard to miss) */
const level06 = level({
  id: 'level06',
  name: 'Grow Grove',
  theme: 'meadow',
  spawn: { x: 1.5, y: 0 },
  width: 72,
  goal: { x: 64, y: 0, height: 5.5 },
  platforms: [
    g(8, 0, 18),
    // First power-up: low Q over path so ricochet/slide hits you
    plat(10, 1.3, 3.5, 'stone'),
    q(10, 3.9, 'powerUp'),
    g(22, 0, 8),
    q(20, 2.5, 'coin'),
    q(21.1, 2.5, 'coin'),
    plat(28, 2.4, 2.8, 'brick'),
    q(28, 5.0, 'coin'),
    g(36, 0, 8),
    pipe(34, 2.0, 2.0),
    plat(42, 1.8, 2.6, 'wood'),
    plat(47, 2.6, 2.4, 'wood'),
    g(56, 0, 18),
    q(54, 2.5, 'powerUp'),
  ],
  coins: coins([
    [4, 1.3],
    [7, 1.3],
    [12, 2.2],
    [16, 1.3],
    [22, 1.3],
    [28, 3.3],
    [36, 1.3],
    [42, 2.7],
    [47, 3.5],
    [56, 1.3],
    [60, 1.3],
  ]),
  enemies: enemies([
    [24, 0, 'bruiser', 1.6],
    [38, 0, 'bruiser', 1.5],
    [48, 3.5, 'skimmer', 1.4],
    [58, 0, 'bruiser', 1.8],
  ]),
});

/** 7 — Cadence Hills: challenge → cadence → theme test */
const level07 = level({
  id: 'level07',
  name: 'Cadence Hills',
  theme: 'meadow',
  spawn: { x: 1.2, y: 0 },
  width: 80,
  maxY: 24,
  goal: { x: 72, y: 0, height: 5.5 },
  platforms: [
    g(5, 0, 10),
    // Intro challenge
    plat(12, 1.5, 2.0),
    plat(16, 2.2, 2.0),
    plat(20, 1.6, 2.0),
    g(26, 0, 6),
    // Cadence: repeated hop pattern
    plat(32, 1.8, 1.8, 'brick'),
    plat(36, 1.8, 1.8, 'brick'),
    plat(40, 1.8, 1.8, 'brick'),
    plat(44, 1.8, 1.8, 'brick'),
    g(50, 0, 6),
    // Skill theme test: rising + Q
    plat(54, 2.0, 2.0, 'stone'),
    plat(58, 3.0, 2.0, 'stone'),
    plat(62, 4.0, 2.4, 'metal'),
    q(62, 6.5, 'coin'),
    g(68, 0, 12),
  ],
  coins: coins([
    [4, 1.3],
    [12, 2.4],
    [16, 3.1],
    [20, 2.5],
    [26, 1.3],
    [32, 2.7],
    [36, 2.7],
    [40, 2.7],
    [44, 2.7],
    [50, 1.3],
    [54, 2.9],
    [58, 3.9],
    [62, 4.9],
    [68, 1.3],
  ]),
  enemies: enemies([
    [27, 0, 'bruiser', 1.3],
    [38, 1.8, 'bruiser', 0.6],
    [51, 0, 'bruiser', 1.4],
    [56, 3.5, 'skimmer', 1.5],
  ]),
});

/** 8 — Ridge Climb: vertical routing (evolved L2) */
const level08 = level({
  id: 'level08',
  name: 'Ridge Climb',
  theme: 'sunset',
  spawn: { x: 1.2, y: 0 },
  width: 100,
  maxY: 28,
  deathY: -6,
  goal: { x: 92, y: 0, height: 6.0 },
  platforms: [
    g(5, 0, 12),
    pipe(10.5, 2.4, 2.4),
    g(16, 0, 5),
    plat(20.5, 1.4, 2.2, 'stone'),
    plat(24.2, 2.4, 2.0, 'brick'),
    plat(28.0, 3.5, 2.0, 'stone'),
    plat(32.0, 4.6, 2.4, 'metal'),
    q(32.0, 7.1, 'coin'),
    q(33.1, 7.1, 'powerUp'),
    g(38, 0, 6, 1.9, 'dirt'),
    pipe(36.2, 1.6, 1.6),
    pipe(40.0, 2.8, 2.8),
    plat(44, 1.8, 2.6, 'wood'),
    plat(48.5, 3.2, 2.2, 'wood'),
    plat(44.5, 4.6, 2.2, 'wood'),
    plat(49.0, 6.0, 2.8, 'stone'),
    plat(56, 6.0, 8, 'grass', 1.0),
    block(61.5, 7.0, 'brick'),
    block(61.5, 8.0, 'brick'),
    stair(65.5, 6.0, 5, 3.5, 'brick'),
    plat(72, 3.2, 2.4, 'metal'),
    plat(77.5, 4.0, 2.0, 'metal'),
    plat(83, 2.6, 2.6, 'metal'),
    pipe(87, 2.2, 2.2),
    pipe(90.2, 3.0, 3.0),
    g(94, 0, 14),
    plat(54, 2.0, 2.5, 'stone'),
    ledge(88, 1.3, 2.8),
  ],
  coins: coins([
    [3, 1.3],
    [6, 1.3],
    [10.5, 3.3],
    [20.5, 2.3],
    [24.2, 3.3],
    [28, 4.4],
    [32, 5.5],
    [38, 1.3],
    [44, 2.7],
    [48.5, 4.1],
    [49, 6.9],
    [56, 7.0],
    [72, 4.1],
    [77.5, 4.9],
    [83, 3.5],
    [90, 1.3],
  ]),
  enemies: enemies([
    [17, 0, 'bruiser', 1.4],
    [39, 0, 'bruiser', 1.5],
    [56, 6.0, 'bruiser', 2.0],
    [46, 5.5, 'skimmer', 1.6],
    [75, 4.5, 'skimmer', 1.4],
    [91, 0, 'bruiser', 1.5],
  ]),
});

/** 9 — Stone Stacks: stairs + overhead clearance */
const level09 = level({
  id: 'level09',
  name: 'Stone Stacks',
  theme: 'sunset',
  spawn: { x: 1.2, y: 0 },
  width: 78,
  maxY: 26,
  goal: { x: 70, y: 0, height: 5.5 },
  platforms: [
    g(5, 0, 10),
    stair(12, 3.0, 5, 3.0, 'stone'),
    plat(18, 3.0, 3.0, 'stone'),
    q(18, 5.6, 'coin'),
    stair(24, 4.0, 4, 4.0, 'brick'),
    plat(30, 4.0, 3.5, 'brick'),
    q(29.5, 6.6, 'coin'),
    q(30.6, 6.6, 'powerUp'),
    plat(36, 2.5, 2.4, 'stone'),
    g(44, 0, 8),
    stair(50, 2.8, 4, 2.8, 'stone'),
    plat(56, 2.8, 3.0, 'grass'),
    g(64, 0, 14),
  ],
  coins: coins([
    [4, 1.3],
    [12, 1.8],
    [15, 2.8],
    [18, 3.9],
    [24, 2.5],
    [28, 4.0],
    [30, 4.9],
    [36, 3.4],
    [44, 1.3],
    [52, 2.5],
    [56, 3.7],
    [64, 1.3],
  ]),
  enemies: enemies([
    [19, 3.0, 'bruiser', 0.9],
    [31, 4.0, 'bruiser', 1.0],
    [45, 0, 'bruiser', 1.6],
    [34, 5.5, 'skimmer', 1.5],
  ]),
});

/** 10 — Gap Gallery: precise 4–5u death gaps */
const level10 = level({
  id: 'level10',
  name: 'Gap Gallery',
  theme: 'sunset',
  spawn: { x: 1.2, y: 0 },
  width: 82,
  deathY: -6,
  goal: { x: 74, y: 0, height: 5.5 },
  platforms: [
    g(4, 0, 8),
    plat(12, 1.2, 2.2, 'metal'),
    plat(18.5, 1.6, 2.0, 'metal'), // ~4.3 gap centers
    plat(25, 1.2, 2.2, 'metal'),
    plat(31.5, 2.0, 2.0, 'brick'),
    plat(38, 1.4, 2.2, 'metal'),
    g(46, 0, 5),
    plat(54, 1.8, 2.0, 'metal'),
    plat(60.5, 2.4, 2.0, 'metal'),
    plat(67, 1.6, 2.4, 'stone'),
    g(72, 0, 10),
    q(31.5, 4.5, 'coin'),
  ],
  coins: coins([
    [4, 1.3],
    [12, 2.1],
    [15, 2.4],
    [18.5, 2.5],
    [22, 2.2],
    [25, 2.1],
    [31.5, 2.9],
    [38, 2.3],
    [46, 1.3],
    [54, 2.7],
    [60.5, 3.3],
    [67, 2.5],
    [72, 1.3],
  ]),
  enemies: enemies([
    [47, 0, 'bruiser', 1.2],
    [28, 3.0, 'skimmer', 1.8],
    [56, 3.5, 'skimmer', 1.4],
  ]),
});

/** 11 — Layer Yard: jumps + enemies layered */
const level11 = level({
  id: 'level11',
  name: 'Layer Yard',
  theme: 'sunset',
  spawn: { x: 1.2, y: 0 },
  width: 84,
  goal: { x: 76, y: 0, height: 5.5 },
  platforms: [
    g(6, 0, 12),
    plat(14, 1.8, 2.4, 'brick'),
    plat(19, 2.6, 2.4, 'brick'),
    g(26, 0, 8),
    pipe(24, 2.0, 2.0),
    plat(32, 2.2, 2.6, 'stone'),
    q(32, 4.8, 'powerUp'),
    g(40, 0, 8),
    plat(46, 1.6, 2.2, 'wood'),
    plat(51, 2.4, 2.2, 'wood'),
    plat(56, 3.2, 2.6, 'wood'),
    g(64, 0, 8),
    pipe(68, 2.4, 2.4),
    g(74, 0, 10),
  ],
  coins: coins([
    [4, 1.3],
    [10, 1.3],
    [14, 2.7],
    [19, 3.5],
    [26, 1.3],
    [32, 3.1],
    [40, 1.3],
    [46, 2.5],
    [51, 3.3],
    [56, 4.1],
    [64, 1.3],
    [72, 1.3],
  ]),
  enemies: enemies([
    [12, 0, 'bruiser', 1.5],
    [14, 1.8, 'bruiser', 0.7],
    [28, 0, 'bruiser', 1.6],
    [42, 0, 'bruiser', 1.5],
    [51, 2.4, 'bruiser', 0.7],
    [48, 3.8, 'skimmer', 1.6],
    [66, 0, 'bruiser', 1.4],
  ]),
});

/** 12 — Momentum Run: continuous flow */
const level12 = level({
  id: 'level12',
  name: 'Momentum Run',
  theme: 'sunset',
  spawn: { x: 1.2, y: 0 },
  width: 96,
  goal: { x: 88, y: 0, height: 5.5 },
  platforms: [
    g(8, 0, 18),
    g(22, 0, 6),
    g(32, 0, 6),
    g(42, 0, 6),
    plat(48, 1.5, 2.4, 'stone'),
    g(56, 0, 8),
    plat(64, 1.4, 2.2, 'brick'),
    plat(69, 1.8, 2.2, 'brick'),
    g(78, 0, 20),
    q(48, 4.0, 'coin'),
    q(64, 3.9, 'coin'),
    pipe(74, 1.8, 1.8),
  ],
  coins: coins([
    [4, 1.3],
    [8, 1.3],
    [12, 1.3],
    [16, 1.3],
    [22, 1.3],
    [26, 1.3],
    [32, 1.3],
    [36, 1.3],
    [42, 1.3],
    [48, 2.4],
    [56, 1.3],
    [64, 2.3],
    [69, 2.7],
    [78, 1.3],
    [84, 1.3],
  ]),
  enemies: enemies([
    [14, 0, 'bruiser', 2.0],
    [28, 0, 'bruiser', 1.5],
    [38, 0, 'bruiser', 1.5],
    [58, 0, 'bruiser', 1.8],
    [66, 2.5, 'skimmer', 2.0],
    [80, 0, 'bruiser', 2.0],
  ]),
});

/** 13 — Cave Mouth: theme shift, coin guidance */
const level13 = level({
  id: 'level13',
  name: 'Cave Mouth',
  theme: 'cave',
  spawn: { x: 1.2, y: 0 },
  width: 76,
  goal: { x: 68, y: 0, height: 5.5 },
  platforms: [
    g(5, 0, 10, 1.9, 'dirt'),
    plat(12, 1.6, 2.4, 'stone'),
    plat(17, 2.4, 2.2, 'stone'),
    g(24, 0, 8, 1.9, 'dirt'),
    pipe(22, 2.2, 2.2),
    // "Roof" of cave mouth
    plat(30, 4.5, 8, 'stone', 0.9),
    plat(30, 1.5, 2.4, 'stone'),
    plat(34, 2.2, 2.4, 'stone'),
    g(42, 0, 8, 1.9, 'dirt'),
    q(34, 4.8, 'coin'),
    q(30, 4.0, 'powerUp'),
    plat(48, 2.0, 2.6, 'brick'),
    g(58, 0, 18, 1.9, 'dirt'),
  ],
  coins: coins([
    [4, 1.3],
    [12, 2.5],
    [17, 3.3],
    [24, 1.3],
    [30, 2.4],
    [34, 3.1],
    [38, 3.5],
    [42, 1.3],
    [48, 2.9],
    [58, 1.3],
    [64, 1.3],
  ]),
  enemies: enemies([
    [18, 0, 'bruiser', 1.4],
    [26, 0, 'bruiser', 1.5],
    [36, 2.2, 'bruiser', 0.8],
    [32, 5.5, 'skimmer', 1.8],
    [50, 0, 'bruiser', 1.6],
  ]),
});

/** 14 — Branch Cavern: pipe multi-path + optional loop feel */
const level14 = level({
  id: 'level14',
  name: 'Branch Cavern',
  theme: 'cave',
  spawn: { x: 1.2, y: 0 },
  width: 88,
  maxY: 24,
  goal: { x: 80, y: 0, height: 5.5 },
  platforms: [
    g(5, 0, 10, 1.9, 'dirt'),
    pipe(10, 2.4, 2.4),
    // Upper branch
    plat(14, 3.6, 2.6, 'stone'),
    plat(19, 4.2, 2.4, 'stone'),
    plat(24, 3.8, 2.8, 'brick'),
    q(24, 6.4, 'multiCoin', { durationSec: 3.0, maxCoins: 8 }),
    // Lower branch
    g(18, 0, 6, 1.9, 'dirt'),
    g(28, 0, 6, 1.9, 'dirt'),
    pipe(32, 2.0, 2.0),
    // Secret-feeling loft
    plat(36, 5.0, 3.0, 'metal'),
    q(36, 7.5, 'powerUp'),
    g(40, 0, 8, 1.9, 'dirt'),
    plat(48, 2.2, 2.6, 'stone'),
    plat(54, 3.0, 2.4, 'stone'),
    g(62, 0, 8, 1.9, 'dirt'),
    pipe(68, 2.6, 2.6),
    g(76, 0, 12, 1.9, 'dirt'),
  ],
  coins: coins([
    [4, 1.3],
    [14, 4.5],
    [19, 5.1],
    [24, 4.7],
    [18, 1.3],
    [28, 1.3],
    [36, 5.9],
    [40, 1.3],
    [48, 3.1],
    [54, 3.9],
    [62, 1.3],
    [76, 1.3],
  ]),
  enemies: enemies([
    [20, 0, 'bruiser', 1.4],
    [24, 3.8, 'bruiser', 0.8],
    [42, 0, 'bruiser', 1.6],
    [50, 3.5, 'skimmer', 1.5],
    [64, 0, 'bruiser', 1.5],
  ]),
});

/** 15 — Multi-Coin Mine: timed multi-coin blocks */
const level15 = level({
  id: 'level15',
  name: 'Multi-Coin Mine',
  theme: 'cave',
  spawn: { x: 1.2, y: 0 },
  width: 80,
  goal: { x: 72, y: 0, height: 5.5 },
  platforms: [
    g(6, 0, 14, 1.9, 'dirt'),
    plat(10, 1.4, 3.0, 'stone'),
    q(10, 4.0, 'multiCoin', { durationSec: 3.5, maxCoins: 10 }),
    g(20, 0, 8, 1.9, 'dirt'),
    q(18, 2.5, 'multiCoin', { durationSec: 2.5, maxCoins: 6 }),
    q(19.1, 2.5, 'coin'),
    q(20.2, 2.5, 'coin'),
    plat(28, 2.4, 3.0, 'brick'),
    q(28, 5.0, 'multiCoin', { durationSec: 3.0, maxCoins: 8 }),
    g(38, 0, 8, 1.9, 'dirt'),
    pipe(36, 2.2, 2.2),
    plat(44, 1.8, 2.4, 'stone'),
    q(44, 4.4, 'powerUp'),
    g(54, 0, 8, 1.9, 'dirt'),
    g(66, 0, 14, 1.9, 'dirt'),
  ],
  coins: coins([
    [4, 1.3],
    [14, 1.3],
    [22, 1.3],
    [28, 3.3],
    [38, 1.3],
    [44, 2.7],
    [54, 1.3],
    [66, 1.3],
  ]),
  enemies: enemies([
    [22, 0, 'bruiser', 1.6],
    [40, 0, 'bruiser', 1.5],
    [30, 3.8, 'skimmer', 1.4],
    [56, 0, 'bruiser', 1.8],
  ]),
});

/** 16 — Vertical Vein: tall climbs + drop recovery */
const level16 = level({
  id: 'level16',
  name: 'Vertical Vein',
  theme: 'cave',
  spawn: { x: 1.2, y: 0 },
  width: 70,
  maxY: 30,
  deathY: -6,
  goal: { x: 62, y: 0, height: 5.5 },
  platforms: [
    g(4, 0, 8, 1.9, 'dirt'),
    plat(8, 1.6, 2.2, 'stone'),
    plat(8, 3.4, 2.2, 'stone'),
    plat(8, 5.2, 2.2, 'stone'),
    plat(12, 6.4, 2.6, 'brick'),
    plat(16, 7.6, 2.4, 'brick'),
    plat(20, 8.6, 3.0, 'metal'),
    q(20, 11.2, 'powerUp'),
    // Drop recovery
    plat(26, 5.0, 2.4, 'stone'),
    plat(30, 3.2, 2.4, 'stone'),
    plat(34, 1.6, 2.4, 'stone'),
    g(42, 0, 8, 1.9, 'dirt'),
    stair(48, 3.5, 5, 3.5, 'stone'),
    plat(54, 3.5, 3.0, 'grass'),
    g(60, 0, 10, 1.9, 'dirt'),
  ],
  coins: coins([
    [4, 1.3],
    [8, 2.5],
    [8, 4.3],
    [8, 6.1],
    [12, 7.3],
    [16, 8.5],
    [20, 9.5],
    [26, 5.9],
    [30, 4.1],
    [34, 2.5],
    [42, 1.3],
    [50, 3.0],
    [54, 4.4],
  ]),
  enemies: enemies([
    [12, 6.4, 'bruiser', 0.7],
    [20, 8.6, 'bruiser', 0.9],
    [18, 10.0, 'skimmer', 1.4],
    [44, 0, 'bruiser', 1.5],
  ]),
});

/** 17 — Pace Break Peak: hard stretch then breathing room */
const level17 = level({
  id: 'level17',
  name: 'Pace Break Peak',
  theme: 'cave',
  spawn: { x: 1.2, y: 0 },
  width: 90,
  maxY: 26,
  deathY: -6,
  goal: { x: 82, y: 0, height: 5.5 },
  platforms: [
    g(5, 0, 10, 1.9, 'dirt'),
    // Hard stretch
    plat(12, 1.8, 1.8, 'metal'),
    plat(17, 2.6, 1.8, 'metal'),
    plat(22, 1.6, 1.8, 'metal'),
    plat(27, 3.0, 1.8, 'brick'),
    plat(32, 2.2, 1.8, 'metal'),
    plat(37, 3.4, 2.0, 'metal'),
    // Breathing room
    g(46, 0, 14, 1.9, 'dirt'),
    q(48, 2.5, 'coin'),
    q(49.1, 2.5, 'coin'),
    q(50.2, 2.5, 'powerUp'),
    // Soft finale
    plat(58, 1.6, 2.8, 'stone'),
    plat(64, 2.0, 2.6, 'stone'),
    g(74, 0, 16, 1.9, 'dirt'),
  ],
  coins: coins([
    [4, 1.3],
    [12, 2.7],
    [17, 3.5],
    [22, 2.5],
    [27, 3.9],
    [32, 3.1],
    [37, 4.3],
    [46, 1.3],
    [52, 1.3],
    [58, 2.5],
    [64, 2.9],
    [74, 1.3],
    [78, 1.3],
  ]),
  enemies: enemies([
    [19, 3.5, 'skimmer', 1.6],
    [34, 4.0, 'skimmer', 1.4],
    [50, 0, 'bruiser', 2.0],
    [66, 3.5, 'skimmer', 1.3],
    [76, 0, 'bruiser', 1.5],
  ]),
});

/** 18 — Sunset Gauntlet: layered gaps + enemies + prize risk */
const level18 = level({
  id: 'level18',
  name: 'Sunset Gauntlet',
  theme: 'sunset',
  spawn: { x: 1.2, y: 0 },
  width: 94,
  maxY: 26,
  deathY: -6,
  goal: { x: 86, y: 0, height: 5.8 },
  platforms: [
    g(5, 0, 10),
    plat(12, 1.5, 2.2, 'metal'),
    plat(18, 2.4, 2.0, 'metal'),
    q(18, 5.0, 'coin'),
    plat(24, 1.8, 2.2, 'brick'),
    g(32, 0, 6),
    pipe(30, 2.4, 2.4),
    plat(38, 2.6, 2.4, 'stone'),
    plat(44, 3.4, 2.2, 'stone'),
    q(44, 6.0, 'powerUp'),
    plat(50, 2.4, 2.2, 'metal'),
    plat(56, 1.6, 2.4, 'metal'),
    g(64, 0, 8),
    stair(70, 2.8, 4, 2.8, 'brick'),
    g(80, 0, 14),
  ],
  coins: coins([
    [4, 1.3],
    [12, 2.4],
    [18, 3.3],
    [24, 2.7],
    [32, 1.3],
    [38, 3.5],
    [44, 4.3],
    [50, 3.3],
    [56, 2.5],
    [64, 1.3],
    [72, 2.5],
    [80, 1.3],
  ]),
  enemies: enemies([
    [14, 2.5, 'skimmer', 1.5],
    [26, 2.8, 'skimmer', 1.4],
    [34, 0, 'bruiser', 1.4],
    [40, 2.6, 'bruiser', 0.7],
    [52, 3.5, 'skimmer', 1.6],
    [66, 0, 'bruiser', 1.6],
    [82, 0, 'bruiser', 1.5],
  ]),
});

/** 19 — Master Fork: full multi-path; power-gated optional upper */
const level19 = level({
  id: 'level19',
  name: 'Master Fork',
  theme: 'sunset',
  spawn: { x: 1.2, y: 0 },
  width: 100,
  maxY: 28,
  deathY: -6,
  goal: { x: 92, y: 0, height: 5.8 },
  platforms: [
    g(5, 0, 10),
    // Power gate start
    plat(10, 1.3, 3.0, 'stone'),
    q(10, 3.9, 'powerUp'),
    // Low main
    g(18, 0, 6),
    g(28, 0, 6),
    g(40, 0, 8),
    // High optional (easier with power jump)
    plat(16, 4.0, 2.4, 'metal'),
    plat(22, 5.0, 2.2, 'metal'),
    plat(28, 5.6, 2.4, 'metal'),
    plat(34, 5.0, 2.4, 'brick'),
    q(34, 7.6, 'multiCoin', { durationSec: 3.0, maxCoins: 8 }),
    plat(40, 4.4, 2.6, 'metal'),
    // Mid merge
    plat(50, 2.2, 3.0, 'wood'),
    pipe(48, 2.0, 2.0),
    g(58, 0, 8),
    plat(66, 2.4, 2.6, 'stone'),
    plat(72, 3.2, 2.4, 'stone'),
    g(82, 0, 18),
    pipe(78, 2.4, 2.4),
  ],
  coins: coins([
    [4, 1.3],
    [12, 2.2],
    [18, 1.3],
    [16, 4.9],
    [22, 5.9],
    [28, 6.5],
    [34, 5.9],
    [40, 5.3],
    [28, 1.3],
    [42, 1.3],
    [50, 3.1],
    [58, 1.3],
    [66, 3.3],
    [72, 4.1],
    [84, 1.3],
    [88, 1.3],
  ]),
  enemies: enemies([
    [20, 0, 'bruiser', 1.4],
    [30, 0, 'bruiser', 1.4],
    [28, 5.6, 'bruiser', 0.7],
    [36, 6.5, 'skimmer', 1.6],
    [52, 2.2, 'bruiser', 0.9],
    [60, 0, 'bruiser', 1.6],
    [70, 4.0, 'skimmer', 1.5],
    [84, 0, 'bruiser', 1.8],
  ]),
});

/** 20 — Flag Finale: capstone mix, clean goal */
const level20 = level({
  id: 'level20',
  name: 'Flag Finale',
  theme: 'sunset',
  spawn: { x: 1.2, y: 0 },
  width: 110,
  maxY: 28,
  deathY: -6,
  goal: { x: 100, y: 0, height: 6.2 },
  platforms: [
    g(6, 0, 12),
    q(8, 2.5, 'powerUp'),
    // Cadence hops
    plat(14, 1.6, 2.0, 'brick'),
    plat(18, 2.2, 2.0, 'brick'),
    plat(22, 1.8, 2.0, 'brick'),
    g(28, 0, 6),
    pipe(26, 2.2, 2.2),
    // Vertical ridge
    plat(34, 2.0, 2.4, 'stone'),
    plat(38, 3.2, 2.2, 'stone'),
    plat(42, 4.4, 2.4, 'metal'),
    q(42, 7.0, 'multiCoin', { durationSec: 3.0, maxCoins: 8 }),
    // Gaps
    plat(48, 3.0, 2.2, 'metal'),
    plat(54, 2.2, 2.2, 'metal'),
    plat(60, 3.0, 2.4, 'metal'),
    // Breathing
    g(68, 0, 10),
    q(70, 2.5, 'coin'),
    q(71.1, 2.5, 'coin'),
    // Final skill mix
    stair(76, 3.0, 4, 3.0, 'brick'),
    plat(82, 3.0, 3.0, 'grass'),
    pipe(86, 2.0, 2.0),
    plat(90, 1.6, 2.6, 'stone'),
    g(98, 0, 16),
  ],
  coins: coins([
    [4, 1.3],
    [10, 1.3],
    [14, 2.5],
    [18, 3.1],
    [22, 2.7],
    [28, 1.3],
    [34, 2.9],
    [38, 4.1],
    [42, 5.3],
    [48, 3.9],
    [54, 3.1],
    [60, 3.9],
    [68, 1.3],
    [76, 2.0],
    [82, 3.9],
    [90, 2.5],
    [96, 1.3],
  ]),
  enemies: enemies([
    [16, 2.5, 'skimmer', 1.4],
    [30, 0, 'bruiser', 1.5],
    [36, 2.0, 'bruiser', 0.7],
    [44, 5.5, 'skimmer', 1.6],
    [56, 3.5, 'skimmer', 1.5],
    [70, 0, 'bruiser', 1.8],
    [83, 3.0, 'bruiser', 0.9],
    [94, 0, 'bruiser', 1.5],
  ]),
});

/** Full campaign in play order. */
export const ALL_LEVELS: LevelDef[] = [
  level01,
  level02,
  level03,
  level04,
  level05,
  level06,
  level07,
  level08,
  level09,
  level10,
  level11,
  level12,
  level13,
  level14,
  level15,
  level16,
  level17,
  level18,
  level19,
  level20,
];

/** Back-compat aliases for older imports. */
export const level1 = level01;
export const level2 = level08;
