/**
 * Hopper — the hero, as a procedurally drawn sprite sheet.
 *
 * Every frame is one evaluation of `drawHopper(ctx, pose)`: a parametric puppet
 * (hip root -> torso -> shoulders/head, two-bone legs and arms) posed by numbers.
 * Clips are pose curves — sine cycles for idle/run, explicit key poses for the
 * air and impact states — so the animation articulates instead of just bobbing.
 *
 * Drop-in replacement for PlayerVisual: same public API, same squash/stretch feel.
 */

import * as THREE from 'three';
import { COLORS } from '../game/config';
import {
  bodyFill,
  box,
  eye,
  highlight,
  limb,
  mixColor,
  mouth,
  orb,
  parseColor,
  polygon,
  rgbToCss,
  shade,
  smoothStep,
  vgrad,
  withAlpha,
} from '../render/paint';
import {
  buildSpriteSheet,
  getSheet,
  spriteFromArt,
  type AnimatedSprite,
  type CharacterArt,
  type ClipMap,
} from '../render/SpriteSheet';

// --- Sheet geometry --------------------------------------------------------

const FRAME = 128;
const CX = 64;
/** Feet baseline: sole + outline lands here, 8px above the frame bottom. */
const BASE_Y = 120;
/** Ankle joint height when the boot rests on the baseline. */
const ANKLE_Y = 113.5;

export const HOPPER_WORLD_HEIGHT = 1.72;
export const HOPPER_FEET_INSET = 8 / 128;

// --- Skeleton --------------------------------------------------------------

const HIP_Y = 78;
/** Shoulder and head offsets, in torso-local space (y up is negative). */
const SHOULDER_DY = -23;
const HEAD_DY = -45;
const THIGH = 19.5;
const SHIN = 19.5;
const UPPER_ARM = 13.5;
const FOREARM = 12;
const HEAD_RX = 18.5;
const HEAD_RY = 18;

const TAU = Math.PI * 2;

// --- Palette ---------------------------------------------------------------

const css = (c: number): string => rgbToCss(parseColor(c));

const SHADOW_TINT = 0x2a1f4a;
const BODY = COLORS.playerBody;
const ACCENT = COLORS.playerAccent;
const SKIN = 0xffc9a8;
const PANTS = 0x8f3f52;
const BOOT = 0x3b3252;
const BLUSH = 0xff8a7a;

/**
 * paint.ts' default ink, restated so back-facing limbs can use a softer one.
 * The far ink recedes by hue, never by alpha: the material cuts out at
 * alphaTest 0.5, so a 0.6-alpha outline loses its whole antialiased edge and
 * the back limbs come back jagged and a third too thin.
 */
const INK_FRONT = 'rgba(26, 22, 38, 0.92)';
const INK_BACK = mixColor(0x1a1626, SHADOW_TINT, 0.9);

// --- Pose ------------------------------------------------------------------

/**
 * One frame of the puppet. Angles are radians, 0 = limb pointing straight down,
 * positive = swung toward +X (the direction the character faces). Positions are
 * frame pixels: `hipY`/`foot*Y` absolute, `hipX`/`foot*X` offsets from CX.
 */
interface Pose {
  hipX: number;
  hipY: number;
  /** Torso rotation about the hip. Positive tips the chest forward. */
  torsoLean: number;
  /** Head rotation, relative to the leaned torso. */
  headTilt: number;
  headX: number;
  headY: number;
  armFrontAngle: number;
  armBackAngle: number;
  /** Elbow flexion; positive swings the hand forward of the upper arm. */
  elbowFrontBend: number;
  elbowBackBend: number;
  footFrontX: number;
  footFrontY: number;
  footBackX: number;
  footBackY: number;
  /** Extra forward lead of the knee, in px, on top of the IK solution. */
  kneeFrontBend: number;
  kneeBackBend: number;
  /** Boot rotation about the ankle; positive points the toe down. */
  footFrontPitch: number;
  footBackPitch: number;
  /** Drawn vertical scale about the feet baseline. */
  squash: number;
  /** Cap rotation relative to the head — lag and windmilling. */
  capTilt: number;
  blink: number;
  mouthCurve: number;
  /** 0 = closed line mouth, 1 = wide open. */
  mouthOpen: number;
  lookX: number;
  lookY: number;
}

const NEUTRAL: Pose = {
  hipX: 0,
  hipY: HIP_Y,
  torsoLean: 0.05,
  headTilt: -0.02,
  headX: 0,
  headY: 0,
  armFrontAngle: 0.17,
  armBackAngle: -0.13,
  elbowFrontBend: 0.3,
  elbowBackBend: 0.24,
  footFrontX: 6.5,
  footFrontY: ANKLE_Y,
  footBackX: -7.5,
  footBackY: ANKLE_Y,
  kneeFrontBend: 1.4,
  kneeBackBend: 1.1,
  footFrontPitch: 0,
  footBackPitch: 0,
  squash: 1,
  capTilt: 0,
  blink: 0,
  mouthCurve: 2.8,
  mouthOpen: 0,
  lookX: 0.36,
  lookY: 0,
};

const pose = (over: Partial<Pose>): Pose => ({ ...NEUTRAL, ...over });

// --- Kinematics ------------------------------------------------------------

function clampNum(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Rotate a torso-local offset into frame space. */
function rotOff(dx: number, dy: number, a: number): [number, number] {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [dx * c - dy * s, dx * s + dy * c];
}

/**
 * Two-bone IK. The knee is always placed on the forward side of the hip->foot
 * line (human knees only bend one way); `lead` nudges it further forward so a
 * nearly straight leg still reads as flexed. Overreaching targets keep the foot
 * where it was asked for and just stretch the shin, which is far less ugly than
 * the pop you get from clamping the foot.
 *
 * With hip and foot both pinned there is no free parameter left, so `lead` has
 * to buy its knee travel by lengthening bone. It spends that on BOTH bones
 * equally — pushing the knee off the hip->foot line instead would grow the
 * thigh and shrink the shin, and the leg visibly changes proportion frame to
 * frame in exactly the poses (deep crouch, high knee) that lead the most.
 */
function solveKnee(
  hx: number,
  hy: number,
  fx: number,
  fy: number,
  lead: number,
): [number, number] {
  const thigh = THIGH + lead * 0.5;
  const shin = SHIN + lead * 0.5;
  let dx = fx - hx;
  let dy = fy - hy;
  let d = Math.hypot(dx, dy);
  const max = (thigh + shin) * 0.995;
  if (d > max) {
    const k = max / d;
    dx *= k;
    dy *= k;
    d = max;
  }
  if (d < 0.001) {
    dx = 0;
    dy = 0.001;
    d = 0.001;
  }
  const a = (thigh * thigh - shin * shin + d * d) / (2 * d);
  const off = Math.sqrt(Math.max(0.5, thigh * thigh - a * a));
  const ux = dx / d;
  const uy = dy / d;
  const kx = hx + ux * a + uy * off;
  const ky = hy + uy * a - ux * off;
  // A foot behind the hip tips the "forward" side of the line downward, which on
  // a tightly folded leg can shove the knee through the floor. Knees stay above
  // the ankle.
  return [kx, Math.min(ky, Math.max(hy, fy) - 4)];
}

// --- Painting --------------------------------------------------------------

const SHIN_RADIUS = 5.8;
const SHIN_INK = 2.8;

/** Boot box in ankle-local px, plus half the outline it is stroked with. */
const BOOT_HEEL_X = -6.5;
const BOOT_TOE_X = 12.5;
const BOOT_SOLE_Y = 5;
const BOOT_INK = 1.4;
const TOE_R = Math.hypot(BOOT_TOE_X, BOOT_SOLE_Y);
const HEEL_R = Math.hypot(BOOT_HEEL_X, BOOT_SOLE_Y);
const TOE_PHI = Math.atan2(BOOT_SOLE_Y, BOOT_TOE_X);
const HEEL_PHI = Math.atan2(BOOT_SOLE_Y, -BOOT_HEEL_X);

/**
 * Widest pitch that still keeps both sole corners on or above the floor line.
 * A sole corner sits `r * sin(angle + phi)` below the ankle, so the limits are
 * closed-form. Clamping on ankle height alone (the old `fy >= ANKLE_Y - 1.5`
 * test) let the run's toe-off frames, whose ankle has peeled 2-4px up, drive
 * the toe a further 3px through the ground.
 */
function floorPitch(ay: number, angle: number): number {
  const sag = BASE_Y - BOOT_INK - ay;
  const hi = sag < TOE_R ? Math.asin(clampNum(sag / TOE_R, -1, 1)) - TOE_PHI : Math.PI;
  const lo = sag < HEEL_R ? HEEL_PHI - Math.asin(clampNum(sag / HEEL_R, -1, 1)) : -Math.PI;
  // Ankle buried deeper than the sole is long: no angle satisfies both corners.
  if (lo > hi) return (lo + hi) * 0.5;
  return clampNum(angle, lo, hi);
}

function drawBoot(
  ctx: CanvasRenderingContext2D,
  ax: number,
  ay: number,
  angle: number,
  top: string,
  bottom: string,
  sole: string,
  ink: string,
): void {
  ctx.save();
  ctx.translate(ax, ay);
  ctx.rotate(angle);
  box(ctx, BOOT_HEEL_X, -4, 19, 9, 4.2, {
    fill: vgrad(ctx, -4.5, BOOT_SOLE_Y, top, bottom),
    outline: ink,
    lineWidth: 2.8,
  });
  box(ctx, -5.2, 2.6, 16.5, 2.6, 1.3, { fill: sole, outline: null });
  highlight(ctx, 3, -2.3, 7, 2.3, '#ffffff', 0.22);
  ctx.restore();
}

/**
 * Two-stop vertical shading for a capsule. `tint` (0 = near limb) sinks the
 * whole ramp toward the shadow hue for far-side limbs.
 */
function limbFill(
  ctx: CanvasRenderingContext2D,
  ay: number,
  by: number,
  base: number,
  tint: number,
): CanvasGradient {
  return vgrad(
    ctx,
    Math.min(ay, by) - 8,
    Math.max(ay, by) + 8,
    tint > 0 ? mixColor(base, SHADOW_TINT, tint * 0.72) : shade(base, 0.18),
    mixColor(base, SHADOW_TINT, 0.32 + tint),
  );
}

function drawLeg(
  ctx: CanvasRenderingContext2D,
  hx: number,
  hy: number,
  fx: number,
  fy: number,
  lead: number,
  pitch: number,
  front: boolean,
): void {
  const [kx, ky] = solveKnee(hx, hy, fx, fy, lead);
  const ink = front ? INK_FRONT : INK_BACK;
  const tint = front ? 0 : 0.3;
  const soleC = front ? shade(ACCENT, -0.18) : mixColor(ACCENT, SHADOW_TINT, 0.42);

  const shinLen = Math.max(6, Math.hypot(fx - kx, fy - ky));
  // Stop the shin short of the ankle: its round cap would otherwise poke out
  // under the boot heel and read as the foot sinking through the ground.
  const t = 1 - 3.5 / shinLen;
  const ax = kx + (fx - kx) * t;
  // Backing off along the shin only helps while the shin is steep. In a deep
  // crouch it lies almost flat, so the cap has to be lifted straight up instead
  // — keeping the horizontal reach that plugs it into the boot.
  const ay = Math.min(
    ky + (fy - ky) * t,
    fy + BOOT_SOLE_Y + BOOT_INK - (SHIN_RADIUS + SHIN_INK),
  );
  limb(ctx, hx, hy, kx, ky, 7.6, {
    fill: limbFill(ctx, hy, ky, PANTS, tint),
    outline: ink,
    lineWidth: 2.8,
  });
  limb(ctx, kx, ky, ax, ay, SHIN_RADIUS, {
    fill: limbFill(ctx, ky, ay, SKIN, tint),
    outline: ink,
    lineWidth: SHIN_INK,
  });

  // Heel-strike / toe-off tilt rides the shin angle so the sole stays believable,
  // but a planted foot is constrained by the floor it is standing on.
  const shinAngle = Math.atan2(fx - kx, fy - ky);
  const bootAngle = floorPitch(fy, pitch - shinAngle * 0.28);
  drawBoot(
    ctx,
    fx,
    fy,
    bootAngle,
    tint > 0 ? mixColor(BOOT, SHADOW_TINT, 0.2) : shade(BOOT, 0.2),
    mixColor(BOOT, SHADOW_TINT, 0.28 + tint),
    soleC,
    ink,
  );
}

function drawArm(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  angle: number,
  elbowBend: number,
  front: boolean,
): void {
  const ink = front ? INK_FRONT : INK_BACK;
  const tint = front ? 0 : 0.26;

  const ex = sx + Math.sin(angle) * UPPER_ARM;
  const ey = sy + Math.cos(angle) * UPPER_ARM;
  const ha = angle + elbowBend;
  const hx = ex + Math.sin(ha) * FOREARM;
  const hy = ey + Math.cos(ha) * FOREARM;

  limb(ctx, sx, sy, ex, ey, 5.6, {
    fill: limbFill(ctx, sy, ey, SKIN, tint),
    outline: ink,
    lineWidth: 2.8,
  });
  limb(ctx, ex, ey, hx, hy, 4.9, {
    fill: limbFill(ctx, ey, hy, SKIN, tint),
    outline: ink,
    lineWidth: 2.8,
  });
  orb(ctx, hx, hy, 5.4, 5.1, {
    fill: vgrad(
      ctx,
      hy - 5.1,
      hy + 5.1,
      tint > 0 ? mixColor(ACCENT, SHADOW_TINT, 0.3) : shade(ACCENT, 0.16),
      mixColor(ACCENT, SHADOW_TINT, 0.3 + tint),
    ),
    outline: ink,
    lineWidth: 2.6,
  });
  if (front) highlight(ctx, hx - 1.7, hy - 1.9, 3.4, 2.7, '#ffffff', 0.34);
}

function drawTorso(ctx: CanvasRenderingContext2D, hx: number, hy: number, lean: number): void {
  ctx.save();
  ctx.translate(hx, hy);
  ctx.rotate(lean);

  // Shorts first: the shirt overlaps them, leaving a visible hip mass.
  limb(ctx, -3, 0, 3, 1.5, 15.5, {
    fill: bodyFill(ctx, -14, 17, PANTS),
    outline: INK_FRONT,
    lineWidth: 2.8,
  });

  limb(ctx, 0.5, -25, 2, -33, 6.4, {
    fill: mixColor(SKIN, SHADOW_TINT, 0.2),
    outline: INK_FRONT,
    lineWidth: 2.6,
  });
  orb(ctx, 0, -14.5, 19.5, 17, {
    fill: bodyFill(ctx, -32, 3, BODY),
    outline: INK_FRONT,
    lineWidth: 3,
  });

  box(ctx, -19.5, -3.5, 39, 7, 3.2, {
    fill: css(ACCENT),
    outline: INK_FRONT,
    lineWidth: 2.4,
  });
  box(ctx, -2, -2.4, 8.5, 4.8, 1.8, { fill: shade(ACCENT, -0.3), outline: null });

  polygon(
    ctx,
    [
      [-3.5, -25],
      [2, -19],
      [-3.5, -13],
      [-9, -19],
    ] as const,
    { fill: css(ACCENT), outline: INK_FRONT, lineWidth: 2 },
  );

  highlight(ctx, -7, -24, 11.5, 9, '#ffffff', 0.28);
  // Occlusion band where the shirt tucks under the belt.
  orb(ctx, 0, 1, 18, 6, { fill: withAlpha(SHADOW_TINT, 0.2), outline: null });
  ctx.restore();
}

function drawCap(ctx: CanvasRenderingContext2D, tilt: number): void {
  ctx.save();
  ctx.rotate(tilt);
  const baseY = -6.5;

  // Bill first so the dome overlaps its root.
  ctx.save();
  ctx.translate(8.5, baseY + 1);
  ctx.rotate(0.14);
  box(ctx, 0, -3.1, 21, 6.2, 3, {
    fill: shade(ACCENT, -0.34),
    outline: INK_FRONT,
    lineWidth: 2.6,
  });
  ctx.restore();

  // Half dome: clip above the brim line, then draw a whole ellipse.
  ctx.save();
  ctx.beginPath();
  ctx.rect(-26, -27, 52, 21 + baseY + 6.5);
  ctx.clip();
  orb(ctx, 0, baseY, 19.5, 13, {
    fill: bodyFill(ctx, baseY - 13, baseY + 4, ACCENT),
    outline: INK_FRONT,
    lineWidth: 3,
  });
  ctx.restore();

  box(ctx, -19.8, -10.2, 39.6, 6.2, 3, {
    fill: shade(ACCENT, -0.14),
    outline: INK_FRONT,
    lineWidth: 2.6,
  });
  highlight(ctx, -5, -15.5, 9, 6, '#ffffff', 0.4);
  ctx.restore();
}

function drawFace(ctx: CanvasRenderingContext2D, p: Pose): void {
  const ink = css(COLORS.playerEyes);
  // Three-quarter view: near eye on the cheek, far eye tucked against the nose.
  eye(ctx, -1.5, 3, {
    r: 5.0,
    blink: p.blink,
    lookX: p.lookX,
    lookY: p.lookY,
    pupilColor: ink,
  });
  eye(ctx, 10.5, 3.5, {
    r: 3.9,
    blink: p.blink,
    lookX: p.lookX,
    lookY: p.lookY,
    pupilColor: ink,
  });

  orb(ctx, -5, 10, 4.8, 3, { fill: withAlpha(BLUSH, 0.5), outline: null });

  if (p.mouthOpen > 0.04) {
    const mw = 8 + 3.4 * p.mouthOpen;
    const mh = 2.4 + 5.6 * p.mouthOpen;
    orb(ctx, 4.5, 11.5 + mh * 0.2, mw * 0.5, mh * 0.5, {
      fill: '#5c2536',
      outline: withAlpha(COLORS.playerEyes, 0.9),
      lineWidth: 1.8,
    });
    orb(ctx, 4.5, 11.5 + mh * 0.42, mw * 0.28, mh * 0.22, {
      fill: '#e8737f',
      outline: null,
    });
  } else {
    mouth(ctx, 4, 10.5, 11.5, p.mouthCurve, undefined, 2.6);
  }
}

function drawHead(
  ctx: CanvasRenderingContext2D,
  hx: number,
  hy: number,
  lean: number,
  p: Pose,
): void {
  ctx.save();
  ctx.translate(hx, hy);
  ctx.rotate(lean);
  ctx.translate(p.headX, HEAD_DY + p.headY);
  ctx.rotate(p.headTilt);

  orb(ctx, -17, 5, 4.2, 5.4, {
    fill: mixColor(SKIN, SHADOW_TINT, 0.24),
    outline: INK_FRONT,
    lineWidth: 2.6,
  });
  orb(ctx, 0, 0, HEAD_RX, HEAD_RY, {
    fill: vgrad(ctx, -HEAD_RY, HEAD_RY, shade(SKIN, 0.16), mixColor(SKIN, SHADOW_TINT, 0.17)),
    outline: INK_FRONT,
    lineWidth: 3,
  });
  // Button nose breaks the head silhouette so the facing reads instantly.
  orb(ctx, 16.5, 6, 3.6, 3.2, {
    fill: css(SKIN),
    outline: INK_FRONT,
    lineWidth: 2.4,
  });

  drawFace(ctx, p);
  drawCap(ctx, p.capTilt);
  ctx.restore();
}

/** Render the whole puppet from a pose into a `w` x `h` frame box. */
function drawHopper(ctx: CanvasRenderingContext2D, p: Pose, w: number, h: number): void {
  ctx.save();
  ctx.scale(w / FRAME, h / FRAME);

  // Drawn squash pivots on the baseline, so compressed poses stay planted.
  const sy = clampNum(p.squash, 0.72, 1.04);
  const sx = 1 / Math.sqrt(sy);
  ctx.translate(CX, BASE_Y);
  ctx.scale(sx, sy);
  ctx.translate(-CX, -BASE_Y);

  const hx = CX + p.hipX;
  const hy = p.hipY;
  const lean = p.torsoLean;
  const [bax, bay] = rotOff(-8, SHOULDER_DY, lean);
  const [fax, fay] = rotOff(7.5, SHOULDER_DY, lean);

  drawArm(ctx, hx + bax, hy + bay, p.armBackAngle + lean, p.elbowBackBend, false);
  drawLeg(ctx, hx, hy, CX + p.footBackX, p.footBackY, p.kneeBackBend, p.footBackPitch, false);
  drawTorso(ctx, hx, hy, lean);
  drawLeg(ctx, hx, hy, CX + p.footFrontX, p.footFrontY, p.kneeFrontBend, p.footFrontPitch, true);
  drawHead(ctx, hx, hy, lean, p);
  // Near arm last: raised hands must not disappear behind the head.
  drawArm(ctx, hx + fax, hy + fay, p.armFrontAngle + lean, p.elbowFrontBend, true);

  ctx.restore();
}

// --- Clip pose curves ------------------------------------------------------

const IDLE_FRAMES = 6;
const RUN_FRAMES = 8;

/**
 * Breathing rise/fall plus a second harmonic. The fundamental is phase-shifted
 * off the frame grid on purpose: an unshifted sin(a) is zero at both a=0 and
 * a=PI while the second harmonic repeats over that same span, so frames 0 and 3
 * of a 6-frame loop landed on an identical breath value and the idle read as a
 * 3-frame stutter.
 */
function idlePose(i: number): Pose {
  const a = (i / IDLE_FRAMES) * TAU;
  const br = 0.7 * Math.sin(a + 0.6) + 0.3 * Math.sin(2 * a + 0.9);
  const lag = Math.sin(a - 1.0);
  const sway = Math.sin(a + 0.5);
  return pose({
    hipX: 0.6 * sway,
    hipY: HIP_Y - 0.5 - 1.0 * br,
    torsoLean: 0.055 - 0.03 * br,
    headY: -0.8 * br + 0.3 * lag,
    headTilt: -0.02 + 0.035 * lag,
    capTilt: 0.05 * lag,
    armFrontAngle: 0.17 + 0.07 * br,
    armBackAngle: -0.13 - 0.06 * lag,
    elbowFrontBend: 0.3 - 0.07 * br,
    elbowBackBend: 0.24 - 0.05 * lag,
    footFrontX: 6.5 + 0.4 * sway,
    footBackX: -7.5 + 0.4 * sway,
    kneeFrontBend: 1.5 + 0.9 * br,
    kneeBackBend: 1.1 + 0.6 * lag,
    blink: i === 4 ? 0.88 : i === 3 ? 0.3 : i === 5 ? 0.18 : 0,
    mouthCurve: 2.6 + 0.5 * br,
    lookX: 0.34 + 0.1 * lag,
    lookY: 0.05 * br,
  });
}

const STRIDE = 14;
const SWING_LIFT = 15;
const HEEL_RISE = 4;

/**
 * One leg's foot target over the gait cycle. Stance (phase 0..0.5) drags the
 * planted foot back from +STRIDE to -STRIDE while the heel peels up; swing
 * (0.5..1) arcs it forward again.
 */
function runFoot(phase: number): { x: number; y: number; pitch: number } {
  const t = phase - Math.floor(phase);
  if (t < 0.5) {
    const u = t / 0.5;
    return {
      x: STRIDE * (1 - 2 * u),
      y: ANKLE_Y - HEEL_RISE * smoothStep((u - 0.55) / 0.45),
      pitch: -0.14 + 0.44 * u,
    };
  }
  const u = (t - 0.5) / 0.5;
  return {
    x: -STRIDE + 2 * STRIDE * smoothStep(u),
    y: ANKLE_Y - (HEEL_RISE * (1 - smoothStep(u)) + SWING_LIFT * Math.sin(Math.PI * u)),
    pitch: 0.3 - 0.44 * smoothStep(u),
  };
}

function runPose(i: number): Pose {
  const p = i / RUN_FRAMES;
  const ph = p * TAU;
  // Arm swing is deliberately NOT cos(ph): a bare cosine is symmetric about the
  // extremes, so on an 8-frame grid frames 1/7, 2/6 and 3/5 came out with the
  // exact same arm and elbow angles while their legs were doing quite different
  // things. Shifting the fundamental off the grid and adding a second harmonic
  // gives all eight frames distinct arms and a real drive/recovery asymmetry.
  const swing = Math.cos(ph - 0.35);
  const drive = Math.sin(2 * ph);
  // Hips dip twice per cycle: low when the legs split, high over the pass pose.
  const bob = 0.5 - 0.5 * Math.cos(2 * ph);
  const front = runFoot(p);
  const back = runFoot(p + 0.5);
  return pose({
    hipX: 0.7 * Math.sin(ph),
    hipY: 80.6 - 3.1 * bob,
    torsoLean: 0.2 + 0.035 * Math.cos(2 * ph),
    headTilt: -0.13 - 0.02 * Math.cos(2 * ph),
    headY: -0.5 * bob,
    capTilt: -0.15 + 0.035 * Math.sin(2 * ph),
    armFrontAngle: 0.1 - 0.88 * swing + 0.16 * drive,
    armBackAngle: 0.1 + 0.88 * swing - 0.16 * drive,
    elbowFrontBend: 1.1 - 0.42 * swing,
    elbowBackBend: 1.1 + 0.42 * swing,
    footFrontX: front.x,
    footFrontY: front.y,
    footFrontPitch: front.pitch,
    footBackX: back.x,
    footBackY: back.y,
    footBackPitch: back.pitch,
    kneeFrontBend: 1.2,
    kneeBackBend: 1.0,
    squash: 0.985 + 0.02 * bob,
    blink: 0.18,
    mouthOpen: 0.28 + 0.12 * bob,
    lookX: 0.5,
    lookY: -0.05,
  });
}

/** crouch-launch -> tuck with arms up -> hold stretched (last frame is held). */
const JUMP_POSES: readonly Partial<Pose>[] = [
  {
    hipX: 1,
    hipY: 91,
    torsoLean: 0.3,
    headTilt: -0.04,
    capTilt: 0.1,
    armFrontAngle: -1.15,
    armBackAngle: -1.35,
    elbowFrontBend: 0.55,
    elbowBackBend: 0.45,
    footFrontX: 7,
    footBackX: -5,
    kneeFrontBend: 2.6,
    kneeBackBend: 2.1,
    squash: 0.86,
    blink: 0.2,
    mouthOpen: 0.45,
    lookX: 0.45,
    lookY: -0.3,
  },
  {
    hipY: 76.5,
    torsoLean: 0.03,
    headTilt: 0.04,
    capTilt: -0.2,
    armFrontAngle: 2.1,
    armBackAngle: 2.35,
    elbowFrontBend: 0.22,
    elbowBackBend: 0.16,
    footFrontX: 8,
    footFrontY: 96,
    footFrontPitch: 0.35,
    footBackX: -6,
    footBackY: 100,
    footBackPitch: 0.3,
    kneeFrontBend: 2.0,
    kneeBackBend: 1.6,
    squash: 1.0,
    blink: 0.1,
    mouthOpen: 0.6,
    lookX: 0.3,
    lookY: -0.25,
  },
  {
    hipY: 77,
    torsoLean: 0.1,
    headTilt: 0.0,
    capTilt: -0.24,
    armFrontAngle: 1.9,
    armBackAngle: 2.25,
    elbowFrontBend: 0.3,
    elbowBackBend: 0.25,
    footFrontX: 4,
    footFrontY: 102,
    footFrontPitch: 0.38,
    footBackX: -10,
    footBackY: 105,
    footBackPitch: 0.42,
    kneeFrontBend: 1.2,
    kneeBackBend: 0.8,
    squash: 1.02,
    mouthOpen: 0.35,
    lookX: 0.4,
    lookY: -0.1,
  },
];

/** Arms out, legs trailing, two-frame flutter. */
const FALL_POSES: readonly Partial<Pose>[] = [
  {
    hipY: 78.5,
    torsoLean: -0.08,
    headTilt: 0.1,
    capTilt: -0.26,
    armFrontAngle: 1.75,
    armBackAngle: 2.1,
    elbowFrontBend: 0.45,
    elbowBackBend: 0.35,
    footFrontX: 9,
    footFrontY: 104,
    footFrontPitch: 0.34,
    footBackX: -12,
    footBackY: 107,
    footBackPitch: 0.38,
    kneeFrontBend: 1.5,
    kneeBackBend: 1.0,
    squash: 0.99,
    blink: 0.2,
    mouthOpen: 0.5,
    lookX: 0.3,
    lookY: 0.35,
  },
  {
    hipY: 77.5,
    torsoLean: -0.02,
    headTilt: 0.05,
    capTilt: -0.19,
    armFrontAngle: 1.95,
    armBackAngle: 1.88,
    elbowFrontBend: 0.3,
    elbowBackBend: 0.52,
    footFrontX: 5.5,
    footFrontY: 107,
    footFrontPitch: 0.42,
    footBackX: -13.5,
    footBackY: 103,
    footBackPitch: 0.28,
    kneeFrontBend: 1.0,
    kneeBackBend: 1.7,
    squash: 1.0,
    blink: 0.1,
    mouthOpen: 0.42,
    lookX: 0.35,
    lookY: 0.3,
  },
];

/** Deep compress, then recover. */
const LAND_POSES: readonly Partial<Pose>[] = [
  {
    hipX: -1,
    hipY: 92,
    torsoLean: 0.18,
    headTilt: -0.02,
    capTilt: 0.14,
    armFrontAngle: 1.05,
    armBackAngle: 1.35,
    elbowFrontBend: 0.85,
    elbowBackBend: 0.7,
    footFrontX: 7.5,
    footBackX: -4,
    kneeFrontBend: 2.6,
    kneeBackBend: 2.2,
    squash: 0.86,
    blink: 0.5,
    mouthOpen: 0.55,
    lookX: 0.2,
    lookY: 0.2,
  },
  {
    hipY: 86,
    torsoLean: 0.09,
    headTilt: 0.04,
    capTilt: 0.1,
    armFrontAngle: 0.5,
    armBackAngle: 0.62,
    elbowFrontBend: 0.55,
    elbowBackBend: 0.45,
    footFrontX: 7,
    footBackX: -8,
    kneeFrontBend: 2.2,
    kneeBackBend: 1.8,
    squash: 0.93,
    blink: 0.3,
    mouthOpen: 0.3,
  },
];

/** Recoil back, eyes shut, arms flung forward; the cap keeps flying. */
const HURT_POSES: readonly Partial<Pose>[] = [
  {
    hipX: -3,
    hipY: 80,
    torsoLean: -0.34,
    headTilt: -0.14,
    capTilt: 0.3,
    armFrontAngle: 1.55,
    armBackAngle: 1.8,
    elbowFrontBend: -0.15,
    elbowBackBend: -0.1,
    footFrontX: 13,
    footFrontY: 111,
    footFrontPitch: -0.25,
    footBackX: -9,
    kneeFrontBend: 1.8,
    kneeBackBend: 1.4,
    squash: 1.0,
    blink: 0.88,
    mouthOpen: 0.75,
    lookX: 0,
  },
  {
    hipX: -5.5,
    hipY: 87,
    torsoLean: -0.16,
    headTilt: -0.04,
    capTilt: 0.16,
    armFrontAngle: 1.2,
    armBackAngle: 1.5,
    elbowFrontBend: 0.25,
    elbowBackBend: 0.2,
    footFrontX: 10,
    footBackX: -14,
    footBackY: 108,
    footBackPitch: 0.3,
    kneeFrontBend: 2.4,
    kneeBackBend: 1.2,
    squash: 0.9,
    blink: 0.9,
    mouthOpen: 0.5,
  },
];

const IDLE_AT = 0;
const RUN_AT = IDLE_AT + IDLE_FRAMES; // 6
const JUMP_AT = RUN_AT + RUN_FRAMES; // 14
const FALL_AT = JUMP_AT + JUMP_POSES.length; // 17
const LAND_AT = FALL_AT + FALL_POSES.length; // 19
const HURT_AT = LAND_AT + LAND_POSES.length; // 21
const TOTAL_FRAMES = HURT_AT + HURT_POSES.length; // 23

function keyPose(list: readonly Partial<Pose>[], i: number): Pose {
  return pose(list[clampNum(i, 0, list.length - 1)]);
}

function poseForFrame(frame: number): Pose {
  if (frame < RUN_AT) return idlePose(frame - IDLE_AT);
  if (frame < JUMP_AT) return runPose(frame - RUN_AT);
  if (frame < FALL_AT) return keyPose(JUMP_POSES, frame - JUMP_AT);
  if (frame < LAND_AT) return keyPose(FALL_POSES, frame - FALL_AT);
  if (frame < HURT_AT) return keyPose(LAND_POSES, frame - LAND_AT);
  return keyPose(HURT_POSES, frame - HURT_AT);
}

// --- Art bundle ------------------------------------------------------------

const range = (start: number, count: number): number[] =>
  Array.from({ length: count }, (_, i) => start + i);

export const HOPPER_CLIPS: ClipMap = {
  idle: { frames: range(IDLE_AT, IDLE_FRAMES), fps: 7, loop: true },
  run: { frames: range(RUN_AT, RUN_FRAMES), fps: 14, loop: true },
  jump: { frames: range(JUMP_AT, JUMP_POSES.length), fps: 12, loop: false },
  fall: { frames: range(FALL_AT, FALL_POSES.length), fps: 8, loop: true },
  land: { frames: range(LAND_AT, LAND_POSES.length), fps: 16, loop: false },
  hurt: { frames: range(HURT_AT, HURT_POSES.length), fps: 10, loop: false },
};

export function getHopperArt(): CharacterArt {
  const sheet = getSheet('hopper', () =>
    buildSpriteSheet({
      frameW: FRAME,
      frameH: FRAME,
      frames: TOTAL_FRAMES,
      cols: 6,
      padding: 2,
      draw: (ctx, frame, w, h) => drawHopper(ctx, poseForFrame(frame), w, h),
    }),
  );
  return {
    sheet,
    clips: HOPPER_CLIPS,
    worldHeight: HOPPER_WORLD_HEIGHT,
    feetInset: HOPPER_FEET_INSET,
  };
}

// --- Game-facing visual ----------------------------------------------------

/** |vx| that plays the run clip at its authored 14fps. */
const RUN_REF_SPEED = 7;

export class HopperSprite {
  readonly group: THREE.Group;

  private readonly sprite: AnimatedSprite;
  private squash = 1;
  private bobPhase = 0;
  private facing: 1 | -1 = 1;

  constructor() {
    this.sprite = spriteFromArt(getHopperArt(), 'idle', { castShadow: true });
    this.group = new THREE.Group();
    this.group.name = 'Hopper';
    this.group.add(this.sprite.object3d);
  }

  get object3d(): THREE.Object3D {
    return this.group;
  }

  setPosition(x: number, y: number, z = 0): void {
    this.group.position.set(x, y, z);
  }

  /** facing: +1 = right (+X), -1 = left. Mirrors via scale.x inside setDeform. */
  setFacing(facing: 1 | -1): void {
    if (facing === this.facing) return;
    this.facing = facing;
    this.sprite.setFacing(facing);
  }

  /** Kick off the hurt clip; it holds its last frame until state changes. */
  playHurt(): void {
    this.sprite.play('hurt', true);
  }

  update(
    dt: number,
    opts: {
      grounded: boolean;
      vx: number;
      vy: number;
      justLanded: boolean;
      justJumped: boolean;
    },
  ): void {
    const speed = Math.abs(opts.vx);
    const clip = this.sprite.clip;

    if (opts.justJumped) {
      this.sprite.play('jump', true);
    } else if (opts.justLanded) {
      this.sprite.play('land', true);
    } else if (!opts.grounded) {
      // No restart while rising: 'jump' runs to its stretched pose and holds.
      this.sprite.play(opts.vy > 0.5 ? 'jump' : 'fall');
    } else if (
      (clip === 'land' || clip === 'hurt') &&
      !this.sprite.finished
    ) {
      // Impact reads fully before locomotion resumes.
    } else if (speed > 0.35) {
      this.sprite.play('run');
    } else {
      this.sprite.play('idle');
    }

    // Squash/stretch, carried over from PlayerVisual: snap into the impulse,
    // then relax back toward 1.
    let targetSquash = 1;
    if (opts.justLanded) {
      targetSquash = 0.72;
    } else if (opts.justJumped) {
      targetSquash = 1.22;
    } else if (!opts.grounded && opts.vy > 2.5) {
      targetSquash = 1.1;
    } else if (!opts.grounded && opts.vy < -5) {
      targetSquash = 0.9;
    } else if (opts.grounded && speed > 6) {
      targetSquash = 0.97;
    }
    const snap = opts.justLanded || opts.justJumped ? 22 : 12;
    this.squash += (targetSquash - this.squash) * Math.min(1, snap * dt);
    this.squash += (1 - this.squash) * Math.min(1, 5.5 * dt);
    this.sprite.setDeform(this.squash);

    if (opts.grounded && speed > 0.4) {
      this.bobPhase += dt * (8 + speed * 0.55);
    } else {
      this.bobPhase += dt * 2;
    }
    // Wrapped, or a long session pushes the phase where float spacing exceeds
    // the step and the bob quantises into a visible judder.
    if (this.bobPhase > TAU) this.bobPhase -= TAU;
    // The sheet already animates the run's hip bob; this is only the extra
    // whole-body float, so keep it small. Feet-anchored geometry means the
    // squash needs no vertical compensation.
    this.sprite.mesh.position.y =
      opts.grounded && speed > 0.35
        ? Math.sin(this.bobPhase) * 0.018
        : Math.sin(this.bobPhase) * 0.012;

    // Run playback rate tracks ground speed: a scaled dt drives the clip clock,
    // so fast running cycles faster without touching the authored fps.
    const clockDt =
      this.sprite.clip === 'run'
        ? dt * clampNum(speed / RUN_REF_SPEED, 0.55, 1.75)
        : dt;
    this.sprite.update(clockDt);
  }

  dispose(): void {
    this.sprite.dispose();
    this.group.clear();
    this.group.removeFromParent();
  }
}
