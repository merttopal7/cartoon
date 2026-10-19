import { parseScenario, type Scenario } from '../schema';

/**
 * Bölümün başına açılış klibini ekler (`film.intro: <senaryo kimliği>`, ör. `acilis`). Açılış senaryosu
 * public/scenarios/<kimlik>.yaml'den okunur; sahneleri filmin başına, varlıkları önekle (`<kimlik>__toprak`) eklenir:
 * bölümün kendi varlık tanımları (ör. farklı kostüm ya da animasyon) açılışı bozmaz. Film ayarları (müzik, görünüm,
 * kararmalar) bölümünkidir. Bölüm ilk çekiminde kesme yerine kısa bir kararmayla başlar.
 *
 * Uygulamanın senaryo yükleme akışında çağrılır (önizleme ve dışa aktarım açılışı içerir); motor testleri bölümün
 * kendi içeriğini sınamak için buildFilm'i doğrudan çağırır.
 */
export async function withIntro(s: Scenario, warn: (message: string) => void): Promise<Scenario> {
  const id = s.film.intro;
  if (!id) return s;
  let intro: Scenario;
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}scenarios/${encodeURIComponent(id)}.yaml`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const parsed = parseScenario(await res.text());
    if (!parsed.ok) throw new Error(parsed.errors[0] ?? 'geçersiz senaryo');
    intro = parsed.scenario;
  } catch (err) {
    warn(`Açılış klibi "${id}" eklenemedi: ${err instanceof Error ? err.message : String(err)}`);
    return s;
  }
  if (intro.film.intro) warn(`Açılış klibi "${id}" kendi içinde başka bir açılış istiyor; yok sayıldı`);

  const prefix = `${id}__`;
  const assets: Scenario['assets'] = { ...s.assets };
  for (const [key, def] of Object.entries(intro.assets)) assets[prefix + key] = def;
  const introScenes = intro.scenes.map((sc) => ({
    ...sc,
    id: `${id}-${sc.id}`,
    characters: sc.characters.map((c) => ({ ...c, asset: prefix + c.asset })),
    props: sc.props.map((p) => ({ ...p, asset: prefix + p.asset })),
  }));
  // Bölüm, açılıştan sonra kesme yerine kısa bir kararmayla başlar
  const episode = s.scenes.map((sc, i) => {
    if (i !== 0 || !sc.cameras?.length || (sc.cameras[0].transition ?? 'cut') !== 'cut') return sc;
    return { ...sc, cameras: [{ ...sc.cameras[0], transition: 'fade' as const }, ...sc.cameras.slice(1)] };
  });
  return { ...s, assets, scenes: [...introScenes, ...episode] };
}
