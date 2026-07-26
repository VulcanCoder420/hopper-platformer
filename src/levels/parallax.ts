/**
 * Layered parallax background meshes that scroll at different rates
 * relative to camera X for a 2.5D side-scroller depth read.
 */

import * as THREE from 'three';
import { COLORS } from '../game/config';

export interface ParallaxLayer {
  group: THREE.Group;
  /** 0 = locked to camera (sky), 1 = world-fixed. Typical: far 0.15, mid 0.4, near 0.7. */
  factor: number;
  /** Base world X of the layer content when camera is at 0. */
  baseX: number;
}

export interface ParallaxSystem {
  root: THREE.Group;
  layers: ParallaxLayer[];
  update(cameraX: number): void;
  dispose(): void;
}

interface LayerSpec {
  name: string;
  z: number;
  y: number;
  factor: number;
  color: number;
  scale: number;
  count: number;
  spread: number;
  kind: 'hills' | 'clouds' | 'ridges';
}

const DEFAULT_SPECS: LayerSpec[] = [
  {
    name: 'ParallaxFar',
    z: -52,
    y: 1.4,
    factor: 0.08,
    color: COLORS.hillFar,
    scale: 2.7,
    count: 8,
    spread: 28,
    kind: 'hills',
  },
  {
    name: 'ParallaxMidFar',
    z: -38,
    y: 0.6,
    factor: 0.2,
    color: 0x255a4a,
    scale: 1.9,
    count: 7,
    spread: 22,
    kind: 'hills',
  },
  {
    name: 'ParallaxMid',
    z: -26,
    y: 0.05,
    factor: 0.38,
    color: COLORS.hillMid,
    scale: 1.5,
    count: 8,
    spread: 18,
    kind: 'hills',
  },
  {
    name: 'ParallaxNear',
    z: -12,
    y: -0.6,
    factor: 0.68,
    color: COLORS.hillNear,
    scale: 1.05,
    count: 9,
    spread: 13,
    kind: 'hills',
  },
  {
    name: 'ParallaxCloudsFar',
    z: -44,
    y: 13,
    factor: 0.12,
    color: 0xe8f2ff,
    scale: 1.45,
    count: 5,
    spread: 30,
    kind: 'clouds',
  },
  {
    name: 'ParallaxClouds',
    z: -32,
    y: 10,
    factor: 0.28,
    color: 0xf5f9ff,
    scale: 1.15,
    count: 6,
    spread: 24,
    kind: 'clouds',
  },
];

/**
 * Build a parallax stack and add it under `parent` (or return detached).
 */
export function createParallax(
  parent?: THREE.Object3D,
  levelWidth = 80,
): ParallaxSystem {
  const root = new THREE.Group();
  root.name = 'ParallaxRoot';
  const layers: ParallaxLayer[] = [];

  for (const spec of DEFAULT_SPECS) {
    const group = new THREE.Group();
    group.name = spec.name;

    if (spec.kind === 'hills' || spec.kind === 'ridges') {
      for (let i = 0; i < spec.count; i++) {
        const s = spec.scale * (0.75 + (i % 3) * 0.18);
        const hill = createHillMesh(spec.color, s);
        const x =
          (i - (spec.count - 1) / 2) * spec.spread +
          (i % 2) * 3 +
          levelWidth * 0.2;
        hill.position.set(x, spec.y, (i % 2) * 2);
        group.add(hill);
      }
    } else if (spec.kind === 'clouds') {
      const cloudMat = new THREE.MeshStandardMaterial({
        color: spec.color,
        roughness: 1,
        metalness: 0,
        flatShading: true,
      });
      for (let i = 0; i < spec.count; i++) {
        const s = spec.scale * (0.9 + (i % 3) * 0.2);
        const cloud = createCloud(cloudMat, s);
        const x =
          (i - (spec.count - 1) / 2) * spec.spread +
          (i % 2) * 5 +
          levelWidth * 0.15;
        cloud.position.set(x, spec.y + (i % 2) * 1.5, (i % 3) * 1.2);
        group.add(cloud);
      }
    }

    group.position.z = spec.z;
    root.add(group);
    layers.push({ group, factor: spec.factor, baseX: 0 });
  }

  parent?.add(root);

  return {
    root,
    layers,
    update(cameraX: number) {
      // Content stays roughly fixed in world; lower factor → follows camera more
      // (appears farther). offset = cameraX * (1 - factor)
      for (const layer of layers) {
        layer.group.position.x = layer.baseX + cameraX * (1 - layer.factor);
      }
    },
    dispose() {
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

function createHillMesh(color: number, scale: number): THREE.Mesh {
  const geo = new THREE.SphereGeometry(
    4 * scale,
    16,
    10,
    0,
    Math.PI * 2,
    0,
    Math.PI * 0.5,
  );
  const mat = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.95,
    metalness: 0,
    flatShading: true,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.scale.set(1.4, 1.0 + scale * 0.15, 1.1);
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  return mesh;
}

function createCloud(mat: THREE.Material, scale: number): THREE.Group {
  const g = new THREE.Group();
  const parts: Array<[number, number, number, number]> = [
    [0, 0, 0, 1],
    [0.9, 0.15, 0.1, 0.75],
    [-0.85, 0.1, -0.05, 0.7],
    [0.2, 0.45, 0, 0.65],
  ];
  for (const [x, y, z, s] of parts) {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(1.1 * s * scale, 10, 8),
      mat,
    );
    m.position.set(x * scale, y * scale, z * scale);
    m.castShadow = false;
    g.add(m);
  }
  return g;
}
