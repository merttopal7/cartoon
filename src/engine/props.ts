import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { OUTLINE, toonMaterial } from './toon';

import { applyWindShader } from './wind';

export type PropKind = 'tree' | 'bush' | 'rock' | 'house';

/** Model gelene kadar kullanılan basit dekor parçaları. */
export function buildProp(kind: PropKind, colorHex?: string): THREE.Object3D {
  const g = new THREE.Group();
  g.name = `prop_${kind}`;
  const mat = (c: string, flat = false) => toonMaterial(c, { outline: OUTLINE.prop, flat });
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    g.add(mesh);
    return mesh;
  };

  switch (kind) {
    case 'tree': {
      const trunkGeo = new THREE.CylinderGeometry(0.14, 0.2, 1.3, 10);
      const tPos = trunkGeo.attributes.position;
      const tWind = new Float32Array(tPos.count);
      for (let i = 0; i < tPos.count; i++) {
        const norm = Math.max(0, (tPos.getY(i) + 0.65) / 1.3);
        tWind[i] = norm * norm * 0.2; // taban zeminde kesinlikle 0
      }
      trunkGeo.setAttribute('aWind', new THREE.BufferAttribute(tWind, 1));
      const trunkMat = mat('#8b5a2b');
      applyWindShader(trunkMat);
      add(trunkGeo, trunkMat, 0, 0.65, 0);

      const leaf = mat(colorHex ?? '#4caf50', true);
      applyWindShader(leaf);
      const addLeaf = (geo: THREE.BufferGeometry, x: number, y: number, z: number) => {
        geo.setAttribute('aWind', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count).fill(0.9), 1));
        return add(geo, leaf, x, y, z);
      };
      addLeaf(new THREE.IcosahedronGeometry(0.9, 1), 0, 1.85, 0);
      addLeaf(new THREE.IcosahedronGeometry(0.62, 1), 0.5, 1.45, 0.2);
      addLeaf(new THREE.IcosahedronGeometry(0.58, 1), -0.45, 1.5, -0.1);
      break;
    }
    case 'bush': {
      const leaf = mat(colorHex ?? '#5cb85c', true);
      applyWindShader(leaf);
      const addBushLeaf = (geo: THREE.BufferGeometry, x: number, y: number, z: number) => {
        const bPos = geo.attributes.position;
        const bWind = new Float32Array(bPos.count);
        for (let i = 0; i < bPos.count; i++) {
          const norm = Math.max(0, (bPos.getY(i) + 0.35) / 0.7);
          bWind[i] = norm * 0.7; // taban 0
        }
        geo.setAttribute('aWind', new THREE.BufferAttribute(bWind, 1));
        return add(geo, leaf, x, y, z);
      };
      addBushLeaf(new THREE.IcosahedronGeometry(0.45, 1), 0, 0.35, 0);
      addBushLeaf(new THREE.IcosahedronGeometry(0.35, 1), 0.4, 0.25, 0.1);
      addBushLeaf(new THREE.IcosahedronGeometry(0.32, 1), -0.38, 0.24, -0.05);
      break;
    }
    case 'rock': {
      const rock = add(new THREE.DodecahedronGeometry(0.5, 0), mat(colorHex ?? '#9e9e9e', true), 0, 0.28, 0);
      rock.scale.set(1.2, 0.7, 1);
      break;
    }
    case 'house': {
      add(new RoundedBoxGeometry(2.2, 1.7, 2, 3, 0.06), mat(colorHex ?? '#f5e3c3'), 0, 0.85, 0);
      const roof = add(new THREE.ConeGeometry(1.75, 1.1, 4), mat('#d9534f', true), 0, 2.25, 0);
      roof.rotation.y = Math.PI / 4;
      add(new RoundedBoxGeometry(0.5, 0.9, 0.08, 2, 0.03), mat('#8b5a2b'), 0, 0.45, 1.0);
      for (const x of [-0.65, 0.65]) add(new RoundedBoxGeometry(0.42, 0.42, 0.06, 2, 0.03), mat('#7ec8e3'), x, 1.05, 1.0);
      break;
    }
  }

  g.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.castShadow = o.receiveShadow = true;
  });
  return g;
}
