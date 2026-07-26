/**
 * Level 1 — Meadow Tutorial.
 * Gentle gaps, few platforms, clear path to the flag.
 * Jump height ~2.7u full hold; run speed 8.2 — gaps of 2–4u are comfortable.
 */

import type { LevelDef } from './types';

export const level1: LevelDef = {
  id: 'level1',
  name: 'Meadow Run',
  theme: 'meadow',
  spawn: { x: 1.5, y: 0 },
  bounds: {
    minX: -4,
    maxX: 72,
    minY: -6,
    maxY: 22,
  },
  deathY: -5,
  goal: { x: 64, y: 0, height: 5.5 },

  platforms: [
    // —— Starting ground ——
    { kind: 'ground', style: 'grass', x: 6, y: 0, w: 16, h: 1.8, depth: 6 },

    // Small step-up blocks (tutorial ledge)
    { kind: 'block', style: 'stone', x: 10, y: 1.1, w: 1.0, h: 1.0, depth: 1.2 },
    { kind: 'block', style: 'stone', x: 11.1, y: 1.1, w: 1.0, h: 1.0, depth: 1.2 },

    // First easy floating platform
    { kind: 'platform', style: 'stone', x: 16, y: 1.5, w: 3.4, h: 0.9, depth: 2.6 },

    // Question block above platform (solid — can stand / bonk)
    { kind: 'block', style: 'question', x: 16, y: 3.4, w: 0.95, h: 0.95, depth: 0.95 },

    // Ground continues after small gap (~2.5u — easy walk/jump)
    { kind: 'ground', style: 'grass', x: 24, y: 0, w: 10, h: 1.8, depth: 6 },

    // Mid floating path
    { kind: 'platform', style: 'brick', x: 28, y: 2.0, w: 2.8, h: 0.85, depth: 2.4 },
    { kind: 'platform', style: 'stone', x: 32.5, y: 2.8, w: 2.4, h: 0.85, depth: 2.2 },

    // Ground island
    { kind: 'ground', style: 'grass', x: 38, y: 0, w: 8, h: 1.8, depth: 6 },

    // Decorative / usable question row
    { kind: 'block', style: 'question', x: 36.5, y: 2.6, w: 0.95, h: 0.95, depth: 0.95 },
    { kind: 'block', style: 'brick', x: 37.5, y: 2.6, w: 0.95, h: 0.95, depth: 0.95 },
    { kind: 'block', style: 'question', x: 38.5, y: 2.6, w: 0.95, h: 0.95, depth: 0.95 },

    // Soft stair up to high ledge
    { kind: 'stair', style: 'stone', x: 43, y: 2.4, w: 4, h: 2.4, depth: 2.4 },

    // High platform after stairs
    { kind: 'platform', style: 'grass', x: 48, y: 2.4, w: 4.5, h: 1.0, depth: 2.8 },

    // Gentle drop platforms toward flag
    { kind: 'platform', style: 'stone', x: 53.5, y: 1.6, w: 3.0, h: 0.85, depth: 2.4 },

    // Final ground before flag
    { kind: 'ground', style: 'grass', x: 62, y: 0, w: 14, h: 1.8, depth: 6 },

    // Friendly pipe near end (obstacle / landmark, jump over or onto lip)
    { kind: 'pipe', style: 'pipe', x: 57.5, y: 2.0, w: 1.6, h: 2.0, depth: 1.6 },
  ],

  coins: [
    // Start path
    { x: 4, y: 1.3 },
    { x: 5.2, y: 1.3 },
    { x: 6.4, y: 1.3 },
    { x: 10, y: 2.0 },
    { x: 11.1, y: 2.0 },
    // First platform + question block
    { x: 15.2, y: 2.3 },
    { x: 16, y: 2.3 },
    { x: 16.8, y: 2.3 },
    { x: 16, y: 4.2 },
    // Arc over first gap
    { x: 19.5, y: 1.8 },
    { x: 21, y: 1.5 },
    { x: 22.5, y: 1.3 },
    // Ground after gap
    { x: 24, y: 1.3 },
    { x: 25.5, y: 1.3 },
    { x: 27, y: 1.3 },
    // Mid floating path
    { x: 28, y: 2.9 },
    { x: 30.2, y: 3.2 },
    { x: 32.5, y: 3.7 },
    // Question row
    { x: 36.5, y: 3.6 },
    { x: 37.5, y: 3.6 },
    { x: 38.5, y: 3.6 },
    { x: 38, y: 1.3 },
    { x: 39.5, y: 1.3 },
    // Stairs + high ledge
    { x: 43, y: 2.0 },
    { x: 44.2, y: 2.8 },
    { x: 45.5, y: 3.4 },
    { x: 47, y: 3.3 },
    { x: 48, y: 3.3 },
    { x: 49, y: 3.3 },
    // Drop toward flag
    { x: 51.5, y: 2.8 },
    { x: 53.5, y: 2.5 },
    { x: 55.5, y: 2.2 },
    // Pipe hop + final ground
    { x: 57.5, y: 3.0 },
    { x: 59, y: 1.4 },
    { x: 60.5, y: 1.4 },
    { x: 62, y: 1.4 },
    { x: 63.5, y: 1.4 },
    { x: 65, y: 1.4 },
  ],

  enemies: [
    // First contact after the easy gap — short patrol, fair intro stomp
    { x: 26, y: 0, type: 'bruiser', patrol: 1.8 },
    // Mid island (room to approach from either side)
    { x: 39, y: 0, type: 'bruiser', patrol: 1.6 },
    // High grass platform — narrow but stompable
    { x: 48.5, y: 2.4, type: 'bruiser', patrol: 1.1 },
    // Skimmer over mid path (optional air threat)
    { x: 31, y: 3.8, type: 'skimmer', patrol: 1.6 },
    // Final approach — leave space before the flag
    { x: 59.5, y: 0, type: 'bruiser', patrol: 1.5 },
  ],
};

export default level1;
