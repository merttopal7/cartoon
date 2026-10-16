import * as THREE from 'three';
import type { Heightfield } from './terrain';
import type { SceneDef } from '../schema';

/**
 * Render aşamasında sahneyi zenginleştiren arka plan ormanı ve detay grubunu oluşturur.
 */
export function buildSceneRenderDetails(
  _def: SceneDef,
  _existingProps: Array<{ at: [number, number, number]; scale: number }>,
  _terrain: Heightfield | null,
): THREE.Group {
  const root = new THREE.Group();
  root.name = 'render_mode_details';
  root.visible = false;
  // Orijinal haritanın gerçek kalitesini korumak için sonradan eklenen amatör low-poly ağaçlar kaldırıldı.
  return root;
}
