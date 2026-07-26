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

export interface LoadedLevel {
  def: LevelDef;
  root: THREE.Group;
  solids: Solid[];
  coins: THREE.Object3D[];
  goal: THREE.Group;
  parallax: ParallaxSystem;
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
 * Load a level definition into the given scene (or a detached root).
 */
export function loadLevel(def: LevelDef, scene?: THREE.Scene): LoadedLevel {
  const root = new THREE.Group();
  root.name = `Level_${def.id}`;

  const solids: Solid[] = [];
  /** Decorative coin meshes unused — CoinManager owns gameplay coins. */
  const coins: THREE.Object3D[] = [];
  const depthDefault = WORLD.platformDepth * 0.55;

  // Far ground plane for fog continuity
  const farGround = new THREE.Mesh(
    new THREE.PlaneGeometry(Math.max(200, def.bounds.maxX - def.bounds.minX + 80), 120),
    mat(COLORS.hillMid, { roughness: 1, metalness: 0 }),
  );
  farGround.rotation.x = -Math.PI / 2;
  farGround.position.set(
    (def.bounds.minX + def.bounds.maxX) * 0.5,
    def.deathY + 0.05,
    -30,
  );
  farGround.receiveShadow = true;
  farGround.castShadow = false;
  root.add(farGround);

  for (const p of def.platforms) {
    const kind = p.kind ?? 'platform';
    const style = p.style ?? (kind === 'ground' ? 'grass' : 'stone');
    const isSolid = p.solid !== false;
    const depth = p.depth ?? depthDefault;
    const z = p.z ?? 0;

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
  const parallax = createParallax(root, levelWidth);

  scene?.add(root);

  return {
    def,
    root,
    solids,
    coins,
    goal,
    parallax,
    dispose() {
      parallax.dispose();
      root.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry?.dispose();
          const m = obj.material;
          if (Array.isArray(m)) m.forEach((mm) => mm.dispose());
          else m?.dispose();
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
  const colors = STYLE_COLORS[style];
  const solids: Solid[] = [];

  const topH = isGround ? Math.min(p.h, 0.55) : Math.min(p.h, 0.38);
  const bodyH = Math.max(p.h - topH, isGround ? 1.2 : 0.45);
  const topY = p.y;
  const topCy = topY - topH * 0.5;
  const bodyCy = topY - topH - bodyH * 0.5;

  const top = boxMesh(
    p.w,
    topH,
    depth,
    mat(colors.top, { roughness: colors.roughness, metalness: colors.metalness }),
    { cast: !isGround, receive: true },
  );
  top.position.set(p.x, topCy, z);
  group.add(top);

  const body = boxMesh(
    p.w * (isGround ? 1 : 0.94),
    bodyH,
    depth * (isGround ? 0.96 : 0.9),
    mat(colors.body, { roughness: 0.92, metalness: 0.02 }),
    { cast: !isGround, receive: true },
  );
  body.position.set(p.x, bodyCy, z);
  group.add(body);

  if (style === 'grass' || isGround) {
    const lip = boxMesh(
      p.w,
      0.14,
      0.18,
      mat(COLORS.grassDark, { roughness: 0.9 }),
      { cast: false, receive: true },
    );
    lip.position.set(p.x, topY + 0.02, z + depth * 0.5 - 0.06);
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
  const material = mat(colors.top, {
    roughness: colors.roughness,
    metalness: colors.metalness,
    emissive: isQ ? 0xffa000 : 0x000000,
    emissiveIntensity: isQ ? 0.22 : 0,
  });

  const mesh = boxMesh(size, size, d, material);
  mesh.position.set(p.x, cy, z);
  group.add(mesh);

  if (isQ) {
    // "?" face as a thin raised disc/plane on front
    const face = new THREE.Mesh(
      new THREE.PlaneGeometry(size * 0.55, size * 0.55),
      mat(0xfff8e1, { roughness: 0.5, metalness: 0.1, emissive: 0xffe082, emissiveIntensity: 0.15 }),
    );
    face.position.set(p.x, cy, z + d * 0.5 + 0.01);
    face.castShadow = false;
    group.add(face);
  }

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
  const colors = STYLE_COLORS.pipe;
  const radius = p.w * 0.5;
  const height = p.h;
  // p.y = top lip
  const bodyH = height * 0.85;
  const lipH = height * 0.15;
  const bodyCy = p.y - lipH - bodyH * 0.5;
  const lipCy = p.y - lipH * 0.5;
  const z = p.z ?? 0;

  const bodyMat = mat(colors.body, { roughness: 0.38, metalness: 0.4 });
  const lipMat = mat(colors.top, { roughness: 0.35, metalness: 0.45 });

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
  const colors = STYLE_COLORS[style];
  const solids: Solid[] = [];
  // Stair rises to the right: each step is 1 unit wide, total height p.h
  const steps = Math.max(2, Math.round(p.w));
  const stepW = p.w / steps;
  const stepH = p.h / steps;

  for (let i = 0; i < steps; i++) {
    const sh = stepH * (i + 1);
    const sx = p.x - p.w * 0.5 + stepW * (i + 0.5);
    const topY = p.y - p.h + sh;
    const mesh = boxMesh(
      stepW * 0.98,
      sh,
      depth,
      mat(i % 2 === 0 ? colors.top : colors.body, {
        roughness: colors.roughness,
        metalness: colors.metalness,
      }),
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
      emissiveIntensity: 0.55,
    }),
  );
  ball.position.set(goal.x, baseY + poleH + 0.15, 0);
  ball.castShadow = true;
  group.add(ball);

  // Flag (emissive for subtle bloom pick-up)
  const flag = new THREE.Mesh(
    new THREE.PlaneGeometry(1.7, 1.05),
    new THREE.MeshStandardMaterial({
      color: 0xff5252,
      side: THREE.DoubleSide,
      roughness: 0.6,
      metalness: 0.08,
      emissive: 0xc62828,
      emissiveIntensity: 0.28,
    }),
  );
  flag.position.set(goal.x + 0.9, baseY + poleH - 0.7, 0);
  flag.castShadow = true;
  flag.name = 'Flag';
  group.add(flag);

  // Accent stripe
  const stripe = new THREE.Mesh(
    new THREE.PlaneGeometry(1.7, 0.18),
    mat(0xffe066, { roughness: 0.5, metalness: 0.1, emissive: 0xffc107, emissiveIntensity: 0.2 }),
  );
  stripe.position.set(goal.x + 0.9, baseY + poleH - 0.7, 0.01);
  group.add(stripe);

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

/** Convenience: unload previous and load next. */
export function swapLevel(
  scene: THREE.Scene,
  previous: LoadedLevel | null,
  nextDef: LevelDef,
): LoadedLevel {
  previous?.dispose();
  return loadLevel(nextDef, scene);
}
