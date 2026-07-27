/**
 * Level 2 — Ridge Climb.
 * Longer, more vertical, tighter jumps, pipes as obstacles.
 * Requires precise jumps (~4–5u gaps) and multi-level routing.
 */

import type { LevelDef } from './types';

export const level2: LevelDef = {
  id: 'level2',
  name: 'Ridge Climb',
  theme: 'sunset',
  spawn: { x: 1.2, y: 0 },
  bounds: {
    minX: -4,
    maxX: 110,
    minY: -8,
    maxY: 28,
  },
  deathY: -6,
  goal: { x: 100, y: 0, height: 6.0 },

  platforms: [
    // —— Spawn strip ——
    { kind: 'ground', style: 'grass', x: 5, y: 0, w: 12, h: 1.9, depth: 6 },

    // Early pipe wall (must jump onto or over)
    { kind: 'pipe', style: 'pipe', x: 10.5, y: 2.4, w: 1.7, h: 2.4 },

    // Gap then short ground
    { kind: 'ground', style: 'grass', x: 16, y: 0, w: 5, h: 1.9, depth: 6 },

    // Rising platform chain (tighter spacing)
    { kind: 'platform', style: 'stone', x: 20.5, y: 1.4, w: 2.2, h: 0.8, depth: 2.2 },
    { kind: 'platform', style: 'brick', x: 24.2, y: 2.4, w: 2.0, h: 0.8, depth: 2.0 },
    { kind: 'platform', style: 'stone', x: 28.0, y: 3.5, w: 2.0, h: 0.8, depth: 2.0 },
    { kind: 'platform', style: 'metal', x: 32.0, y: 4.6, w: 2.4, h: 0.75, depth: 2.2 },

    // Question block ceiling-ish bonk target on high path. Underside must clear
    // the metal platform top (4.6) by more than PLAYER.height (1.28), or most of
    // that platform turns into an invisible wall.
    { kind: 'block', style: 'question', x: 32.0, y: 7.1, w: 0.95, h: 0.95, depth: 0.95 },
    { kind: 'block', style: 'question', x: 33.1, y: 7.1, w: 0.95, h: 0.95, depth: 0.95 },

    // Drop to mid ground with pit risk on both sides
    { kind: 'ground', style: 'dirt', x: 38, y: 0, w: 6, h: 1.9, depth: 6 },

    // Twin pipes as corridor obstacles
    { kind: 'pipe', style: 'pipe', x: 36.2, y: 1.6, w: 1.5, h: 1.6 },
    { kind: 'pipe', style: 'pipe', x: 40.0, y: 2.8, w: 1.6, h: 2.8 },

    // Vertical tower of ledges (alternate sides)
    { kind: 'platform', style: 'wood', x: 44, y: 1.8, w: 2.6, h: 0.75, depth: 2.2 },
    { kind: 'platform', style: 'wood', x: 48.5, y: 3.2, w: 2.2, h: 0.75, depth: 2.0 },
    { kind: 'platform', style: 'wood', x: 44.5, y: 4.6, w: 2.2, h: 0.75, depth: 2.0 },
    { kind: 'platform', style: 'stone', x: 49.0, y: 6.0, w: 2.8, h: 0.8, depth: 2.2 },

    // Long high ridge
    { kind: 'platform', style: 'grass', x: 56, y: 6.0, w: 8, h: 1.0, depth: 2.8 },

    // Brick wall + stair descent
    { kind: 'block', style: 'brick', x: 61.5, y: 7.0, w: 1.0, h: 1.0, depth: 1.0 },
    { kind: 'block', style: 'brick', x: 61.5, y: 8.0, w: 1.0, h: 1.0, depth: 1.0 },
    { kind: 'stair', style: 'brick', x: 65.5, y: 6.0, w: 5, h: 3.5, depth: 2.4 },

    // Floating islands with wider death gaps (~4.5–5u)
    { kind: 'platform', style: 'metal', x: 72, y: 3.2, w: 2.4, h: 0.75, depth: 2.0 },
    { kind: 'platform', style: 'metal', x: 77.5, y: 4.0, w: 2.0, h: 0.75, depth: 2.0 },
    { kind: 'platform', style: 'metal', x: 83, y: 2.6, w: 2.6, h: 0.75, depth: 2.2 },

    // Pipe hop sequence
    { kind: 'pipe', style: 'pipe', x: 87, y: 2.2, w: 1.55, h: 2.2 },
    { kind: 'pipe', style: 'pipe', x: 90.2, y: 3.0, w: 1.55, h: 3.0 },
    { kind: 'pipe', style: 'pipe', x: 93.5, y: 2.0, w: 1.55, h: 2.0 },

    // Final approach ground
    { kind: 'ground', style: 'grass', x: 100, y: 0, w: 16, h: 1.9, depth: 6 },

    // Safe mid platforms if you fall from ridge early
    { kind: 'platform', style: 'stone', x: 54, y: 2.0, w: 2.5, h: 0.8, depth: 2.2 },
    { kind: 'platform', style: 'stone', x: 59, y: 1.4, w: 2.2, h: 0.8, depth: 2.0 },

    // Ledge near goal for a last hop
    { kind: 'ledge', style: 'stone', x: 96, y: 1.3, w: 2.8, h: 0.85, depth: 2.4 },
  ],

  coins: [
    // Spawn strip
    { x: 3, y: 1.3 },
    { x: 4.5, y: 1.3 },
    { x: 6, y: 1.3 },
    { x: 8, y: 1.3 },
    // Pipe lip
    { x: 10.5, y: 3.3 },
    { x: 10.5, y: 4.0 },
    // Short ground
    { x: 15, y: 1.3 },
    { x: 16.5, y: 1.3 },
    // Rising platform chain
    { x: 20.5, y: 2.3 },
    { x: 22.2, y: 2.8 },
    { x: 24.2, y: 3.3 },
    { x: 26.0, y: 3.8 },
    { x: 28.0, y: 4.4 },
    { x: 30.0, y: 5.0 },
    { x: 32.0, y: 5.5 },
    // Question blocks overhead
    { x: 32.0, y: 8.0 },
    { x: 33.1, y: 8.0 },
    // Mid ground island
    { x: 37, y: 1.3 },
    { x: 38.5, y: 1.3 },
    { x: 40, y: 3.8 },
    // Vertical tower
    { x: 44, y: 2.7 },
    { x: 46, y: 3.4 },
    { x: 48.5, y: 4.1 },
    { x: 46.5, y: 4.9 },
    { x: 44.5, y: 5.5 },
    { x: 47, y: 6.3 },
    { x: 49, y: 6.9 },
    // Long high ridge
    { x: 53, y: 7.0 },
    { x: 55, y: 7.0 },
    { x: 56.5, y: 7.0 },
    { x: 58, y: 7.0 },
    { x: 59.5, y: 7.0 },
    // Safe lower platforms under ridge
    { x: 54, y: 2.9 },
    { x: 59, y: 2.3 },
    // Floating metal islands
    { x: 72, y: 4.1 },
    { x: 74.5, y: 4.5 },
    { x: 77.5, y: 4.9 },
    { x: 80, y: 4.2 },
    { x: 83, y: 3.5 },
    // Pipe hop sequence
    { x: 87, y: 3.1 },
    { x: 90.2, y: 4.0 },
    { x: 90.2, y: 5.0 },
    { x: 93.5, y: 2.9 },
    { x: 96, y: 2.2 },
    // Final approach — all left of the flag at x=100, which ends the level on touch.
    { x: 97.0, y: 1.5 },
    { x: 97.9, y: 1.5 },
    { x: 98.8, y: 1.5 },
    { x: 99.5, y: 1.5 },
  ],

  enemies: [
    // Early ground after spawn strip
    { x: 17.2, y: 0, type: 'bruiser', patrol: 1.4 },
    // Mid ground island — one bruiser (was two stacked unfairly)
    { x: 38.5, y: 0, type: 'bruiser', patrol: 1.6 },
    // High ridge patrol
    { x: 56.5, y: 6.0, type: 'bruiser', patrol: 2.2 },
    // Skimmer between vertical ledges
    { x: 46.5, y: 4.2, type: 'skimmer', patrol: 1.8 },
    // Skimmer over floating metal islands
    { x: 77.5, y: 5.4, type: 'skimmer', patrol: 2.0 },
    // Final approach — offset from flag so you can commit
    { x: 97.5, y: 0, type: 'bruiser', patrol: 1.6 },
    // Pipe corridor pressure
    { x: 41.5, y: 0, type: 'bruiser', patrol: 1.0 },
  ],
};

export default level2;
