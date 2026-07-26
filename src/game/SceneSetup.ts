import * as THREE from 'three';
import { COLORS, RENDER } from './config';

export interface SceneBundle {
  scene: THREE.Scene;
  sun: THREE.DirectionalLight;
  accent: THREE.PointLight;
  fill: THREE.DirectionalLight;
  ambient: THREE.AmbientLight;
  hemi: THREE.HemisphereLight;
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

  addSky(scene);
  const lights = addLights(scene);

  return { scene, ...lights };
}

function addSky(scene: THREE.Scene): void {
  // Layered gradient sky dome (back-side sphere) for rich depth without a custom shader.
  const skyGeo = new THREE.SphereGeometry(120, 32, 16);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      topColor: { value: new THREE.Color(COLORS.skyTop) },
      horizonColor: { value: new THREE.Color(COLORS.skyHorizon) },
      bottomColor: { value: new THREE.Color(COLORS.skyBottom) },
      offset: { value: 0.08 },
      exponent: { value: 0.65 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorldPos;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorldPos = world.xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 topColor;
      uniform vec3 horizonColor;
      uniform vec3 bottomColor;
      uniform float offset;
      uniform float exponent;
      varying vec3 vWorldPos;
      void main() {
        float h = normalize(vWorldPos + vec3(0.0, offset * 40.0, 0.0)).y;
        float t = max(h, 0.0);
        t = pow(t, exponent);
        vec3 col = mix(horizonColor, topColor, t);
        float below = clamp(-h * 2.5, 0.0, 1.0);
        col = mix(col, bottomColor, below * 0.55);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const sky = new THREE.Mesh(skyGeo, skyMat);
  sky.name = 'Sky';
  sky.renderOrder = -10;
  scene.add(sky);

  // Soft sun disc (emissive) for a painterly horizon accent.
  const sunDisc = new THREE.Mesh(
    new THREE.SphereGeometry(3.2, 24, 16),
    new THREE.MeshBasicMaterial({
      color: 0xffe8a8,
      fog: false,
      transparent: true,
      opacity: 0.92,
    }),
  );
  sunDisc.position.set(28, 18, -55);
  sunDisc.name = 'SunDisc';
  scene.add(sunDisc);

  const glow = new THREE.Mesh(
    new THREE.SphereGeometry(6.5, 24, 16),
    new THREE.MeshBasicMaterial({
      color: 0xffc878,
      fog: false,
      transparent: true,
      opacity: 0.18,
    }),
  );
  glow.position.copy(sunDisc.position);
  scene.add(glow);
}

function addLights(scene: THREE.Scene): {
  sun: THREE.DirectionalLight;
  accent: THREE.PointLight;
  fill: THREE.DirectionalLight;
  ambient: THREE.AmbientLight;
  hemi: THREE.HemisphereLight;
} {
  const ambient = new THREE.AmbientLight(COLORS.ambient, 0.4);
  scene.add(ambient);

  const hemi = new THREE.HemisphereLight(COLORS.hemiSky, COLORS.hemiGround, 0.58);
  hemi.position.set(0, 40, 0);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(COLORS.sun, 1.4);
  sun.position.set(18, 28, 12);
  sun.castShadow = true;
  sun.shadow.mapSize.set(RENDER.shadowMapSize, RENDER.shadowMapSize);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 90;
  sun.shadow.camera.left = -32;
  sun.shadow.camera.right = 32;
  sun.shadow.camera.top = 24;
  sun.shadow.camera.bottom = -10;
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.035;
  sun.shadow.radius = 2.5;
  sun.target.position.set(4, 0, 0);
  scene.add(sun);
  scene.add(sun.target);

  const accent = new THREE.PointLight(COLORS.accentWarm, 1.05, 26, 1.7);
  accent.position.set(3, 4.5, 3);
  accent.castShadow = false;
  scene.add(accent);

  // Gentle fill from the left so faces aren't pure black.
  const fill = new THREE.DirectionalLight(0xa8c8ff, 0.28);
  fill.position.set(-12, 8, -6);
  scene.add(fill);

  return { sun, accent, fill, ambient, hemi };
}
