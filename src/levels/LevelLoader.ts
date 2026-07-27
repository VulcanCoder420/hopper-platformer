/**
 * Builds Three.js meshes + solid AABBs from a LevelDef.
 * Stylized modern 2.5D: grass/dirt ground, floating platforms, pipes,
 * question blocks, stairs, goal flag.
 */

import * as THREE from 'three';
import { COLORS, WORLD } from '../game/config';
import type {
  LevelDef,
  PlatformDef,
  PlatformStyle,
  Solid,
} from './types';
import { solidFromTop } from './Collision';
import { createParallax, type ParallaxSystem } from './parallax';
import { createScenery, type ScenerySystem } from './Scenery';
import { surfaceMaterial } from './surfaces';
import { PrizeBlockManager } from '../collectibles/PrizeBlockManager';

export interface LoadedLevel {
  def: LevelDef;
  root: THREE.Group;
  solids: Solid[];
  coins: THREE.Object3D[];
  goal: THREE.Group;
  parallax: ParallaxSystem;
  /** Trees, bushes, tufts — wind is driven via scenery.update(elapsed). */
  scenery: ScenerySystem;
  /** Flag wave + pole shimmer. Call once per frame with absolute elapsed time. */
  animateGoal(elapsed: number): void;
  /** Dispose meshes/materials and remove from parent. */
  dispose(): void;
}

const STYLE_COLORS: Record<
  PlatformStyle,
  { top: number; body: number; roughness: number; metalness: number }
> = {
  grass: { top: COLORS.grass, body: COLORS.dirt, roughness: 0.88, metalness: 0.02 },
  stone: { top: COLORS.stone, body: COLORS.stoneDark, roughness: 0.82, metalness: 0.08 },
  brick: { top: 0xc45c3e, body: 0x8b3a2a, roughness: 0.78, metalness: 0.05 },
  metal: { top: 0x90a4ae, body: 0x546e7a, roughness: 0.35, metalness: 0.65 },
  dirt: { top: COLORS.dirt, body: COLORS.dirtDark, roughness: 0.95, metalness: 0 },
  question: { top: 0xffc107, body: 0xe65100, roughness: 0.45, metalness: 0.25 },
  pipe: { top: 0x43a047, body: 0x2e7d32, roughness: 0.4, metalness: 0.35 },
  wood: { top: 0xbcaaa4, body: 0x6d4c41, roughness: 0.85, metalness: 0.02 },
};

function mat(
  color: number,
  opts: { roughness?: number; metalness?: number; emissive?: number; emissiveIntensity?: number } = {},
): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: opts.roughness ?? 0.82,
    metalness: opts.metalness ?? 0.05,
    emissive: opts.emissive ?? 0x000000,
    emissiveIntensity: opts.emissiveIntensity ?? 0,
  });
}

function boxMesh(
  w: number,
  h: number,
  d: number,
  material: THREE.Material,
  opts: { cast?: boolean; receive?: boolean } = {},
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.castShadow = opts.cast ?? true;
  mesh.receiveShadow = opts.receive ?? true;
  return mesh;
}

/**
 * Textured surface box. Texel density is driven by the mesh's own dimensions so
 * a 16-unit ground strip and a 1-unit block share the same visual scale.
 */
function surfaceBox(
  w: number,
  h: number,
  d: number,
  style: PlatformStyle,
  face: 'top' | 'body',
  opts: { cast?: boolean; receive?: boolean; emissive?: number; emissiveIntensity?: number } = {},
): THREE.Mesh {
  const material = surfaceMaterial(style, face, w, Math.max(h, d), {
    emissive: opts.emissive,
    emissiveIntensity: opts.emissiveIntensity,
  });
  return boxMesh(w, h, d, material, opts);
}

/**
 * Load a level definition into the given scene (or a detached root).
 */
export function loadLevel(def: LevelDef, scene?: THREE.Scene): LoadedLevel {
  const root = new THREE.Group();
  root.name = `Level_${def.id}`;

  const solids: Solid[] = [];
  /** Decorative coin meshes unused — CoinManager owns gameplay coins. */
  const coins: THREE.Object3D[] = [];
  const depthDefault = WORLD.platformDepth * 0.55;

  // No far-ground plate: the parallax ridges now cover the horizon completely,
  // and a lit 200x120 plane behind them showed as a band of lit ground between
  // the ridgeline and the sky. Pits read as open sky, which suits sky islands.

  for (const p of def.platforms) {
    const kind = p.kind ?? 'platform';
    const style = p.style ?? (kind === 'ground' ? 'grass' : 'stone');
    const isSolid = p.solid !== false;
    const depth = p.depth ?? depthDefault;
    const z = p.z ?? 0;

    // Interactive prize blocks are meshed + solid'd by PrizeBlockManager so
    // hit state / empty visuals stay in one place (no double geometry).
    if (PrizeBlockManager.isOwnedPlatform(p)) {
      continue;
    }

    if (kind === 'pipe') {
      const built = buildPipe(p, style);
      root.add(built.group);
      if (isSolid) solids.push(...built.solids);
      continue;
    }

    if (kind === 'block' || style === 'question') {
      const built = buildBlock(p, style, depth, z);
      root.add(built.group);
      if (isSolid) solids.push(...built.solids);
      continue;
    }

    if (kind === 'stair') {
      const built = buildStair(p, style, depth, z);
      root.add(built.group);
      if (isSolid) solids.push(...built.solids);
      continue;
    }

    // ground / platform / ledge
    const built = buildPlatformStrip(p, style, depth, z, kind === 'ground');
    root.add(built.group);
    if (isSolid) solids.push(...built.solids);
  }

  // Coins are owned by CoinManager (spin/bob/collect) — LevelLoader skips meshes.
  // Keep `coins` empty for LoadedLevel API compatibility.

  // Goal flag
  const goal = buildGoal(def.goal);
  root.add(goal);

  // Parallax under root (updates with camera X via LoadedLevel.parallax)
  const levelWidth = def.bounds.maxX - def.bounds.minX;
  const parallax = createParallax(
    root,
    levelWidth,
    (def.bounds.minX + def.bounds.maxX) * 0.5,
  );

  // Vegetation, placed from the platform list and kept off the gameplay lane.
  const scenery = createScenery(def, root);

  const animateGoal = makeGoalAnimator(goal);

  scene?.add(root);

  return {
    def,
    root,
    solids,
    coins,
    goal,
    parallax,
    scenery,
    animateGoal,
    dispose() {
      parallax.dispose();
      scenery.dispose();
      root.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry?.dispose();
          const m = obj.material;
          // Surface materials are shared, process-wide cache entries keyed by
          // style and tiling — disposing them here would blank out every future
          // level. disposeSurfaces() owns their teardown.
          const disposable = (mm: THREE.Material) =>
            !mm.name.startsWith('Surface_');
          if (Array.isArray(m)) m.forEach((mm) => disposable(mm) && mm.dispose());
          else if (m && disposable(m)) m.dispose();
        }
      });
      root.removeFromParent();
    },
  };
}

function buildPlatformStrip(
  p: PlatformDef,
  style: PlatformStyle,
  depth: number,
  z: number,
  isGround: boolean,
): { group: THREE.Group; solids: Solid[] } {
  const group = new THREE.Group();
  group.name = isGround ? 'GroundStrip' : 'Platform';
  const solids: Solid[] = [];

  const topH = isGround ? Math.min(p.h, 0.55) : Math.min(p.h, 0.38);
  const bodyH = Math.max(p.h - topH, isGround ? 1.2 : 0.45);
  const topY = p.y;
  const topCy = topY - topH * 0.5;
  const bodyCy = topY - topH - bodyH * 0.5;

  const top = surfaceBox(p.w, topH, depth, style, 'top', {
    cast: !isGround,
    receive: true,
  });
  top.position.set(p.x, topCy, z);
  group.add(top);

  const body = surfaceBox(
    p.w * (isGround ? 1 : 0.94),
    bodyH,
    depth * (isGround ? 0.96 : 0.9),
    style,
    'body',
    { cast: !isGround, receive: true },
  );
  body.position.set(p.x, bodyCy, z);
  group.add(body);

  if (style === 'grass' || isGround) {
    // Overhanging sod edge. Inset on both ends and pushed clear of the slab's
    // front face — sharing a plane with the slab z-fights along the whole strip.
    const lip = boxMesh(
      p.w - 0.04,
      0.16,
      0.22,
      mat(COLORS.grassDark, { roughness: 0.9 }),
      { cast: false, receive: true },
    );
    lip.position.set(p.x, topY + 0.03, z + depth * 0.5 + 0.02);
    group.add(lip);
  }

  // Single solid covering full height for clean collision
  solids.push(solidFromTop(p.x, topY, p.w, topH + bodyH));

  return { group, solids };
}

function buildBlock(
  p: PlatformDef,
  style: PlatformStyle,
  depth: number,
  z: number,
): { group: THREE.Group; solids: Solid[] } {
  const group = new THREE.Group();
  group.name = style === 'question' ? 'QuestionBlock' : 'Block';
  const colors = STYLE_COLORS[style];
  const size = Math.max(p.w, p.h);
  const d = Math.min(depth, size * 1.1);
  // p.y is top surface
  const cy = p.y - size * 0.5;

  const isQ = style === 'question';
  // The "?" glyph is painted into the question texture itself, so no separate
  // coplanar face plane is needed. Emissive is lifted above the bloom threshold.
  const mesh = surfaceBox(size, size, d, style, 'top', {
    emissive: isQ ? 0xffa000 : 0x000000,
    emissiveIntensity: isQ ? 0.42 : 0,
  });
  mesh.position.set(p.x, cy, z);
  group.add(mesh);

  // Side bevel strip
  const rim = boxMesh(
    size * 1.02,
    size * 0.12,
    d * 1.02,
    mat(colors.body, { roughness: 0.7, metalness: colors.metalness }),
    { cast: true, receive: true },
  );
  rim.position.set(p.x, cy + size * 0.4, z);
  group.add(rim);

  return {
    group,
    solids: [solidFromTop(p.x, p.y, size, size)],
  };
}

function buildPipe(
  p: PlatformDef,
  _style: PlatformStyle,
): { group: THREE.Group; solids: Solid[] } {
  const group = new THREE.Group();
  group.name = 'Pipe';
  const radius = p.w * 0.5;
  const height = p.h;
  // p.y = top lip
  const bodyH = height * 0.85;
  const lipH = height * 0.15;
  const bodyCy = p.y - lipH - bodyH * 0.5;
  const lipCy = p.y - lipH * 0.5;
  const z = p.z ?? 0;

  const bodyMat = surfaceMaterial('pipe', 'body', radius * 2, bodyH);
  const lipMat = surfaceMaterial('pipe', 'top', radius * 2, lipH);

  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 0.92, radius * 0.95, bodyH, 20),
    bodyMat,
  );
  body.position.set(p.x, bodyCy, z);
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  const lip = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 1.12, radius * 1.08, lipH, 20),
    lipMat,
  );
  lip.position.set(p.x, lipCy, z);
  lip.castShadow = true;
  lip.receiveShadow = true;
  group.add(lip);

  // Inner dark hole
  const hole = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 0.7, radius * 0.7, lipH * 0.5, 16),
    mat(0x1b3d1f, { roughness: 1, metalness: 0 }),
  );
  hole.position.set(p.x, p.y - lipH * 0.35, z);
  hole.castShadow = false;
  group.add(hole);

  // AABB: approximate cylinder as box (full width x height)
  const solids = [solidFromTop(p.x, p.y, p.w * 1.15, height)];
  return { group, solids };
}

function buildStair(
  p: PlatformDef,
  style: PlatformStyle,
  depth: number,
  z: number,
): { group: THREE.Group; solids: Solid[] } {
  const group = new THREE.Group();
  group.name = 'Stair';
  const solids: Solid[] = [];
  // Stair rises to the right: each step is 1 unit wide, total height p.h
  const steps = Math.max(2, Math.round(p.w));
  const stepW = p.w / steps;
  const stepH = p.h / steps;

  for (let i = 0; i < steps; i++) {
    const sh = stepH * (i + 1);
    const sx = p.x - p.w * 0.5 + stepW * (i + 0.5);
    const topY = p.y - p.h + sh;
    const mesh = surfaceBox(
      stepW * 0.98,
      sh,
      depth,
      style,
      i % 2 === 0 ? 'top' : 'body',
    );
    mesh.position.set(sx, topY - sh * 0.5, z);
    group.add(mesh);
    solids.push(solidFromTop(sx, topY, stepW * 0.98, sh));
  }

  return { group, solids };
}

function buildGoal(goal: LevelDef['goal']): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Goal';
  const height = goal.height ?? 5.2;
  const baseY = goal.y;
  const poleH = height;
  const poleCy = baseY + poleH * 0.5;

  const pole = boxMesh(
    0.12,
    poleH,
    0.12,
    mat(0xeceff1, { roughness: 0.4, metalness: 0.5 }),
    { cast: true, receive: false },
  );
  pole.position.set(goal.x, poleCy, 0);
  group.add(pole);

  // Ball tip
  const ball = new THREE.Mesh(
    new THREE.SphereGeometry(0.22, 12, 10),
    mat(0xffe082, {
      roughness: 0.28,
      metalness: 0.75,
      emissive: 0xffc107,
      emissiveIntensity: 0.85,
    }),
  );
  ball.position.set(goal.x, baseY + poleH + 0.15, 0);
  ball.castShadow = true;
  group.add(ball);

  // Flag. The geometry is offset so the mesh origin sits at the pole, which lets
  // it wave about its attachment point instead of swinging around its middle.
  const flagGeo = new THREE.PlaneGeometry(1.7, 1.05, 14, 5);
  flagGeo.translate(0.85, 0, 0);
  const flag = new THREE.Mesh(
    flagGeo,
    new THREE.MeshStandardMaterial({
      color: 0xff5252,
      side: THREE.DoubleSide,
      roughness: 0.6,
      metalness: 0.08,
      emissive: 0xc62828,
      emissiveIntensity: 0.62,
    }),
  );
  flag.position.set(goal.x, baseY + poleH - 0.7, 0);
  flag.castShadow = true;
  flag.name = 'Flag';
  group.add(flag);

  // Stripe is a child of the flag so it inherits the wave and can never be
  // bisected by it (the old sibling at z+0.01 was sliced in half every cycle).
  const stripeGeo = new THREE.PlaneGeometry(1.7, 0.18, 14, 1);
  stripeGeo.translate(0.85, 0, 0);
  const stripe = new THREE.Mesh(
    stripeGeo,
    new THREE.MeshStandardMaterial({
      color: 0xffe066,
      side: THREE.DoubleSide,
      roughness: 0.5,
      metalness: 0.1,
      emissive: 0xffc107,
      emissiveIntensity: 0.4,
    }),
  );
  stripe.position.z = 0.014;
  stripe.name = 'FlagStripe';
  flag.add(stripe);

  // Base block
  const base = boxMesh(
    0.7,
    0.35,
    0.7,
    mat(COLORS.stoneDark, { roughness: 0.75, metalness: 0.1 }),
  );
  base.position.set(goal.x, baseY + 0.175, 0);
  group.add(base);

  return group;
}

/**
 * Per-frame cloth wave for the goal flag, amplitude growing with distance from
 * the pole. 90 vertices for the flag plus its stripe — negligible cost, and it is
 * the most-looked-at piece of polish in the level.
 */
function makeGoalAnimator(goal: THREE.Group): (elapsed: number) => void {
  const flag = goal.getObjectByName('Flag');
  if (!(flag instanceof THREE.Mesh)) return () => {};

  const waved: THREE.Mesh[] = [flag];
  const stripe = flag.getObjectByName('FlagStripe');
  if (stripe instanceof THREE.Mesh) waved.push(stripe);

  // Cache the flat X/Y so the wave is recomputed from rest each frame rather
  // than accumulating drift.
  const rest = waved.map((m) => {
    const pos = m.geometry.getAttribute('position') as THREE.BufferAttribute;
    return { mesh: m, pos, x: Float32Array.from(pos.array as Float32Array) };
  });

  return (elapsed: number) => {
    for (const entry of rest) {
      const { pos, x: base } = entry;
      for (let i = 0; i < pos.count; i++) {
        const px = base[i * 3]!;
        const py = base[i * 3 + 1]!;
        // px is 0 at the pole and 1.7 at the free edge.
        const t = px / 1.7;
        pos.setZ(
          i,
          Math.sin(px * 3.1 - elapsed * 6.2 + py * 0.8) * 0.09 * t +
            Math.sin(px * 6.4 - elapsed * 9.1) * 0.03 * t,
        );
      }
      pos.needsUpdate = true;
      entry.mesh.geometry.computeVertexNormals();
    }
  };
}

/** Convenience: unload previous and load next. */
export function swapLevel(
  scene: THREE.Scene,
  previous: LoadedLevel | null,
  nextDef: LevelDef,
): LoadedLevel {
  previous?.dispose();
  return loadLevel(nextDef, scene);
}
