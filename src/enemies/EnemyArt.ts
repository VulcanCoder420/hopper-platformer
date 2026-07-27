/**
 * Procedural art for the two enemy types.
 *
 * Both creatures are painted facing +X (right); the engine mirrors via scale.
 * The two sheets share a frame layout: 0-5 locomotion, 6-8 stomped, 9-10 hurt.
 */

import {
  blob,
  bodyFill,
  box,
  cycle,
  eye,
  hashNoise,
  highlight,
  limb,
  mixColor,
  mouth,
  orb,
  parseColor,
  polygon,
  rimLight,
  shade,
  smoothStep,
  vgrad,
  withAlpha,
  type Rgb,
  type ShapeStyle,
} from '../render/paint';
import {
  buildSpriteSheet,
  getSheet,
  type CharacterArt,
  type ClipMap,
} from '../render/SpriteSheet';

const FRAME = 96;
const PAD = 2;

const INK = 'rgba(26, 22, 38, 0.92)';
/** Opaque ink for silhouette passes — alpha would double up where parts overlap. */
const INK_SOLID = '#1a1626';
const EYE_INK = '#1a1a2e';

const BRUISER = {
  body: 0x7b4fd6,
  belly: 0xc9a0ff,
  accent: 0xff8a5c,
  foot: 0x4a3080,
} as const;

const SKIMMER = {
  body: 0x2ec4b6,
  wing: 0x9ff0e0,
  accent: 0xffd166,
} as const;

export const BRUISER_WORLD_HEIGHT = 1.12;
export const BRUISER_FEET_INSET = 6 / 96;
export const SKIMMER_WORLD_HEIGHT = 1.0;
export const SKIMMER_FEET_INSET = 8 / 96;

const BRUISER_CLIPS: ClipMap = {
  walk: { frames: [0, 1, 2, 3, 4, 5], fps: 10, loop: true },
  squash: { frames: [6, 7, 8], fps: 14, loop: false },
  hurt: { frames: [9, 10], fps: 12, loop: false },
};

const SKIMMER_CLIPS: ClipMap = {
  fly: { frames: [0, 1, 2, 3, 4, 5], fps: 16, loop: true },
  squash: { frames: [6, 7, 8], fps: 14, loop: false },
  hurt: { frames: [9, 10], fps: 12, loop: false },
};

type FaceMode = 'open' | 'shut' | 'dead';

// --- Shared helpers --------------------------------------------------------

/**
 * shade()/mixColor() emit `rgb(...)` strings, which parseColor cannot read back
 * — feeding one to bodyFill/withAlpha/highlight lands on its magenta fallback.
 * Derived colours that get re-parsed downstream go through these instead so they
 * stay in hex form.
 */
function toHex(c: Rgb): string {
  const h = (v: number): string =>
    Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
}

function shadeHex(color: string | number, amount: number): string {
  const { r, g, b } = parseColor(color);
  const t = Math.max(-1, Math.min(1, amount));
  if (t >= 0) {
    return toHex({ r: r + (255 - r) * t, g: g + (255 - g) * t, b: b + (255 - b) * t });
  }
  const k = 1 + t;
  return toHex({ r: r * k, g: g * k, b: b * k });
}

function mixHex(color: string | number, target: string | number, t: number): string {
  const a = parseColor(color);
  const b = parseColor(target);
  const k = Math.max(0, Math.min(1, t));
  return toHex({
    r: a.r + (b.r - a.r) * k,
    g: a.g + (b.g - a.g) * k,
    b: a.b + (b.b - a.b) * k,
  });
}

function rotateAbout(ctx: CanvasRenderingContext2D, ax: number, ay: number, rot: number): void {
  if (rot === 0) return;
  ctx.translate(ax, ay);
  ctx.rotate(rot);
  ctx.translate(-ax, -ay);
}

/**
 * Undo part of an enclosing squash about (ax, ay). `keep` is how much of the
 * squash the part retains: 1 leaves it alone, 0 fully cancels it. Faces and
 * horns keep only a fraction so they stay legible on a flattened body.
 */
function counterScale(
  ctx: CanvasRenderingContext2D,
  ax: number,
  ay: number,
  sx: number,
  sy: number,
  keep: number,
): void {
  const kx = Math.pow(Math.max(0.05, sx), keep - 1);
  const ky = Math.pow(Math.max(0.05, sy), keep - 1);
  ctx.translate(ax, ay);
  ctx.scale(kx, ky);
  ctx.translate(-ax, -ay);
}

interface UnionPart {
  draw: (ctx: CanvasRenderingContext2D, style: ShapeStyle) => void;
  fill: string | CanvasGradient;
}

/** One outline around several overlapping shapes: ink pass, then fills on top. */
function unionShapes(
  ctx: CanvasRenderingContext2D,
  parts: readonly UnionPart[],
  lineWidth = 3,
): void {
  for (const part of parts) {
    part.draw(ctx, { fill: INK_SOLID, outline: INK_SOLID, lineWidth: lineWidth * 2 });
  }
  for (const part of parts) {
    part.draw(ctx, { fill: part.fill, outline: null });
  }
}

function deadEye(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  orb(ctx, cx, cy, r, r * 0.9, {
    fill: '#fdfbff',
    outline: withAlpha(INK_SOLID, 0.85),
    lineWidth: Math.max(1.2, r * 0.24),
  });
  const d = r * 0.6;
  ctx.save();
  ctx.strokeStyle = EYE_INK;
  ctx.lineWidth = Math.max(1.8, r * 0.4);
  ctx.beginPath();
  ctx.moveTo(cx - d, cy - d);
  ctx.lineTo(cx + d, cy + d);
  ctx.moveTo(cx + d, cy - d);
  ctx.lineTo(cx - d, cy + d);
  ctx.stroke();
  ctx.restore();
}

function painSparks(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  strength: number,
  color: string,
): void {
  if (strength <= 0) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.6;
  for (let i = 0; i < 4; i++) {
    const a = -Math.PI * 0.62 + (hashNoise(i * 4.7, 1.3) - 0.5) * 1.9;
    const r0 = 8 + hashNoise(i * 2.9) * 3;
    const len = (3.5 + hashNoise(i * 6.1, 5) * 3) * strength;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
    ctx.lineTo(cx + Math.cos(a) * (r0 + len), cy + Math.sin(a) * (r0 + len));
    ctx.stroke();
  }
  ctx.restore();
}

// --- Bruiser ---------------------------------------------------------------

const B_CX = 48;
const B_CY = 53;
const B_RX = 31;
const B_RY = 27;
const B_BASE = 90;
/** Tip pivot sits low, near the feet, so the waddle reads as shifting weight. */
const B_TIP_Y = 84;
const B_FACE_X = 60;
const B_FACE_Y = 47;
const FACE_KEEP = 0.35;
const HORN_KEEP = 0.4;

/** Lumpy heavy silhouette. Jitter is hash-driven, so it never changes. */
const B_BODY_PTS: readonly (readonly [number, number])[] = (() => {
  const pts: [number, number][] = [];
  const n = 11;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 - Math.PI * 0.5;
    const j = 1 + (hashNoise(i * 2.13, 7.7) - 0.5) * 0.1;
    pts.push([B_CX + Math.cos(a) * B_RX * j, B_CY + Math.sin(a) * B_RY * j]);
  }
  return pts;
})();

interface BruiserPose {
  sx: number;
  sy: number;
  pivotY: number;
  /**
   * Rise of the torso stack only. The feet are deliberately outside it: bobbing
   * the whole creature lifts the stance foot off the floor and it reads as
   * hovering rather than walking.
   */
  bodyLift: number;
  tip: number;
  /** Horns and belly trail the torso — that delay is what carries the weight. */
  lagTip: number;
  /** Per-foot fore/aft travel and swing height, relative to the stance position. */
  nearFootX: number;
  nearFootUp: number;
  farFootX: number;
  farFootUp: number;
  footSpread: number;
  hornSplay: number;
  face: FaceMode;
  lookX: number;
  sparks: number;
}

function bruiserFoot(
  ctx: CanvasRenderingContext2D,
  cx: number,
  bottom: number,
  roll: number,
  far: boolean,
): void {
  const w = far ? 25 : 26;
  const h = 15;
  const base = far ? shadeHex(BRUISER.foot, -0.24) : BRUISER.foot;
  ctx.save();
  // Pivot at the heel-ish contact point so a rolled foot still touches down there.
  rotateAbout(ctx, cx - w * 0.25, bottom, roll);
  box(ctx, cx - w * 0.5, bottom - h, w, h, 6.5, {
    fill: bodyFill(ctx, bottom - h, bottom, base),
    lineWidth: far ? 2.6 : 3,
  });
  if (!far) {
    limb(ctx, cx + 2, bottom - h + 3.5, cx + w * 0.5 - 4, bottom - h + 3, 1.6, {
      fill: shade(BRUISER.belly, -0.1),
      outline: null,
    });
  }
  ctx.restore();
}

function bruiserHorn(
  ctx: CanvasRenderingContext2D,
  bx: number,
  by: number,
  len: number,
  half: number,
  tilt: number,
  base: string | number,
): void {
  ctx.save();
  ctx.translate(bx, by);
  ctx.rotate(tilt);
  polygon(
    ctx,
    [
      [-half, 4],
      [-half * 0.6, -len * 0.52],
      [0, -len],
      [half * 0.6, -len * 0.5],
      [half, 4],
    ],
    { fill: bodyFill(ctx, -len, 4, base, 0x5a2a1a), lineWidth: 2.8 },
  );
  ctx.restore();
}

function bruiserFace(ctx: CanvasRenderingContext2D, p: BruiserPose): void {
  const ax = B_FACE_X;
  const ay = B_FACE_Y;

  if (p.face === 'dead') {
    deadEye(ctx, ax - 7, ay + 2, 6);
    deadEye(ctx, ax + 6, ay + 1, 6.6);
  } else {
    const blink = p.face === 'shut' ? 1 : 0;
    eye(ctx, ax - 7, ay + 3, {
      r: 5.6,
      blink,
      lookX: p.lookX,
      lookY: 0.2,
      pupilColor: EYE_INK,
    });
    eye(ctx, ax + 6, ay + 2, {
      r: 6.2,
      blink,
      lookX: p.lookX,
      lookY: 0.2,
      pupilColor: EYE_INK,
    });
  }

  // Ridge goes on last: overhanging both eyes is what makes it read as a heavy
  // brow. A thin even band here just reads as a headband — the slab has to be
  // chunky, cap the whole skull, and hook down over the leading eye.
  polygon(
    ctx,
    [
      [ax - 18, ay - 13.5],
      [ax - 4, ay - 14],
      [ax + 8, ay - 11],
      [ax + 12.5, ay - 3.5],
      [ax + 8, ay - 2],
      [ax - 4, ay - 6.5],
      [ax - 17, ay - 6],
    ],
    {
      fill: bodyFill(ctx, ay - 14, ay - 2, BRUISER.accent, 0x7a2f14),
      lineWidth: 2.8,
    },
  );

  if (p.face === 'open') {
    mouth(ctx, ax + 2, ay + 12, 15, -5, INK, 2.6);
  } else {
    orb(ctx, ax + 3, ay + 12, 5.2, 4.4, {
      fill: mixColor(BRUISER.body, 0x1a1020, 0.62),
      lineWidth: 2.2,
    });
  }
}

function drawBruiser(ctx: CanvasRenderingContext2D, p: BruiserPose): void {
  ctx.save();
  ctx.translate(B_CX, p.pivotY);
  ctx.scale(p.sx, p.sy);
  ctx.translate(-B_CX, -p.pivotY);

  bruiserFoot(
    ctx,
    B_CX - 13 - p.footSpread + p.farFootX,
    B_BASE - p.farFootUp,
    p.farFootUp * -0.03,
    true,
  );

  // Torso stack — everything from here up rides the bob; the feet do not.
  ctx.save();
  ctx.translate(0, p.bodyLift);

  ctx.save();
  rotateAbout(ctx, B_CX, B_TIP_Y, p.lagTip);
  counterScale(ctx, B_CX, 30, p.sx, p.sy, HORN_KEEP);
  bruiserHorn(ctx, 36, 31, 13, 6, -0.3 - p.hornSplay, shadeHex(BRUISER.accent, -0.2));
  bruiserHorn(ctx, 51, 29, 14.5, 6.4, -0.24 + p.hornSplay * 1.8, BRUISER.accent);
  ctx.restore();

  ctx.save();
  rotateAbout(ctx, B_CX, B_TIP_Y, p.tip);
  blob(ctx, B_BODY_PTS, {
    fill: bodyFill(ctx, B_CY - B_RY, B_CY + B_RY, BRUISER.body),
    lineWidth: 3.2,
  });
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(B_CX, B_CY, B_RX - 3.5, B_RY - 3.5, 0, 0, Math.PI * 2);
  ctx.clip();
  highlight(ctx, B_CX - 7, B_CY - 15, 21, 13, '#ffffff', 0.3);
  rimLight(ctx, B_CX + 2, B_CY, B_RX - 5, B_RY - 5, '#e0c8ff', 0.4, 1);
  ctx.fillStyle = vgrad(
    ctx,
    B_CY + 3,
    B_CY + B_RY,
    withAlpha(0x241a3f, 0),
    withAlpha(0x241a3f, 0.42),
  );
  ctx.fillRect(B_CX - B_RX, B_CY + 3, B_RX * 2, B_RY);
  ctx.restore();
  ctx.restore();

  ctx.save();
  rotateAbout(ctx, B_CX, B_TIP_Y, p.lagTip);
  orb(ctx, 48, 69.5, 15, 8, {
    fill: bodyFill(ctx, 61, 78, BRUISER.belly),
    outline: withAlpha(INK_SOLID, 0.3),
    lineWidth: 1.8,
  });
  ctx.restore();

  ctx.save();
  rotateAbout(ctx, B_CX, B_TIP_Y, p.tip);
  counterScale(ctx, B_FACE_X, B_FACE_Y, p.sx, p.sy, FACE_KEEP);
  bruiserFace(ctx, p);
  ctx.restore();

  painSparks(ctx, 64, 32, p.sparks, shade(BRUISER.accent, 0.15));
  ctx.restore();

  bruiserFoot(
    ctx,
    B_CX + 13 + p.footSpread + p.nearFootX,
    B_BASE - p.nearFootUp,
    p.nearFootUp * -0.03,
    false,
  );

  ctx.restore();
}

/**
 * One leg's contribution to the cycle. `phase` 0 is the foot fully forward at
 * contact; it drives aft through stance and lifts through the forward swing, so
 * the two legs scissor when driven half a cycle apart.
 */
function bruiserStep(phase: number): { x: number; up: number } {
  return {
    x: Math.cos(phase) * 5.5,
    up: smoothStep(Math.max(0, -Math.sin(phase))) * 7,
  };
}

function bruiserWalkPose(f: number): BruiserPose {
  const ph = cycle(f, 6);
  const near = bruiserStep(ph);
  const far = bruiserStep(ph + Math.PI);
  // Contacts land at ph 0 and ph pi; sin^2 peaks between them, so it doubles as
  // the passing-position bob and the contact-frame compression.
  const pass = Math.sin(ph) * Math.sin(ph);
  return {
    sx: 1 + 0.035 * (1 - pass),
    sy: 1 - 0.05 * (1 - pass),
    pivotY: B_BASE,
    bodyLift: -2.6 * pass,
    // Roll and its follow-through use offset phases rather than sin/|cos|: with
    // six samples the unshifted pair repeats itself and half the frames collide.
    tip: Math.sin(ph + 0.9) * 0.085,
    lagTip: Math.sin(ph - 0.2) * 0.115,
    nearFootX: near.x,
    nearFootUp: near.up,
    farFootX: far.x,
    farFootUp: far.up,
    footSpread: 0,
    hornSplay: Math.sin(ph + 2.1) * 0.05,
    face: 'open',
    lookX: 0.34 + Math.cos(ph + 1.2) * 0.16,
    sparks: 0,
  };
}

function bruiserSquashPose(i: number): BruiserPose {
  const e = smoothStep((i + 1) / 3);
  return {
    // Widening past ~1.3 pushes the blob's outline through the frame edge.
    sx: 1 + 0.28 * e,
    sy: 1 - 0.76 * e,
    pivotY: B_BASE,
    bodyLift: 0,
    tip: -0.05 * e,
    lagTip: 0.08 * e,
    nearFootX: 0,
    nearFootUp: 0,
    farFootX: 0,
    farFootUp: 0,
    footSpread: 2 * e,
    hornSplay: 0.55 * e,
    face: 'dead',
    lookX: 0,
    sparks: 0,
  };
}

function bruiserHurtPose(i: number): BruiserPose {
  const recoil = i === 0;
  return {
    sx: recoil ? 1.1 : 0.96,
    sy: recoil ? 0.87 : 1.06,
    pivotY: B_BASE,
    bodyLift: recoil ? 0 : -3,
    tip: recoil ? -0.2 : -0.07,
    lagTip: recoil ? -0.05 : -0.16,
    nearFootX: recoil ? 2 : 4.5,
    nearFootUp: recoil ? 0 : 5,
    farFootX: recoil ? -1 : -3,
    farFootUp: recoil ? 0 : 2,
    footSpread: recoil ? 3 : 1,
    hornSplay: recoil ? 0.22 : 0.08,
    face: 'shut',
    lookX: 0,
    sparks: recoil ? 1 : 0.45,
  };
}

function drawBruiserFrame(ctx: CanvasRenderingContext2D, frame: number): void {
  if (frame < 6) drawBruiser(ctx, bruiserWalkPose(frame));
  else if (frame < 9) drawBruiser(ctx, bruiserSquashPose(frame - 6));
  else drawBruiser(ctx, bruiserHurtPose(frame - 9));
}

// --- Skimmer ---------------------------------------------------------------

const S_CX = 47;
const S_BASE = 88;
const S_BODY_X = 46;
const S_BODY_Y = 56;
const S_BODY_RX = 24;
const S_BODY_RY = 12.5;
const S_HEAD_X = 68;
const S_HEAD_Y = 53;
const S_HEAD_R = 14.5;
const S_TAIL_X = 27;
const S_TAIL_Y = 56;

interface SkimmerPose {
  /** +1 wings at the top of the beat, -1 at the bottom. */
  beat: number;
  beatFar: number;
  /** Membrane trail; opposes the stroke direction, so it flips mid-beat. */
  sag: number;
  sagFar: number;
  wingScale: number;
  pitch: number;
  rise: number;
  tailRot: number;
  tailFold: number;
  sx: number;
  sy: number;
  pivotY: number;
  glow: number;
  face: FaceMode;
  sparks: number;
}

function skimmerHullPath(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  ctx.ellipse(S_BODY_X, S_BODY_Y, S_BODY_RX, S_BODY_RY, 0, 0, Math.PI * 2);
  ctx.ellipse(S_HEAD_X, S_HEAD_Y, S_HEAD_R, S_HEAD_R * 0.95, 0, 0, Math.PI * 2);
}

/**
 * Root chord stays welded to the body; the tip swings about the shoulder.
 *
 * Two traps here. Rotating the chord along with the wing keeps the area honest
 * but lifts the root clear of the hull at the stroke extremes. Leaving the chord
 * put but raking it aft — the obvious alternative — lets lead, tip and trail go
 * collinear part-way through the downstroke: the membrane shrinks to a sliver
 * and the wing reads as a stick lying across the body. Hence a fixed chord held
 * near-perpendicular to the sweep, which holds area within ~1.5x across the
 * whole beat while the root never moves.
 */
function skimmerWing(
  ctx: CanvasRenderingContext2D,
  rootX: number,
  rootY: number,
  beat: number,
  sag: number,
  scale: number,
  far: boolean,
): void {
  const angle = beat * 0.95;
  const span = 26 * scale;
  const rake = 4 * scale;
  const tipX = rootX - span * Math.cos(angle) + rake * Math.sin(angle);
  const tipY = rootY - span * Math.sin(angle) - rake * Math.cos(angle);
  const leadX = rootX + 3 * scale;
  const leadY = rootY - 7 * scale;
  const trailX = rootX + 1 * scale;
  const trailY = rootY + 9 * scale;

  const dx = tipX - rootX;
  const dy = tipY - rootY;
  const len = Math.hypot(dx, dy) || 1;
  // Unit normal of the root->tip line; +n is the wing's upper face at any angle.
  const nx = -dy / len;
  const ny = dx / len;
  // Membrane trails the stroke. Clamped so a hard flick bows it flat, never
  // inside-out through the leading edge.
  const bow = Math.max(-5, Math.min(8, sag)) * scale;
  const camber = 5 * scale;
  const leadCX = (leadX + tipX) * 0.5 + nx * (camber + bow * 0.25);
  const leadCY = (leadY + tipY) * 0.5 + ny * (camber + bow * 0.25);
  const trailCX = (tipX + trailX) * 0.5 - nx * (6 * scale + bow);
  const trailCY = (tipY + trailY) * 0.5 - ny * (6 * scale + bow);

  ctx.beginPath();
  ctx.moveTo(leadX, leadY);
  ctx.quadraticCurveTo(leadCX, leadCY, tipX, tipY);
  ctx.quadraticCurveTo(trailCX, trailCY, trailX, trailY);
  // Bow the base forward into the hull so the joint reads as a shoulder.
  ctx.quadraticCurveTo(rootX + 6 * scale, rootY + 1 * scale, leadX, leadY);
  ctx.closePath();

  const g = ctx.createLinearGradient(rootX, rootY, tipX, tipY);
  if (far) {
    g.addColorStop(0, mixColor(SKIMMER.wing, 0x123c3f, 0.42));
    g.addColorStop(1, mixColor(SKIMMER.wing, 0x123c3f, 0.66));
  } else {
    g.addColorStop(0, shade(SKIMMER.wing, 0.12));
    g.addColorStop(1, withAlpha(mixHex(SKIMMER.wing, SKIMMER.body, 0.4), 0.88));
  }
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = far ? withAlpha(INK_SOLID, 0.65) : INK;
  ctx.lineWidth = (far ? 2.2 : 2.8) * Math.max(0.6, scale);
  ctx.stroke();

  // Ribs fan from the root to the trailing edge; they sell the stretch.
  const bez = (a: number, c: number, b: number, u: number): number =>
    (1 - u) * (1 - u) * a + 2 * u * (1 - u) * c + u * u * b;
  ctx.save();
  ctx.strokeStyle = withAlpha(
    mixHex(SKIMMER.body, 0x0b3b3a, far ? 0.55 : 0.2),
    far ? 0.35 : 0.5,
  );
  ctx.lineWidth = 1.6 * scale;
  for (let i = 0; i < 3; i++) {
    const u = 0.26 + i * 0.24;
    ctx.beginPath();
    ctx.moveTo(rootX + 3 * scale, rootY - 1 * scale);
    ctx.lineTo(bez(tipX, trailCX, trailX, u), bez(tipY, trailCY, trailY, u));
    ctx.stroke();
  }
  ctx.restore();

  if (!far) {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(leadX, leadY);
    ctx.quadraticCurveTo(leadCX, leadCY, tipX, tipY);
    ctx.strokeStyle = withAlpha(SKIMMER.accent, 0.85);
    ctx.lineWidth = 2.2 * Math.max(0.6, scale);
    ctx.stroke();
    ctx.restore();
  }
}

function skimmerTail(ctx: CanvasRenderingContext2D, rot: number, fold: number): void {
  const spread = 15 - fold * 8;
  ctx.save();
  ctx.translate(S_TAIL_X, S_TAIL_Y);
  ctx.rotate(rot);
  polygon(
    ctx,
    [
      [2, -7],
      [-13, -spread],
      [-8, 0],
      [-13, spread],
      [2, 7],
    ],
    { fill: bodyFill(ctx, -spread, spread, SKIMMER.accent, 0x6b3a12), lineWidth: 2.8 },
  );
  ctx.restore();
}

function skimmerHull(ctx: CanvasRenderingContext2D, p: SkimmerPose): void {
  unionShapes(ctx, [
    {
      draw: (c, style) => orb(c, S_BODY_X, S_BODY_Y, S_BODY_RX, S_BODY_RY, style),
      fill: bodyFill(ctx, S_BODY_Y - S_BODY_RY, S_BODY_Y + S_BODY_RY, SKIMMER.body, 0x0d3340),
    },
    {
      draw: (c, style) => orb(c, S_HEAD_X, S_HEAD_Y, S_HEAD_R, S_HEAD_R * 0.95, style),
      fill: bodyFill(
        ctx,
        S_HEAD_Y - S_HEAD_R,
        S_HEAD_Y + S_HEAD_R,
        shadeHex(SKIMMER.body, 0.06),
        0x0d3340,
      ),
    },
  ]);

  ctx.save();
  skimmerHullPath(ctx);
  ctx.clip();
  // Glowing underside stripe.
  box(ctx, S_BODY_X - 19, S_BODY_Y + 4.5, 36, 7, 3.4, {
    fill: vgrad(
      ctx,
      S_BODY_Y + 4.5,
      S_BODY_Y + 11.5,
      shade(SKIMMER.accent, 0.32),
      mixColor(SKIMMER.accent, 0x8a4a12, 0.45),
    ),
    outline: withAlpha(INK_SOLID, 0.28),
    lineWidth: 1.6,
  });
  highlight(ctx, S_BODY_X - 2, S_BODY_Y + 8.5, 22, 8, shadeHex(SKIMMER.accent, 0.3), p.glow);
  highlight(ctx, S_BODY_X - 4, S_BODY_Y - 8, 20, 7, '#ffffff', 0.3);
  highlight(ctx, S_HEAD_X - 2, S_HEAD_Y - 7, 11, 7, '#ffffff', 0.38);
  rimLight(ctx, S_HEAD_X, S_HEAD_Y, S_HEAD_R - 2, S_HEAD_R - 3, '#dffff8', 0.45, 1);
  ctx.fillStyle = vgrad(
    ctx,
    S_BODY_Y + 9,
    S_BODY_Y + S_BODY_RY + 2,
    withAlpha(0x082c33, 0),
    withAlpha(0x082c33, 0.4),
  );
  ctx.fillRect(S_BODY_X - 30, S_BODY_Y + 9, 70, 18);
  // Gill dashes tie the accent into the head.
  ctx.strokeStyle = withAlpha(SKIMMER.accent, 0.7);
  ctx.lineWidth = 2.2;
  for (let i = 0; i < 2; i++) {
    const x = 57 + i * 4.5;
    ctx.beginPath();
    ctx.moveTo(x, S_HEAD_Y + 1);
    ctx.lineTo(x - 1.5, S_HEAD_Y + 7);
    ctx.stroke();
  }
  ctx.restore();
}

function skimmerFace(ctx: CanvasRenderingContext2D, p: SkimmerPose): void {
  const ax = S_HEAD_X + 3;
  const ay = S_HEAD_Y - 1;
  ctx.save();
  counterScale(ctx, ax, ay, p.sx, p.sy, FACE_KEEP);
  if (p.face === 'dead') {
    deadEye(ctx, ax - 8, ay + 2.5, 4.4);
    deadEye(ctx, ax + 3, ay - 1, 5.6);
  } else {
    const blink = p.face === 'shut' ? 1 : 0;
    eye(ctx, ax - 8, ay + 2.5, {
      r: 4.4,
      blink,
      lookX: 0.4,
      scleraColor: '#eafff9',
      pupilColor: EYE_INK,
    });
    eye(ctx, ax + 3, ay - 1, {
      r: 5.6,
      blink,
      lookX: 0.45,
      brow: 0.3,
      scleraColor: '#f4fffc',
      pupilColor: EYE_INK,
    });
  }
  ctx.restore();
}

function drawSkimmer(ctx: CanvasRenderingContext2D, p: SkimmerPose): void {
  ctx.save();
  ctx.translate(S_CX, p.pivotY);
  ctx.scale(p.sx, p.sy);
  ctx.translate(-S_CX, -p.pivotY);
  ctx.translate(0, p.rise);
  rotateAbout(ctx, S_BODY_X, S_BODY_Y, p.pitch);

  skimmerWing(ctx, 38, 52, p.beatFar, p.sagFar, p.wingScale * 0.82, true);
  skimmerTail(ctx, p.tailRot, p.tailFold);
  skimmerHull(ctx, p);
  skimmerWing(ctx, 44, 50, p.beat, p.sag, p.wingScale, false);
  skimmerFace(ctx, p);
  painSparks(ctx, 76, 34, p.sparks, shade(SKIMMER.accent, 0.2));

  ctx.restore();
}

function skimmerFlyPose(f: number): SkimmerPose {
  const ph = cycle(f, 6);
  // Every joint runs on its own phase offset. Sampling one unshifted cos six
  // times only yields three distinct values, so a wing driven straight off
  // cos(ph) gives the same angle on frames 1/5 and 2/4 — a 6-frame beat that
  // plays as 4. Lagging the wing plate behind its drive both fixes that and is
  // what a membrane actually does.
  const wingPh = ph - 0.38;
  const farPh = wingPh - 0.62;
  return {
    beat: Math.cos(wingPh),
    beatFar: Math.cos(farPh),
    sag: -Math.sin(wingPh) * 7.5,
    sagFar: -Math.sin(farPh) * 6,
    wingScale: 1,
    pitch: -Math.cos(ph - 0.7) * 0.09,
    rise: Math.cos(ph - 1.1) * 2.4,
    tailRot: Math.cos(ph - 1.5) * 0.3,
    tailFold: 0,
    sx: 1,
    sy: 1,
    pivotY: S_BASE,
    glow: 0.3 + (1 - Math.cos(ph)) * 0.1,
    face: 'open',
    sparks: 0,
  };
}

function skimmerSquashPose(i: number): SkimmerPose {
  const e = smoothStep((i + 1) / 3);
  return {
    beat: 0.45 + 0.4 * e,
    beatFar: 0.35 + 0.45 * e,
    sag: -3 * e,
    sagFar: -2 * e,
    wingScale: 1 - 0.55 * e,
    pitch: 0.12 * e,
    rise: 7 * e,
    tailRot: -0.3 * e,
    tailFold: e,
    // Beyond ~1.16 the head's outline runs off the right edge of the frame.
    sx: 1 + 0.16 * e,
    sy: 1 - 0.74 * e,
    pivotY: 74,
    glow: 0.3 - 0.24 * e,
    face: 'dead',
    sparks: 0,
  };
}

function skimmerHurtPose(i: number): SkimmerPose {
  const recoil = i === 0;
  return {
    beat: recoil ? 0.95 : 0.25,
    beatFar: recoil ? 0.8 : 0.1,
    sag: recoil ? -7 : 5,
    sagFar: recoil ? -5 : 4,
    wingScale: recoil ? 0.9 : 1,
    pitch: recoil ? -0.3 : -0.12,
    rise: recoil ? 3 : -2,
    tailRot: recoil ? 0.34 : 0.12,
    tailFold: recoil ? 0.35 : 0.1,
    sx: recoil ? 1.08 : 0.96,
    sy: recoil ? 0.9 : 1.04,
    pivotY: 78,
    glow: recoil ? 0.5 : 0.36,
    face: 'shut',
    sparks: recoil ? 1 : 0.45,
  };
}

function drawSkimmerFrame(ctx: CanvasRenderingContext2D, frame: number): void {
  if (frame < 6) drawSkimmer(ctx, skimmerFlyPose(frame));
  else if (frame < 9) drawSkimmer(ctx, skimmerSquashPose(frame - 6));
  else drawSkimmer(ctx, skimmerHurtPose(frame - 9));
}

// --- Art bundles -----------------------------------------------------------

let bruiserArt: CharacterArt | null = null;
let skimmerArt: CharacterArt | null = null;

export function getBruiserArt(): CharacterArt {
  if (!bruiserArt) {
    bruiserArt = {
      sheet: getSheet('bruiser', () =>
        buildSpriteSheet({
          frameW: FRAME,
          frameH: FRAME,
          frames: 11,
          cols: 4,
          padding: PAD,
          draw: (ctx, frame) => drawBruiserFrame(ctx, frame),
        }),
      ),
      clips: BRUISER_CLIPS,
      worldHeight: BRUISER_WORLD_HEIGHT,
      feetInset: BRUISER_FEET_INSET,
    };
  }
  return bruiserArt;
}

export function getSkimmerArt(): CharacterArt {
  if (!skimmerArt) {
    skimmerArt = {
      sheet: getSheet('skimmer', () =>
        buildSpriteSheet({
          frameW: FRAME,
          frameH: FRAME,
          frames: 11,
          cols: 4,
          padding: PAD,
          draw: (ctx, frame) => drawSkimmerFrame(ctx, frame),
        }),
      ),
      clips: SKIMMER_CLIPS,
      worldHeight: SKIMMER_WORLD_HEIGHT,
      feetInset: SKIMMER_FEET_INSET,
    };
  }
  return skimmerArt;
}
