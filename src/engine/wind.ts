import * as THREE from 'three';
import type { Heightfield } from './terrain';

export interface WindConfig {
  enabled?: boolean;
  speed?: number;
  strength?: number;
  direction?: [number, number];
  leaves?: boolean;
}

export const windUniforms = {
  uTime: { value: 0 },
  uWindSpeed: { value: 1.0 },
  uWindStrength: { value: 0.5 },
  uWindDir: { value: new THREE.Vector2(1.0, 0.3).normalize() },
};

const VEGETATION_PATTERN = /(pine|trunk|tree|birch|oak|bush|foliage|leaves|needle|grass|vegetation|atlas)/i;
const NON_VEGETATION_PATTERN = /(road|ground|dirt|rock|cliff|stone|log|wood_log|fence|wall|puddle|cobble|fallen|terrain|metal)/i;

export function isVegetation(name?: string): boolean {
  if (!name) return false;
  if (NON_VEGETATION_PATTERN.test(name)) return false;
  return VEGETATION_PATTERN.test(name);
}

/**
 * Malzemeye rüzgar vertex shader kancasını bağlar.
 * aWind özniteliği 0 olan noktalarda (kökler ve zemin) kesinlikle 0 hareket üretir.
 */
export function applyWindShader(material: THREE.Material) {
  if (material.userData.__hasWindShader) return;
  material.userData.__hasWindShader = true;

  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    prev?.(shader, renderer);

    shader.uniforms.uTime = windUniforms.uTime;
    shader.uniforms.uWindSpeed = windUniforms.uWindSpeed;
    shader.uniforms.uWindStrength = windUniforms.uWindStrength;
    shader.uniforms.uWindDir = windUniforms.uWindDir;

    shader.vertexShader = `
      attribute float aWind;
      uniform float uTime;
      uniform float uWindSpeed;
      uniform float uWindStrength;
      uniform vec2 uWindDir;
      ${shader.vertexShader}
    `;

    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `
      #include <begin_vertex>
      
      // SADECE aWind > 0 OLAN YUKARIDAKİ NOKTALAR HAREKET EDER:
      // Köklerde aWind == 0 olduğu için zemin konumu DEĞİŞMEZ.
      if (aWind > 0.001) {
        vec4 worldP = modelMatrix * vec4(position, 1.0);
        
        // 1. Ana Salınım (Sway): Rüzgar yönünde dalgalı eğilme
        float phase = uTime * (uWindSpeed * 2.0) + (worldP.x * uWindDir.x + worldP.z * uWindDir.y) * 0.12;
        float gust = sin(phase) * 0.72 + sin(phase * 2.2 + 0.8) * 0.28;
        
        // aWind ile ölçeklenir (kök = 0, gövde ortası = 0.2, tepe = 1.0)
        float sway = gust * (uWindStrength * 0.42) * aWind;
        transformed.x += uWindDir.x * sway;
        transformed.z += uWindDir.y * sway;
        transformed.y -= abs(sway) * 0.06 * aWind;
        
        // 2. Yaprak ve Uç Dal Titremesi (High-frequency Leaf Flutter):
        float flutterPhase = uTime * (uWindSpeed * 5.0) + worldP.x * 4.0 + worldP.y * 3.0 + worldP.z * 2.0;
        float flutter = sin(flutterPhase) * (0.045 * uWindStrength * aWind);
        transformed.x += flutter;
        transformed.z += flutter * 0.6;
      }
      `
    );
  };
  material.needsUpdate = true;
}

/**
 * Sahnedeki bitki ve ağaçları tarayıp zemin yüksekliğine göre aWind ağırlığını hesaplar.
 * Kök kısımları (zemine yakın vertexler) kesinlikle 0 alır ve konumları değişmez.
 * Tepe ve yapraklar rüzgarla doğal olarak salınır (sway + flutter).
 */
export function setupVegetationWind(root: THREE.Object3D, terrain?: Heightfield | null) {
  const v = new THREE.Vector3();

  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;

    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const isVeg = isVegetation(mesh.name) || mats.some((m) => isVegetation(m.name));
    if (!isVeg) return;

    const geo = mesh.geometry;
    const posAttr = geo.attributes.position;
    if (!posAttr) return;
    // Paylaşılan geometri (ör. 171 çam örneği) bir kez hesaplanır; her örnekte baştan hesaplamak yüklemeyi uzatıyordu
    if (geo.attributes.aWind) {
      for (const m of mats) applyWindShader(m);
      return;
    }
    mesh.updateMatrixWorld(true);

    geo.computeBoundingBox();
    const bboxMinY = geo.boundingBox ? geo.boundingBox.min.y : 0;

    const count = posAttr.count;
    const weights = new Float32Array(count);

    const nameStr = `${mesh.name} ${mats.map((m) => m.name).join(' ')}`.toLowerCase();
    const isTrunk = nameStr.includes('trunk');
    const isBush = nameStr.includes('bush');
    const isGrass = nameStr.includes('grass');

    // Gövde ~10m, çalı ~1.5m, çimen ~0.45m referans tepe boyu
    const maxRefH = isTrunk ? 10.0 : isBush ? 1.5 : isGrass ? 0.45 : 12.0;
    // Kök / taban payı: Bu yüksekliğin altındaki vertexler %100 SABİTTİR (0 hareket)
    const baseOffset = isGrass ? 0.05 : isBush ? 0.1 : 0.3;

    for (let i = 0; i < count; i++) {
      v.fromBufferAttribute(posAttr, i).applyMatrix4(mesh.matrixWorld);
      const groundY = terrain ? (terrain.heightAt(v.x, v.z) ?? bboxMinY) : bboxMinY;
      const h = Math.max(0, v.y - groundY);

      if (h <= baseOffset) {
        // Zemin ve kök noktaları: KESİNLİKLE 0 (konum değişemez)
        weights[i] = 0.0;
      } else {
        const norm = Math.min(1.0, (h - baseOffset) / maxRefH);
        weights[i] = norm * norm; // karesel esneme
      }
    }

    geo.setAttribute('aWind', new THREE.BufferAttribute(weights, 1));

    for (const m of mats) {
      applyWindShader(m);
    }
  });
}

/** Havada süzülen sonbahar yaprakları parçacık sistemi. */
export class LeavesParticleSystem {
  readonly mesh: THREE.InstancedMesh;
  private readonly count = 200;
  private readonly offsets: Float32Array;
  private readonly speeds: Float32Array;
  private readonly rotations: Float32Array;
  private readonly dummy = new THREE.Object3D();

  private readonly bounds = {
    minX: -60,
    maxX: 90,
    minY: 0.3,
    maxY: 16.0,
    minZ: -40,
    maxZ: 60,
  };

  constructor() {
    const geo = new THREE.BufferGeometry();
    const vertices = new Float32Array([
      -0.07, 0, 0,
       0.07, 0, 0,
       0, 0.02, 0.14,
      -0.07, 0, 0,
       0, 0.02, 0.14,
       0, 0, -0.09,
    ]);
    geo.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    geo.computeVertexNormals();

    const mat = new THREE.MeshToonMaterial({
      side: THREE.DoubleSide,
      vertexColors: true,
    });

    this.mesh = new THREE.InstancedMesh(geo, mat, this.count);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.castShadow = true;

    this.offsets = new Float32Array(this.count * 3);
    this.speeds = new Float32Array(this.count * 4);
    this.rotations = new Float32Array(this.count * 3);

    const colors = new Float32Array(this.count * 3);
    const autumnPalette = [
      new THREE.Color('#d35400'),
      new THREE.Color('#e67e22'),
      new THREE.Color('#f39c12'),
      new THREE.Color('#d4ac0d'),
      new THREE.Color('#a04000'),
      new THREE.Color('#7d6608'),
    ];

    for (let i = 0; i < this.count; i++) {
      this.offsets[i * 3 + 0] = THREE.MathUtils.randFloat(this.bounds.minX, this.bounds.maxX);
      this.offsets[i * 3 + 1] = THREE.MathUtils.randFloat(this.bounds.minY, this.bounds.maxY);
      this.offsets[i * 3 + 2] = THREE.MathUtils.randFloat(this.bounds.minZ, this.bounds.maxZ);

      this.speeds[i * 4 + 0] = THREE.MathUtils.randFloat(0.4, 0.9);
      this.speeds[i * 4 + 1] = THREE.MathUtils.randFloat(1.5, 2.8);
      this.speeds[i * 4 + 2] = THREE.MathUtils.randFloat(0.8, 2.0);
      this.speeds[i * 4 + 3] = THREE.MathUtils.randFloat(1.0, 2.5);

      this.rotations[i * 3 + 0] = Math.random() * Math.PI * 2;
      this.rotations[i * 3 + 1] = Math.random() * Math.PI * 2;
      this.rotations[i * 3 + 2] = Math.random() * Math.PI * 2;

      const c = autumnPalette[i % autumnPalette.length];
      colors[i * 3 + 0] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }

    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);
  }

  update(t: number, speed: number, strength: number, dir: THREE.Vector2) {
    const rangeY = this.bounds.maxY - this.bounds.minY;
    const rangeX = this.bounds.maxX - this.bounds.minX;
    const rangeZ = this.bounds.maxZ - this.bounds.minZ;

    for (let i = 0; i < this.count; i++) {
      const fallSpeed = this.speeds[i * 4 + 0] * (0.7 + strength * 0.3);
      const swaySpeed = this.speeds[i * 4 + 1] * speed;
      const rotSpeedX = this.speeds[i * 4 + 2];
      const rotSpeedY = this.speeds[i * 4 + 3];

      const rawY = this.offsets[i * 3 + 1] - t * fallSpeed;
      const y = this.bounds.maxY - ((rawY % rangeY) + rangeY) % rangeY;

      const windDrift = t * speed * strength * 2.2;
      const swayPhase = t * swaySpeed + i;
      const swirlX = Math.sin(swayPhase) * (0.5 + strength * 0.4);
      const swirlZ = Math.cos(swayPhase * 0.8) * (0.5 + strength * 0.4);

      const rawX = this.offsets[i * 3 + 0] + dir.x * windDrift + swirlX;
      const x = this.bounds.minX + (((rawX - this.bounds.minX) % rangeX) + rangeX) % rangeX;

      const rawZ = this.offsets[i * 3 + 2] + dir.y * windDrift + swirlZ;
      const z = this.bounds.minZ + (((rawZ - this.bounds.minZ) % rangeZ) + rangeZ) % rangeZ;

      this.dummy.position.set(x, y, z);
      this.dummy.rotation.set(
        this.rotations[i * 3 + 0] + t * rotSpeedX + Math.sin(swayPhase) * 0.4,
        this.rotations[i * 3 + 1] + t * rotSpeedY + dir.angle(),
        this.rotations[i * 3 + 2] + Math.cos(swayPhase * 1.2) * 0.4,
      );
      this.dummy.scale.setScalar(0.85 + Math.sin(i) * 0.25);
      this.dummy.updateMatrix();

      this.mesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    this.mesh.geometry.dispose();
    if (Array.isArray(this.mesh.material)) {
      this.mesh.material.forEach((m) => m.dispose());
    } else {
      this.mesh.material.dispose();
    }
  }
}

/** Sahne ortamına bağlı çalışan rüzgar yöneticisi */
export class WindSystem {
  private readonly dir: THREE.Vector2;
  private readonly leavesSystem?: LeavesParticleSystem;

  constructor(
    readonly group: THREE.Group,
    readonly config: WindConfig = {},
  ) {
    const d = config.direction ?? [1.0, 0.3];
    this.dir = new THREE.Vector2(d[0], d[1]).normalize();

    windUniforms.uWindSpeed.value = config.speed ?? 1.0;
    windUniforms.uWindStrength.value = config.strength ?? 0.6;
    windUniforms.uWindDir.value.copy(this.dir);

    if (config.leaves !== false) {
      this.leavesSystem = new LeavesParticleSystem();
      this.group.add(this.leavesSystem.mesh);
    }
  }

  update(t: number) {
    windUniforms.uTime.value = t;
    if (this.leavesSystem) {
      this.leavesSystem.update(
        t,
        windUniforms.uWindSpeed.value,
        windUniforms.uWindStrength.value,
        this.dir,
      );
    }
  }

  setRenderMode(mode: 'preview' | 'render') {
    if (this.leavesSystem) {
      this.leavesSystem.mesh.visible = mode === 'render';
    }
  }

  dispose() {
    this.leavesSystem?.dispose();
  }
}
