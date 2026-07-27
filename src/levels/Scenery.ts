/**
 * Vegetation and world dressing: trees, bushes, grass tufts, flowers, rocks.
 *
 * These are lit, shadowed low-poly meshes living in the same world as the
 * platforms — not sprites. Two tricks keep a 60+ prop field cheap:
 *
 *  1. Every prop is a *pre-merged* variant geometry. A tree canopy is one mesh
 *     built from three to five overlapping icosahedra, a grass tuft is one mesh
 *     built from five to eight blades. That 21-shape palette is cached for the
 *     process (see `getShapes`), so props cost one draw call each and the vertex
 *     data is merged once per session rather than once per level load.
 *  2. Form shading (sun-facing mass light and warm, underside deep and cool) is
 *     baked into a vertex-colour attribute at build time. That buys two-tone
 *     canopies with a grand total of two materials for the whole level.
 *
 * Everything random comes from hashNoise, so a level dresses itself identically
 * on every load.
 */

import * as THREE from 'three';
import { COLORS, WORLD } from '../game/config';
import { hashNoise, mixColor } from '../render/paint';
import type { LevelDef, PlatformDef } from './types';

export interface ScenerySystem {
  root: THREE.Group;
  /** Advance wind. Called once per frame with absolute elapsed seconds. */
  update(elapsed: number): void;
  dispose(): void;
}

// --- Tuning ----------------------------------------------------------------

/**
 * Nothing may reach forward of this Z. The player and enemies run at z = 0, so
 * props stay strictly behind them and never occlude the run line.
 */
const PLAY_CLEAR_Z = -0.85;

/**
 * Safety epsilon on top of the *computed* reach. Every prop's wind lean is
 * folded into its forward reach before placement (see `swayReach`), so this is
 * a rounding cushion rather than a guess at how far a gust throws a branch.
 */
const SWAY_SLACK = 0.04;

/**
 * Peak of the two-harmonic gust envelope used by `update`:
 * |sin t + 0.32 sin(2.3 t + 1.1)| ≤ 1.32, and the shared gust factor is ≤ 1.
 */
const BEND_PEAK = 1.32;

/**
 * Surfaces shallower than this get no props. It is a cheap pre-filter only —
 * the real gate is `zBand`, which also has to fit the prop's own footprint
 * between the rear edge and PLAY_CLEAR_Z.
 */
const MIN_PROP_DEPTH = 2.4;

/** Trees need a wide, deep surface so the crown never hangs over the gameplay plane. */
const MIN_TREE_WIDTH = 5.5;
const MIN_TREE_DEPTH = 4.2;

/** Matches SceneSetup's directional light, so baked shading agrees with the real sun. */
const SUN = new THREE.Vector3(18, 28, 12).normalize();

// --- Palette ---------------------------------------------------------------

function ramp(...stops: readonly (string | number)[]): THREE.Color[] {
  return stops.map((c) => new THREE.Color(c));
}

/** Deep cool shadow → sunlit warm green. Drives every leaf mass. */
const FOLIAGE_RAMP = ramp(
  mixColor(COLORS.grassDark, 0x0d3a2e, 0.55),
  mixColor(COLORS.grassDark, 0x0d3a2e, 0.2),
  COLORS.grassDark,
  COLORS.grass,
  mixColor(COLORS.grass, 0xdcf07a, 0.42),
  mixColor(COLORS.grass, 0xf2ffb0, 0.66),
);

/** Bushes read as the same family, pushed a touch more yellow so they separate. */
const BUSH_RAMP = ramp(
  mixColor(COLORS.grassDark, 0x123a2a, 0.45),
  COLORS.grassDark,
  mixColor(COLORS.grass, 0xa8d861, 0.25),
  mixColor(COLORS.grass, 0xe6f79a, 0.55),
);

const BARK_RAMP = ramp(
  mixColor(COLORS.dirtDark, 0x241a12, 0.55),
  COLORS.dirtDark,
  mixColor(COLORS.dirt, COLORS.dirtDark, 0.45),
  COLORS.dirt,
  mixColor(COLORS.dirt, 0xffe0b0, 0.3),
);

const BLADE_RAMP = ramp(
  mixColor(COLORS.grassDark, 0x123326, 0.5),
  COLORS.grassDark,
  COLORS.grass,
  mixColor(COLORS.grass, 0xe8ff9a, 0.5),
);

const ROCK_RAMP = ramp(
  mixColor(COLORS.stoneDark, 0x20303a, 0.5),
  COLORS.stoneDark,
  COLORS.stone,
  mixColor(COLORS.stone, 0xe8f2ff, 0.42),
);

const FLOWER_COLORS = ramp(0xffd166, 0xff8a7a, 0xf5f9ff);
const FLOWER_HEART = new THREE.Color(mixColor(0xffd166, 0xf08a3c, 0.55));

// --- Small maths -----------------------------------------------------------

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Deterministic value in [lo, hi) from a seed plus a per-property offset. */
function pick(seed: number, offset: number, lo: number, hi: number): number {
  return lo + (hi - lo) * hashNoise(seed + offset);
}

function pickIndex(seed: number, offset: number, list: readonly number[]): number {
  const i = Math.floor(hashNoise(seed + offset) * list.length);
  return list[Math.min(list.length - 1, Math.max(0, i))];
}

function sample(stops: readonly THREE.Color[], t: number, out: THREE.Color): void {
  const c = clamp01(t) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(c));
  out.copy(stops[i]).lerp(stops[i + 1], c - i);
}

// --- Geometry merging ------------------------------------------------------

interface TintInput {
  x: number;
  y: number;
  z: number;
  nx: number;
  ny: number;
  nz: number;
  /** 0 = facing away from the sun, 1 = facing it. The whole basis of the baked form. */
  lit: number;
}

type TintFn = (v: TintInput, out: THREE.Color) => void;

interface MergePart {
  geo: THREE.BufferGeometry;
  matrix?: THREE.Matrix4;
  tint: TintFn;
}

const IDENTITY = new THREE.Matrix4();

/**
 * Flatten transformed copies of source geometries into one non-indexed buffer
 * carrying baked vertex colours. Source geometries are left intact — they are
 * shared primitives reused by dozens of parts.
 */
function mergeParts(parts: readonly MergePart[]): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const normalMatrix = new THREE.Matrix3();
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  const c = new THREE.Color();
  const input: TintInput = { x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0, lit: 0.5 };

  for (const part of parts) {
    const src = part.geo.index ? part.geo.toNonIndexed() : part.geo;
    const pos = src.getAttribute('position');
    const nor = src.getAttribute('normal');
    const m = part.matrix ?? IDENTITY;
    normalMatrix.getNormalMatrix(m);

    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i).applyMatrix4(m);
      if (nor) {
        n.fromBufferAttribute(nor, i).applyMatrix3(normalMatrix).normalize();
      } else {
        n.set(0, 1, 0);
      }
      input.x = p.x;
      input.y = p.y;
      input.z = p.z;
      input.nx = n.x;
      input.ny = n.y;
      input.nz = n.z;
      input.lit = 0.5 + 0.5 * n.dot(SUN);
      part.tint(input, c);
      positions.push(p.x, p.y, p.z);
      normals.push(n.x, n.y, n.z);
      colors.push(c.r, c.g, c.b);
    }
    if (src !== part.geo) src.dispose();
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

interface PropShape {
  geo: THREE.BufferGeometry;
  /** Largest |x| in the geometry — the instance footprint before scaling. */
  reachX: number;
  reachZ: number;
  /**
   * Largest hypot(x, z) — the footprint radius. For a prop that spins about Y
   * this is the only sound reach bound: `max(reachX, reachZ)` misses the corner
   * a rotated silhouette sweeps through, and hypot(reachX, reachZ) badly
   * over-states a radial shape like a grass tuft.
   */
  radiusXZ: number;
  /** Highest y in the geometry. */
  top: number;
}

function measure(geo: THREE.BufferGeometry): PropShape {
  const pos = geo.getAttribute('position');
  let rSq = 0;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    rSq = Math.max(rSq, x * x + z * z);
  }
  const radiusXZ = Math.sqrt(rSq);
  const bb = geo.boundingBox;
  if (!bb) return { geo, reachX: 1, reachZ: 1, radiusXZ, top: 1 };
  return {
    geo,
    reachX: Math.max(Math.abs(bb.min.x), Math.abs(bb.max.x)),
    reachZ: Math.max(Math.abs(bb.min.z), Math.abs(bb.max.z)),
    radiusXZ,
    top: bb.max.y,
  };
}

/** Drop the geometry so its lowest point sits at y = 0 (props stand on ground). */
function seat(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  // Measure first: on a geometry that has never been measured `boundingBox` is
  // null, and seating would silently do nothing at all.
  if (!geo.boundingBox) geo.computeBoundingBox();
  const bb = geo.boundingBox;
  if (bb) geo.translate(0, -bb.min.y, 0);
  geo.computeBoundingBox();
  return geo;
}

/** Rescale so the geometry is exactly one unit tall — instances scale by height. */
function unitHeight(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  seat(geo);
  const bb = geo.boundingBox;
  if (bb && bb.max.y > 1e-4) geo.scale(1 / bb.max.y, 1 / bb.max.y, 1 / bb.max.y);
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

// --- Leaf / stone masses ---------------------------------------------------

interface Blob {
  x: number;
  y: number;
  z: number;
  r: number;
  /** Vertical squash, 1 = sphere. */
  sy?: number;
  /** Depth squash — kept below 1 so crowns stay thin along Z. */
  sz?: number;
}

function blobParts(
  blobs: readonly Blob[],
  tint: TintFn,
  hi: THREE.BufferGeometry,
  lo: THREE.BufferGeometry,
  seed: number,
): MergePart[] {
  const euler = new THREE.Euler();
  const q = new THREE.Quaternion();
  return blobs.map((b, i) => {
    const sy = b.sy ?? 1;
    const sz = b.sz ?? 1;
    // Spin each mass so facets never line up between neighbours.
    euler.set(
      pick(seed, i * 1.7 + 0.11, -0.9, 0.9),
      pick(seed, i * 1.7 + 0.37, -Math.PI, Math.PI),
      pick(seed, i * 1.7 + 0.63, -0.9, 0.9),
    );
    q.setFromEuler(euler);
    // Squash *after* the spin (T·S·R, not compose's T·R·S). Spinning a unit
    // sphere only shuffles facets, so the ellipsoid ends up with exactly the
    // authored half-extents; the other order lets a 90° Y spin swap the thin
    // sz axis into X and fatten a crown along Z, which is the one axis that has
    // to stay slab-thin to keep foliage off the gameplay plane.
    const matrix = new THREE.Matrix4()
      .makeTranslation(b.x, b.y, b.z)
      .multiply(new THREE.Matrix4().makeScale(b.r, b.r * sy, b.r * sz))
      .multiply(new THREE.Matrix4().makeRotationFromQuaternion(q));
    return { geo: b.r >= 0.38 ? hi : lo, matrix, tint };
  });
}

function massTint(blobs: readonly Blob[], stops: readonly THREE.Color[], heightBias: number): TintFn {
  let yLo = Infinity;
  let yHi = -Infinity;
  for (const b of blobs) {
    const sy = b.sy ?? 1;
    yLo = Math.min(yLo, b.y - b.r * sy);
    yHi = Math.max(yHi, b.y + b.r * sy);
  }
  const span = Math.max(0.001, yHi - yLo);
  return (v, out) => {
    const t = clamp01((v.y - yLo) / span);
    sample(stops, heightBias * (t * t * (3 - 2 * t)) + (1 - heightBias) * v.lit, out);
  };
}

// Four canopy silhouettes that read as one species: an upright egg, a broad
// low crown, a leaning asymmetric one, and a compact sapling puff. Offsets are
// authored so |z| reach stays well under |x| reach — crowns are slab-like, which
// is what keeps them off the gameplay plane.
const CANOPY_BLOBS: readonly (readonly Blob[])[] = [
  [
    { x: 0.0, y: 0.75, z: -0.02, r: 0.62, sy: 1.15, sz: 0.72 },
    { x: -0.34, y: 0.52, z: 0.06, r: 0.42, sy: 1.0, sz: 0.7 },
    { x: 0.36, y: 0.6, z: -0.1, r: 0.4, sy: 1.0, sz: 0.7 },
    { x: 0.12, y: 1.1, z: 0.1, r: 0.34, sy: 0.95, sz: 0.7 },
    { x: -0.2, y: 0.98, z: -0.14, r: 0.3, sy: 0.9, sz: 0.7 },
  ],
  [
    { x: 0.0, y: 0.6, z: 0.0, r: 0.56, sy: 0.95, sz: 0.75 },
    { x: -0.44, y: 0.48, z: 0.05, r: 0.44, sy: 0.9, sz: 0.72 },
    { x: 0.46, y: 0.52, z: -0.06, r: 0.44, sy: 0.9, sz: 0.72 },
    { x: 0.1, y: 0.95, z: 0.08, r: 0.4, sy: 0.85, sz: 0.7 },
    { x: -0.24, y: 0.86, z: -0.12, r: 0.32, sy: 0.85, sz: 0.7 },
  ],
  [
    { x: 0.06, y: 0.8, z: 0.0, r: 0.58, sy: 1.2, sz: 0.7 },
    { x: -0.36, y: 0.62, z: 0.08, r: 0.4, sy: 1.05, sz: 0.68 },
    { x: 0.34, y: 1.06, z: -0.08, r: 0.34, sy: 1.0, sz: 0.68 },
    { x: -0.1, y: 1.22, z: 0.06, r: 0.26, sy: 0.95, sz: 0.68 },
  ],
  [
    { x: 0.0, y: 0.62, z: 0.0, r: 0.55, sy: 1.05, sz: 0.75 },
    { x: -0.28, y: 0.8, z: 0.06, r: 0.36, sy: 0.95, sz: 0.7 },
    { x: 0.3, y: 0.72, z: -0.06, r: 0.34, sy: 0.95, sz: 0.7 },
  ],
];

const BUSH_BLOBS: readonly (readonly Blob[])[] = [
  [
    { x: 0.0, y: 0.34, z: 0.0, r: 0.42, sy: 0.85, sz: 0.9 },
    { x: -0.34, y: 0.26, z: 0.08, r: 0.3, sy: 0.82, sz: 0.88 },
    { x: 0.32, y: 0.28, z: -0.06, r: 0.28, sy: 0.8, sz: 0.85 },
  ],
  [
    { x: -0.26, y: 0.3, z: 0.0, r: 0.38, sy: 0.88, sz: 0.9 },
    { x: 0.3, y: 0.26, z: 0.04, r: 0.34, sy: 0.84, sz: 0.88 },
  ],
  [
    { x: 0.0, y: 0.42, z: 0.0, r: 0.4, sy: 1.05, sz: 0.9 },
    { x: -0.3, y: 0.26, z: 0.06, r: 0.26, sy: 0.85, sz: 0.85 },
    { x: 0.26, y: 0.3, z: -0.08, r: 0.24, sy: 0.85, sz: 0.85 },
  ],
];

const ROCK_BLOBS: readonly (readonly Blob[])[] = [
  [{ x: 0, y: 0.34, z: 0, r: 0.5, sy: 0.66, sz: 0.85 }],
  [
    { x: -0.1, y: 0.3, z: 0, r: 0.46, sy: 0.6, sz: 0.82 },
    { x: 0.42, y: 0.16, z: 0.12, r: 0.22, sy: 0.7, sz: 0.8 },
  ],
  [
    { x: 0.0, y: 0.38, z: 0.0, r: 0.36, sy: 0.95, sz: 0.8 },
    { x: -0.34, y: 0.14, z: -0.1, r: 0.2, sy: 0.7, sz: 0.8 },
  ],
];

// --- Trunks ----------------------------------------------------------------

interface TrunkShape extends PropShape {
  /** Tip of the trunk in normalised units (trunk is one unit tall overall). */
  tipX: number;
  tipY: number;
  /** Accumulated lean at the tip, radians — the canopy continues it. */
  tipAngle: number;
  /** Radius of the flared base ring, and how far that ring is already tilted. */
  baseRadius: number;
  baseTilt: number;
}

/**
 * A tapered trunk built as three stacked cylinder sections, each tilted a
 * little further than the last. That gives a real bend (and a knobbly joint
 * silhouette under flat shading) using nothing but transforms.
 *
 * Radii are expressed as a fraction of trunk height, so instances can scale
 * uniformly and keep both the taper and the bend in proportion.
 */
function buildTrunk(baseR: number, topR: number, bend: number, seed: number): TrunkShape {
  const segs = 3;
  const segH = 1 / segs;
  const cursor = new THREE.Matrix4();
  const parts: MergePart[] = [];
  const sources: THREE.BufferGeometry[] = [];
  let tipAngle = 0;
  let baseRadius = baseR;
  let baseTilt = 0;

  const tint: TintFn = (v, out) => {
    sample(BARK_RAMP, 0.6 * clamp01(v.y) + 0.4 * v.lit, out);
  };

  for (let k = 0; k < segs; k++) {
    const remaining = 1 - k / segs;
    const step = bend * (0.3 + 0.28 * remaining) + (hashNoise(seed + k * 3.7) - 0.5) * 0.05;
    tipAngle += step;
    cursor.multiply(new THREE.Matrix4().makeRotationZ(step));

    const rBottom = lerp(baseR, topR, k / segs) * (k === 0 ? 1.18 : 1);
    const rTop = lerp(baseR, topR, (k + 1) / segs);
    if (k === 0) {
      baseRadius = rBottom;
      baseTilt = step;
    }
    const seg = new THREE.CylinderGeometry(rTop, rBottom, segH, 7, 1, false);
    seg.translate(0, segH * 0.5, 0);
    sources.push(seg);
    parts.push({ geo: seg, matrix: cursor.clone(), tint });

    cursor.multiply(new THREE.Matrix4().makeTranslation(0, segH, 0));
  }

  const geo = mergeParts(parts);
  for (const s of sources) s.dispose();

  const tip = new THREE.Vector3().setFromMatrixPosition(cursor);
  return { ...measure(geo), tipX: tip.x, tipY: tip.y, tipAngle, baseRadius, baseTilt };
}

// --- Blades, tufts, flowers -----------------------------------------------

/**
 * One grass blade: a tapered strip folded into a shallow V along its length.
 * The fold is what stops a blade from vanishing when it turns edge-on.
 */
function buildBlade(
  height: number,
  halfWidth: number,
  bend: number,
  fold: number,
  segs: number,
): THREE.BufferGeometry {
  const pos: number[] = [];
  const tri = (
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
    cx: number, cy: number, cz: number,
  ): void => {
    pos.push(ax, ay, az, bx, by, bz, cx, cy, cz);
  };

  const rowAt = (t: number): { c: number; hw: number; y: number; z: number } => {
    const hw = halfWidth * Math.pow(1 - t, 0.7);
    return { c: bend * t * t, hw, y: height * t, z: -fold * hw };
  };

  const rows: { c: number; hw: number; y: number; z: number }[] = [];
  for (let i = 0; i < segs; i++) rows.push(rowAt(i / segs));

  for (let i = 0; i < segs - 1; i++) {
    const a = rows[i];
    const b = rows[i + 1];
    tri(a.c, a.y, 0, a.c + a.hw, a.y, a.z, b.c + b.hw, b.y, b.z);
    tri(a.c, a.y, 0, b.c + b.hw, b.y, b.z, b.c, b.y, 0);
    tri(a.c, a.y, 0, b.c, b.y, 0, b.c - b.hw, b.y, b.z);
    tri(a.c, a.y, 0, b.c - b.hw, b.y, b.z, a.c - a.hw, a.y, a.z);
  }

  const last = rows[segs - 1];
  tri(last.c, last.y, 0, last.c + last.hw, last.y, last.z, bend, height, 0);
  tri(last.c, last.y, 0, bend, height, 0, last.c - last.hw, last.y, last.z);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  return geo;
}

const bladeTint: TintFn = (v, out) => {
  sample(BLADE_RAMP, clamp01(0.78 * clamp01(v.y / 0.9) + 0.22 * v.lit), out);
};

/** Fanned blade cluster, merged into a single mesh. */
function buildTuft(seed: number, blades: number): PropShape {
  const parts: MergePart[] = [];
  const sources: THREE.BufferGeometry[] = [];
  const tallest = pick(seed, 0.05, 0.82, 1.0);

  for (let i = 0; i < blades; i++) {
    const s = seed + i * 4.13;
    const fan = (i / blades) * Math.PI * 2 + pick(s, 0.17, -0.42, 0.42);
    const lean = pick(s, 0.31, 0.16, 0.62);
    const h = tallest * pick(s, 0.53, 0.55, 1.0);
    const blade = buildBlade(h, pick(s, 0.71, 0.075, 0.125), pick(s, 0.87, 0.1, 0.34), 0.55, 3);
    sources.push(blade);
    const matrix = new THREE.Matrix4()
      .makeRotationY(fan)
      .multiply(new THREE.Matrix4().makeRotationZ(-lean));
    parts.push({ geo: blade, matrix, tint: bladeTint });
  }

  const geo = unitHeight(mergeParts(parts));
  for (const s of sources) s.dispose();
  return measure(geo);
}

/** Flat diamond petal, base at the origin, tip at +Y, gently cupped in Z. */
function buildPetal(len: number, wid: number): THREE.BufferGeometry {
  const mx = wid * 0.5;
  const my = len * 0.45;
  const mz = len * 0.1;
  const tz = -len * 0.06;
  const pos = [
    0, 0, 0, mx, my, mz, 0, len, tz,
    0, 0, 0, 0, len, tz, -mx, my, mz,
  ];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  return geo;
}

function buildFlower(seed: number, petalColor: THREE.Color, heart: THREE.BufferGeometry): PropShape {
  const stemH = pick(seed, 0.13, 0.66, 0.86);
  const bend = pick(seed, 0.29, 0.06, 0.2);
  const stem = buildBlade(stemH, 0.024, bend, 0.5, 3);
  const petalLen = pick(seed, 0.41, 0.15, 0.21);
  const petal = buildPetal(petalLen, petalLen * 0.66);
  const petals = 5;

  // Capped at 1×: the shading term darkens toward the shadow side but never
  // amplifies, so a petal is never brighter than its authored colour. The pale
  // variant still sits under the sky's own bloom luma, which is the reference
  // for "bright but not emissive" in this scene.
  const petalTint: TintFn = (v, out) => {
    out.copy(petalColor).multiplyScalar(0.72 + 0.28 * v.lit);
  };
  const heartTint: TintFn = (v, out) => {
    out.copy(FLOWER_HEART).multiplyScalar(0.78 + 0.22 * v.lit);
  };

  const parts: MergePart[] = [{ geo: stem, tint: bladeTint }];
  // Blossom sits on the stem tip, tipped back so it faces the camera and up.
  const head = new THREE.Matrix4()
    .makeTranslation(bend, stemH, 0)
    .multiply(new THREE.Matrix4().makeRotationZ(pick(seed, 0.59, -0.3, 0.3)))
    .multiply(new THREE.Matrix4().makeRotationX(-0.38));

  for (let i = 0; i < petals; i++) {
    const spin = (i / petals) * Math.PI * 2 + pick(seed, 0.67, 0, 1.2);
    parts.push({
      geo: petal,
      matrix: head.clone().multiply(new THREE.Matrix4().makeRotationZ(spin)),
      tint: petalTint,
    });
  }
  parts.push({
    geo: heart,
    matrix: head.clone().multiply(
      new THREE.Matrix4().makeScale(petalLen * 0.3, petalLen * 0.3, petalLen * 0.2),
    ),
    tint: heartTint,
  });

  const geo = unitHeight(mergeParts(parts));
  stem.dispose();
  petal.dispose();
  return measure(geo);
}

// --- Shape palette ---------------------------------------------------------

interface ShapeSet {
  trunks: TrunkShape[];
  canopies: PropShape[];
  bushes: PropShape[];
  tufts: PropShape[];
  flowers: PropShape[];
  rocks: PropShape[];
}

function buildShapes(): ShapeSet {
  const icoHi = new THREE.IcosahedronGeometry(1, 1);
  const icoLo = new THREE.IcosahedronGeometry(1, 0);
  const stone = new THREE.DodecahedronGeometry(1, 0);

  const trunks: TrunkShape[] = [
    buildTrunk(0.074, 0.03, 0.16, 11.2),
    buildTrunk(0.078, 0.032, -0.13, 23.7),
    buildTrunk(0.108, 0.048, 0.22, 37.1),
    buildTrunk(0.056, 0.026, -0.18, 51.9),
  ];

  const canopies = CANOPY_BLOBS.map((blobs, i) =>
    measure(
      mergeParts(blobParts(blobs, massTint(blobs, FOLIAGE_RAMP, 0.46), icoHi, icoLo, 7.3 + i * 5.1)),
    ),
  );

  const bushes = BUSH_BLOBS.map((blobs, i) =>
    measure(
      seat(mergeParts(blobParts(blobs, massTint(blobs, BUSH_RAMP, 0.4), icoHi, icoLo, 61.4 + i * 3.9))),
    ),
  );

  const rocks = ROCK_BLOBS.map((blobs, i) =>
    measure(
      seat(mergeParts(blobParts(blobs, massTint(blobs, ROCK_RAMP, 0.34), stone, stone, 83.6 + i * 4.7))),
    ),
  );

  const tufts = [
    buildTuft(101.3, 7),
    buildTuft(113.9, 6),
    buildTuft(127.1, 8),
    buildTuft(139.7, 5),
  ];

  const flowers = FLOWER_COLORS.map((color, i) => buildFlower(151.3 + i * 6.7, color, icoLo));

  icoHi.dispose();
  icoLo.dispose();
  stone.dispose();

  return { trunks, canopies, bushes, tufts, flowers, rocks };
}

let cachedShapes: ShapeSet | null = null;

/**
 * Build-once palette, mirroring SpriteSheet's `getSheet` registry: these 21
 * merged geometries are shared art (~230 KB of vertex data), so they survive
 * level swaps instead of being re-merged on every load. A ScenerySystem
 * therefore owns only its two materials and its scene graph.
 */
function getShapes(): ShapeSet {
  if (!cachedShapes) cachedShapes = buildShapes();
  return cachedShapes;
}

// --- Wind ------------------------------------------------------------------

interface SwaySpec {
  ampX: number;
  ampZ: number;
  speed: number;
  phase: number;
}

interface SwayNode extends SwaySpec {
  obj: THREE.Object3D;
  restX: number;
  restZ: number;
}

/**
 * Worst-case forward Z a swaying prop adds to its resting footprint, for a prop
 * of the given world height rocking about its base.
 *
 * `rotation.z` is applied in object space (three's default Euler order is XYZ,
 * so Z is innermost), which means the prop's `rotation.y` spin can aim the whole
 * lean straight at the camera; `rotation.x` then tips it forward on top of that.
 * Both are bounded by height × angle, so the sum is a safe envelope.
 */
function swayReach(spec: SwaySpec, height: number): number {
  return (BEND_PEAK * spec.ampZ + spec.ampX) * height;
}

/**
 * How far in from a surface's rear edge a prop's *centre* must stand. Deliberately
 * short of the full reach: leaves overhanging the back lip read as growth, a bare
 * gutter along the rear edge reads as a tray. Only the fringe crosses, by ~0.4×
 * the footprint radius.
 */
function backInset(reach: number): number {
  return Math.max(0.12, reach * 0.6);
}

// --- Trees -----------------------------------------------------------------

type TreeKind = 'tall' | 'bushy' | 'sapling';

interface TreeSpec {
  trunkVariants: readonly number[];
  canopyVariants: readonly number[];
  trunkH: readonly [number, number];
  canopyScale: readonly [number, number];
  canopySquash: readonly [number, number];
  swayAmp: readonly [number, number];
  swaySpeed: readonly [number, number];
  /**
   * Rough world half-width, used only for the flag/spawn readability keep-out,
   * which is about where the *trunk* stands. Collision and crown spacing use the
   * finished tree's measured reach instead.
   */
  nominalReach: number;
}

const TREE_SPECS: Record<TreeKind, TreeSpec> = {
  tall: {
    trunkVariants: [0, 1],
    canopyVariants: [0, 2],
    trunkH: [2.5, 3.3],
    canopyScale: [1.35, 1.75],
    canopySquash: [0.95, 1.15],
    swayAmp: [0.05, 0.085],
    swaySpeed: [0.5, 0.82],
    nominalReach: 1.45,
  },
  bushy: {
    trunkVariants: [2],
    canopyVariants: [1, 3],
    trunkH: [1.45, 1.95],
    canopyScale: [1.2, 1.5],
    canopySquash: [0.82, 0.98],
    swayAmp: [0.055, 0.09],
    swaySpeed: [0.62, 0.95],
    nominalReach: 1.4,
  },
  sapling: {
    trunkVariants: [3],
    canopyVariants: [3, 1],
    trunkH: [1.0, 1.45],
    canopyScale: [0.55, 0.8],
    canopySquash: [0.9, 1.1],
    swayAmp: [0.1, 0.17],
    swaySpeed: [0.95, 1.45],
    nominalReach: 0.62,
  },
};

interface TreeInstance {
  group: THREE.Group;
  sway: SwayNode;
  /** World-space horizontal half-extent, trunk bend and whole-tree lean included. */
  reachX: number;
  /** Forward Z half-extent, wind included — this is what keeps crowns off the run line. */
  reachZ: number;
  /** Total height above the surface, crown tip included. */
  height: number;
  /** Footprint radius of the bole. Undergrowth may sit under the crown, not in the trunk. */
  trunkReach: number;
  /** How far to bed the tree into the ground so no sky shows under the bole. */
  sink: number;
}

function makeTree(
  kind: TreeKind,
  seed: number,
  shapes: ShapeSet,
  material: THREE.Material,
): TreeInstance {
  const spec = TREE_SPECS[kind];
  const trunk = shapes.trunks[pickIndex(seed, 0.07, spec.trunkVariants)];
  const canopy = shapes.canopies[pickIndex(seed, 0.19, spec.canopyVariants)];

  const trunkH = pick(seed, 0.23, spec.trunkH[0], spec.trunkH[1]);
  const crown = pick(seed, 0.37, spec.canopyScale[0], spec.canopyScale[1]);
  const squash = pick(seed, 0.43, spec.canopySquash[0], spec.canopySquash[1]);
  const lean = pick(seed, 0.51, -0.055, 0.055);

  const group = new THREE.Group();
  group.name = `Tree_${kind}`;
  // A whole-tree lean, plus a mirror flip via rotation.y so scale stays positive
  // (a negative scale would invert winding and turn the crown inside out).
  group.rotation.z = lean;
  if (hashNoise(seed + 0.61) < 0.5) group.rotation.y = Math.PI;

  const trunkMesh = new THREE.Mesh(trunk.geo, material);
  trunkMesh.scale.setScalar(trunkH);
  trunkMesh.castShadow = true;
  trunkMesh.receiveShadow = true;
  group.add(trunkMesh);

  // Pivot at the trunk tip: bending it bends the entire crown, no vertex work.
  const pivotX = trunk.tipX * trunkH;
  const pivotY = trunk.tipY * trunkH;
  const pivotTilt = trunk.tipAngle * 0.5;
  const pivot = new THREE.Group();
  pivot.position.set(pivotX, pivotY, 0);
  pivot.rotation.z = pivotTilt;
  group.add(pivot);

  const canopyMesh = new THREE.Mesh(canopy.geo, material);
  canopyMesh.scale.set(crown, crown * squash, crown);
  // Sink the crown so its lower masses swallow the trunk tip.
  canopyMesh.position.y = -0.24 * crown;
  canopyMesh.castShadow = true;
  canopyMesh.receiveShadow = true;
  pivot.add(canopyMesh);

  const sway: SwayNode = {
    obj: pivot,
    restX: 0,
    restZ: pivotTilt,
    ampX: pick(seed, 0.73, 0.012, 0.03),
    ampZ: pick(seed, 0.79, spec.swayAmp[0], spec.swayAmp[1]),
    speed: pick(seed, 0.83, spec.swaySpeed[0], spec.swaySpeed[1]),
    phase: hashNoise(seed + 0.89) * Math.PI * 2,
  };

  // Crown extents are measured *from the pivot*, so everything the pivot adds
  // ends up in the reported reach: the trunk's sideways bend (pivotX), the tilt
  // it hands the crown, and the whole-tree lean. Reporting the bare canopy
  // half-width instead understates a bent tall tree's footprint by ~0.7 units.
  const crownTop = crown * (canopy.top * squash - 0.24);
  const crownX = canopy.reachX * crown;
  const crownZ = canopy.reachZ * crown;
  const height = pivotY + crownTop;
  // Rest tilt *plus* the gust. rotation.z is the axis a gale actually swings, and
  // it moves the crown in X only — dropping it understated a tall tree's X
  // footprint by ~0.2 units, while reachZ below already folds in its own wind term.
  const tiltSwing =
    (Math.abs(Math.sin(pivotTilt)) + Math.sin(BEND_PEAK * sway.ampZ)) * crownTop;

  return {
    group,
    sway,
    trunkReach: trunk.reachX * trunkH,
    // The base ring is already tilted by the first bend and by the whole-tree
    // lean, so its high side stands clear of the ground. Bury exactly that much:
    // a 2px sliver of sky under a trunk is the loudest "prop pasted on the
    // surface" tell there is, and the flare keeps the buried part invisible.
    sink: Math.max(0.02, trunk.baseRadius * trunkH * Math.abs(Math.sin(trunk.baseTilt + lean))),
    reachX:
      Math.max(Math.abs(pivotX) + crownX + tiltSwing, trunk.reachX * trunkH) +
      Math.abs(Math.sin(lean)) * height,
    // Neither the lean nor the pivot's rotation.z touches Z (the group's only
    // Y rotation is a 180° mirror, which leaves |z| alone); the pivot's
    // rotation.x sway is the sole forward excursion.
    reachZ: crownZ + Math.hypot(crownX, crownTop) * sway.ampX,
    height,
  };
}

// --- Placement -------------------------------------------------------------

interface Surface {
  x0: number;
  x1: number;
  y: number;
  /** World Z of the surface's rear face. */
  zBack: number;
  depth: number;
  width: number;
  /** 1 = grass, lower for drier ground — thins every prop count. */
  lush: number;
  seed: number;
  /** Index of the PlatformDef this surface came from. */
  source: number;
}

function surfaceOf(p: PlatformDef, index: number): Surface | null {
  const kind = p.kind ?? 'platform';
  if (kind !== 'ground' && kind !== 'platform' && kind !== 'ledge') return null;
  if (p.solid === false) return null;

  const style = p.style ?? (kind === 'ground' ? 'grass' : 'stone');
  if (style !== 'grass' && style !== 'dirt') return null;

  const depth = p.depth ?? WORLD.platformDepth * 0.55;
  if (depth < MIN_PROP_DEPTH || p.w < 1.6) return null;

  const z = p.z ?? 0;
  return {
    x0: p.x - p.w * 0.5,
    x1: p.x + p.w * 0.5,
    y: p.y,
    zBack: z - depth * 0.5,
    depth,
    width: p.w,
    lush: style === 'dirt' ? 0.55 : 1,
    seed: index * 17.31 + p.x * 0.911 + p.y * 0.577,
    source: index,
  };
}

interface KeepOut {
  x: number;
  r: number;
}

function blocked(x: number, clearance: number, zones: readonly KeepOut[]): boolean {
  for (const zone of zones) {
    if (Math.abs(x - zone.x) < zone.r + clearance) return true;
  }
  return false;
}

/** Resting XZ footprint of a prop already standing on this surface. */
interface Footprint {
  x: number;
  z: number;
  r: number;
}

/**
 * Each category walks its own slot grid, so nothing on its own stops a flower
 * from landing dead centre in a bush or a tuft from sprouting out of a rock.
 *
 * The test is deliberately loose: a spot is rejected only when the *larger* of
 * the two footprints would swallow the other's centre. Fringes may still
 * interleave — grass crowding the skirt of a bush is exactly what the field
 * wants — but no prop ends up buried inside another.
 */
function buried(taken: readonly Footprint[], x: number, z: number, r: number): boolean {
  for (const t of taken) {
    const limit = Math.max(t.r, r) * 0.85;
    const dx = x - t.x;
    const dz = z - t.z;
    if (dx * dx + dz * dz < limit * limit) return true;
  }
  return false;
}

/**
 * Every platform in the level as an X/Y footprint plus how far back it reaches.
 * A tree is rejected only when a body actually shares its X, Y *and* Z span —
 * the usual case of a block or pipe standing at z = 0 in front of a tree parked
 * at the back of the strip is not a conflict, it is depth.
 */
interface Obstruction {
  x0: number;
  x1: number;
  yLo: number;
  yHi: number;
  zBack: number;
  zFront: number;
  source: number;
}

function obstructionOf(p: PlatformDef, index: number): Obstruction {
  const kind = p.kind ?? 'platform';
  // Mirrors LevelLoader: pipes are cylinders sized off p.w and ignore p.depth;
  // blocks (kind 'block' *or* the question style, same as LevelLoader's branch)
  // are cubes of max(w, h) hanging from p.y, clamped in depth.
  const isPipe = kind === 'pipe';
  const isBlock = kind === 'block' || p.style === 'question';
  const nominalDepth = p.depth ?? WORLD.platformDepth * 0.55;
  const size = isPipe ? p.w * 1.15 : isBlock ? Math.max(p.w, p.h) : p.w;
  const depth = isPipe
    ? p.w * 1.15
    : isBlock
      ? Math.min(nominalDepth, size * 1.1)
      : nominalDepth;
  const z = p.z ?? 0;
  return {
    x0: p.x - size * 0.5,
    x1: p.x + size * 0.5,
    // A block's body is as tall as it is wide, so p.h alone can understate it.
    yLo: p.y - (isBlock ? size : p.h),
    yHi: p.y,
    zBack: z - depth * 0.5,
    zFront: z + depth * 0.5,
    source: index,
  };
}

function intersects(
  bodies: readonly Obstruction[],
  self: number,
  x0: number,
  x1: number,
  yLo: number,
  yHi: number,
  zBack: number,
  zFront: number,
): boolean {
  for (const b of bodies) {
    if (b.source === self) continue;
    if (b.x1 <= x0 || b.x0 >= x1) continue;
    if (b.yHi <= yLo || b.yLo >= yHi) continue;
    if (b.zFront <= zBack || b.zBack >= zFront) continue;
    return true;
  }
  return false;
}

/** Even slots across the span with bounded jitter, so props never bunch up. */
function slotX(
  x0: number,
  x1: number,
  i: number,
  count: number,
  seed: number,
  jitter: number,
): number {
  const span = x1 - x0;
  if (span <= 0 || count <= 0) return (x0 + x1) * 0.5;
  const step = span / count;
  const base = x0 + step * (i + 0.5) + (hashNoise(seed) - 0.5) * step * jitter;
  return Math.min(x1, Math.max(x0, base));
}

function countFor(width: number, lush: number, per: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(width * per * lush)));
}

// --- System ----------------------------------------------------------------

export function createScenery(def: LevelDef, parent?: THREE.Object3D): ScenerySystem {
  const root = new THREE.Group();
  root.name = 'Scenery';

  const foliageMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    roughness: 0.88,
    metalness: 0,
  });
  const bladeMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    roughness: 0.9,
    metalness: 0,
    side: THREE.DoubleSide,
  });

  const shapes = getShapes();
  const sway: SwayNode[] = [];

  const smallKeepOut: KeepOut[] = [
    { x: def.goal.x, r: 1.3 },
    { x: def.spawn.x, r: 1.1 },
  ];
  // Trees are landmarks too, so they give the flag and the spawn a wider berth.
  const treeKeepOut: KeepOut[] = [
    { x: def.goal.x, r: 1.9 },
    { x: def.spawn.x, r: 1.5 },
  ];

  const surfaces: Surface[] = [];
  const bodies: Obstruction[] = [];
  let index = 0;
  for (const p of def.platforms) {
    index++;
    bodies.push(obstructionOf(p, index));
    const surface = surfaceOf(p, index);
    if (surface) surfaces.push(surface);
  }

  const addProp = (
    name: string,
    shape: PropShape,
    material: THREE.Material,
    scale: THREE.Vector3,
    castShadow: boolean,
  ): THREE.Mesh => {
    const mesh = new THREE.Mesh(shape.geo, material);
    mesh.name = name;
    mesh.scale.copy(scale);
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    root.add(mesh);
    return mesh;
  };

  /**
   * Deepest-to-frontmost Z band a prop may occupy. `frontReach` must already
   * include the prop's wind excursion — that is what makes PLAY_CLEAR_Z a bound
   * rather than a hope.
   */
  const zBand = (
    surface: Surface,
    frontReach: number,
    rearInset: number,
    depthFraction: number,
  ): { lo: number; hi: number } | null => {
    const lo = surface.zBack + rearInset;
    const hi = Math.min(
      surface.zBack + surface.depth * depthFraction,
      PLAY_CLEAR_Z - frontReach - SWAY_SLACK,
    );
    return hi < lo ? null : { lo, hi };
  };

  /**
   * A z inside the band that does not bury this prop in one already standing.
   * The first try reproduces the unconstrained placement, so only props that
   * actually clash move. Four tries, then drop it — a thinner field beats a
   * flower growing out of a rock.
   */
  const freeZ = (
    band: { lo: number; hi: number },
    taken: readonly Footprint[],
    x: number,
    r: number,
    seed: number,
  ): number | null => {
    for (let k = 0; k < 4; k++) {
      const z = lerp(band.lo, band.hi, hashNoise(seed + k * 1.37));
      if (!buried(taken, x, z, r)) return z;
    }
    return null;
  };

  for (const surface of surfaces) {
    /** Everything already standing on this surface, biggest categories first. */
    const taken: Footprint[] = [];

    // —— Trees ——
    if (surface.width >= MIN_TREE_WIDTH && surface.depth >= MIN_TREE_DEPTH) {
      const count = countFor(surface.width, surface.lush, 0.34, 1, 5);
      const x0 = surface.x0 + 0.8;
      const x1 = surface.x1 - 0.8;
      /** Trees already standing on this surface — crowns may touch, not stack. */
      const standing: KeepOut[] = [];
      for (let i = 0; i < count; i++) {
        const seed = surface.seed + 3.3 + i * 11.7;
        const x = slotX(x0, x1, i, count, seed + 0.03, 0.42);
        const roll = hashNoise(seed + 0.13);
        const kind: TreeKind = roll < 0.5 ? 'tall' : roll < 0.82 ? 'bushy' : 'sapling';
        if (blocked(x, TREE_SPECS[kind].nominalReach * 0.4, treeKeepOut)) continue;

        // Built before the remaining tests because only the finished tree knows
        // its true crown reach.
        const tree = makeTree(kind, seed, shapes, foliageMat);
        const band = zBand(surface, tree.reachZ, 0.4, 0.32);
        if (!band) continue;
        // Crowns may interleave into a copse, but not sit inside one another.
        if (blocked(x, tree.reachX * 0.5, standing)) continue;
        const z = lerp(band.lo, band.hi, hashNoise(seed + 0.47));
        if (
          intersects(
            bodies,
            surface.source,
            x - tree.reachX,
            x + tree.reachX,
            surface.y + 0.05,
            surface.y + tree.height,
            z - tree.reachZ,
            z + tree.reachZ,
          )
        ) {
          continue;
        }
        tree.group.position.set(x, surface.y - tree.sink, z);
        root.add(tree.group);
        sway.push(tree.sway);
        standing.push({ x, r: tree.reachX * 0.5 });
        taken.push({ x, z, r: tree.trunkReach });
      }
    }

    // —— Bushes ——
    {
      const count = countFor(surface.width, surface.lush, 0.24, 1, 4);
      for (let i = 0; i < count; i++) {
        const seed = surface.seed + 41.7 + i * 8.3;
        const x = slotX(surface.x0 + 0.5, surface.x1 - 0.5, i, count, seed + 0.03, 0.8);
        const shape = shapes.bushes[pickIndex(seed, 0.11, [0, 1, 2])];
        const s = pick(seed, 0.19, 0.8, 1.35);
        const squash = pick(seed, 0.27, 0.85, 1.15);
        const stretchZ = pick(seed, 0.33, 0.85, 1.05);
        // Props spin freely about Y, so the footprint radius is the reach.
        const reach = shape.radiusXZ * s * Math.max(1, stretchZ);
        const height = shape.top * s * squash;
        const spec: SwaySpec = {
          ampX: pick(seed, 0.61, 0.015, 0.035),
          ampZ: pick(seed, 0.67, 0.05, 0.095),
          speed: pick(seed, 0.71, 0.85, 1.35),
          phase: hashNoise(seed + 0.77) * Math.PI * 2,
        };
        if (blocked(x, reach * 0.6, smallKeepOut)) continue;
        const band = zBand(surface, reach + swayReach(spec, height), backInset(reach), 0.6);
        if (!band) continue;
        const z = freeZ(band, taken, x, reach, seed + 0.53);
        if (z === null) continue;

        const mesh = addProp(
          'Bush',
          shape,
          foliageMat,
          new THREE.Vector3(s, s * squash, s * stretchZ),
          true,
        );
        // Full spin: three bush silhouettes only read as many if they turn.
        mesh.rotation.y = pick(seed, 0.39, -Math.PI, Math.PI);
        mesh.position.set(x, surface.y - 0.05 * s, z);
        sway.push({ obj: mesh, restX: 0, restZ: 0, ...spec });
        taken.push({ x, z, r: reach });
      }
    }

    // —— Grass tufts ——
    {
      const count = countFor(surface.width, surface.lush, 0.85, 3, 14);
      for (let i = 0; i < count; i++) {
        const seed = surface.seed + 91.1 + i * 5.9;
        const x = slotX(surface.x0 + 0.25, surface.x1 - 0.25, i, count, seed + 0.03, 0.9);
        const shape = shapes.tufts[pickIndex(seed, 0.11, [0, 1, 2, 3])];
        const s = pick(seed, 0.17, 0.3, 0.52);
        const reach = shape.radiusXZ * s;
        const spec: SwaySpec = {
          ampX: pick(seed, 0.31, 0.03, 0.07),
          ampZ: pick(seed, 0.37, 0.1, 0.2),
          speed: pick(seed, 0.41, 1.4, 2.3),
          phase: hashNoise(seed + 0.43) * Math.PI * 2,
        };
        if (blocked(x, reach, smallKeepOut)) continue;
        const band = zBand(surface, reach + swayReach(spec, shape.top * s), backInset(reach), 0.66);
        if (!band) continue;
        const z = freeZ(band, taken, x, reach, seed + 0.29);
        if (z === null) continue;

        const mesh = addProp('Tuft', shape, bladeMat, new THREE.Vector3(s, s, s), false);
        mesh.rotation.y = pick(seed, 0.23, -Math.PI, Math.PI);
        mesh.position.set(x, surface.y - 0.015, z);
        sway.push({ obj: mesh, restX: 0, restZ: 0, ...spec });
        taken.push({ x, z, r: reach });
      }
    }

    // —— Flowers ——
    {
      const count = countFor(surface.width, surface.lush, 0.3, 1, 5);
      for (let i = 0; i < count; i++) {
        const seed = surface.seed + 137.3 + i * 6.7;
        const x = slotX(surface.x0 + 0.35, surface.x1 - 0.35, i, count, seed + 0.03, 0.95);
        const shape = shapes.flowers[pickIndex(seed, 0.11, [0, 1, 2])];
        const s = pick(seed, 0.17, 0.3, 0.46);
        const reach = shape.radiusXZ * s;
        const spec: SwaySpec = {
          ampX: pick(seed, 0.31, 0.03, 0.08),
          ampZ: pick(seed, 0.37, 0.12, 0.22),
          speed: pick(seed, 0.41, 1.6, 2.5),
          phase: hashNoise(seed + 0.43) * Math.PI * 2,
        };
        if (blocked(x, reach, smallKeepOut)) continue;
        const band = zBand(surface, reach + swayReach(spec, shape.top * s), backInset(reach), 0.62);
        if (!band) continue;
        const z = freeZ(band, taken, x, reach, seed + 0.29);
        if (z === null) continue;

        const mesh = addProp('Flower', shape, bladeMat, new THREE.Vector3(s, s, s), false);
        // Kept near-frontal: the blossom is a flat rosette that faces the camera.
        mesh.rotation.y = pick(seed, 0.23, -0.6, 0.6);
        mesh.position.set(x, surface.y - 0.01, z);
        sway.push({ obj: mesh, restX: 0, restZ: 0, ...spec });
        taken.push({ x, z, r: reach });
      }
    }

    // —— Rocks ——
    {
      const count = countFor(surface.width, 1, 0.13, 0, 2);
      for (let i = 0; i < count; i++) {
        const seed = surface.seed + 181.9 + i * 9.1;
        const x = slotX(surface.x0 + 0.4, surface.x1 - 0.4, i, count, seed + 0.03, 0.85);
        const shape = shapes.rocks[pickIndex(seed, 0.11, [0, 1, 2])];
        const s = pick(seed, 0.17, 0.24, 0.5);
        const flatten = pick(seed, 0.23, 0.7, 1.1);
        const stretchZ = pick(seed, 0.29, 0.85, 1.1);
        const tiltX = pick(seed, 0.31, -0.12, 0.12);
        const tiltZ = pick(seed, 0.41, -0.1, 0.1);
        // Rocks never sway; the only forward slack is the bedding tilt (rotation.z
        // is inside the Y spin, so it leans forward just as rotation.x does).
        const reach =
          shape.radiusXZ * s * Math.max(1, stretchZ) +
          (Math.abs(Math.sin(tiltX)) + Math.abs(Math.sin(tiltZ))) * shape.top * s * flatten;
        if (blocked(x, reach, smallKeepOut)) continue;
        const band = zBand(surface, reach, backInset(reach), 0.58);
        if (!band) continue;
        const z = freeZ(band, taken, x, reach, seed + 0.47);
        if (z === null) continue;

        const mesh = addProp(
          'Rock',
          shape,
          foliageMat,
          new THREE.Vector3(s, s * flatten, s * stretchZ),
          true,
        );
        mesh.rotation.set(tiltX, pick(seed, 0.37, -Math.PI, Math.PI), tiltZ);
        mesh.position.set(x, surface.y - 0.06 * s, z);
        taken.push({ x, z, r: reach });
        // Static prop: freeze its matrix so the per-frame walk skips it.
        mesh.updateMatrix();
        mesh.matrixAutoUpdate = false;
      }
    }
  }

  parent?.add(root);

  let disposed = false;

  return {
    root,
    update(elapsed: number) {
      if (disposed) return;
      // One shared gust envelope keeps the field breathing together while the
      // per-instance phase stops it from pulsing in unison.
      const gust = 0.72 + 0.28 * Math.sin(elapsed * 0.43);
      for (const node of sway) {
        const t = elapsed * node.speed + node.phase;
        const bend = (Math.sin(t) + 0.32 * Math.sin(t * 2.3 + 1.1)) * gust;
        node.obj.rotation.z = node.restZ + bend * node.ampZ;
        node.obj.rotation.x = node.restX + Math.sin(t * 0.79 + 2.1) * node.ampX * gust;
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      // The 21 merged geometries belong to the process-wide palette (getShapes)
      // and outlive every level, exactly like a cached SpriteSheet. Only the
      // materials and the scene graph are this system's to release.
      foliageMat.dispose();
      bladeMat.dispose();
      sway.length = 0;
      root.clear();
      root.removeFromParent();
    },
  };
}
