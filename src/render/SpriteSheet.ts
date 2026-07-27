/**
 * Procedural sprite-sheet engine.
 *
 * Frames are drawn at runtime into a single offscreen canvas grid and exposed
 * as one THREE.Texture. Animation is UV-window scrolling (texture.offset), so a
 * character costs one draw call and one shared GPU texture regardless of how
 * many clips or instances exist.
 *
 * No binary art assets, no new dependencies — the same "generate it" approach
 * the project already uses for audio.
 */

import * as THREE from 'three';

/** Draws frame `frame` into a (0,0,w,h) box. Origin top-left, y down (canvas space). */
export type FrameDrawFn = (
  ctx: CanvasRenderingContext2D,
  frame: number,
  w: number,
  h: number,
) => void;

export interface SpriteSheetOptions {
  /** Frame pixel width. */
  frameW: number;
  /** Frame pixel height. */
  frameH: number;
  /** Total frame count. */
  frames: number;
  /** Frames per sheet row. Defaults to a near-square grid. */
  cols?: number;
  /** Transparent gutter around each frame, in px, to stop bilinear bleed. */
  padding?: number;
  /** Per-frame painter. */
  draw: FrameDrawFn;
}

export interface SpriteSheet {
  readonly texture: THREE.Texture;
  readonly frames: number;
  readonly cols: number;
  readonly rows: number;
  readonly frameW: number;
  readonly frameH: number;
  /** Aspect ratio (w/h) of one frame — use it to size world planes. */
  readonly aspect: number;
  /** Point a texture (this one, or a clone) at frame `i`. */
  applyFrame(texture: THREE.Texture, i: number): void;
  /** Per-instance texture sharing this sheet's GPU upload. */
  cloneTexture(): THREE.Texture;
  dispose(): void;
}

/**
 * Build a sheet. `padding` defaults to 2px: with mipmapping on, a gutter keeps
 * neighbouring frames from bleeding into each other at minified sizes.
 */
export function buildSpriteSheet(opts: SpriteSheetOptions): SpriteSheet {
  const frameW = Math.max(1, Math.floor(opts.frameW));
  const frameH = Math.max(1, Math.floor(opts.frameH));
  const frames = Math.max(1, Math.floor(opts.frames));
  const padding = Math.max(0, Math.floor(opts.padding ?? 2));
  const cols = Math.max(1, Math.floor(opts.cols ?? Math.ceil(Math.sqrt(frames))));
  const rows = Math.ceil(frames / cols);

  const cellW = frameW + padding * 2;
  const cellH = frameH + padding * 2;
  const sheetW = cols * cellW;
  const sheetH = rows * cellH;

  const canvas = document.createElement('canvas');
  canvas.width = sheetW;
  canvas.height = sheetH;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('[SpriteSheet] 2D canvas context unavailable');
  }

  ctx.clearRect(0, 0, sheetW, sheetH);

  for (let i = 0; i < frames; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const ox = col * cellW + padding;
    const oy = row * cellH + padding;

    ctx.save();
    // Clip to the frame box so a sloppy painter cannot smear into the gutter.
    ctx.beginPath();
    ctx.rect(ox, oy, frameW, frameH);
    ctx.clip();
    ctx.translate(ox, oy);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    opts.draw(ctx, i, frameW, frameH);
    ctx.restore();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.needsUpdate = true;

  const repeatX = frameW / sheetW;
  const repeatY = frameH / sheetH;

  const applyFrame = (tex: THREE.Texture, i: number): void => {
    const f = i < 0 ? 0 : i >= frames ? frames - 1 : i;
    const col = f % cols;
    const row = Math.floor(f / cols);
    const left = col * cellW + padding;
    const top = row * cellH + padding;
    tex.repeat.set(repeatX, repeatY);
    // flipY (three's default for canvas sources) mirrors rows, so a region whose
    // top edge sits at image row `top` starts at v = 1 - (top + frameH)/sheetH.
    tex.offset.set(left / sheetW, 1 - (top + frameH) / sheetH);
  };

  applyFrame(texture, 0);

  const clones: THREE.Texture[] = [];

  return {
    texture,
    frames,
    cols,
    rows,
    frameW,
    frameH,
    aspect: frameW / frameH,
    applyFrame,
    cloneTexture() {
      // clone() shares Texture.source, so every instance reuses one GPU upload
      // while keeping its own offset/repeat window.
      const t = texture.clone();
      t.needsUpdate = true;
      applyFrame(t, 0);
      clones.push(t);
      return t;
    },
    dispose() {
      for (const t of clones) t.dispose();
      clones.length = 0;
      texture.dispose();
    },
  };
}

// --- Clips -----------------------------------------------------------------

export interface ClipDef {
  /** Frame indices into the sheet, in play order. */
  frames: readonly number[];
  /** Playback rate. */
  fps: number;
  /** Loop, or hold the final frame. Default true. */
  loop?: boolean;
}

export type ClipMap = Readonly<Record<string, ClipDef>>;

/**
 * Frame clock over a ClipMap. Pure state — owns no THREE objects.
 */
export class ClipPlayer<K extends string = string> {
  private readonly clips: ClipMap;
  private current: K;
  private time = 0;
  private index = 0;
  private done = false;

  constructor(clips: ClipMap, initial: K) {
    this.clips = clips;
    this.current = initial;
    if (!clips[initial]) {
      throw new Error(`[ClipPlayer] unknown initial clip "${initial}"`);
    }
  }

  get clip(): K {
    return this.current;
  }

  /** Sheet frame index to display right now. */
  get frame(): number {
    const def = this.clips[this.current];
    if (!def || def.frames.length === 0) return 0;
    const i = Math.min(this.index, def.frames.length - 1);
    return def.frames[i] ?? 0;
  }

  /** True once a non-looping clip has reached its last frame. */
  get finished(): boolean {
    return this.done;
  }

  /** Normalised progress through the current clip (0..1). */
  get progress(): number {
    const def = this.clips[this.current];
    if (!def || def.frames.length <= 1) return this.done ? 1 : 0;
    return Math.min(1, this.index / (def.frames.length - 1));
  }

  /**
   * Switch clips. Re-playing the active clip is a no-op unless `restart`.
   */
  play(name: K, restart = false): void {
    if (!this.clips[name]) return;
    if (name === this.current && !restart) return;
    this.current = name;
    this.time = 0;
    this.index = 0;
    this.done = false;
  }

  update(dt: number): void {
    const def = this.clips[this.current];
    if (!def || def.frames.length === 0) return;
    const loop = def.loop !== false;
    if (this.done && !loop) return;

    this.time += Math.max(0, dt);
    const step = 1 / Math.max(0.0001, def.fps);
    while (this.time >= step) {
      this.time -= step;
      if (this.index + 1 < def.frames.length) {
        this.index++;
      } else if (loop) {
        this.index = 0;
      } else {
        this.done = true;
        break;
      }
    }
  }
}

// --- Character art bundles -------------------------------------------------

/**
 * Everything needed to instantiate one character's sprite: the shared sheet,
 * its clip table, and the world-space sizing that puts feet on the ground.
 * Art modules expose a cached `get*Art()` returning this.
 */
export interface CharacterArt {
  sheet: SpriteSheet;
  clips: ClipMap;
  /** World height of the sprite plane. */
  worldHeight: number;
  /** Fraction of frame height that is empty space below the feet baseline. */
  feetInset: number;
}

/** Build an AnimatedSprite straight from a CharacterArt bundle. */
export function spriteFromArt(
  art: CharacterArt,
  initialClip: string,
  opts: { castShadow?: boolean; alphaTest?: number } = {},
): AnimatedSprite {
  return new AnimatedSprite({
    sheet: art.sheet,
    clips: art.clips,
    initialClip,
    worldHeight: art.worldHeight,
    feetInset: art.feetInset,
    castShadow: opts.castShadow ?? true,
    alphaTest: opts.alphaTest,
  });
}

// --- World sprite ----------------------------------------------------------

export interface AnimatedSpriteOptions {
  sheet: SpriteSheet;
  clips: ClipMap;
  initialClip: string;
  /** World height of the plane. Width follows the frame aspect unless given. */
  worldHeight: number;
  worldWidth?: number;
  /**
   * Fraction of the frame height that is empty padding below the character's
   * feet. Shifts the plane down so feet land exactly on y=0.
   */
  feetInset?: number;
  castShadow?: boolean;
  /** Alpha cutoff. 0.5 sits inside a drawn outline and reads as a clean edge. */
  alphaTest?: number;
}

/**
 * A billboard plane driven by a ClipPlayer.
 *
 * Feet sit at local y = 0 and the mesh faces +Z, matching the game's
 * entity convention (position is bottom-centre) and its fixed camera azimuth.
 * Facing flips via scale.x, so squash/stretch must go through setDeform().
 */
export class AnimatedSprite {
  readonly group: THREE.Group;
  readonly mesh: THREE.Mesh;
  readonly player: ClipPlayer;

  private readonly sheet: SpriteSheet;
  private readonly texture: THREE.Texture;
  private readonly material: THREE.MeshStandardMaterial;
  private readonly geometry: THREE.PlaneGeometry;
  private readonly depthMaterial: THREE.MeshDepthMaterial;
  private lastFrame = -1;
  private facing: 1 | -1 = 1;

  constructor(opts: AnimatedSpriteOptions) {
    this.sheet = opts.sheet;
    this.player = new ClipPlayer(opts.clips, opts.initialClip);

    const h = opts.worldHeight;
    const w = opts.worldWidth ?? h * opts.sheet.aspect;

    this.geometry = new THREE.PlaneGeometry(w, h);
    // Anchor feet at y=0, discounting transparent space under the character.
    const inset = (opts.feetInset ?? 0) * h;
    this.geometry.translate(0, h * 0.5 - inset, 0);

    this.texture = opts.sheet.cloneTexture();

    this.material = new THREE.MeshStandardMaterial({
      map: this.texture,
      transparent: false,
      alphaTest: opts.alphaTest ?? 0.5,
      roughness: 0.92,
      metalness: 0,
      // Art carries its own baked shading; lights only tint it.
      side: THREE.FrontSide,
    });

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.castShadow = opts.castShadow ?? true;
    this.mesh.receiveShadow = false;

    // Default depth material ignores alphaTest, which would cast a rectangular
    // shadow. Mirror the cutout so the shadow follows the silhouette.
    this.depthMaterial = new THREE.MeshDepthMaterial({
      depthPacking: THREE.RGBADepthPacking,
      map: this.texture,
      alphaTest: this.material.alphaTest,
    });
    this.mesh.customDepthMaterial = this.depthMaterial;

    this.group = new THREE.Group();
    this.group.add(this.mesh);

    this.sheet.applyFrame(this.texture, this.player.frame);
    this.lastFrame = this.player.frame;
  }

  get object3d(): THREE.Object3D {
    return this.group;
  }

  play(clip: string, restart = false): void {
    this.player.play(clip, restart);
  }

  get clip(): string {
    return this.player.clip;
  }

  get finished(): boolean {
    return this.player.finished;
  }

  setPosition(x: number, y: number, z = 0): void {
    this.group.position.set(x, y, z);
  }

  setFacing(facing: 1 | -1): void {
    this.facing = facing;
  }

  /**
   * Apply squash/stretch. `sy` scales height; width compensates to conserve
   * volume. Facing is folded in here so it survives deformation.
   */
  setDeform(sy: number, extraX = 1): void {
    const clamped = Math.max(0.2, sy);
    const sxz = (1 / Math.sqrt(clamped)) * extraX;
    this.mesh.scale.set(sxz * this.facing, clamped, 1);
  }

  /** Advance the clip clock and push the new UV window if the frame changed. */
  update(dt: number): void {
    this.player.update(dt);
    const f = this.player.frame;
    if (f !== this.lastFrame) {
      this.sheet.applyFrame(this.texture, f);
      this.lastFrame = f;
    }
  }

  /** Fade out (death anims). Flips to blended mode on first use. */
  setOpacity(opacity: number): void {
    if (opacity >= 1) {
      if (this.material.transparent) {
        this.material.transparent = false;
        this.material.opacity = 1;
        this.material.needsUpdate = true;
      }
      return;
    }
    if (!this.material.transparent) {
      this.material.transparent = true;
      this.material.needsUpdate = true;
    }
    this.material.opacity = Math.max(0, opacity);
  }

  /**
   * Release per-instance resources. The shared sheet is owned by its registry
   * and is deliberately left alone.
   */
  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.depthMaterial.dispose();
    this.texture.dispose();
    this.mesh.customDepthMaterial = undefined as unknown as THREE.Material;
    this.group.removeFromParent();
  }
}

// --- Shared sheet registry -------------------------------------------------

const registry = new Map<string, SpriteSheet>();

/**
 * Build-once cache. Sheets are process-wide and survive level swaps, so
 * character art is rasterised a single time per session.
 */
export function getSheet(key: string, build: () => SpriteSheet): SpriteSheet {
  const existing = registry.get(key);
  if (existing) return existing;
  const sheet = build();
  registry.set(key, sheet);
  return sheet;
}

/** Drop every cached sheet. For teardown/HMR only. */
export function disposeAllSheets(): void {
  for (const sheet of registry.values()) sheet.dispose();
  registry.clear();
}
