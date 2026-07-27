/**
 * Procedural tiling surface materials for level geometry.
 *
 * Every platform style gets one 256x256 Canvas2D colour tile plus a matching
 * greyscale bump tile, painted by the same code path so the height detail
 * registers with the marks it came from. Tiles are seamless: every mark goes
 * through `stamp()`, which repeats it across the tile seam.
 *
 * Colour identity is baked into the map (material.color stays white), so a
 * textured platform reads as the same style colour it had when it was a flat box.
 */

import * as THREE from 'three';
import { COLORS } from '../game/config';
import type { PlatformStyle } from './types';
import { box, hashNoise, orb, parseColor, polygon, rgbToCss, type Rgb } from '../render/paint';

export type SurfaceFace = 'top' | 'body';

const TILE = 256;
/** World units covered by one texture tile — texel density anchor. */
const UNITS_PER_TILE = 2;
/** Repeat quantisation step; collapses similar platforms onto one material. */
const REPEAT_STEP = 0.5;
/**
 * Floor on the repeat. A sub-tile window is harmless — the tile is seamless, so
 * a mesh taking 0.5 of it just shows less pattern at the same texel density.
 * Flooring at a whole tile instead doubled the pattern scale on everything under
 * two units: a 1-unit stone block drew its courses at 0.33 world units next to a
 * ground strip drawing the same courses at 0.67.
 */
const MIN_REPEAT = REPEAT_STEP;

type Ctx = CanvasRenderingContext2D;
/** Resolves a mark's colour: the hue on the colour pass, its height on the bump pass. */
type Ink = (color: Rgb, height: number) => Rgb;
type Painter = (ctx: Ctx, ink: Ink) => void;
type Mark = (ctx: Ctx, x: number, y: number) => void;

// --- Colour ----------------------------------------------------------------

const css = rgbToCss;

/** Lighten (t > 0) or darken (t < 0) toward white/black, staying in Rgb space. */
function lift(c: Rgb, t: number): Rgb {
  const k = Math.max(-1, Math.min(1, t));
  if (k >= 0) {
    return { r: c.r + (255 - c.r) * k, g: c.g + (255 - c.g) * k, b: c.b + (255 - c.b) * k };
  }
  const m = 1 + k;
  return { r: c.r * m, g: c.g * m, b: c.b * m };
}

function blend(a: Rgb, b: Rgb, t: number): Rgb {
  const k = Math.max(0, Math.min(1, t));
  return { r: a.r + (b.r - a.r) * k, g: a.g + (b.g - a.g) * k, b: a.b + (b.b - a.b) * k };
}

function makeInk(bump: boolean): Ink {
  if (!bump) return (color) => color;
  return (_color, height) => {
    const v = Math.max(0, Math.min(1, height)) * 255;
    return { r: v, g: v, b: v };
  };
}

// --- Deterministic variation ----------------------------------------------

/** Fixed-seed value stream. Same seed + same code path => byte-identical art. */
function noiseSeq(seed: number): () => number {
  let i = 0;
  return () => {
    i += 1;
    return hashNoise(seed * 12.9898 + i * 7.317, seed * 3.771 + i * 1.913);
  };
}

const span = (t: number, a: number, b: number): number => a + (b - a) * t;
const wrapCoord = (v: number): number => ((v % TILE) + TILE) % TILE;

// --- Seam-safe stamping ----------------------------------------------------

/**
 * Paint a mark, mirroring it across whichever tile seams it comes within
 * `reach` of. Geometry must be decided *before* calling — every copy has to be
 * identical, and the bump pass has to consume the noise stream the same way.
 */
function stamp(ctx: Ctx, x: number, y: number, reachX: number, reachY: number, draw: Mark): void {
  const xs: number[] = [x];
  if (x - reachX < 0) xs.push(x + TILE);
  if (x + reachX > TILE) xs.push(x - TILE);
  const ys: number[] = [y];
  if (y - reachY < 0) ys.push(y + TILE);
  if (y + reachY > TILE) ys.push(y - TILE);
  for (const px of xs) {
    for (const py of ys) draw(ctx, px, py);
  }
}

const mark = (ctx: Ctx, x: number, y: number, reach: number, draw: Mark): void =>
  stamp(ctx, x, y, reach, reach, draw);

/** Full-width horizontal feature: only the top/bottom seam can cut it. */
const band = (ctx: Ctx, y: number, reachY: number, draw: (ctx: Ctx, y: number) => void): void =>
  stamp(ctx, 0, y, 0, reachY, (c, _x, py) => draw(c, py));

// --- Shared marks ----------------------------------------------------------

function softBlob(ctx: Ctx, cx: number, cy: number, r: number, color: Rgb, alpha: number): void {
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  g.addColorStop(0, css(color, alpha));
  g.addColorStop(1, css(color, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
}

/** Granularity scatter — the grit under soil, mortar, metal and paint. */
function speckle(
  ctx: Ctx,
  n: () => number,
  count: number,
  tints: readonly Rgb[],
  rMin: number,
  rMax: number,
  aMin: number,
  aMax: number,
): void {
  for (let i = 0; i < count; i++) {
    const x = n() * TILE;
    const y = n() * TILE;
    const r = span(n(), rMin, rMax);
    const tint = tints[Math.floor(n() * tints.length) % tints.length];
    ctx.fillStyle = css(tint, span(n(), aMin, aMax));
    mark(ctx, x, y, r + 1.5, (c, px, py) => {
      c.beginPath();
      c.arc(px, py, r, 0, Math.PI * 2);
      c.fill();
    });
  }
}

function pathOf(ctx: Ctx, pts: readonly (readonly [number, number])[]): void {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
}

/** Wavy full-width slab. The wobble is periodic in x so it survives tiling. */
function strata(ctx: Ctx, y: number, h: number, amp: number, phase: number, freq: number): void {
  const steps = 32;
  ctx.beginPath();
  for (let i = 0; i <= steps; i++) {
    const x = (i / steps) * TILE;
    const wy = y + Math.sin((x / TILE) * Math.PI * 2 * freq + phase) * amp;
    if (i === 0) ctx.moveTo(x, wy);
    else ctx.lineTo(x, wy);
  }
  for (let i = steps; i >= 0; i--) {
    const x = (i / steps) * TILE;
    ctx.lineTo(x, y + h + Math.sin((x / TILE) * Math.PI * 2 * freq + phase + 1.1) * amp * 0.7);
  }
  ctx.closePath();
  ctx.fill();
}

/** Cell-bounded irregular slab outline, jittered inward only so blocks never merge. */
function blockPoly(hw: number, hh: number, jitter: number, n: () => number): [number, number][] {
  const corners: readonly (readonly [number, number])[] = [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh],
  ];
  const pts: [number, number][] = [];
  for (let c = 0; c < 4; c++) {
    const a = corners[c];
    const b = corners[(c + 1) % 4];
    for (let s = 0; s < 3; s++) {
      const t = s / 3;
      const px = a[0] + (b[0] - a[0]) * t;
      const py = a[1] + (b[1] - a[1]) * t;
      pts.push([px - Math.sign(px) * jitter * n(), py - Math.sign(py) * jitter * n()]);
    }
  }
  return pts;
}

// --- Style painters --------------------------------------------------------

function grassTop(base: Rgb): Painter {
  const dark = lift(base, -0.36);
  const mid = lift(base, -0.06);
  const bright = blend(lift(base, 0.26), { r: 214, g: 226, b: 108 }, 0.32);
  const fleck: Rgb = { r: 246, g: 238, b: 168 };

  return (ctx, ink) => {
    const n = noiseSeq(7.31);
    ctx.fillStyle = css(ink(mid, 0.52));
    ctx.fillRect(0, 0, TILE, TILE);

    for (let i = 0; i < 16; i++) {
      const cx = n() * TILE;
      const cy = n() * TILE;
      const r = span(n(), 24, 62);
      const up = n() > 0.55;
      const tint = ink(up ? bright : dark, up ? 0.6 : 0.42);
      const alpha = up ? 0.28 : 0.42;
      mark(ctx, cx, cy, r, (c, px, py) => softBlob(c, px, py, r, tint, alpha));
    }

    for (let i = 0; i < 2200; i++) {
      const x = n() * TILE;
      const y = n() * TILE;
      const len = span(n(), 4.5, 9);
      const tilt = (n() - 0.5) * 5;
      const pick = n();
      const col = pick < 0.34 ? dark : pick < 0.72 ? mid : bright;
      const h = pick < 0.34 ? 0.56 : pick < 0.72 ? 0.68 : 0.79;
      ctx.strokeStyle = css(ink(col, h), 0.9);
      ctx.lineWidth = span(n(), 1.3, 2.2);
      mark(ctx, x, y, len + 4, (c, px, py) => {
        c.beginPath();
        c.moveTo(px, py);
        c.lineTo(px + tilt, py - len);
        c.stroke();
      });
    }

    for (let i = 0; i < 44; i++) {
      const x = n() * TILE;
      const y = n() * TILE;
      const r = span(n(), 1, 1.9);
      const tint = css(ink(fleck, 0.86));
      mark(ctx, x, y, r + 2, (c, px, py) => orb(c, px, py, r, r, { fill: tint, outline: null }));
    }
  };
}

/** Granular soil with strata and embedded pebbles — grass body and dirt. */
function soil(base: Rgb): Painter {
  const dark = lift(base, -0.3);
  const darker = lift(base, -0.54);
  const light = lift(base, 0.2);

  return (ctx, ink) => {
    const n = noiseSeq(19.4);
    ctx.fillStyle = css(ink(base, 0.5));
    ctx.fillRect(0, 0, TILE, TILE);

    for (let i = 0; i < 9; i++) {
      const y = ((i + span(n(), 0.15, 0.85)) / 9) * TILE;
      const h = span(n(), 9, 26);
      const amp = span(n(), 2, 6);
      const phase = n() * Math.PI * 2;
      const freq = 1 + Math.floor(n() * 3);
      const up = n() > 0.5;
      ctx.fillStyle = css(ink(up ? light : dark, up ? 0.58 : 0.42), 0.38);
      band(ctx, y, h + amp + 3, (c, py) => strata(c, py, h, amp, phase, freq));
    }

    speckle(
      ctx,
      n,
      2300,
      [ink(dark, 0.4), ink(darker, 0.34), ink(light, 0.62), ink(base, 0.5)],
      0.6,
      1.7,
      0.25,
      0.7,
    );

    for (let i = 0; i < 58; i++) {
      const x = n() * TILE;
      const y = n() * TILE;
      const r = span(n(), 2.2, 5.2);
      const rot = n() * Math.PI;
      const face = lift(base, span(n(), -0.1, 0.34));
      const body = css(ink(face, 0.82));
      const rim = css(ink(darker, 0.34), 0.8);
      const gloss = css(ink(lift(face, 0.42), 0.92), 0.55);
      mark(ctx, x, y, r + 4, (c, px, py) => {
        orb(c, px, py, r, r * 0.82, { fill: body, outline: rim, lineWidth: 1.4 }, rot);
        orb(c, px - r * 0.3, py - r * 0.34, r * 0.34, r * 0.24, { fill: gloss, outline: null }, rot);
      });
    }
  };
}

/** Large irregular blocks, mortar lines, chipped corners, mottled noise. */
function stoneBlocks(base: Rgb): Painter {
  const mortar = lift(base, -0.46);
  const seam = lift(base, -0.68);
  const glow = lift(base, 0.32);

  return (ctx, ink) => {
    const n = noiseSeq(3.77);
    // Square grid, each row staggered by a third of a block — after `grid` rows
    // the stagger is back to zero, so the courses re-register across the
    // vertical seam instead of jumping there.
    const grid = 3;
    const cellW = TILE / grid;
    const cellH = TILE / grid;

    ctx.fillStyle = css(ink(mortar, 0.24));
    ctx.fillRect(0, 0, TILE, TILE);
    speckle(ctx, n, 700, [ink(seam, 0.18), ink(lift(mortar, 0.24), 0.32)], 0.6, 1.6, 0.2, 0.5);

    for (let r = 0; r < grid; r++) {
      const offset = (r * cellW) / grid;
      const cy = (r + 0.5) * cellH;
      for (let i = 0; i < grid; i++) {
        const cx = wrapCoord(offset + (i + 0.5) * cellW);
        const gap = span(n(), 4, 7);
        const hw = cellW * 0.5 - gap * 0.5;
        const hh = cellH * 0.5 - gap * 0.5;
        const pts = blockPoly(hw, hh, 3.4, n);
        const face = lift(base, span(n(), -0.12, 0.12));

        const mottles: [number, number, number][] = [];
        for (let m = 0; m < 24; m++) {
          mottles.push([span(n(), -hw, hw), span(n(), -hh, hh), span(n(), 6, 20)]);
        }
        const chips: [number, number, number][] = [];
        for (let k = 0, kn = 1 + Math.floor(n() * 2); k < kn; k++) {
          chips.push([n() < 0.5 ? -hw : hw, n() < 0.5 ? -hh : hh, span(n(), 5, 11)]);
        }

        const faceCss = css(ink(face, 0.72));
        const seamCss = css(ink(seam, 0.2));
        const mottleTint = ink(lift(face, -0.18), 0.66);
        const topCss = css(ink(glow, 0.87), 0.26);
        const botCss = css(ink(lift(base, -0.32), 0.5), 0.34);
        const chipCss = css(ink(lift(base, -0.38), 0.36));

        // Reach is a whole cell, not the block's own extent: blocks nearly fill
        // their cells, so a tight reach would sit ~1px from under-reaching and a
        // later change to the seam stroke would silently open a seam.
        mark(ctx, cx, cy, cellW * 0.6, (c, px, py) => {
          const at = pts.map(([dx, dy]): [number, number] => [px + dx, py + dy]);
          polygon(c, at, { fill: faceCss, outline: seamCss, lineWidth: 3 });
          c.save();
          pathOf(c, at);
          c.clip();
          for (const [mx, my, mr] of mottles) softBlob(c, px + mx, py + my, mr, mottleTint, 0.3);
          c.fillStyle = topCss;
          c.fillRect(px - hw, py - hh, hw * 2, 5);
          c.fillStyle = botCss;
          c.fillRect(px - hw, py + hh - 7, hw * 2, 7);
          for (const [chx, chy, cr] of chips) {
            polygon(
              c,
              [
                [px + chx, py + chy],
                [px + chx - Math.sign(chx) * cr, py + chy],
                [px + chx, py + chy - Math.sign(chy) * cr],
              ],
              { fill: chipCss, outline: null },
            );
          }
          c.restore();
        });
      }
    }
  };
}

/** Staggered courses with mortar and per-brick tonal drift. */
function bricks(base: Rgb): Painter {
  const mortar = lift(base, -0.5);
  const edge = lift(base, -0.44);

  return (ctx, ink) => {
    const n = noiseSeq(41.9);
    const cols = 3;
    const rows = 6;
    const bw = TILE / cols;
    const bh = TILE / rows;
    const gap = 3.2;

    ctx.fillStyle = css(ink(mortar, 0.26));
    ctx.fillRect(0, 0, TILE, TILE);
    speckle(ctx, n, 620, [ink(lift(mortar, 0.3), 0.34), ink(lift(mortar, -0.3), 0.18)], 0.6, 1.5, 0.2, 0.5);

    for (let r = 0; r < rows; r++) {
      const offset = (r % 2) * bw * 0.5;
      const cy = (r + 0.5) * bh;
      for (let i = 0; i < cols; i++) {
        const cx = wrapCoord(offset + (i + 0.5) * bw);
        const tone = lift(base, span(n(), -0.15, 0.12));
        const hw = bw * 0.5 - gap * 0.5;
        const hh = bh * 0.5 - gap * 0.5;

        const specks: [number, number, number][] = [];
        for (let s = 0; s < 12; s++) {
          specks.push([span(n(), -hw + 4, hw - 4), span(n(), -hh + 4, hh - 4), span(n(), 0.7, 1.8)]);
        }

        const faceCss = css(ink(tone, 0.7));
        const edgeCss = css(ink(edge, 0.3), 0.85);
        const topCss = css(ink(lift(tone, 0.34), 0.83), 0.4);
        const botCss = css(ink(lift(tone, -0.3), 0.52), 0.4);
        const speckCss = css(ink(lift(tone, -0.24), 0.64), 0.45);

        mark(ctx, cx, cy, bw * 0.6, (c, px, py) => {
          box(c, px - hw, py - hh, hw * 2, hh * 2, 2.6, {
            fill: faceCss,
            outline: edgeCss,
            lineWidth: 1.6,
          });
          c.fillStyle = topCss;
          c.fillRect(px - hw + 2, py - hh + 1.6, hw * 2 - 4, 2.2);
          c.fillStyle = botCss;
          c.fillRect(px - hw + 2, py + hh - 3.8, hw * 2 - 4, 2.4);
          for (const [sx, sy, sr] of specks) {
            orb(c, px + sx, py + sy, sr, sr, { fill: speckCss, outline: null });
          }
        });
      }
    }
  };
}

/** Vertical planks: grain, knots, seam gaps. */
function planks(base: Rgb): Painter {
  const seam = lift(base, -0.66);
  const knotInk = lift(base, -0.5);

  return (ctx, ink) => {
    const n = noiseSeq(63.2);
    const count = 4;
    const pw = TILE / count;

    ctx.fillStyle = css(ink(seam, 0.16));
    ctx.fillRect(0, 0, TILE, TILE);

    for (let p = 0; p < count; p++) {
      const x0 = p * pw;
      const tone = lift(base, span(n(), -0.16, 0.14));
      // Cross-plank ramp: lit off the upper-left, occluded into both seams. Flat
      // fill would leave the board tone-dead, and the ramp doubles as its crown.
      const face = ctx.createLinearGradient(x0, 0, x0 + pw, 0);
      face.addColorStop(0, css(ink(lift(tone, -0.2), 0.48)));
      face.addColorStop(0.28, css(ink(lift(tone, 0.12), 0.68)));
      face.addColorStop(0.74, css(ink(tone, 0.62)));
      face.addColorStop(1, css(ink(lift(tone, -0.26), 0.44)));
      ctx.fillStyle = face;
      ctx.fillRect(x0 + 1.8, 0, pw - 3.6, TILE);

      for (let g = 0; g < 17; g++) {
        const gx = x0 + span(n(), 3.5, pw - 3.5);
        const amp = span(n(), 1, 4.5);
        const phase = n() * Math.PI * 2;
        const freq = 1 + Math.floor(n() * 3);
        const deep = n() > 0.34;
        ctx.strokeStyle = css(
          ink(lift(tone, deep ? -0.32 : 0.26), deep ? 0.46 : 0.7),
          span(n(), 0.14, 0.34),
        );
        ctx.lineWidth = span(n(), 0.7, 1.8);
        stamp(ctx, gx, TILE * 0.5, amp + 3, 0, (c, px) => {
          c.beginPath();
          // Overshoot both seams so the round caps never land inside the tile —
          // hence a single subpath starting at s = -1, not at s = 0. The step
          // divides TILE, so the sampled polyline — not just the sine it
          // approximates — is exactly y-periodic and meets itself at the seam.
          for (let s = -1; s <= 25; s++) {
            const y = (s / 24) * TILE;
            const wx = px + Math.sin((y / TILE) * Math.PI * 2 * freq + phase) * amp;
            if (s === -1) c.moveTo(wx, y);
            else c.lineTo(wx, y);
          }
          c.stroke();
        });
      }
    }

    for (let k = 0; k < 5; k++) {
      const kr = span(n(), 4, 8);
      // Keep the whole knot inside one board. The seam gaps are painted last, so
      // a knot straddling one would come out as two mirrored half-knots.
      const reach = kr * 2.1 + 2;
      const board = Math.min(count - 1, Math.floor(n() * count));
      const kx = board * pw + span(n(), reach, pw - reach);
      const ky = n() * TILE;
      const rot = n() * Math.PI;
      const core = css(ink(knotInk, 0.42));
      const ring = css(ink(lift(base, -0.24), 0.56), 0.55);
      mark(ctx, kx, ky, kr * 2.4, (c, px, py) => {
        for (let i = 3; i >= 1; i--) {
          orb(c, px, py, kr * i * 0.7, kr * i * 0.44, { fill: undefined, outline: ring, lineWidth: 1.4 }, rot);
        }
        orb(c, px, py, kr * 0.55, kr * 0.36, { fill: core, outline: null }, rot);
      });
    }

    for (let p = 0; p < count; p++) {
      const x = p * pw;
      const gapCss = css(ink(seam, 0.14), 0.85);
      const lipCss = css(ink(lift(base, 0.3), 0.66), 0.3);
      stamp(ctx, x, TILE * 0.5, 5, 0, (c, px) => {
        c.fillStyle = gapCss;
        c.fillRect(px - 1.7, 0, 3.4, TILE);
        c.fillStyle = lipCss;
        c.fillRect(px + 1.9, 0, 1.4, TILE);
      });
    }
  };
}

/** Brushed horizontal streaks, panel lines, rivets. */
function brushedMetal(base: Rgb): Painter {
  const bright = lift(base, 0.34);
  const dark = lift(base, -0.34);
  const line = lift(base, -0.52);

  return (ctx, ink) => {
    const n = noiseSeq(88.1);
    ctx.fillStyle = css(ink(base, 0.5));
    ctx.fillRect(0, 0, TILE, TILE);

    for (let i = 0; i < 900; i++) {
      const cx = n() * TILE;
      const cy = n() * TILE;
      const len = span(n(), 26, 170);
      const up = n() > 0.5;
      ctx.strokeStyle = css(ink(up ? bright : dark, up ? 0.56 : 0.44), span(n(), 0.08, 0.26));
      ctx.lineWidth = span(n(), 0.6, 1.9);
      stamp(ctx, cx, cy, len * 0.5 + 2, 2, (c, px, py) => {
        c.beginPath();
        c.moveTo(px - len * 0.5, py);
        c.lineTo(px + len * 0.5, py);
        c.stroke();
      });
    }
    speckle(ctx, n, 420, [ink(bright, 0.55), ink(dark, 0.45)], 0.5, 1.2, 0.06, 0.16);

    // The panel lines below cut the tile into four plates. Give each one the house
    // highlight/occlusion pair so the brushing sits on a surface instead of a
    // flat field. Period TILE/2 divides TILE, so the falloff tiles.
    const plate = TILE * 0.5;
    for (let i = 0; i < 2; i++) {
      const y0 = i * plate;
      const g = ctx.createLinearGradient(0, y0, 0, y0 + plate);
      g.addColorStop(0, css(ink(bright, 0.6), 0.16));
      g.addColorStop(0.44, css(ink(base, 0.5), 0));
      g.addColorStop(1, css(ink(dark, 0.4), 0.18));
      ctx.fillStyle = g;
      ctx.fillRect(0, y0, TILE, plate);
    }

    const lineDark = css(ink(line, 0.3), 0.55);
    const lineLight = css(ink(bright, 0.62), 0.28);
    for (let i = 0; i < 2; i++) {
      const pos = i * TILE * 0.5;
      ctx.fillStyle = lineDark;
      band(ctx, pos, 4, (c, py) => c.fillRect(0, py - 1.2, TILE, 2.4));
      ctx.fillStyle = lineLight;
      band(ctx, pos, 4, (c, py) => c.fillRect(0, py + 1.4, TILE, 1.2));
      ctx.fillStyle = lineDark;
      stamp(ctx, pos, TILE * 0.5, 4, 0, (c, px) => c.fillRect(px - 1.2, 0, 2.4, TILE));
      ctx.fillStyle = lineLight;
      stamp(ctx, pos, TILE * 0.5, 4, 0, (c, px) => c.fillRect(px + 1.4, 0, 1.2, TILE));
    }

    const studCss = css(ink(lift(base, 0.18), 0.8));
    const studRim = css(ink(line, 0.4), 0.7);
    const studGloss = css(ink(bright, 0.93), 0.6);
    const rivets = [14, 114, 142, 242];
    for (const rx of rivets) {
      for (const ry of rivets) {
        const r = 3.4;
        mark(ctx, rx, ry, r + 3, (c, px, py) => {
          orb(c, px, py, r, r, { fill: studCss, outline: studRim, lineWidth: 1.3 });
          orb(c, px - r * 0.3, py - r * 0.34, r * 0.4, r * 0.32, { fill: studGloss, outline: null });
        });
      }
    }
  };
}

/**
 * Smooth pipe skin. Pipes are CylinderGeometry, whose torso UV runs u = 0..1
 * once around the barrel from thetaStart = 0 — and that start point is +Z, i.e.
 * the sliver of pipe pointing straight at the camera. So u = 0/1 is the front
 * centre, u = 0.25 the right silhouette, u = 0.75 the left one, and the barrel
 * gradient has to be laid out on *that* mapping, not on "left edge to right
 * edge". First and last stops match so it closes where it wraps onto the front.
 * Constant in y, so the horizontal seam is free.
 */
function pipeSkin(base: Rgb): Painter {
  return (ctx, ink) => {
    const n = noiseSeq(55.5);
    // SceneSetup's key light sits front-right (sun at +X/+Z over a target on the
    // lane), so the baked sheen belongs just right of the front and both
    // silhouettes roll off. The left flank recovers a little from the cool fill.
    const front = css(ink(lift(base, 0.16), 0.55));
    const g = ctx.createLinearGradient(0, 0, TILE, 0);
    g.addColorStop(0, front);
    g.addColorStop(0.07, css(ink(lift(base, 0.32), 0.6)));
    g.addColorStop(0.13, css(ink(lift(base, 0.44), 0.64)));
    g.addColorStop(0.2, css(ink(lift(base, 0.08), 0.52)));
    g.addColorStop(0.28, css(ink(lift(base, -0.3), 0.4)));
    g.addColorStop(0.42, css(ink(lift(base, -0.46), 0.34)));
    g.addColorStop(0.58, css(ink(lift(base, -0.44), 0.35)));
    g.addColorStop(0.72, css(ink(lift(base, -0.34), 0.38)));
    g.addColorStop(0.82, css(ink(lift(base, -0.2), 0.43)));
    g.addColorStop(0.92, css(ink(lift(base, -0.02), 0.5)));
    g.addColorStop(1, front);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, TILE, TILE);

    for (let i = 0; i < 5; i++) {
      const cx = n() * TILE;
      const halfW = span(n(), 8, 24);
      const up = n() > 0.5;
      const tint = ink(lift(base, up ? 0.3 : -0.26), up ? 0.58 : 0.44);
      const alpha = span(n(), 0.06, 0.16);
      stamp(ctx, cx, TILE * 0.5, halfW + 2, 0, (c, px) => {
        const bg = c.createLinearGradient(px - halfW, 0, px + halfW, 0);
        bg.addColorStop(0, css(tint, 0));
        bg.addColorStop(0.5, css(tint, alpha));
        bg.addColorStop(1, css(tint, 0));
        c.fillStyle = bg;
        c.fillRect(px - halfW, 0, halfW * 2, TILE);
      });
    }

    for (let i = 0; i < 3; i++) {
      const y = n() * TILE;
      const th = span(n(), 0.8, 2);
      ctx.fillStyle = css(ink(lift(base, -0.34), 0.45), 0.1);
      band(ctx, y, th + 2, (c, py) => c.fillRect(0, py, TILE, th));
    }

    speckle(ctx, n, 260, [ink(lift(base, 0.24), 0.54), ink(lift(base, -0.24), 0.47)], 0.5, 1.3, 0.05, 0.13);
  };
}

/** Clean bright panel with a vector "?" glyph and corner studs. */
function questionPanel(base: Rgb): Painter {
  const cream = blend(lift(base, 0.78), { r: 255, g: 248, b: 225 }, 0.6);
  const dark = lift(base, -0.62);

  return (ctx, ink) => {
    const n = noiseSeq(99.9);
    // Centred radial gradients are seam-safe: opposite edges mirror each other.
    const g = ctx.createRadialGradient(TILE * 0.5, TILE * 0.5, 8, TILE * 0.5, TILE * 0.5, TILE * 0.72);
    g.addColorStop(0, css(ink(lift(base, 0.32), 0.6)));
    g.addColorStop(1, css(ink(lift(base, -0.14), 0.48)));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, TILE, TILE);

    // Grit belongs to the panel field only — frame, studs and glyph are the
    // focal marks and stay crisp on top of it.
    speckle(ctx, n, 90, [ink(lift(base, 0.5), 0.56)], 0.5, 1.3, 0.05, 0.14);

    box(ctx, 13, 13, TILE - 26, TILE - 26, 18, {
      fill: undefined,
      outline: css(ink(dark, 0.34), 0.9),
      lineWidth: 6,
    });

    const studs: readonly (readonly [number, number])[] = [
      [30, 30],
      [TILE - 30, 30],
      [30, TILE - 30],
      [TILE - 30, TILE - 30],
    ];
    const studCss = css(ink(lift(base, 0.3), 0.9));
    const studRim = css(ink(dark, 0.4), 0.85);
    const studGloss = css(ink(cream, 0.96), 0.7);
    for (const [sx, sy] of studs) {
      mark(ctx, sx, sy, 12, (c, px, py) => {
        orb(c, px, py, 8, 8, { fill: studCss, outline: studRim, lineWidth: 2.2 });
        orb(c, px - 2.4, py - 2.8, 3, 2.4, { fill: studGloss, outline: null });
      });
    }

    // Glyph spans -87..85 in its own units, so 0.86x centred on the tile leaves
    // ~37px of margin inside the frame on both sides.
    questionGlyph(ctx, TILE * 0.5, TILE * 0.5, 0.86, css(ink(cream, 0.94)), css(ink(dark, 0.42)));
  };
}

/**
 * "?" drawn as stroked vector paths — fonts are not dependable in a canvas we
 * rasterise ourselves, and a hand-built glyph keeps the bold-outline house style.
 */
function questionGlyph(ctx: Ctx, cx: number, cy: number, scale: number, fill: string, outline: string): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  const hook = (): void => {
    ctx.beginPath();
    // Canvas angles run clockwise on screen: PI -> 2PI sweeps left, over the top, to the right.
    ctx.arc(0, -36, 34, Math.PI * 0.94, Math.PI * 2.06, false);
    ctx.quadraticCurveTo(30, 8, 0, 22);
    // Stem stops at 30, not 34: the outline pass is 34 wide, so its round cap is
    // a disc of radius 17 and a stem ending at 34 puts that disc's rim exactly
    // on the dot's outline circle — the two fused into one blob at the tangent.
    ctx.lineTo(0, 30);
  };

  hook();
  ctx.strokeStyle = outline;
  ctx.lineWidth = 34;
  ctx.stroke();
  hook();
  ctx.strokeStyle = fill;
  ctx.lineWidth = 22;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(0, 70, 15, 0, Math.PI * 2);
  ctx.fillStyle = outline;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(0, 70, 10.5, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();

  ctx.restore();
}

// --- Style table -----------------------------------------------------------

interface FaceSpec {
  /** Base hue — mirrors LevelLoader's STYLE_COLORS so identity is unchanged. */
  color: number;
  roughness: number;
  metalness: number;
  bumpScale: number;
  paint: (base: Rgb) => Painter;
}

/**
 * Per style/face surface spec. Top values are STYLE_COLORS as-is; body values
 * follow LevelLoader's rougher, less metallic treatment of the lower slab.
 */
const SURFACES: Record<PlatformStyle, Record<SurfaceFace, FaceSpec>> = {
  grass: {
    top: { color: COLORS.grass, roughness: 0.88, metalness: 0.02, bumpScale: 0.5, paint: grassTop },
    body: { color: COLORS.dirt, roughness: 0.95, metalness: 0, bumpScale: 0.6, paint: soil },
  },
  stone: {
    top: { color: COLORS.stone, roughness: 0.82, metalness: 0.08, bumpScale: 0.85, paint: stoneBlocks },
    body: { color: COLORS.stoneDark, roughness: 0.86, metalness: 0.06, bumpScale: 0.85, paint: stoneBlocks },
  },
  brick: {
    top: { color: 0xc45c3e, roughness: 0.78, metalness: 0.05, bumpScale: 0.7, paint: bricks },
    body: { color: 0x8b3a2a, roughness: 0.82, metalness: 0.04, bumpScale: 0.7, paint: bricks },
  },
  metal: {
    top: { color: 0x90a4ae, roughness: 0.35, metalness: 0.65, bumpScale: 0.3, paint: brushedMetal },
    body: { color: 0x546e7a, roughness: 0.4, metalness: 0.6, bumpScale: 0.3, paint: brushedMetal },
  },
  dirt: {
    top: { color: COLORS.dirt, roughness: 0.95, metalness: 0, bumpScale: 0.6, paint: soil },
    body: { color: COLORS.dirtDark, roughness: 0.96, metalness: 0, bumpScale: 0.6, paint: soil },
  },
  question: {
    top: { color: 0xffc107, roughness: 0.45, metalness: 0.25, bumpScale: 0.35, paint: questionPanel },
    body: { color: 0xe65100, roughness: 0.5, metalness: 0.2, bumpScale: 0.35, paint: questionPanel },
  },
  pipe: {
    top: { color: 0x43a047, roughness: 0.4, metalness: 0.35, bumpScale: 0.15, paint: pipeSkin },
    body: { color: 0x2e7d32, roughness: 0.38, metalness: 0.4, bumpScale: 0.15, paint: pipeSkin },
  },
  wood: {
    top: { color: 0xbcaaa4, roughness: 0.85, metalness: 0.02, bumpScale: 0.55, paint: planks },
    body: { color: 0x6d4c41, roughness: 0.85, metalness: 0.02, bumpScale: 0.55, paint: planks },
  },
};

// --- Texture / material cache ---------------------------------------------

interface BaseSurface {
  color: THREE.Texture;
  bump: THREE.Texture;
}

const baseCache = new Map<string, BaseSurface>();
const materialCache = new Map<string, THREE.MeshStandardMaterial>();
const tiledClones: THREE.Texture[] = [];

function paintTile(painter: Painter, bump: boolean): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = TILE;
  canvas.height = TILE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('[surfaces] 2D canvas context unavailable');
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  painter(ctx, makeInk(bump));
  return canvas;
}

function tileTexture(canvas: HTMLCanvasElement, srgb: boolean): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(canvas);
  // Height data must stay linear; only the albedo is colour-managed.
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

function baseSurface(style: PlatformStyle, face: SurfaceFace): BaseSurface {
  const key = `${style}|${face}`;
  const hit = baseCache.get(key);
  if (hit) return hit;
  const spec = SURFACES[style][face];
  const painter = spec.paint(parseColor(spec.color));
  const entry: BaseSurface = {
    color: tileTexture(paintTile(painter, false), true),
    bump: tileTexture(paintTile(painter, true), false),
  };
  baseCache.set(key, entry);
  return entry;
}

/** clone() shares Texture.source, so every repeat variant reuses one GPU upload. */
function tiled(src: THREE.Texture, rx: number, ry: number): THREE.Texture {
  const t = src.clone();
  t.repeat.set(rx, ry);
  tiledClones.push(t);
  return t;
}

/**
 * Most tiles are stochastic patterns that survive being cut anywhere ('free').
 * A framed panel must not be cut mid-glyph, so it takes whole tiles only, and
 * the pipe's barrel gradient models one cylinder's cross-section, so that axis
 * has to span exactly one tile however wide the pipe is.
 */
type RepeatMode = 'free' | 'whole' | 'span';

const FREE_REPEAT: { x: RepeatMode; y: RepeatMode } = { x: 'free', y: 'free' };
const REPEAT_MODE: Partial<Record<PlatformStyle, { x: RepeatMode; y: RepeatMode }>> = {
  question: { x: 'whole', y: 'whole' },
  pipe: { x: 'span', y: 'free' },
};

function quantRepeat(worldSize: number, mode: RepeatMode): number {
  if (mode === 'span') return 1;
  const raw = Math.abs(worldSize) / UNITS_PER_TILE;
  if (mode === 'whole') return Math.max(1, Math.round(raw));
  return Math.max(MIN_REPEAT, Math.round(raw / REPEAT_STEP) * REPEAT_STEP);
}

/**
 * Cached MeshStandardMaterial for a style/face, with maps tiled to real-world scale.
 * worldW/worldH are the mesh's dimensions in world units so texel density stays
 * constant across a 16-unit ground strip and a 1-unit block.
 *
 * A level teardown that disposes mesh materials only frees GPU objects — the
 * canvas sources are retained, so a cached entry re-uploads on next use.
 * disposeSurfaces() is the real teardown.
 */
export function surfaceMaterial(
  style: PlatformStyle,
  face: SurfaceFace,
  worldW: number,
  worldH: number,
  opts?: { emissive?: number; emissiveIntensity?: number },
): THREE.MeshStandardMaterial {
  const mode = REPEAT_MODE[style] ?? FREE_REPEAT;
  const rx = quantRepeat(worldW, mode.x);
  const ry = quantRepeat(worldH, mode.y);
  const emissive = opts?.emissive ?? 0x000000;
  // three's own default is 1. Falling back to 0 would silently swallow an
  // emissive colour passed without an intensity.
  const emissiveIntensity = opts?.emissiveIntensity ?? (emissive === 0x000000 ? 0 : 1);
  const key = `${style}|${face}|${rx}|${ry}|${emissive}|${emissiveIntensity}`;

  const hit = materialCache.get(key);
  if (hit) return hit;

  const spec = SURFACES[style][face];
  const base = baseSurface(style, face);
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: tiled(base.color, rx, ry),
    bumpMap: tiled(base.bump, rx, ry),
    bumpScale: spec.bumpScale,
    roughness: spec.roughness,
    metalness: spec.metalness,
    emissive,
    emissiveIntensity,
  });
  material.name = `Surface_${style}_${face}`;
  materialCache.set(key, material);
  return material;
}

/** Release every cached texture and material. */
export function disposeSurfaces(): void {
  for (const m of materialCache.values()) m.dispose();
  materialCache.clear();
  for (const t of tiledClones) t.dispose();
  tiledClones.length = 0;
  for (const s of baseCache.values()) {
    s.color.dispose();
    s.bump.dispose();
  }
  baseCache.clear();
}
