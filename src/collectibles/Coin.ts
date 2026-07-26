import * as THREE from 'three';
import { COLORS } from '../game/config';
import type { Solid } from '../levels/types';

const COIN_RADIUS = 0.28;
const COIN_THICKNESS = 0.08;
const COLLECT_RADIUS = 0.42;

/**
 * Spinning / bobbing coin collectible.
 * Position is world center of the coin disc.
 */
export class Coin {
  readonly x: number;
  readonly baseY: number;
  readonly z: number;
  collected = false;

  readonly mesh: THREE.Mesh;
  private readonly group: THREE.Group;
  private phase: number;
  private spin = 0;

  constructor(x: number, y: number, z = 0) {
    this.x = x;
    this.baseY = y;
    this.z = z;
    this.phase = x * 0.7 + y * 1.3;

    this.group = new THREE.Group();
    this.group.name = 'Coin';
    this.group.position.set(x, y, z);

    const geo = new THREE.CylinderGeometry(COIN_RADIUS, COIN_RADIUS, COIN_THICKNESS, 20);
    const mat = new THREE.MeshStandardMaterial({
      color: COLORS.coin,
      roughness: 0.32,
      metalness: 0.62,
      emissive: COLORS.coin,
      emissiveIntensity: 0.48,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    // Stand upright like a classic side-view coin (face toward camera-ish)
    this.mesh.rotation.z = Math.PI / 2;
    this.mesh.castShadow = true;
    this.group.add(this.mesh);
  }

  get object3d(): THREE.Object3D {
    return this.group;
  }

  get position(): { x: number; y: number; z: number } {
    return {
      x: this.group.position.x,
      y: this.group.position.y,
      z: this.group.position.z,
    };
  }

  /** AABB for player overlap (slightly generous). */
  getBounds(): Solid {
    const r = COLLECT_RADIUS;
    const y = this.group.position.y;
    return {
      minX: this.x - r,
      maxX: this.x + r,
      minY: y - r,
      maxY: y + r,
    };
  }

  /**
   * Spin + bob. Call every frame while active.
   * @param dt seconds
   * @param elapsed global elapsed for phase sync
   */
  update(dt: number, elapsed: number): void {
    if (this.collected) return;

    this.spin += dt * 4.2;
    this.mesh.rotation.y = this.spin;

    const bob = Math.sin(elapsed * 2.5 + this.phase) * 0.12;
    this.group.position.y = this.baseY + bob;

    // Subtle pulse on emissive
    const mat = this.mesh.material as THREE.MeshStandardMaterial;
    mat.emissiveIntensity = 0.28 + Math.sin(elapsed * 5 + this.phase) * 0.12;
  }

  /** Mark collected and hide mesh (manager removes from scene). */
  collect(): void {
    if (this.collected) return;
    this.collected = true;
    this.group.visible = false;
  }

  dispose(): void {
    this.group.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry?.dispose();
        const m = obj.material;
        if (Array.isArray(m)) m.forEach((mm) => mm.dispose());
        else m?.dispose();
      }
    });
    this.group.removeFromParent();
  }
}
