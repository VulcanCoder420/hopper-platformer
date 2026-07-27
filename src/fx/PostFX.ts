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
  /** Linear-luma cut on the pre-tonemap HDR buffer. */
  bloomThreshold?: number;
  /** Luma ramp above the threshold — 0 cuts binarily, ~0.08 fades in. */
  bloomSmoothWidth?: number;
  /** Vignette darkness (higher = darker edges). */
  vignetteDarkness?: number;
  vignetteOffset?: number;
}

export class PostFX {
  readonly composer: EffectComposer;
  readonly bloomPass: UnrealBloomPass;
  readonly colorPass: ShaderPass;
  readonly vignettePass: ShaderPass;
  /** MSAA sample count actually in use (0 when gated off). */
  readonly samples: number;
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

    // EffectComposer's default target is samples: 0, which silently throws away
    // the renderer's own MSAA — everything is drawn offscreen and resolved flat.
    // Hand it a multisampled target instead; renderTarget2 is cloned from this
    // one and RenderTarget.copy carries `samples` across, so both halves of the
    // ping-pong are multisampled and three resolves the FBO on unbind.
    // High-DPI panels already pay 4x the fill rate, so skip MSAA there.
    // `capabilities.isWebGL2` is a hardcoded back-compat `true` in three 0.172 —
    // `maxSamples` is the real capability, and three clamps to it anyway.
    this.samples =
      window.devicePixelRatio < 2
        ? Math.min(4, renderer.capabilities.maxSamples)
        : 0;
    const target = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType,
      stencilBuffer: false,
      samples: this.samples,
    });
    target.texture.name = 'PostFX.rt';

    this.composer = new EffectComposer(renderer, target);
    this.composer.setPixelRatio(renderer.getPixelRatio());
    this.composer.setSize(w, h);

    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);

    // Wide soft glow on authored emissives. The high pass reads the linear HDR
    // buffer before OutputPass, so the threshold is a linear luma, not sRGB.
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(w, h),
      opts.bloomStrength ?? 0.55,
      opts.bloomRadius ?? 0.6,
      opts.bloomThreshold ?? 0.55,
    );
    // Ramp the cut so an emissive fades into the glow as it brightens instead of
    // switching on. `materialHighPassFilter.uniforms` is the same object as
    // `bloomPass.highPassUniforms`, but typed, so it indexes without a cast.
    this.bloomPass.materialHighPassFilter.uniforms['smoothWidth'].value =
      opts.bloomSmoothWidth ?? 0.08;
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
    // composer.setSize forwards `w * pixelRatio` to every pass, which is what
    // resizes the bloom mip chain. UnrealBloomPass.setSize never reads back
    // `resolution`, so poking it here only stored a stale unscaled value.
    this.composer.setSize(w, h);
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
