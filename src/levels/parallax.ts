/**
 * Layered parallax backdrop for the 2.5D frame.
 *
 * Every layer is a flat, unlit painted plate on a fixed Z plane: extruded
 * ridgeline silhouettes for the hills, merged puffs for the clouds, and a dark
 * fringe in front of the play plane. Plate content is periodic and wrapped
 * around the camera every frame, so coverage never depends on level length.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CAMERA, COLORS } from '../game/config';
import { parseColor } from '../render/paint';

export interface ParallaxLayer {
  group: THREE.Group;
  /**
   * World follow factor: `group.x = baseX + cameraX * (1 - factor)`.
   * 0 = locked to the camera (infinitely far), 1 = world-fixed, > 1 = sweeps
   * against the camera (foreground). This is *not* the on-screen scroll rate —
   * perspective already scales motion by cameraZ / distance, so a world-fixed
   * plate at z -52 already crawls. See `screenRateToFactor`.
   */
  factor: number;
  /** Base world X of the layer content when the camera is at 0. */
  baseX: number;
}

export interface ParallaxSystem {
  root: THREE.Group;
  layers: ParallaxLayer[];
  /** `elapsed` (seconds) is optional; cloud drift only advances when given. */
  update(cameraX: number, elapsed?: number): void;
  dispose(): void;
}

/** Widest aspect ratio the backdrop is sized for, so ultrawide never runs dry. */
const DESIGN_ASPECT = 2.4;
/** Ridge tiles are this much wider than the frame — sets the repeat distance. */
const RIDGE_TILE_OVERSHOOT = 1.5;
/** Two tiles per ridge: guarantees a full frame of cover through every wrap. */
const RIDGE_TILES = 2;
/** Extrusion depth of a silhouette plate; only the front cap is ever seen. */
const PLATE_DEPTH = 2;
/** How far a plate's skirt reaches below its own silhouette band. */
const PLATE_SKIRT = 24;
/** Distinct puff / fringe shapes per layer, shared between instances. */
const SHAPE_VARIANTS = 3;

const HALF_FOV = THREE.MathUtils.degToRad(CAMERA.fov) * 0.5;

type LayerKind = 'ridge' | 'clouds' | 'fringe';

interface RidgeSpec {
  /** Summed-sine crest amplitudes, largest first (world units). */
  amps: [number, number, number];
  /** Target wavelength for each amplitude (world units). */
  waves: [number, number, number];
  /** Ridgeline samples per world unit. */
  samplesPerUnit: number;
}

interface CloudSpec {
  /** Nominal puff radius multiplier. */
  scale: number;
  /** Average X spacing between puffs (world units). */
  spread: number;
  /** Horizontal drift speed (world units per second). */
  drift: number;
}

interface FringeSpec {
  spread: number;
  /** Silhouette width and mound height at scale 1. */
  width: number;
  height: number;
}

interface LayerSpec {
  name: string;
  kind: LayerKind;
  /** Plate plane Z. Negative sits behind the play plane, positive in front. */
  z: number;
  /** Anchor Y: ridge mean height, cloud band centre, fringe crest. */
  y: number;
  /** Intended on-screen scroll rate, 1 = the play plane at z 0. */
  rate: number;
  /**
   * Plate colour, used verbatim at the crest. The depth progression itself
   * belongs to the COLORS ridge ramp and to scene fog, so nothing here washes
   * a layer further than its own base.
   */
  color: number;
  /** Wash at the plate's base — aerial perspective near the horizon. */
  haze: number;
  /** Defaults to the sky at the horizon. */
  hazeTarget?: number;
  /** Per-element Y scatter, +/- this many units. */
  yJitter?: number;
  ridge?: RidgeSpec;
  clouds?: CloudSpec;
  fringe?: FringeSpec;
}

/**
 * Mix two packed sRGB colours and stay packed. `paint.mixColor` returns a CSS
 * `rgb(...)` string that `paint.parseColor` cannot read back — it falls through
 * to magenta — so a derived colour must never be fed into a second mix. Layer
 * colours stay numbers end to end.
 */
function mixHex(color: number, target: number, t: number): number {
  const a = parseColor(color);
  const b = parseColor(target);
  const k = Math.min(1, Math.max(0, t));
  const ch = (lo: number, hi: number): number =>
    Math.max(0, Math.min(255, Math.round(lo + (hi - lo) * k)));
  return (ch(a.r, b.r) << 16) | (ch(a.g, b.g) << 8) | ch(a.b, b.b);
}

/** Mid-far ridges sit between two palette stops instead of a hardcoded green. */
const HILL_MID_FAR = mixHex(COLORS.hillMid, COLORS.hillFar, 0.55);
/** Foreground fringe: the near-hill green crushed almost to black. */
const FRINGE_DARK = mixHex(COLORS.hillNear, 0x121a1e, 0.8);

const DEFAULT_SPECS: LayerSpec[] = [
  {
    name: 'ParallaxFar',
    kind: 'ridge',
    z: -52,
    y: 1.4,
    rate: 0.11,
    color: COLORS.hillFar,
    haze: 0.34,
    ridge: { amps: [4.8, 2.2, 1.0], waves: [58, 24, 11], samplesPerUnit: 4 },
  },
  {
    name: 'ParallaxMidFar',
    kind: 'ridge',
    z: -38,
    y: 0.6,
    rate: 0.2,
    color: HILL_MID_FAR,
    haze: 0.32,
    ridge: { amps: [3.1, 1.4, 0.7], waves: [46, 19, 9], samplesPerUnit: 4 },
  },
  {
    name: 'ParallaxMid',
    kind: 'ridge',
    z: -26,
    y: 0.05,
    rate: 0.3,
    color: COLORS.hillMid,
    haze: 0.3,
    ridge: { amps: [2.2, 1.0, 0.5], waves: [36, 15, 7], samplesPerUnit: 5 },
  },
  {
    name: 'ParallaxNear',
    kind: 'ridge',
    z: -12,
    y: -0.6,
    rate: 0.46,
    color: COLORS.hillNear,
    haze: 0.26,
    ridge: { amps: [1.9, 0.85, 0.42], waves: [26, 11, 5], samplesPerUnit: 5 },
  },
  {
    name: 'ParallaxCloudsFar',
    kind: 'clouds',
    z: -44,
    y: 13,
    rate: 0.06,
    color: 0xffffff,
    haze: 1,
    hazeTarget: 0xcfe0f2,
    yJitter: 1.8,
    clouds: { scale: 1.45, spread: 30, drift: 0.42 },
  },
  {
    name: 'ParallaxClouds',
    kind: 'clouds',
    z: -32,
    y: 10,
    rate: 0.13,
    color: 0xffffff,
    haze: 1,
    hazeTarget: 0xcfe0f2,
    yJitter: 1.4,
    clouds: { scale: 1.15, spread: 24, drift: 0.62 },
  },
  {
    name: 'ParallaxFringe',
    kind: 'fringe',
    z: 4.2,
    // The camera sits 4.05 above the play plane and only 7.8 from this plane, so
    // a crest at -0.55 projects to ndc.y -0.98..-1.13 — entirely off the bottom
    // edge. -0.34 hems the frame at ndc.y -0.94..-1.05 while still clearing the
    // ground strip's front-face top edge (-0.71) and the player's feet (-0.45).
    y: -0.34,
    rate: 1.5,
    color: FRINGE_DARK,
    haze: 0.16,
    hazeTarget: 0x0d1116,
    yJitter: 0.18,
    fringe: { spread: 30, width: 2, height: 1.9 },
  },
];

interface Ramp {
  top: THREE.Color;
  bottom: THREE.Color;
}

/** One wrapped instance of a plate shape. */
interface ParallaxElement {
  object: THREE.Object3D;
  /** X in the layer's own content space, before drift and wrapping. */
  baseX: number;
}

interface LayerRuntime {
  layer: ParallaxLayer;
  elements: ParallaxElement[];
  /** Content-space wrap period. */
  period: number;
  /** Horizontal drift speed (units per second); 0 for static plates. */
  drift: number;
}

/** Distance from the camera plane to a layer's plane. */
function planeDistance(z: number): number {
  return CAMERA.offset.z - z;
}

/** Visible world height at a layer's depth. */
function frameHeightAt(z: number): number {
  return 2 * planeDistance(z) * Math.tan(HALF_FOV);
}

/** Visible world width at a layer's depth, on the widest supported aspect. */
function frameWidthAt(z: number): number {
  return frameHeightAt(z) * DESIGN_ASPECT;
}

/**
 * Convert an intended on-screen scroll rate (1 = the play plane) into the world
 * follow factor. Perspective alone already scrolls a world-fixed plate at
 * cameraZ / distance, so the factor divides that head start back out.
 */
function screenRateToFactor(rate: number, z: number): number {
  return (rate * planeDistance(z)) / CAMERA.offset.z;
}

/** Deterministic PRNG (mulberry32) so a layer's layout is identical every run. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable 32-bit hash of a layer name — seeds that layer's PRNG. */
function seedFromName(name: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) {
    h = Math.imul(h ^ name.charCodeAt(i), 0x01000193);
  }
  return h >>> 0;
}

/** Palette-derived top and base colours for a plate's vertical ramp. */
function plateRamp(spec: LayerSpec): Ramp {
  const target = spec.hazeTarget ?? COLORS.skyHorizon;
  return {
    top: new THREE.Color(spec.color),
    bottom: new THREE.Color(mixHex(spec.color, target, spec.haze)),
  };
}

/**
 * Bake a vertical colour ramp into vertex colours. Aerial perspective that
 * survives independently of fog tuning; y outside [y0, y1] clamps to an end.
 */
function applyVerticalRamp(
  geometry: THREE.BufferGeometry,
  ramp: Ramp,
  y0?: number,
  y1?: number,
): void {
  const pos = geometry.getAttribute('position');
  let lo = y0 ?? Number.POSITIVE_INFINITY;
  let hi = y1 ?? Number.NEGATIVE_INFINITY;
  if (y0 === undefined || y1 === undefined) {
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      if (y < lo) lo = y;
      if (y > hi) hi = y;
    }
  }
  const span = Math.max(1e-4, hi - lo);
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const t = Math.min(1, Math.max(0, (pos.getY(i) - lo) / span));
    c.copy(ramp.bottom).lerp(ramp.top, t);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

/** Unlit plate material — backdrop reads as paint, not as lit geometry. */
function plateMaterial(name: string): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    vertexColors: true,
    fog: true,
  });
  material.name = `${name}Mat`;
  return material;
}

function plateMesh(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  name: string,
): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  // Backdrop plates can neither meaningfully cast nor receive shadows.
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  return mesh;
}

/**
 * One extruded ridgeline silhouette per layer, tiled twice.
 *
 * The three sine harmonics are integer multiples of the tile width, so the
 * ridgeline is exactly periodic: tiles join seamlessly and the modulo wrap in
 * update() cannot show a seam or a pop.
 */
function buildRidge(
  spec: LayerSpec,
  ridge: RidgeSpec,
  material: THREE.Material,
  ramp: Ramp,
  rng: () => number,
  centerX: number,
): { elements: ParallaxElement[]; period: number; geometry: THREE.BufferGeometry } {
  const tile = frameWidthAt(spec.z) * RIDGE_TILE_OVERSHOOT;
  const half = tile * 0.5;
  const floorY = -(frameHeightAt(spec.z) * 0.5 + PLATE_SKIRT);
  const [a1, a2, a3] = ridge.amps;
  const k1 = harmonic(tile, ridge.waves[0]);
  const k2 = harmonic(tile, ridge.waves[1]);
  const k3 = harmonic(tile, ridge.waves[2]);
  const p1 = rng() * Math.PI * 2;
  const p2 = rng() * Math.PI * 2;
  const p3 = rng() * Math.PI * 2;
  const crestAt = (x: number): number =>
    a1 * Math.sin(k1 * x + p1) +
    a2 * Math.sin(k2 * x + p2) +
    a3 * Math.sin(k3 * x + p3);

  const steps = Math.max(16, Math.round(tile * ridge.samplesPerUnit));
  const shape = new THREE.Shape();
  shape.moveTo(-half, floorY);
  let lowest = Number.POSITIVE_INFINITY;
  let highest = Number.NEGATIVE_INFINITY;
  for (let i = 0; i <= steps; i++) {
    const x = -half + (tile * i) / steps;
    const y = crestAt(x);
    if (y < lowest) lowest = y;
    if (y > highest) highest = y;
    shape.lineTo(x, y);
  }
  shape.lineTo(half, floorY);
  shape.closePath();

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: PLATE_DEPTH,
    bevelEnabled: false,
  });
  // Put the front cap exactly on the layer plane.
  geometry.translate(0, 0, -PLATE_DEPTH);
  // Ramp across the realized crest band: summits keep the palette colour, the
  // valleys and everything below them sit in haze.
  applyVerticalRamp(geometry, ramp, lowest, highest);

  const elements: ParallaxElement[] = [];
  for (let i = 0; i < RIDGE_TILES; i++) {
    const mesh = plateMesh(geometry, material, `${spec.name}Tile${i}`);
    const baseX = centerX + (i - (RIDGE_TILES - 1) / 2) * tile;
    mesh.position.set(baseX, spec.y, 0);
    elements.push({ object: mesh, baseX });
  }
  return { elements, period: RIDGE_TILES * tile, geometry };
}

/** Nearest integer harmonic of `tile` to the desired wavelength. */
function harmonic(tile: number, wavelength: number): number {
  const n = Math.max(1, Math.round(tile / wavelength));
  return (Math.PI * 2 * n) / tile;
}

const CLOUD_LUMPS: ReadonlyArray<readonly [number, number, number, number]> = [
  [0, 0, 0, 1],
  [0.9, 0.15, 0.1, 0.75],
  [-0.85, 0.1, -0.05, 0.7],
  [0.2, 0.45, 0, 0.65],
];

/** Four spheres merged into a single puff, lit only by its baked ramp. */
function createCloudGeometry(rng: () => number, ramp: Ramp): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const [lx, ly, lz, lr] of CLOUD_LUMPS) {
    const sphere = new THREE.SphereGeometry(1.1 * lr * (0.86 + rng() * 0.28), 10, 8);
    sphere.translate(lx + (rng() * 2 - 1) * 0.18, ly + (rng() * 2 - 1) * 0.12, lz);
    parts.push(sphere);
  }
  const merged = mergeGeometries(parts);
  for (const part of parts) part.dispose();
  applyVerticalRamp(merged, ramp);
  return merged;
}

/**
 * Lumpy silhouette mound: crest at local y 0 so per-instance Y scaling only
 * changes its bulk, with a skirt reaching far below the frame.
 */
function createFringeGeometry(
  rng: () => number,
  fringe: FringeSpec,
  ramp: Ramp,
): THREE.BufferGeometry {
  const half = fringe.width * 0.5;
  const wobble1 = rng() * Math.PI * 2;
  const wobble2 = rng() * Math.PI * 2;
  const steps = 26;
  const profile: number[] = [];
  let peak = 1e-4;
  for (let i = 0; i <= steps; i++) {
    const u = -1 + (2 * i) / steps;
    const bump = Math.cos(u * Math.PI * 0.5) ** 1.35;
    const lumps =
      1 + 0.2 * Math.sin(u * 6.3 + wobble1) + 0.11 * Math.sin(u * 11.7 + wobble2);
    const v = Math.max(0, bump * lumps);
    profile.push(v);
    if (v > peak) peak = v;
  }

  const skirt = -(fringe.height + PLATE_SKIRT);
  const shape = new THREE.Shape();
  shape.moveTo(-half, skirt);
  for (let i = 0; i <= steps; i++) {
    const u = -1 + (2 * i) / steps;
    shape.lineTo(u * half, (profile[i] / peak - 1) * fringe.height);
  }
  shape.lineTo(half, skirt);
  shape.closePath();

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: PLATE_DEPTH,
    bevelEnabled: false,
  });
  geometry.translate(0, 0, -PLATE_DEPTH);
  applyVerticalRamp(geometry, ramp, -fringe.height, 0);
  return geometry;
}

/**
 * Scatter shared shape variants along the layer. Count is derived from the
 * frame width at that depth, so a wrap can never leave a hole; jitter comes
 * from the layer's PRNG so the field never reads as a pattern.
 */
function buildScatter(
  spec: LayerSpec,
  spread: number,
  variants: THREE.BufferGeometry[],
  material: THREE.Material,
  rng: () => number,
  centerX: number,
  scale: number,
): { elements: ParallaxElement[]; period: number } {
  const count = Math.max(3, Math.ceil(frameWidthAt(spec.z) / spread) + 2);
  const yJitter = spec.yJitter ?? 0.4;
  const elements: ParallaxElement[] = [];
  for (let i = 0; i < count; i++) {
    const geometry = variants[i % variants.length];
    const mesh = plateMesh(geometry, material, `${spec.name}${i}`);
    const s = scale * (0.7 + rng() * 0.65);
    mesh.scale.set(s, s, 1);
    const baseX =
      centerX + (i - (count - 1) / 2) * spread + (rng() * 2 - 1) * spread * 0.35;
    mesh.position.set(baseX, spec.y + (rng() * 2 - 1) * yJitter, 0);
    elements.push({ object: mesh, baseX });
  }
  return { elements, period: count * spread };
}

/**
 * Build a parallax stack and add it under `parent` (or return detached).
 *
 * `centerX` only sets the phase of the deterministic layout — wrapping supplies
 * coverage — so the level-bounds midpoint is ideal but the default is harmless.
 */
export function createParallax(
  parent?: THREE.Object3D,
  levelWidth = 80,
  centerX = levelWidth * 0.5,
): ParallaxSystem {
  const root = new THREE.Group();
  root.name = 'ParallaxRoot';
  const layers: ParallaxLayer[] = [];
  const runtimes: LayerRuntime[] = [];
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();

  for (const spec of DEFAULT_SPECS) {
    const group = new THREE.Group();
    group.name = spec.name;
    group.position.z = spec.z;
    const rng = mulberry32(seedFromName(spec.name));
    const ramp = plateRamp(spec);
    const material = plateMaterial(spec.name);
    materials.add(material);

    let built: { elements: ParallaxElement[]; period: number } | null = null;
    if (spec.kind === 'ridge' && spec.ridge) {
      const ridge = buildRidge(spec, spec.ridge, material, ramp, rng, centerX);
      geometries.add(ridge.geometry);
      built = ridge;
    } else if (spec.kind === 'clouds' && spec.clouds) {
      const variants: THREE.BufferGeometry[] = [];
      for (let v = 0; v < SHAPE_VARIANTS; v++) {
        const geometry = createCloudGeometry(rng, ramp);
        geometries.add(geometry);
        variants.push(geometry);
      }
      built = buildScatter(
        spec,
        spec.clouds.spread,
        variants,
        material,
        rng,
        centerX,
        spec.clouds.scale,
      );
    } else if (spec.kind === 'fringe' && spec.fringe) {
      const variants: THREE.BufferGeometry[] = [];
      for (let v = 0; v < SHAPE_VARIANTS; v++) {
        const geometry = createFringeGeometry(rng, spec.fringe, ramp);
        geometries.add(geometry);
        variants.push(geometry);
      }
      built = buildScatter(
        spec,
        spec.fringe.spread,
        variants,
        material,
        rng,
        centerX,
        1,
      );
    }
    if (!built) continue;

    for (const el of built.elements) group.add(el.object);
    root.add(group);

    const layer: ParallaxLayer = {
      group,
      factor: screenRateToFactor(spec.rate, spec.z),
      baseX: 0,
    };
    layers.push(layer);
    runtimes.push({
      layer,
      elements: built.elements,
      period: built.period,
      drift: spec.clouds?.drift ?? 0,
    });
  }

  parent?.add(root);

  return {
    root,
    layers,
    update(cameraX: number, elapsed?: number) {
      const time = elapsed ?? 0;
      for (const rt of runtimes) {
        const layer = rt.layer;
        // Screen offset per unit of camera travel is -factor / distance, so
        // factor 0 pins the plate to the camera and 1 leaves it world-fixed.
        layer.group.position.x = layer.baseX + cameraX * (1 - layer.factor);
        // Where the camera looks, expressed in this layer's content space.
        const camContentX = cameraX * layer.factor - layer.baseX;
        const shift = rt.drift * time;
        for (const el of rt.elements) {
          const x = el.baseX + shift;
          const rel = x - camContentX;
          el.object.position.x = x - Math.round(rel / rt.period) * rt.period;
        }
      }
    },
    dispose() {
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
      geometries.clear();
      materials.clear();
      root.clear();
      root.removeFromParent();
    },
  };
}
