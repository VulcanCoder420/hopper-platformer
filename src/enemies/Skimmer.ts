import * as THREE from 'three';
import type { Solid } from '../levels/types';
import { Enemy } from './Enemy';

/**
 * Flying skimmer — glides on a horizontal path with a gentle sine bob.
 * Stompable from above; side contact damages the player.
 * Stylized teal finned flyer (original design).
 */
export class Skimmer extends Enemy {
  private readonly spawnX: number;
  private readonly spawnY: number;
  /** Horizontal patrol half-width. */
  patrolHalf: number;
  /** Sine bob amplitude (world units). */
  bobAmp: number;
  /** Sine bob frequency (rad/s-ish via phase). */
  bobSpeed: number;
  private phase = 0;
  private readonly baseSpeed: number;

  constructor(
    x: number,
    y: number,
    opts: {
      patrol?: number;
      bobAmp?: number;
      bobSpeed?: number;
      speed?: number;
    } = {},
  ) {
    super('skimmer', x, y, { halfW: 0.42, height: 0.55, hp: 1 });
    this.spawnX = x;
    this.spawnY = Math.max(y, 1.2);
    this.y = this.spawnY;
    this.patrolHalf = opts.patrol ?? 2.2;
    this.bobAmp = opts.bobAmp ?? 0.45;
    this.bobSpeed = opts.bobSpeed ?? 2.4;
    this.baseSpeed = opts.speed ?? 2.4;
    this.vx = this.baseSpeed;
    this.facing = 1;
    this.stompable = true;
    this.buildMesh();
  }

  private buildMesh(): void {
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x2ec4b6,
      roughness: 0.4,
      metalness: 0.15,
      emissive: 0x0a4a44,
      emissiveIntensity: 0.15,
    });
    const wingMat = new THREE.MeshStandardMaterial({
      color: 0x9ff0e0,
      roughness: 0.35,
      metalness: 0.12,
      emissive: 0x2ec4b6,
      emissiveIntensity: 0.08,
      transparent: true,
      opacity: 0.92,
      side: THREE.DoubleSide,
    });
    const eyeMat = new THREE.MeshStandardMaterial({
      color: 0x1a1a2e,
      roughness: 0.3,
      metalness: 0,
    });
    const accentMat = new THREE.MeshStandardMaterial({
      color: 0xffd166,
      roughness: 0.4,
      metalness: 0.2,
      emissive: 0xffd166,
      emissiveIntensity: 0.12,
    });

    // Capsule body elongated along X
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.2, 0.45, 6, 12),
      bodyMat,
    );
    body.rotation.z = Math.PI / 2;
    body.position.y = 0.28;
    body.castShadow = true;
    body.receiveShadow = true;
    this.bodyRoot.add(body);

    // Head bulb
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 14, 12), bodyMat);
    head.position.set(0.32, 0.3, 0);
    head.castShadow = true;
    this.bodyRoot.add(head);

    // Eyes
    const eyeGeo = new THREE.SphereGeometry(0.055, 8, 8);
    const eyeL = new THREE.Mesh(eyeGeo, eyeMat);
    eyeL.position.set(0.42, 0.34, 0.1);
    const eyeR = new THREE.Mesh(eyeGeo, eyeMat);
    eyeR.position.set(0.42, 0.34, -0.1);
    this.bodyRoot.add(eyeL, eyeR);

    // Fin / wings
    const wingGeo = new THREE.ConeGeometry(0.28, 0.55, 4);
    const wingL = new THREE.Mesh(wingGeo, wingMat);
    wingL.position.set(-0.05, 0.42, 0.28);
    wingL.rotation.set(0.6, 0, 0.9);
    wingL.castShadow = true;
    const wingR = new THREE.Mesh(wingGeo, wingMat);
    wingR.position.set(-0.05, 0.42, -0.28);
    wingR.rotation.set(-0.6, 0, 0.9);
    wingR.castShadow = true;
    this.bodyRoot.add(wingL, wingR);

    // Tail fin
    const tail = new THREE.Mesh(
      new THREE.ConeGeometry(0.12, 0.32, 5),
      accentMat,
    );
    tail.position.set(-0.42, 0.28, 0);
    tail.rotation.z = Math.PI / 2;
    tail.castShadow = true;
    this.bodyRoot.add(tail);

    // Underside glow stripe
    const stripe = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.06, 0.12),
      accentMat,
    );
    stripe.position.set(0.05, 0.14, 0);
    this.bodyRoot.add(stripe);
  }

  protected updateAlive(dt: number, _solids: readonly Solid[]): void {
    this.phase += dt * this.bobSpeed;

    // Horizontal patrol
    this.x += this.vx * dt;
    if (this.x > this.spawnX + this.patrolHalf) {
      this.x = this.spawnX + this.patrolHalf;
      this.vx = -this.baseSpeed;
      this.facing = -1;
    } else if (this.x < this.spawnX - this.patrolHalf) {
      this.x = this.spawnX - this.patrolHalf;
      this.vx = this.baseSpeed;
      this.facing = 1;
    }

    // Sine bob around spawn Y
    this.y = this.spawnY + Math.sin(this.phase) * this.bobAmp;
    this.vy = Math.cos(this.phase) * this.bobAmp * this.bobSpeed;
  }

  protected override syncMesh(dt: number): void {
    this.group.position.set(this.x, this.y, 0);
    this.walkPhase += dt * 8;
    // Gentle wing-ish roll
    const flap = Math.sin(this.walkPhase) * 0.12;
    this.squash += (1 - this.squash) * Math.min(1, 8 * dt);
    const sy = this.squash;
    const sxz = 1 / Math.sqrt(Math.max(sy, 0.5));
    this.bodyRoot.scale.set(sxz * this.facing, sy, sxz);
    this.bodyRoot.rotation.z = flap * 0.35 * this.facing;
    this.bodyRoot.position.y = Math.sin(this.walkPhase * 0.5) * 0.02;
  }
}
