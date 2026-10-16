import * as THREE from 'three';
import type { EnvironmentDef } from '../schema';
import { toonMaterial } from './toon';
import { WindSystem } from './wind';

interface LightPreset {
  sky: string;
  ground: string;
  sun: string;
  sunIntensity: number;
  sunDir: [number, number, number];
  hemiSky: string;
  hemiGround: string;
  hemiIntensity: number;
}

const PRESETS: Record<EnvironmentDef['preset'], LightPreset> = {
  day: {
    sky: '#8fd3ff', ground: '#7cc95b', sun: '#fff3dc', sunIntensity: 2.4, sunDir: [6, 10, 5],
    hemiSky: '#ffffff', hemiGround: '#9ab37a', hemiIntensity: 1.1,
  },
  sunset: {
    sky: '#ffb37a', ground: '#a3b25a', sun: '#ffc48a', sunIntensity: 2.2, sunDir: [9, 4, 3],
    hemiSky: '#ffd9c0', hemiGround: '#6d6a4a', hemiIntensity: 0.9,
  },
  night: {
    sky: '#1d2550', ground: '#2f4a3a', sun: '#c4d2ff', sunIntensity: 1.6, sunDir: [-5, 9, 4],
    hemiSky: '#8090d0', hemiGround: '#283038', hemiIntensity: 1.0,
  },
};

export interface BuiltEnvironment {
  group: THREE.Group;
  sky: THREE.Color;
  fog: THREE.Fog | null;
  /** Güneş ve hedefine göre konumu; gölge alanı kameranın baktığı yeri takip etsin diye. */
  sun: THREE.DirectionalLight;
  sunOffset: THREE.Vector3;
  hemi: THREE.HemisphereLight;
  wind: WindSystem | null;
}

export function buildEnvironment(def: EnvironmentDef): BuiltEnvironment {
  const p = PRESETS[def.preset];
  const sky = new THREE.Color(def.sky ?? p.sky);
  const group = new THREE.Group();

  // Haritada hiçbir zaman gökyüzü boşluğu kalmaması için geniş alt zemin eteği (sadece zemin düzlemi açıksa)
  if (def.ground_plane !== false) {
    const underSkirtColor = def.ground ?? '#584a37';
    const underSkirt = new THREE.Mesh(
      new THREE.CircleGeometry(350, 64).rotateX(-Math.PI / 2),
      toonMaterial(underSkirtColor, { outline: false }),
    );
    underSkirt.name = 'under_ground_skirt';
    underSkirt.position.y = (def.ground_level ?? 0) - 1.0;
    underSkirt.receiveShadow = false;
    group.add(underSkirt);
  }

  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(300, 64).rotateX(-Math.PI / 2),
    toonMaterial(def.ground ?? p.ground, { outline: false }),
  );
  ground.receiveShadow = true;
  ground.position.y = def.ground_level ?? 0;
  if (def.ground_plane !== false) group.add(ground);

  const hemi = new THREE.HemisphereLight(p.hemiSky, p.hemiGround, p.hemiIntensity);
  group.add(hemi);

  const sun = new THREE.DirectionalLight(p.sun, p.sunIntensity);
  sun.position.set(...p.sunDir).multiplyScalar(5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -38, right: 38, top: 38, bottom: -38, near: 1, far: 140 });
  sun.shadow.bias = -0.0008;
  sun.shadow.normalBias = 0.04;
  group.add(sun, sun.target);

  const wind = def.wind?.enabled === true ? new WindSystem(group, def.wind) : null;

  return {
    group,
    sky,
    fog: def.fog ? new THREE.Fog(sky, def.fog_near, def.fog_far) : null,
    sun,
    sunOffset: sun.position.clone(),
    hemi,
    wind,
  };
}
