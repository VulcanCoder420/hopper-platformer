import * as THREE from 'three';
import { COLORS } from '../game/config';

/**
 * Original stylized Hopper mesh: rounded body, hat accent, simple face.
 * Feet sit at local y=0; facing +X when scale.x > 0 (controller facing = 1).
 */
export class PlayerVisual {
  readonly group: THREE.Group;
  private readonly bodyRoot: THREE.Group;
  private squash = 1;
  private bobPhase = 0;
  private facing: 1 | -1 = 1;

  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'Hopper';

    this.bodyRoot = new THREE.Group();
    this.group.add(this.bodyRoot);

    const bodyMat = new THREE.MeshStandardMaterial({
      color: COLORS.playerBody,
      roughness: 0.42,
      metalness: 0.08,
    });
    const accentMat = new THREE.MeshStandardMaterial({
      color: COLORS.playerAccent,
      roughness: 0.38,
      metalness: 0.12,
      emissive: COLORS.playerAccent,
      emissiveIntensity: 0.14,
    });
    const darkMat = new THREE.MeshStandardMaterial({
      color: COLORS.playerEyes,
      roughness: 0.35,
      metalness: 0,
    });
    const skinMat = new THREE.MeshStandardMaterial({
      color: 0xffc9a8,
      roughness: 0.55,
      metalness: 0.02,
    });

    // Torso — rounded capsule
    const torso = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.34, 0.42, 6, 14),
      bodyMat,
    );
    torso.position.y = 0.72;
    torso.castShadow = true;
    torso.receiveShadow = true;
    this.bodyRoot.add(torso);

    // Overalls / belt stripe
    const belt = new THREE.Mesh(
      new THREE.TorusGeometry(0.33, 0.05, 8, 20),
      accentMat,
    );
    belt.rotation.x = Math.PI / 2;
    belt.position.y = 0.58;
    belt.castShadow = true;
    this.bodyRoot.add(belt);

    // Head
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 14), skinMat);
    head.position.y = 1.18;
    head.scale.set(1, 0.95, 0.95);
    head.castShadow = true;
    this.bodyRoot.add(head);

    // Hat (beanie-ish brim + dome) — accent color
    const hat = new THREE.Mesh(
      new THREE.SphereGeometry(0.28, 14, 12, 0, Math.PI * 2, 0, Math.PI * 0.55),
      accentMat,
    );
    hat.position.y = 1.32;
    hat.castShadow = true;
    this.bodyRoot.add(hat);

    const brim = new THREE.Mesh(
      new THREE.CylinderGeometry(0.34, 0.36, 0.06, 18),
      accentMat,
    );
    brim.position.y = 1.22;
    brim.castShadow = true;
    this.bodyRoot.add(brim);

    // Simple face — eyes + smile dots (face toward +X for side view)
    const eyeGeo = new THREE.SphereGeometry(0.055, 10, 8);
    const eyeL = new THREE.Mesh(eyeGeo, darkMat);
    eyeL.position.set(0.22, 1.2, 0.1);
    const eyeR = new THREE.Mesh(eyeGeo, darkMat);
    eyeR.position.set(0.22, 1.2, -0.1);
    this.bodyRoot.add(eyeL, eyeR);

    const cheekMat = new THREE.MeshStandardMaterial({
      color: 0xff8a7a,
      roughness: 0.6,
      metalness: 0,
      transparent: true,
      opacity: 0.55,
    });
    const cheekL = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), cheekMat);
    cheekL.position.set(0.2, 1.1, 0.16);
    const cheekR = cheekL.clone();
    cheekR.position.z = -0.16;
    this.bodyRoot.add(cheekL, cheekR);

    // Arms (simple stubs)
    const armGeo = new THREE.CapsuleGeometry(0.08, 0.22, 4, 8);
    const armL = new THREE.Mesh(armGeo, skinMat);
    armL.position.set(0, 0.78, 0.38);
    armL.rotation.z = 0.35;
    armL.castShadow = true;
    const armR = new THREE.Mesh(armGeo, skinMat);
    armR.position.set(0, 0.78, -0.38);
    armR.rotation.z = -0.35;
    armR.castShadow = true;
    this.bodyRoot.add(armL, armR);

    // Feet
    const footGeo = new THREE.BoxGeometry(0.28, 0.12, 0.2);
    const footL = new THREE.Mesh(footGeo, darkMat);
    footL.position.set(0.04, 0.06, 0.14);
    footL.castShadow = true;
    const footR = new THREE.Mesh(footGeo, darkMat);
    footR.position.set(0.04, 0.06, -0.14);
    footR.castShadow = true;
    this.bodyRoot.add(footL, footR);

    // Default face +X (right)
    this.bodyRoot.rotation.y = 0;
  }

  get object3d(): THREE.Object3D {
    return this.group;
  }

  setPosition(x: number, y: number, z = 0): void {
    this.group.position.set(x, y, z);
  }

  /**
   * Flip mesh to face run direction. facing: +1 = right (+X), -1 = left.
   */
  setFacing(facing: 1 | -1): void {
    if (facing === this.facing) return;
    this.facing = facing;
    // Mirror via scale so hat/face stay coherent without full reorient complexity.
    this.bodyRoot.scale.x = facing;
  }

  /**
   * Light juice: run bob + jump stretch / land squash.
   */
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
    if (opts.grounded && speed > 0.4) {
      this.bobPhase += dt * (8 + speed * 0.55);
    } else {
      this.bobPhase += dt * 2;
    }

    // Punchy squash-stretch: land compress, jump elongate, air stretch/fall squash
    let targetSquash = 1;
    if (opts.justLanded) {
      targetSquash = 0.72;
    } else if (opts.justJumped) {
      targetSquash = 1.22;
    } else if (!opts.grounded && opts.vy > 2.5) {
      targetSquash = 1.1;
    } else if (!opts.grounded && opts.vy < -5) {
      targetSquash = 0.9;
    } else if (opts.grounded && Math.abs(opts.vx) > 6) {
      // Slight run squash for weight
      targetSquash = 0.97;
    }

    // Fast snap toward impulse, then ease back
    const snap = opts.justLanded || opts.justJumped ? 22 : 12;
    this.squash += (targetSquash - this.squash) * Math.min(1, snap * dt);
    // Relax toward 1
    this.squash += (1 - this.squash) * Math.min(1, 5.5 * dt);

    const bob =
      opts.grounded && speed > 0.35
        ? Math.sin(this.bobPhase) * 0.045
        : Math.sin(this.bobPhase) * 0.012;

    const sy = this.squash;
    const sxz = 1 / Math.sqrt(Math.max(sy, 0.5));
    this.bodyRoot.scale.y = sy;
    this.bodyRoot.scale.z = sxz * Math.sign(this.bodyRoot.scale.z || 1);
    // preserve facing on X
    this.bodyRoot.scale.x = sxz * this.facing;
    this.bodyRoot.position.y = bob + (1 - sy) * 0.35;
  }

  dispose(): void {
    this.group.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry?.dispose();
        const mat = obj.material;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else mat?.dispose();
      }
    });
  }
}
