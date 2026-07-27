/**
 * Canvas2D painting toolkit shared by every procedural sprite.
 *
 * House style: bold dark outline, flat base colour, one soft upper highlight,
 * one lower occlusion band. Keeping every character on these primitives is what
 * makes procedurally generated art read as a single art direction instead of
 * five unrelated doodles.
 *
 * Coordinates are canvas space (y grows downward) in frame-local pixels.
 */

// --- Colour ----------------------------------------------------------------

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Parse `#rgb`, `#rrggbb`, or a 0xRRGGBB number. */
export function parseColor(color: string | number): Rgb {
  if (typeof color === 'number') {
    return { r: (color >> 16) & 255, g: (color >> 8) & 255, b: color & 255 };
  }
  let hex = color.trim().replace('#', '');
  if (hex.length === 3) {
    hex = hex[0]! + hex[0]! + hex[1]! + hex[1]! + hex[2]! + hex[2]!;
  }
  const n = Number.parseInt(hex, 16);
  if (!Number.isFinite(n)) return { r: 255, g: 0, b: 255 };
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgbToCss({ r, g, b }: Rgb, alpha = 1): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return alpha >= 1
    ? `rgb(${c(r)}, ${c(g)}, ${c(b)})`
    : `rgba(${c(r)}, ${c(g)}, ${c(b)}, ${Math.max(0, Math.min(1, alpha))})`;
}

/** Lighten (amount > 0) or darken (amount < 0) toward white/black. -1..1. */
export function shade(color: string | number, amount: number): string {
  const { r, g, b } = parseColor(color);
  const t = Math.max(-1, Math.min(1, amount));
  if (t >= 0) {
    return rgbToCss({
      r: r + (255 - r) * t,
      g: g + (255 - g) * t,
      b: b + (255 - b) * t,
    });
  }
  const k = 1 + t;
  return rgbToCss({ r: r * k, g: g * k, b: b * k });
}

/** Shift a colour toward `target` by `t` (0..1) — for tinting into shadow hues. */
export function mixColor(color: string | number, target: string | number, t: number): string {
  const a = parseColor(color);
  const b = parseColor(target);
  const k = Math.max(0, Math.min(1, t));
  return rgbToCss({
    r: a.r + (b.r - a.r) * k,
    g: a.g + (b.g - a.g) * k,
    b: a.b + (b.b - a.b) * k,
  });
}

export function withAlpha(color: string | number, alpha: number): string {
  return rgbToCss(parseColor(color), alpha);
}

// --- Style -----------------------------------------------------------------

export interface ShapeStyle {
  fill?: string | CanvasGradient;
  /** Outline colour. Pass null to skip the outline. */
  outline?: string | null;
  /** Outline width in px. */
  lineWidth?: number;
}

const DEFAULT_OUTLINE = 'rgba(26, 22, 38, 0.92)';

function paintPath(ctx: CanvasRenderingContext2D, style: ShapeStyle): void {
  if (style.fill) {
    ctx.fillStyle = style.fill;
    ctx.fill();
  }
  const outline = style.outline === undefined ? DEFAULT_OUTLINE : style.outline;
  if (outline) {
    ctx.strokeStyle = outline;
    ctx.lineWidth = style.lineWidth ?? 3;
    ctx.stroke();
  }
}

// --- Primitives ------------------------------------------------------------

/**
 * Capsule between two points — the workhorse for arms, legs, and torsos.
 * Outlining the stroke rather than the path keeps joints seamless.
 */
export function limb(
  ctx: CanvasRenderingContext2D,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  radius: number,
  style: ShapeStyle = {},
): void {
  const outline = style.outline === undefined ? DEFAULT_OUTLINE : style.outline;
  const lw = style.lineWidth ?? 3;

  ctx.lineCap = 'round';
  if (outline) {
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.strokeStyle = outline;
    ctx.lineWidth = radius * 2 + lw * 2;
    ctx.stroke();
  }
  if (style.fill) {
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.strokeStyle = style.fill as string;
    ctx.lineWidth = radius * 2;
    ctx.stroke();
  }
}

/** Ellipse / circle body part. */
export function orb(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  style: ShapeStyle = {},
  rotation = 0,
): void {
  ctx.beginPath();
  ctx.ellipse(cx, cy, Math.abs(rx), Math.abs(ry), rotation, 0, Math.PI * 2);
  paintPath(ctx, style);
}

/** Rounded rectangle. */
export function box(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
  style: ShapeStyle = {},
): void {
  const r = Math.max(0, Math.min(radius, Math.min(Math.abs(w), Math.abs(h)) * 0.5));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
  paintPath(ctx, style);
}

export function polygon(
  ctx: CanvasRenderingContext2D,
  points: readonly (readonly [number, number])[],
  style: ShapeStyle = {},
  close = true,
): void {
  if (points.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(points[0]![0], points[0]![1]);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i]![0], points[i]![1]);
  }
  if (close) ctx.closePath();
  paintPath(ctx, style);
}

/** Closed Catmull-Rom-ish blob through control points — organic silhouettes. */
export function blob(
  ctx: CanvasRenderingContext2D,
  points: readonly (readonly [number, number])[],
  style: ShapeStyle = {},
): void {
  const n = points.length;
  if (n < 3) {
    polygon(ctx, points, style);
    return;
  }
  ctx.beginPath();
  const mid = (i: number, j: number): [number, number] => [
    (points[i]![0] + points[j]![0]) * 0.5,
    (points[i]![1] + points[j]![1]) * 0.5,
  ];
  let start = mid(n - 1, 0);
  ctx.moveTo(start[0], start[1]);
  for (let i = 0; i < n; i++) {
    const cp = points[i]!;
    const next = mid(i, (i + 1) % n);
    ctx.quadraticCurveTo(cp[0], cp[1], next[0], next[1]);
  }
  ctx.closePath();
  paintPath(ctx, style);
}

// --- Shading ---------------------------------------------------------------

/** Vertical gradient, light on top. Use as a `fill`. */
export function vgrad(
  ctx: CanvasRenderingContext2D,
  y0: number,
  y1: number,
  top: string,
  bottom: string,
): CanvasGradient {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, top);
  g.addColorStop(1, bottom);
  return g;
}

/** Standard body fill: base colour lit from above, tinted into shadow below. */
export function bodyFill(
  ctx: CanvasRenderingContext2D,
  y0: number,
  y1: number,
  base: string | number,
  shadowTint: string | number = 0x2a1f4a,
): CanvasGradient {
  return vgrad(ctx, y0, y1, shade(base, 0.22), mixColor(base, shadowTint, 0.34));
}

/**
 * Soft specular blob. Clip to the body shape before calling for a tight
 * highlight, or call bare for a loose sheen.
 */
export function highlight(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  color = '#ffffff',
  alpha = 0.35,
): void {
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(rx, ry));
  g.addColorStop(0, withAlpha(color, alpha));
  g.addColorStop(1, withAlpha(color, 0));
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(cx, cy, Math.abs(rx), Math.abs(ry), 0, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.restore();
}

/** Rim light along one side — cheap way to lift a sprite off the background. */
export function rimLight(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  color = '#bfe4ff',
  alpha = 0.5,
  side: 1 | -1 = 1,
): void {
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(cx, cy, Math.abs(rx), Math.abs(ry), 0, -Math.PI * 0.55 * side, Math.PI * 0.35 * side, side < 0);
  ctx.strokeStyle = withAlpha(color, alpha);
  ctx.lineWidth = Math.max(1.5, Math.min(rx, ry) * 0.22);
  ctx.lineCap = 'round';
  ctx.stroke();
  ctx.restore();
}

/** Contact shadow ellipse, for sprites whose feet meet the ground. */
export function contactShadow(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  alpha = 0.3,
): void {
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(rx, ry));
  g.addColorStop(0, `rgba(20, 16, 34, ${alpha})`);
  g.addColorStop(1, 'rgba(20, 16, 34, 0)');
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(cx, cy, Math.abs(rx), Math.abs(ry), 0, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.restore();
}

// --- Eyes / faces ----------------------------------------------------------

export interface EyeOptions {
  /** Eye radius. */
  r?: number;
  /** 0 = wide open, 1 = fully shut. */
  blink?: number;
  /** Pupil offset in eye radii. */
  lookX?: number;
  lookY?: number;
  scleraColor?: string;
  pupilColor?: string;
  /** Angry brow angle in radians. 0 = none. */
  brow?: number;
  browColor?: string;
}

/** Cartoon eye with sclera, pupil, catchlight, and optional brow. */
export function eye(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  opts: EyeOptions = {},
): void {
  const r = opts.r ?? 5;
  const blink = Math.max(0, Math.min(1, opts.blink ?? 0));
  const openY = r * (1 - blink);

  if (blink >= 0.92) {
    ctx.beginPath();
    ctx.moveTo(cx - r, cy);
    ctx.lineTo(cx + r, cy);
    ctx.strokeStyle = 'rgba(26, 22, 38, 0.95)';
    ctx.lineWidth = Math.max(1.5, r * 0.32);
    ctx.lineCap = 'round';
    ctx.stroke();
  } else {
    orb(ctx, cx, cy, r, Math.max(0.6, openY), {
      fill: opts.scleraColor ?? '#fdfbff',
      outline: 'rgba(26, 22, 38, 0.9)',
      lineWidth: Math.max(1.2, r * 0.26),
    });
    const pr = r * 0.52;
    const px = cx + (opts.lookX ?? 0) * r * 0.42;
    const py = cy + (opts.lookY ?? 0) * Math.max(0.6, openY) * 0.42;
    orb(ctx, px, py, pr, Math.min(pr, Math.max(0.5, openY * 0.86)), {
      fill: opts.pupilColor ?? '#1a1a2e',
      outline: null,
    });
    if (openY > r * 0.45) {
      orb(ctx, px - pr * 0.34, py - pr * 0.38, pr * 0.34, pr * 0.3, {
        fill: 'rgba(255,255,255,0.9)',
        outline: null,
      });
    }
  }

  if (opts.brow) {
    const bw = r * 1.5;
    const tilt = opts.brow;
    ctx.save();
    ctx.translate(cx, cy - r * 1.75);
    ctx.rotate(tilt);
    ctx.beginPath();
    ctx.moveTo(-bw * 0.5, 0);
    ctx.lineTo(bw * 0.5, 0);
    ctx.strokeStyle = opts.browColor ?? 'rgba(26, 22, 38, 0.95)';
    ctx.lineWidth = Math.max(1.8, r * 0.42);
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.restore();
  }
}

/** Simple mouth arc. `curve` > 0 smiles, < 0 frowns. */
export function mouth(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  width: number,
  curve: number,
  color = 'rgba(26, 22, 38, 0.9)',
  lineWidth = 2.2,
): void {
  ctx.beginPath();
  ctx.moveTo(cx - width * 0.5, cy);
  ctx.quadraticCurveTo(cx, cy + curve, cx + width * 0.5, cy);
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'round';
  ctx.stroke();
}

// --- Curves ----------------------------------------------------------------

/** Ease a 0..1 phase into a smooth in/out ramp. */
export function smoothStep(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}

/** Phase (0..1) as radians — for cycle-driven limb swings. */
export function cycle(frame: number, total: number): number {
  return (frame / Math.max(1, total)) * Math.PI * 2;
}

/** Deterministic value noise in 0..1 — replaces Math.random for stable art. */
export function hashNoise(x: number, y = 0): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return s - Math.floor(s);
}
