/**
 * EffectComposer stack: scene render → subtle Unreal bloom →
 * mild color grade → vignette → output (tone map + color space).
 * Tuned for mid-hardware 60fps — bloom stays decorative, never blinding.
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { VignetteShader } from 'three/examples/jsm/shaders/VignetteShader.js';
import { ColorCorrectionShader } from 'three/examples/jsm/shaders/ColorCorrectionShader.js';

export interface PostFXOptions {
  /** Bloom strength (0.2–0.45 is subtle). */
  bloomStrength?: number;
  bloomRadius?: number;
  bloomThreshold?: number;
  /** Vignette darkness (higher = darker edges). */
  vignetteDarkness?: number;
  vignetteOffset?: number;
}

export class PostFX {
  readonly composer: EffectComposer;
  readonly bloomPass: UnrealBloomPass;
  readonly colorPass: ShaderPass;
  readonly vignettePass: ShaderPass;
  private readonly renderPass: RenderPass;
  private enabled = true;

  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    width: number,
    height: number,
    opts: PostFXOptions = {},
  ) {
    const w = Math.max(1, Math.floor(width));
    const h = Math.max(1, Math.floor(height));

    this.composer = new EffectComposer(renderer);
    this.composer.setPixelRatio(renderer.getPixelRatio());
    this.composer.setSize(w, h);

    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);

    // Subtle glow — coins / sun / emissives read as sparkle, not HDR glare
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(w, h),
      opts.bloomStrength ?? 0.28,
      opts.bloomRadius ?? 0.35,
      opts.bloomThreshold ?? 0.82,
    );
    this.composer.addPass(this.bloomPass);

    // Mild warm grade + slight contrast lift
    this.colorPass = new ShaderPass(ColorCorrectionShader);
    this.colorPass.uniforms['powRGB'].value = new THREE.Vector3(0.98, 0.99, 1.02);
    this.colorPass.uniforms['mulRGB'].value = new THREE.Vector3(1.04, 1.01, 0.97);
    this.colorPass.uniforms['addRGB'].value = new THREE.Vector3(0.01, 0.008, 0.0);
    this.composer.addPass(this.colorPass);

    // Soft cinematic vignette (CSS overlay remains as a light secondary falloff)
    this.vignettePass = new ShaderPass(VignetteShader);
    this.vignettePass.uniforms['offset'].value = opts.vignetteOffset ?? 1.12;
    this.vignettePass.uniforms['darkness'].value = opts.vignetteDarkness ?? 0.95;
    this.composer.addPass(this.vignettePass);

    // Applies renderer tone mapping + output color space
    this.composer.addPass(new OutputPass());
  }

  setCamera(camera: THREE.Camera): void {
    this.renderPass.camera = camera;
  }

  setScene(scene: THREE.Scene): void {
    this.renderPass.scene = scene;
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setSize(width: number, height: number): void {
    const w = Math.max(1, Math.floor(width));
    const h = Math.max(1, Math.floor(height));
    this.composer.setSize(w, h);
    this.bloomPass.resolution.set(w, h);
  }

  setPixelRatio(ratio: number): void {
    this.composer.setPixelRatio(ratio);
  }

  render(): void {
    if (this.enabled) {
      this.composer.render();
    }
  }

  dispose(): void {
    this.composer.dispose();
  }
}
