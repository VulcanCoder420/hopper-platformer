/**
 * Shared world / visual / physics placeholders for Hopper.
 * Units are meters-ish world units unless noted.
 */

export const WORLD = {
  /** Nominal ground height (Y). */
  groundY: 0,
  /** Playable strip width along X (for early levels). */
  levelWidth: 80,
  /** Depth of grassy platform strip along Z. */
  platformDepth: 6,
  /** Rise gravity (m/s²) — lighter while going up for floaty peak. */
  gravityRise: 32,
  /** Fall gravity (m/s²) — heavier on the way down for snappy Mario arcs. */
  gravityFall: 52,
  /** Soft max fall speed. */
  terminalVelocity: 36,
  /** Wide default camera / play bounds until a full level system lands. */
  bounds: {
    minX: -12,
    maxX: 48,
    minY: -4,
    maxY: 28,
  },
} as const;

/** Polished side-scroller player feel (Hopper). */
export const PLAYER = {
  /** AABB half-extents (full size = 2 * half). Feet at position.y. */
  halfWidth: 0.32,
  height: 1.28,
  /** Horizontal motion */
  maxRunSpeed: 8.4,
  maxSprintSpeed: 11.6,
  groundAccel: 62,
  groundDecel: 76,
  airAccel: 32,
  airDecel: 18,
  /** Jump — hold for full height; release cuts upward velocity. */
  jumpSpeed: 13.4,
  jumpCutMultiplier: 0.4,
  /** Grace windows (seconds) — generous for excellent edge feel. */
  coyoteTime: 0.12,
  jumpBuffer: 0.14,
  /** Sub-step when |v| is high to reduce tunneling. */
  maxStepDistance: 0.28,
  /** Skin for grounded probe / separation. */
  skin: 0.02,
  /** Downward speed threshold for stomp hook eligibility. */
  stompMinVy: -5.5,
  /**
   * Super / powered form (Bloom pickup). Slightly taller hitbox + jump boost;
   * first hazard hit drops back to normal instead of costing a life.
   */
  poweredHeightScale: 1.32,
  poweredHalfWidthScale: 1.1,
  poweredJumpSpeed: 14.6,
  poweredVisualScale: 1.22,
  /**
   * Crouch (duck). Shrinks the hitbox from the head down — feet stay planted —
   * so low gaps become passable. Applied on top of the power tier, so a powered
   * crouch is still shorter than a normal stand.
   */
  crouchHeightScale: 0.56,
  /** Crouch-walk speed as a fraction of the normal run cap. */
  crouchSpeedScale: 0.42,
} as const;

/** Bloom power-up (mushroom-like grow item — original name/art). */
export const BLOOM = {
  halfW: 0.28,
  height: 0.52,
  emergeDuration: 0.42,
  slideSpeed: 2.6,
  gravity: 48,
  terminal: 22,
  /** How high the item sits above the block top when fully emerged. */
  emergeHeight: 0.55,
} as const;

/** Prize-block hit feedback defaults. */
export const PRIZE = {
  bounceDuration: 0.12,
  bounceHeight: 0.22,
  multiCoinDefaultDuration: 3.2,
  multiCoinDefaultMax: 10,
  /** Ignore re-hits for this long after a successful eject (prevents multi-fire). */
  hitCooldown: 0.08,
} as const;

export const CAMERA = {
  /** Perspective FOV (degrees). */
  fov: 42,
  near: 0.1,
  far: 200,
  /** Side-scroller offset from follow target. */
  offset: { x: 2.5, y: 3.2, z: 12 },
  /** Look-at bias above target feet. */
  lookAtY: 1.4,
  /** Follow smoothing rate (damp lambda) on X. */
  followLambdaX: 7.5,
  /** Milder Y follow so jumps don't yank the frame as hard. */
  followLambdaY: 4.2,
  /** Look-at smoothing rate. */
  lookLambda: 8,
  /** Extra X offset from horizontal velocity (look-ahead). */
  lookAheadMax: 2.8,
  lookAheadLambda: 4.5,
  /** Scale: look-ahead ≈ clamp(vx / maxRun * lookAheadMax). */
  lookAheadSpeedRef: 8.4,
} as const;

export const RENDER = {
  shadowMapSize: 2048,
  /** Sun is bright enough that ACES needs headroom — keep exposure under 1. */
  toneMappingExposure: 0.95,
  /** Long, shallow fog ramp: aerial perspective on the play plane, backdrop
   *  layers washed most of the way into `COLORS.fog` by the far end. */
  fogNear: 8,
  fogFar: 95,
  /** Post-FX bloom (UnrealBloomPass) — wide and soft, not a tight halo. */
  bloomStrength: 0.38,
  bloomRadius: 0.6,
  /** Linear-luma cut, measured on the pre-tonemap HDR buffer. */
  bloomThreshold: 0.55,
  /** Luma ramp above the threshold so emissives fade in instead of popping. */
  bloomSmoothWidth: 0.08,
} as const;

/** Vibrant stylized palette — original, not Mario-branded. */
export const COLORS = {
  skyTop: 0x1a4f9c,
  skyHorizon: 0x7ec8f5,
  skyBottom: 0xc8e8ff,
  /** Exactly skyHorizon so backdrop layers dissolve into the sky, not past it. */
  fog: 0x7ec8f5,
  ambient: 0xb8d0f0,
  hemiSky: 0x9ec8ff,
  /** Warm dirt bounce for undersides — a green ground term made them glow. */
  hemiGround: 0x7a6a4a,
  sun: 0xfff0d0,
  accentWarm: 0xffb060,
  grass: 0x4caf50,
  grassDark: 0x2e7d32,
  dirt: 0x8d6e4a,
  dirtDark: 0x5d4037,
  stone: 0x78909c,
  stoneDark: 0x455a64,
  playerBody: 0xff6b4a,
  playerAccent: 0xffe066,
  playerEyes: 0x1a1a2e,
  /** Backdrop ridges: hillNear, then 30% / 60% mixed toward skyHorizon so the
   *  layers already sit where the fog ramp is taking them. */
  hillNear: 0x4f9a68,
  hillMid: 0x5da892,
  hillFar: 0x6bb6bd,
  platformAccent: 0xf4a261,
  coin: 0xffd54f,
} as const;

export const INPUT = {
  /** Legacy free-move smoke-test values (kept for reference / tools). */
  moveSpeed: 6.5,
  sprintMultiplier: 1.55,
  bobAmplitude: 0.08,
  bobFrequency: 10,
} as const;
