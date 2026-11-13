import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

export const LOT_SIZE = 600;

export interface World {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  sun: THREE.DirectionalLight;
  /** Prefiltered reflection map for car paint / chrome / glass (not applied to the ground). */
  envMap: THREE.Texture;
  /** Keep the shadow frustum centred on the player. */
  follow(x: number, z: number): void;
  resize(): void;
}

function asphaltTexture(renderer: THREE.WebGLRenderer): THREE.CanvasTexture {
  const size = 512;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#5b5d61';
  g.fillRect(0, 0, size, size);
  const img = g.getImageData(0, 0, size, size);
  // aggregate noise: fine grain + a few lighter stones
  let seed = 1337;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rnd() - 0.5) * 26 + (rnd() < 0.02 ? 30 : 0);
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n + 1;
  }
  g.putImageData(img, 0, 0);
  // subtle seams every tile so speed is readable
  g.strokeStyle = 'rgba(30,30,32,0.35)';
  g.lineWidth = 2;
  g.strokeRect(1, 1, size - 2, size - 2);
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return tex;
}

export function createWorld(container: HTMLElement): World {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const sky = new THREE.Color('#a9c4dc');
  scene.background = sky;
  scene.fog = new THREE.Fog(sky, 180, 700);

  scene.add(new THREE.HemisphereLight('#dfeaf5', '#4a4640', 1.1));
  const sun = new THREE.DirectionalLight('#fff4e0', 2.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = sc.bottom = -25; sc.right = sc.top = 25; sc.near = 1; sc.far = 120;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);
  const sunOffset = new THREE.Vector3(-30, 55, -20);

  // the lot
  const tex = asphaltTexture(renderer);
  tex.repeat.set(LOT_SIZE / 8, LOT_SIZE / 8);
  const lot = new THREE.Mesh(
    new THREE.PlaneGeometry(LOT_SIZE, LOT_SIZE),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 0.93, metalness: 0 }),
  );
  lot.rotation.x = -Math.PI / 2;
  lot.receiveShadow = true;
  scene.add(lot);

  // dull surroundings to the horizon: a frame around the lot (no overlap → no z-fighting from afar)
  const grass = new THREE.MeshStandardMaterial({ color: '#6f7a5c', roughness: 1 });
  const H = LOT_SIZE / 2, FAR = 2000;
  for (const [cx, cz, w, d] of [
    [0, H + (FAR - H) / 2, FAR * 2, FAR - H], [0, -H - (FAR - H) / 2, FAR * 2, FAR - H],
    [H + (FAR - H) / 2, 0, FAR - H, LOT_SIZE], [-H - (FAR - H) / 2, 0, FAR - H, LOT_SIZE],
  ]) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), grass);
    m.rotation.x = -Math.PI / 2;
    m.position.set(cx, -0.01, cz);
    scene.add(m);
  }

  // lot edge line
  const border = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(LOT_SIZE - 2, 0.01, LOT_SIZE - 2)),
    new THREE.LineBasicMaterial({ color: '#e6e0c8' }),
  );
  border.position.y = 0.01;
  scene.add(border);

  const resize = () => {
    const w = container.clientWidth, h = container.clientHeight;
    renderer.setSize(w, h, false);
  };
  resize();

  const pmrem = new THREE.PMREMGenerator(renderer);
  const envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();

  return {
    renderer, scene, sun, resize, envMap,
    follow(x, z) {
      sun.position.set(x + sunOffset.x, sunOffset.y, z + sunOffset.z);
      sun.target.position.set(x, 0, z);
    },
  };
}
