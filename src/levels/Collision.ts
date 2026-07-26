/**
 * AABB helpers and player-vs-solids resolution.
 * Mirrors the PlayerController separation model so levels and tools
 * can share the same geometry math without importing Three.
 */

import type { Solid } from './types';
import { PLAYER } from '../game/config';

export type { Solid };

/** True if two AABBs overlap (exclusive edges — touching edges do not count). */
export function aabbOverlap(a: Solid, b: Solid): boolean {
  return a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY;
}

/** True if two AABBs overlap or touch (inclusive edges). */
export function aabbOverlapInclusive(a: Solid, b: Solid): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

/** Intersection volume as an AABB, or null if no overlap. */
export function aabbIntersection(a: Solid, b: Solid): Solid | null {
  if (!aabbOverlap(a, b)) return null;
  return {
    minX: Math.max(a.minX, b.minX),
    maxX: Math.min(a.maxX, b.maxX),
    minY: Math.max(a.minY, b.minY),
    maxY: Math.min(a.maxY, b.maxY),
  };
}

/** Center of an AABB. */
export function aabbCenter(s: Solid): { x: number; y: number } {
  return {
    x: (s.minX + s.maxX) * 0.5,
    y: (s.minY + s.maxY) * 0.5,
  };
}

/** Half-extents of an AABB. */
export function aabbHalfSize(s: Solid): { hw: number; hh: number } {
  return {
    hw: (s.maxX - s.minX) * 0.5,
    hh: (s.maxY - s.minY) * 0.5,
  };
}

/** Build solid from center + full size. */
export function solidFromCenter(cx: number, cy: number, w: number, h: number): Solid {
  const hw = w * 0.5;
  const hh = h * 0.5;
  return {
    minX: cx - hw,
    maxX: cx + hw,
    minY: cy - hh,
    maxY: cy + hh,
  };
}

/**
 * Build solid from top-surface Y and full width/height
 * (top of box at `topY`, extends downward by `h`).
 */
export function solidFromTop(cx: number, topY: number, w: number, h: number): Solid {
  return {
    minX: cx - w * 0.5,
    maxX: cx + w * 0.5,
    minY: topY - h,
    maxY: topY,
  };
}

/** Feet-based player AABB (position is bottom-center). */
export function playerBounds(
  x: number,
  y: number,
  halfW: number = PLAYER.halfWidth,
  height: number = PLAYER.height,
): Solid {
  return {
    minX: x - halfW,
    maxX: x + halfW,
    minY: y,
    maxY: y + height,
  };
}

export interface ResolveResult {
  x: number;
  y: number;
  vx: number;
  vy: number;
  grounded: boolean;
  hitCeiling: boolean;
  hitWall: boolean;
}

/**
 * Separate a feet-based player box from solids after an attempted move.
 * Horizontal then vertical (same order as PlayerController).
 */
export function resolvePlayerVsSolids(
  x: number,
  y: number,
  vx: number,
  vy: number,
  solids: readonly Solid[],
  opts: { halfW?: number; height?: number; skin?: number } = {},
): ResolveResult {
  const halfW = opts.halfW ?? PLAYER.halfWidth;
  const height = opts.height ?? PLAYER.height;
  const skin = opts.skin ?? PLAYER.skin;

  let px = x;
  let py = y;
  let pvx = vx;
  let pvy = vy;
  let grounded = false;
  let hitCeiling = false;
  let hitWall = false;

  // Horizontal
  {
    const b = playerBounds(px, py, halfW, height);
    for (const s of solids) {
      if (!aabbOverlap(b, s)) continue;
      const overlapL = b.maxX - s.minX;
      const overlapR = s.maxX - b.minX;
      if (overlapL < overlapR) {
        px -= overlapL + skin * 0.25;
        if (pvx > 0) pvx = 0;
      } else {
        px += overlapR + skin * 0.25;
        if (pvx < 0) pvx = 0;
      }
      hitWall = true;
      Object.assign(b, playerBounds(px, py, halfW, height));
    }
  }

  // Vertical
  {
    const b = playerBounds(px, py, halfW, height);
    for (const s of solids) {
      if (!aabbOverlap(b, s)) continue;
      const overlapB = b.maxY - s.minY;
      const overlapT = s.maxY - b.minY;
      if (overlapT < overlapB) {
        py += overlapT;
        if (pvy < 0) {
          pvy = 0;
          grounded = true;
        }
      } else {
        py -= overlapB;
        if (pvy > 0) pvy = 0;
        hitCeiling = true;
      }
      Object.assign(b, playerBounds(px, py, halfW, height));
    }
  }

  // Ground probe
  if (pvy <= 0.01 && !grounded) {
    const feet: Solid = {
      minX: px - halfW * 0.9,
      maxX: px + halfW * 0.9,
      minY: py - skin * 2,
      maxY: py + skin,
    };
    for (const s of solids) {
      if (feet.maxX <= s.minX || feet.minX >= s.maxX) continue;
      if (feet.maxY < s.maxY || feet.minY > s.maxY + skin * 3) continue;
      if (py <= s.maxY + skin * 2 && py >= s.maxY - skin * 2) {
        py = s.maxY;
        grounded = true;
        if (pvy < 0) pvy = 0;
        break;
      }
    }
  }

  return { x: px, y: py, vx: pvx, vy: pvy, grounded, hitCeiling, hitWall };
}

/** First solid that overlaps the query box, or undefined. */
export function querySolid(box: Solid, solids: readonly Solid[]): Solid | undefined {
  for (const s of solids) {
    if (aabbOverlap(box, s)) return s;
  }
  return undefined;
}

/** All solids overlapping the query box. */
export function querySolids(box: Solid, solids: readonly Solid[]): Solid[] {
  const out: Solid[] = [];
  for (const s of solids) {
    if (aabbOverlap(box, s)) out.push(s);
  }
  return out;
}
