import * as THREE from 'three';
import { COLORS, RENDER } from './config';

export interface SceneBundle {
  scene: THREE.Scene;
  sun: THREE.DirectionalLight;
  accent: THREE.PointLight;
  fill: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  /** Keep the sky dome centred on the camera and the in-shader sun aligned to the sun light. */
  updateSky(camera: THREE.Camera): void;
}

/**
 * Builds the stylized world shell: sky + lights.
 * Platforms, solids, goal, and parallax come from LevelLoader.
 * Lights are created once — never per-frame.
 */
export function createScene(): SceneBundle {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(COLORS.skyHorizon);
  scene.fog = new THREE.Fog(COLORS.fog, RENDER.fogNear, RENDER.fogFar);

  const lights = addLights(scene);
  const sky = addSky(scene);
  const { sun } = lights;

  /**
   * The painted sun has no position of its own — it is the sun light's
   * direction. Z is mirrored into the far hemisphere because the near half of
   * the dome is behind the camera; unmirrored, the sun would claim to be the
   * light while sitting off-screen behind the viewer.
   */
  const alignSun = (): void => {
    sky.sunDir.copy(sun.position).sub(sun.target.position);
    sky.sunDir.z = -Math.abs(sky.sunDir.z);
    sky.sunDir.normalize();
  };
  alignSun();

  return {
    scene,
    ...lights,
    updateSky(camera: THREE.Camera): void {
      // Translation-invariant shader + dome pinned to the camera = a gradient
      // that cannot drift as the player crosses the level.
      sky.mesh.position.copy(camera.position);
      alignSun();
    },
  };
}

interface Sky {
  mesh: THREE.Mesh;
  /** Live uniform value — write in place, never reassign. */
  sunDir: THREE.Vector3;
}

function addSky(scene: THREE.Scene): Sky {
  // Direction, not world position: the gradient comes from object-space
  // position alone, so moving the dome with the camera changes nothing.
  const sunDir = new THREE.Vector3(0.42, 0.84, -0.36).normalize();
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    // The shader carries no tonemapping include; OutputPass applies the filmic
    // curve to the whole composite. This only declares that intent.
    toneMapped: false,
    uniforms: {
      topColor: { value: new THREE.Color(COLORS.skyTop) },
      horizonColor: { value: new THREE.Color(COLORS.skyHorizon) },
      bottomColor: { value: new THREE.Color(COLORS.skyBottom) },
      /**
       * Above 1.0 in linear so it clears the bloom high pass outright. Under
       * Game.ts's current rig the core never enters the frame — the light sits
       * at 57° elevation and the nearest on-screen direction is 49° off it —
       * so this only pays off if the sun is ever lowered.
       */
      sunCore: { value: new THREE.Color(0xfffaf0).multiplyScalar(3.4) },
      sunHalo: { value: new THREE.Color(0xffc878) },
      sunDir: { value: sunDir },
      offset: { value: 0.027 },
      exponent: { value: 0.65 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 topColor;
      uniform vec3 horizonColor;
      uniform vec3 bottomColor;
      uniform vec3 sunCore;
      uniform vec3 sunHalo;
      uniform vec3 sunDir;
      uniform float offset;
      uniform float exponent;
      varying vec3 vDir;
      void main() {
        vec3 dir = normalize(vDir);
        float h = normalize(dir + vec3(0.0, offset, 0.0)).y;
        float t = pow(max(h, 0.0), exponent);
        vec3 col = mix(horizonColor, topColor, t);
        // Weighted at 0.25, not 0.55: the sub-horizon band is the brightest sky
        // in the frame, and at 0.55 it reached 0.565 linear luma — over
        // RENDER.bloomThreshold — so the strip just above the ridgeline was the
        // only sky that bloomed. 0.25 caps the visible sky at 0.544.
        float below = clamp(-h * 2.5, 0.0, 1.0);
        col = mix(col, bottomColor, below * 0.25);

        // Chord distance between unit vectors — a hot core for the bloom pass
        // plus a warm wash so the sun's quadrant reads even though the core
        // itself is far outside the frame. The chord to the sun never drops
        // below 0.83 on screen, so the halo ramp has to span past that or it
        // evaluates to zero everywhere. Ramps are written low-edge-first because
        // GLSL leaves smoothstep undefined when edge0 >= edge1.
        float d = distance(dir, sunDir);
        col += sunCore * (1.0 - smoothstep(0.032, 0.055, d));
        col += sunHalo * 0.6 * pow(1.0 - smoothstep(0.0, 1.6, d), 3.0);

        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });

  const mesh = new THREE.Mesh(new THREE.SphereGeometry(120, 32, 16), skyMat);
  mesh.name = 'Sky';
  mesh.renderOrder = -10;
  // Always centred on the camera, so the cull test can never fail.
  mesh.frustumCulled = false;
  scene.add(mesh);

  return { mesh, sunDir };
}

function addLights(scene: THREE.Scene): {
  sun: THREE.DirectionalLight;
  accent: THREE.PointLight;
  fill: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
} {
  // Hemisphere owns all indirect light. An AmbientLight on top of it only adds
  // the sky term twice as a directionless lift, which is what kills form.
  const hemi = new THREE.HemisphereLight(COLORS.hemiSky, COLORS.hemiGround, 0.42);
  hemi.position.set(0, 40, 0);
  scene.add(hemi);

  // ~6:1 over the fill, so ACES has a highlight shoulder to roll off.
  const sun = new THREE.DirectionalLight(COLORS.sun, 2.2);
  sun.position.set(18, 28, 12);
  sun.castShadow = true;
  sun.shadow.mapSize.set(RENDER.shadowMapSize, RENDER.shadowMapSize);
  // Sized to the on-screen play volume around the target Game.ts drives
  // (playerX + 2, 0, 0), not to the backdrop: nothing casts onto the far ground
  // or the parallax ridges, so covering them only wasted texels. Measured by
  // projecting the visible band (z -3.5..3.5, y -7..11) into light space across
  // player heights, look-ahead, death falls and aspects up to 2.4: x [-12.64,
  // 12.26], y [-11.30, 21.45], depth [19.8, 50.3]. These add ~0.6 for screen
  // shake and the PCF kernel. 26.5 x 34 light units on a 2048 map instead of
  // 64 x 34 — ~2.4x the shadow texel density.
  sun.shadow.camera.left = -13.5;
  sun.shadow.camera.right = 13;
  sun.shadow.camera.top = 22;
  sun.shadow.camera.bottom = -12;
  // Depth range 46 instead of 89 — halves what a given `bias` costs in world
  // units and doubles depth precision.
  sun.shadow.camera.near = 8;
  sun.shadow.camera.far = 54;
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.bias = -0.0003;
  // Normalized bias now buys ~2x the world-space margin it did, so this can come
  // down and still clear the PCF slope error on platform tops.
  sun.shadow.normalBias = 0.032;
  sun.shadow.radius = 2.5;
  sun.target.position.set(4, 0, 0);
  scene.add(sun);
  scene.add(sun.target);

  const accent = new THREE.PointLight(COLORS.accentWarm, 1.05, 26, 1.7);
  accent.position.set(3, 4.5, 3);
  accent.castShadow = false;
  scene.add(accent);

  // Cool bounce from the camera side. The old fill at (-12, 8, -6) travelled the
  // same way as the sun and lit the back faces, so it was invisible; from +Z it
  // lifts the shadow flank and the faces pointing at the viewer.
  const fill = new THREE.DirectionalLight(COLORS.hemiSky, 0.35);
  fill.position.set(-14, 7, 16);
  scene.add(fill);

  return { sun, accent, fill, hemi };
}
