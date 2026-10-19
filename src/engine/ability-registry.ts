import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import abilitiesText from '../data/abilities.yaml?raw';
import type { AbilityRecipe } from './abilities';

/** Yetenek tanımlarının tek kaynağı src/data/abilities.yaml; alanların açıklaması dosyanın başında. */
const clipSchema = z
  .object({
    name: z.string().min(1),
    duration: z.number().positive().optional(),
    loop: z.boolean().default(false),
    fade: z.number().min(0).optional(),
  })
  .strict();

const abilitySchema = z
  .object({
    title: z.string().min(1),
    aliases: z.array(z.string().min(1)).default([]),
    effect: z.enum(['fire', 'tornado', 'rain', 'shadow', 'tree_fall', 'tree_lift', 'earth', 'whirl', 'rock_rise', 'wave']),
    /** Element: karakterin elementiyle uyuşmazsa yüklemede uyarı verilir (gölge: elementsiz eski yetenekler) */
    element: z.enum(['ates', 'su', 'toprak', 'hava', 'golge']),
    target: z.enum(['character', 'map_tree', 'self']).default('character'),
    icon: z.string().optional(),
    clips: z.array(clipSchema).min(1),
    release: z.object({ clip: z.string(), at: z.number().min(0) }).strict(),
    flight: z.number().positive(),
    linger: z.number().min(0),
    /** Hedefsiz (self) gösteri yeteneklerinde gerekmez */
    knockback: z.object({ arc: z.number().min(0), duration: z.number().positive() }).strict().default({ arc: 0, duration: 0.5 }),
    impact_clip: z.string().min(1).default('impact_3'),
    target_clips: z.array(z.string().min(1)).default([]),
  })
  .strict()
  .superRefine((a, ctx) => {
    if (!a.clips.some((c) => c.name === a.release.clip))
      ctx.addIssue({ code: 'custom', path: ['release', 'clip'], message: `"${a.release.clip}" klip listesinde yok` });
  });

export type AbilityDef = z.infer<typeof abilitySchema> & { id: string };

/** Yetenek gerçek klip süresi bilinmeden (ör. rig yokken) kullanılan süre (sn). */
const FALLBACK_CLIP_DURATION = 1.0;
/** Açık süre gerçek klipten bu kadar uzunsa son kare tutulur ve uyarı verilir (sn). */
const HOLD_WARN = 0.25;

const byName = new Map<string, AbilityDef>();

(function load() {
  const raw = parseYaml(abilitiesText) as Record<string, unknown>;
  const errors: string[] = [];
  for (const [id, value] of Object.entries(raw ?? {})) {
    const res = abilitySchema.safeParse(value);
    if (!res.success) {
      for (const issue of res.error.issues) errors.push(`${id}.${issue.path.join('.')}: ${issue.message}`);
      continue;
    }
    const def: AbilityDef = { ...res.data, id };
    for (const name of [id, ...def.aliases]) {
      if (byName.has(name)) errors.push(`"${name}" adı hem ${byName.get(name)!.id} hem ${id} için kullanılmış`);
      byName.set(name, def);
    }
  }
  // Tanım dosyası bozuksa motor sessizce eksik çalışmasın: geliştirme sırasında hemen görünsün
  if (errors.length) throw new Error(`src/data/abilities.yaml geçersiz:\n${errors.join('\n')}`);
})();

/** Ad veya takma addan yetenek tanımı. */
export function resolveAbility(name: string): AbilityDef | undefined {
  return byName.get(name);
}

/** Senaryoda geçerli tüm yetenek adları (takma adlar dahil). */
export function abilityNames(): string[] {
  return [...byName.keys()];
}

/** Kullananın yükleyeceği klipler (senaryoda `clips` verilmişse onlar). */
export function casterClipNames(def: AbilityDef, customClips?: string[]): string[] {
  return customClips?.length ? customClips : def.clips.map((c) => c.name);
}

/** Hedefin yükleyeceği tepki klipleri. */
export function targetClipNames(def: AbilityDef): string[] {
  if (def.target === 'self') return [];
  return [...new Set([def.impact_clip, ...def.target_clips])];
}

/**
 * Tanımı, kullananın gerçek klip sürelerine göre zaman çizelgesine çevirir.
 * `clipDuration` kullananın rig'inden gelir; süresi verilmemiş klipler gerçek süreleriyle oynar.
 */
export function buildRecipe(
  def: AbilityDef,
  clipDuration?: (name: string) => number | undefined,
  customClips?: string[],
): { recipe: AbilityRecipe; warnings: string[] } {
  const warnings: string[] = [];
  const realOf = (name: string) => clipDuration?.(name);

  // Özel kliplerde yapı (döngü, geçiş) sıraya göre korunur; süreler kliplerin kendi süreleridir
  const source = customClips?.length
    ? customClips.map((name, i) => {
        const base = def.clips[Math.min(i, def.clips.length - 1)];
        return { name, duration: undefined, loop: base.loop, fade: base.fade };
      })
    : def.clips;

  const clips = source.map((c) => {
    const real = realOf(c.name);
    let duration = c.duration ?? real;
    if (duration === undefined) {
      duration = FALLBACK_CLIP_DURATION;
      if (clipDuration) warnings.push(`"${def.id}" yeteneğinin "${c.name}" klibi kullananda yok; ${duration} sn varsayıldı`);
    } else if (real !== undefined && !c.loop && duration > real + HOLD_WARN) {
      warnings.push(
        `"${def.id}": "${c.name}" ${duration} sn oynatılıyor ama klip ${real.toFixed(2)} sn; son kare ${(duration - real).toFixed(2)} sn tutulur`,
      );
    }
    return { name: c.name, duration, loop: c.loop, ...(c.fade !== undefined ? { fade: c.fade } : {}) };
  });

  // Fırlatma anı: tanımdaki klibin başlangıcı + o klipteki saniye. Özel kliplerde aynı sıradaki klipte aynı oran.
  const releaseIndex = def.clips.findIndex((c) => c.name === def.release.clip);
  let releaseClip = releaseIndex;
  let releaseAt = def.release.at;
  if (customClips?.length) {
    releaseClip = Math.min(releaseIndex, clips.length - 1);
    const defDur = def.clips[releaseIndex].duration ?? realOf(def.clips[releaseIndex].name) ?? FALLBACK_CLIP_DURATION;
    releaseAt = (def.release.at / defDur) * clips[releaseClip].duration;
  }
  let clipStart = 0;
  for (let i = 0; i < releaseClip; i++) clipStart += clips[i].duration;
  const chargeEnd = round(clipStart + releaseAt);
  const impactOffset = round(chargeEnd + def.flight);

  return {
    recipe: {
      id: def.id,
      effectType: def.effect,
      targetKind: def.target,
      clips,
      chargeEnd,
      impactOffset,
      totalDuration: round(impactOffset + def.linger),
      arcHeight: def.knockback.arc,
      knockbackDuration: def.knockback.duration,
      defaultImpactClip: def.impact_clip,
    },
    warnings,
  };
}

const round = (v: number) => Math.round(v * 1000) / 1000;
