import * as THREE from 'three';
import { CAMERA, WORLD } from './config';
import { clamp, damp } from '../utils/math';

export interface FollowTarget {
  position: THREE.Vector3;
}

export interface CameraBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/**
 * Smooth side-scroller follow camera.
 * Exponential damp on X/Y, velocity look-ahead, optional level clamps.
 */
export class CameraFollow {
  readonly camera: THREE.PerspectiveCamera;
  private target: FollowTarget | null = null;
  private readonly desired = new THREE.Vector3();
  private readonly lookAt = new THREE.Vector3();
  private readonly smoothedLook = new THREE.Vector3();
  private readonly offset = new THREE.Vector3(
    CAMERA.offset.x,
    CAMERA.offset.y,
    CAMERA.offset.z,
  );

  private lookAheadX = 0;
  private targetVx = 0;
  private bounds: CameraBounds = { ...WORLD.bounds };
  private readonly lookAheadOffset = new THREE.Vector3();

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(
      CAMERA.fov,
      aspect,
      CAMERA.near,
      CAMERA.far,
    );
    this.camera.position.set(CAMERA.offset.x, CAMERA.offset.y, CAMERA.offset.z);
    this.smoothedLook.set(0, CAMERA.lookAtY, 0);
    this.camera.lookAt(this.smoothedLook);
  }

  setTarget(target: FollowTarget | null): void {
    this.target = target;
    if (target) {
      this.desired.copy(target.position).add(this.offset);
      this.camera.position.copy(this.desired);
      this.smoothedLook.set(
        target.position.x,
        target.position.y + CAMERA.lookAtY,
        target.position.z,
      );
      this.camera.lookAt(this.smoothedLook);
    }
  }

  setOffset(x: number, y: number, z: number): void {
    this.offset.set(x, y, z);
  }

  /**
   * Horizontal velocity of the follow subject — drives look-ahead.
   */
  setTargetVelocityX(vx: number): void {
    this.targetVx = vx;
  }

  setBounds(bounds: CameraBounds | null): void {
    this.bounds = bounds ? { ...bounds } : { ...WORLD.bounds };
  }

  getTarget(): FollowTarget | null {
    return this.target;
  }

  update(dt: number): void {
    if (!this.target) return;

    // Smooth look-ahead from horizontal velocity
    const aheadTarget = clamp(
      (this.targetVx / CAMERA.lookAheadSpeedRef) * CAMERA.lookAheadMax,
      -CAMERA.lookAheadMax,
      CAMERA.lookAheadMax,
    );
    this.lookAheadX = damp(
      this.lookAheadX,
      aheadTarget,
      CAMERA.lookAheadLambda,
      dt,
    );

    this.lookAheadOffset.set(this.lookAheadX, 0, 0);
    this.desired
      .copy(this.target.position)
      .add(this.offset)
      .add(this.lookAheadOffset);

    // Clamp desired camera center roughly to level bounds (wide defaults for now)
    const halfSpanX = 6;
    const halfSpanY = 4;
    this.desired.x = clamp(
      this.desired.x,
      this.bounds.minX + halfSpanX,
      this.bounds.maxX - halfSpanX,
    );
    this.desired.y = clamp(
      this.desired.y,
      this.bounds.minY + halfSpanY,
      this.bounds.maxY - halfSpanY,
    );

    const p = this.camera.position;
    p.x = damp(p.x, this.desired.x, CAMERA.followLambdaX, dt);
    p.y = damp(p.y, this.desired.y, CAMERA.followLambdaY, dt);
    p.z = damp(p.z, this.desired.z, CAMERA.followLambdaX * 0.85, dt);

    this.lookAt.set(
      this.target.position.x + 1.2 + this.lookAheadX * 0.35,
      this.target.position.y + CAMERA.lookAtY,
      this.target.position.z,
    );

    this.smoothedLook.x = damp(
      this.smoothedLook.x,
      this.lookAt.x,
      CAMERA.lookLambda,
      dt,
    );
    this.smoothedLook.y = damp(
      this.smoothedLook.y,
      this.lookAt.y,
      CAMERA.lookLambda * 0.85,
      dt,
    );
    this.smoothedLook.z = damp(
      this.smoothedLook.z,
      this.lookAt.z,
      CAMERA.lookLambda,
      dt,
    );

    this.camera.lookAt(this.smoothedLook);
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}
