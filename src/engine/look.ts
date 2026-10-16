/**
 * Filmin görünümü: mürekkep konturu, parlama (bloom) ve renk düzenleme (sahne başına ton).
 * Uygulaması src/render/post.ts'de (son işlem).
 */
import type * as THREE from 'three';

/**
 * Karakter maskesi: 1 iken (yalnızca son işlemin sahne çiziminde) karakter malzemeleri renk tamponunun
 * kullanılmayan alfa kanalına 0 yazar: "burada görünen yüzey karakter". Önündeki her nesne bunu ezer. Kontur,
 * karakteri örten ağacın üstüne taşmasın diye bu maskeyle sınırlanır (sahne derinliğinin MSAA çözümlemesi
 * ~3 ms tutuyordu; alfa kanalı bedava).
 */
export const characterMask = { value: 0 };

/** Opak karakter malzemesine maske kancasını bağlar (yarı saydamlarda alfa karıştırmada kullanılır, dokunulmaz). */
export function markCharacterMaterial(material: THREE.Material) {
  if (material.userData.__charMask || material.transparent) return;
  material.userData.__charMask = true;
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    prev?.(shader, renderer);
    shader.uniforms.uCharMask = characterMask;
    shader.fragmentShader =
      'uniform float uCharMask;\n' +
      shader.fragmentShader.replace(
        '#include <dithering_fragment>',
        '#include <dithering_fragment>\n\tgl_FragColor.a = mix(gl_FragColor.a, 0.0, uCharMask);',
      );
  };
  material.needsUpdate = true;
}

export interface Grade {
  /** Pozlama çarpanı (doğrusal ışıkta) */
  exposure: number;
  /** Orta griye göre kontrast (1 = değişmez) */
  contrast: number;
  /** Doygunluk (1 = değişmez) */
  saturation: number;
  /** Sıcaklık: + sarı/turuncu, − mavi */
  warmth: number;
  /** Köşe kararması (0 = yok) */
  vignette: number;
}

export interface FilmLook {
  /** Kontur kalınlığı (1080p'de piksel; 0 = kapalı) */
  outline: number;
  /** Parlama gücü (0 = kapalı) */
  bloom: number;
}

export const GRADES = {
  /** Değişiklik yok */
  neutral: { exposure: 1, contrast: 1, saturation: 1, warmth: 0, vignette: 0 },
  /** Tanıtım, sakin sahneler: yumuşak, hafif sıcak ve canlı */
  soft: { exposure: 1.03, contrast: 0.96, saturation: 1.08, warmth: 0.02, vignette: 0.12 },
  /** Savaş: daha sıcak, kontrastlı ve doygun, belirgin vinyet */
  battle: { exposure: 1.0, contrast: 1.1, saturation: 1.12, warmth: 0.045, vignette: 0.28 },
  /** Gün batımı: altın tonlar */
  golden: { exposure: 1.02, contrast: 1.04, saturation: 1.1, warmth: 0.07, vignette: 0.18 },
  /** Gece: serin ve hafif koyu */
  night: { exposure: 0.95, contrast: 1.06, saturation: 0.9, warmth: -0.06, vignette: 0.3 },
} as const satisfies Record<string, Grade>;

export type GradeName = keyof typeof GRADES;

export const DEFAULT_LOOK: FilmLook = { outline: 2.2, bloom: 0.3 };

export const isNeutral = (g: Grade) =>
  g.exposure === 1 && g.contrast === 1 && g.saturation === 1 && g.warmth === 0 && g.vignette === 0;

/** Ön ayar adı ya da ön ayar + ayrıntılı ayarlar → tam Grade. */
export function resolveGrade(g: GradeName | (Partial<Grade> & { preset?: GradeName }) | undefined, fallback: Grade = GRADES.neutral): Grade {
  if (!g) return { ...fallback };
  if (typeof g === 'string') return { ...GRADES[g] };
  const { preset, ...rest } = g;
  return { ...(preset ? GRADES[preset] : fallback), ...rest };
}
