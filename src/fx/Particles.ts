import * as THREE from 'three';

/** Max simultaneous particles (hard cap for mid-hardware 60fps + bloom). */
export const PARTICLE_CAP = 180;

interface Particle {
  active: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  size: number;
  /** Packed RGB 0–1 */
  r: number;
  g: number;
  b: number;
  /** Gravity scale (1 = normal world-ish fall). */
  gravity: number;
  drag: number;
}

export type BurstKind = 'coinSparkle' | 'enemyDeath' | 'jumpDust' | 'landDust' | 'landImpact';

/** Soft round spark. Without a map, THREE.Points draws hard squares. */
function makeSparkTexture(): THREE.Texture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const r = size * 0.5;
    const g = ctx.createRadialGradient(r, r, 0, r, r, r);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.72)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Pooled GPU-friendly particle system using a single THREE.Points.
 * Supports coin sparkles, enemy death puffs, jump/landing dust.
 */
export class ParticleSystem {
  readonly object3d: THREE.Points;
  private readonly particles: Particle[] = [];
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly sizes: Float32Array;
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.PointsMaterial;
  private activeCount = 0;

  constructor(cap = PARTICLE_CAP) {
    const n = cap;
    this.positions = new Float32Array(n * 3);
    this.colors = new Float32Array(n * 3);
    this.sizes = new Float32Array(n);

    for (let i = 0; i < n; i++) {
      this.particles.push({
        active: false,
        x: 0,
        y: 0,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        life: 0,
        maxLife: 1,
        size: 0.1,
        r: 1,
        g: 1,
        b: 1,
        gravity: 1,
        drag: 0.5,
      });
      // Park inactive far away / zero alpha via size
      this.positions[i * 3] = 0;
      this.positions[i * 3 + 1] = -9999;
      this.positions[i * 3 + 2] = 0;
      this.sizes[i] = 0;
    }

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    this.geometry.setAttribute('aSize', new THREE.BufferAttribute(this.sizes, 1));

    this.material = new THREE.PointsMaterial({
      // Base size stays at 1 so the per-particle aSize attribute below is the
      // real world size. PointsMaterial.size alone is uniform across the pool.
      size: 1,
      map: makeSparkTexture(),
      vertexColors: true,
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
      sizeAttenuation: true,
      blending: THREE.AdditiveBlending,
    });

    this.material.onBeforeCompile = (shader) => {
      shader.vertexShader =
        'attribute float aSize;\n' +
        shader.vertexShader.replace(
          'gl_PointSize = size;',
          'gl_PointSize = size * aSize;',
        );
    };

    this.object3d = new THREE.Points(this.geometry, this.material);
    this.object3d.name = 'Particles';
    this.object3d.frustumCulled = false;
  }

  get count(): number {
    return this.activeCount;
  }

  /** Generic emit helper. */
  emit(
    x: number,
    y: number,
    z: number,
    opts: {
      count: number;
      speedMin?: number;
      speedMax?: number;
      lifeMin?: number;
      lifeMax?: number;
      sizeMin?: number;
      sizeMax?: number;
      color?: number | number[];
      gravity?: number;
      drag?: number;
      coneUp?: boolean;
      spreadY?: number;
    },
  ): void {
    const count = opts.count;
    const speedMin = opts.speedMin ?? 1;
    const speedMax = opts.speedMax ?? 4;
    const lifeMin = opts.lifeMin ?? 0.25;
    const lifeMax = opts.lifeMax ?? 0.6;
    const sizeMin = opts.sizeMin ?? 0.08;
    const sizeMax = opts.sizeMax ?? 0.2;
    const gravity = opts.gravity ?? 8;
    const drag = opts.drag ?? 1.5;
    const colors = Array.isArray(opts.color)
      ? opts.color
      : [opts.color ?? 0xffffff];

    for (let i = 0; i < count; i++) {
      const p = this.acquire();
      if (!p) break;

      const angle = Math.random() * Math.PI * 2;
      const elev = opts.coneUp
        ? Math.random() * Math.PI * 0.45
        : (Math.random() - 0.5) * Math.PI;
      const speed = speedMin + Math.random() * (speedMax - speedMin);
      const cosE = Math.cos(elev);
      p.x = x + (Math.random() - 0.5) * 0.15;
      p.y = y + (Math.random() - 0.5) * 0.1;
      p.z = z + (Math.random() - 0.5) * 0.15;
      p.vx = Math.cos(angle) * cosE * speed;
      p.vy = opts.coneUp
        ? Math.sin(elev) * speed + (opts.spreadY ?? 0.5)
        : Math.sin(elev) * speed * 0.85 + (opts.spreadY ?? 0);
      p.vz = Math.sin(angle) * cosE * speed * 0.55;
      p.life = lifeMin + Math.random() * (lifeMax - lifeMin);
      p.maxLife = p.life;
      p.size = sizeMin + Math.random() * (sizeMax - sizeMin);
      p.gravity = gravity;
      p.drag = drag;

      const hex = colors[i % colors.length]!;
      const c = new THREE.Color(hex);
      p.r = c.r;
      p.g = c.g;
      p.b = c.b;
    }
  }

  /** Golden sparkle burst when collecting a coin. */
  emitCoinSparkle(x: number, y: number, z = 0): void {
    this.emit(x, y, z, {
      count: 10,
      speedMin: 2.2,
      speedMax: 6.5,
      lifeMin: 0.28,
      lifeMax: 0.55,
      sizeMin: 0.1,
      sizeMax: 0.22,
      color: [0xffe082, 0xffd54f, 0xfff8e1, 0xffc107],
      gravity: 4,
      drag: 2.2,
      coneUp: true,
      spreadY: 1.2,
    });
  }

  /** Puff cloud when an enemy is stomped. */
  emitEnemyDeath(x: number, y: number, z = 0): void {
    this.emit(x, y, z, {
      count: 12,
      speedMin: 1.5,
      speedMax: 5.5,
      lifeMin: 0.3,
      lifeMax: 0.65,
      sizeMin: 0.12,
      sizeMax: 0.28,
      color: [0xef9a9a, 0xffccbc, 0xbcaaa4, 0xffe0b2, 0x90a4ae],
      gravity: 6,
      drag: 2.8,
      coneUp: true,
      spreadY: 2.0,
    });
    // A few darker smoke bits
    this.emit(x, y, z, {
      count: 4,
      speedMin: 0.8,
      speedMax: 2.5,
      lifeMin: 0.4,
      lifeMax: 0.8,
      sizeMin: 0.15,
      sizeMax: 0.32,
      color: [0x78909c, 0x546e7a],
      gravity: 2,
      drag: 1.2,
      coneUp: true,
      spreadY: 0.8,
    });
  }

  /** Small dust when leaving the ground (jump). */
  emitJumpDust(x: number, y: number, z = 0): void {
    this.emit(x, y, z, {
      count: 8,
      speedMin: 1.0,
      speedMax: 3.2,
      lifeMin: 0.18,
      lifeMax: 0.38,
      sizeMin: 0.08,
      sizeMax: 0.18,
      color: [0xd7ccc8, 0xbcaaa4, 0xa1887f],
      gravity: 10,
      drag: 3.5,
      coneUp: false,
      spreadY: 0.4,
    });
  }

  /** Landing dust plume (scale by impact). */
  emitLandingDust(x: number, y: number, z = 0, intensity = 1): void {
    const t = Math.min(2.2, Math.max(0.4, intensity));
    this.emit(x, y, z, {
      count: Math.round(8 * t),
      speedMin: 1.2 * t,
      speedMax: 3.8 * t,
      lifeMin: 0.2,
      lifeMax: 0.45 * Math.min(t, 1.4),
      sizeMin: 0.09,
      sizeMax: 0.2 * t,
      color: [0xe0e0e0, 0xbdbdbd, 0xa1887f, 0x8d6e63],
      gravity: 12,
      drag: 4,
      coneUp: true,
      spreadY: 0.3,
    });
  }

  /** Harder impact spray for heavy landings. */
  emitLandingImpact(x: number, y: number, z = 0, intensity = 1): void {
    const t = Math.min(2.5, Math.max(0.6, intensity));
    this.emitLandingDust(x, y, z, t);
    this.emit(x, y + 0.05, z, {
      count: Math.round(6 * t),
      speedMin: 2 * t,
      speedMax: 5 * t,
      lifeMin: 0.15,
      lifeMax: 0.35,
      sizeMin: 0.06,
      sizeMax: 0.14,
      color: [0xfff3e0, 0xffe0b2],
      gravity: 14,
      drag: 2,
      coneUp: true,
      spreadY: 1.5,
    });
  }

  /** Convenience by kind name. */
  burst(kind: BurstKind, x: number, y: number, z = 0, intensity = 1): void {
    switch (kind) {
      case 'coinSparkle':
        this.emitCoinSparkle(x, y, z);
        break;
      case 'enemyDeath':
        this.emitEnemyDeath(x, y, z);
        break;
      case 'jumpDust':
        this.emitJumpDust(x, y, z);
        break;
      case 'landDust':
        this.emitLandingDust(x, y, z, intensity);
        break;
      case 'landImpact':
        this.emitLandingImpact(x, y, z, intensity);
        break;
    }
  }

  update(dt: number): void {
    if (dt <= 0) return;
    let active = 0;

    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i]!;
      if (!p.active) {
        this.positions[i * 3 + 1] = -9999;
        this.sizes[i] = 0;
        continue;
      }

      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        this.positions[i * 3 + 1] = -9999;
        this.sizes[i] = 0;
        continue;
      }

      const drag = Math.exp(-p.drag * dt);
      p.vx *= drag;
      p.vy *= drag;
      p.vz *= drag;
      p.vy -= p.gravity * dt;

      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;

      const t = p.life / p.maxLife;
      // Fade size toward end of life
      const fade = t < 0.3 ? t / 0.3 : 1;

      this.positions[i * 3] = p.x;
      this.positions[i * 3 + 1] = p.y;
      this.positions[i * 3 + 2] = p.z;
      this.colors[i * 3] = p.r;
      this.colors[i * 3 + 1] = p.g;
      this.colors[i * 3 + 2] = p.b;
      this.sizes[i] = p.size * fade;

      // Dim color as life ends for soft dissolve
      const dim = 0.35 + 0.65 * fade;
      this.colors[i * 3] *= dim;
      this.colors[i * 3 + 1] *= dim;
      this.colors[i * 3 + 2] *= dim;

      active += 1;
    }

    this.activeCount = active;

    this.geometry.getAttribute('position').needsUpdate = true;
    this.geometry.getAttribute('color').needsUpdate = true;
    this.geometry.getAttribute('aSize').needsUpdate = true;
  }

  private acquire(): Particle | null {
    for (const p of this.particles) {
      if (!p.active) {
        p.active = true;
        return p;
      }
    }
    // Pool full — steal oldest (lowest life)
    let worst: Particle | null = null;
    for (const p of this.particles) {
      if (!worst || p.life < worst.life) worst = p;
    }
    if (worst) {
      worst.active = true;
      return worst;
    }
    return null;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.map?.dispose();
    this.material.dispose();
    this.object3d.removeFromParent();
  }
}
