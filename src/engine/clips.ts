import type * as THREE from 'three';

/**
 * Kliplerin kök hareketi sıfırlanmadan önceki doğal ilerleme hızı (model birimi/sn). Yürüme klibini
 * karakterin sahnedeki hızına göre hızlandırıp yavaşlatmak için kullanılır; böylece ayaklar kaymaz.
 */
export const ROOT_SPEED = new WeakMap<THREE.AnimationClip, number>();

/**
 * Klibin çekildiği iskeletin duruş pozundaki kalça yüksekliği (model birimi). Başka boydaki bir
 * karaktere uyarlarken (retarget) kalça izini ölçeklemek için kullanılır.
 */
export const SOURCE_HIPS_HEIGHT = new WeakMap<THREE.AnimationClip, number>();

/** Klibin çekildiği iskelet (animasyon dosyasındaki kemik ağacı, dinlenme pozunda). İnsansı retarget için. */
export const SOURCE_SKELETON = new WeakMap<THREE.AnimationClip, THREE.Object3D>();
