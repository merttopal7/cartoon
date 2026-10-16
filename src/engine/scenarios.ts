/**
 * SQLite Scenario Client Manager
 * Communicates with Vite SQLite API (/api/scenarios) with resilient client-side fallback.
 */

export interface ScenarioMeta {
  id: string;
  title: string;
  description: string;
  category: 'builtin' | 'custom';
  tags: string;
  created_at: string;
  updated_at: string;
}

export interface ScenarioItem extends ScenarioMeta {
  content: string;
}

const LOCAL_STORAGE_CUSTOM_KEY = 'cartoon-engine.custom-scenarios';

export class ScenarioClient {
  private cache: ScenarioMeta[] = [];
  private activeScenarioId: string | null = null;

  getActiveId(): string | null {
    return this.activeScenarioId;
  }

  setActiveId(id: string | null) {
    this.activeScenarioId = id;
  }

  /**
   * Tüm senaryoların özet listesini getirir.
   */
  async list(): Promise<ScenarioMeta[]> {
    try {
      const res = await fetch('/api/scenarios');
      if (res.ok) {
        const data = await res.json();
        if (data.ok && Array.isArray(data.scenarios)) {
          this.cache = data.scenarios;
          return this.cache;
        }
      }
    } catch {
      // Backend erişilemezse (örn. statik build) fallback
    }

    // Fallback listesi
    return this.getFallbackList();
  }

  /**
   * Belirli bir senaryonun tam YAML içeriğini getirir.
   */
  async getContent(id: string): Promise<string> {
    try {
      const res = await fetch(`/api/scenarios/${encodeURIComponent(id)}`);
      if (res.ok) {
        const data = await res.json();
        if (data.ok && data.scenario?.content) {
          this.activeScenarioId = id;
          return data.scenario.content;
        }
      }
    } catch {}

    // Fallback: doğrudan public klasöründen oku
    try {
      const fileRes = await fetch(`${import.meta.env.BASE_URL}scenarios/${id}.yaml`);
      if (fileRes.ok) {
        this.activeScenarioId = id;
        return await fileRes.text();
      }
    } catch {}

    // Fallback: localStorage
    const local = this.getLocalCustom();
    const found = local.find((s) => s.id === id);
    if (found) {
      this.activeScenarioId = id;
      return found.content;
    }

    throw new Error(`Senaryo bulunamadı: ${id}`);
  }

  /**
   * Senaryoyu SQLite veritabanına kaydeder.
   */
  async save(data: { id?: string; title: string; description?: string; content: string; tags?: string }): Promise<ScenarioItem> {
    try {
      const res = await fetch('/api/scenarios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (res.ok) {
        const json = await res.json();
        if (json.ok && json.scenario) {
          this.activeScenarioId = json.scenario.id;
          return json.scenario;
        }
        throw new Error(json.error || 'Kayıt başarısız');
      }
    } catch (err: unknown) {
      // SQLite API hatası durumunda localStorage yedeği al
      console.warn('API kayıt hatası, localStorage kullanılıyor:', err);
    }

    // LocalStorage Fallback
    const id = data.id || `custom-${Date.now()}`;
    const now = new Date().toISOString();
    const item: ScenarioItem = {
      id,
      title: data.title,
      description: data.description || '',
      content: data.content,
      category: 'custom',
      tags: data.tags || 'özel',
      created_at: now,
      updated_at: now,
    };

    const local = this.getLocalCustom();
    const idx = local.findIndex((s) => s.id === id);
    if (idx >= 0) local[idx] = item;
    else local.unshift(item);
    this.saveLocalCustom(local);
    this.activeScenarioId = id;
    return item;
  }

  /**
   * Özel senaryoyu siler.
   */
  async delete(id: string): Promise<boolean> {
    try {
      const res = await fetch(`/api/scenarios/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (res.ok) {
        const json = await res.json();
        if (json.ok) {
          if (this.activeScenarioId === id) this.activeScenarioId = null;
          return true;
        }
      }
    } catch {}

    const local = this.getLocalCustom().filter((s) => s.id !== id);
    this.saveLocalCustom(local);
    if (this.activeScenarioId === id) this.activeScenarioId = null;
    return true;
  }

  private getFallbackList(): ScenarioMeta[] {
    const builtin: ScenarioMeta[] = [
      { id: 'bolum-1-ormanin-bekcileri', title: 'Bölüm 1: İlk Devriye', description: 'Ormanın Bekçileri açılış sahnesi: Toprak, Defne ve Meşe göreve çıkıyor.', category: 'builtin', tags: 'orman, bekçiler, toprak, defne, meşe', created_at: '', updated_at: '' },
      { id: 'bolum-2-karabeyin-golgesi', title: 'Bölüm 2: Karabey\'in Gölgesi', description: 'Toprak, Defne ve Meşe, Karanlık Muhafız Karabey\'e karşı mücadele veriyor.', category: 'builtin', tags: 'orman, bekçiler, karabey, aksiyon', created_at: '', updated_at: '' },
      { id: 'harita-toprak-yol', title: 'Orman Haritası (Toprak Yol)', description: 'Tam Türkçe seslendirmeli ve mimikli animasyon.', category: 'builtin', tags: 'seslendirme, orman', created_at: '', updated_at: '' },
    ];
    const custom = this.getLocalCustom().map(({ content: _, ...m }) => m);
    return [...builtin, ...custom];
  }

  private getLocalCustom(): ScenarioItem[] {
    try {
      const str = localStorage.getItem(LOCAL_STORAGE_CUSTOM_KEY);
      return str ? JSON.parse(str) : [];
    } catch {
      return [];
    }
  }

  private saveLocalCustom(items: ScenarioItem[]) {
    try {
      localStorage.setItem(LOCAL_STORAGE_CUSTOM_KEY, JSON.stringify(items));
    } catch {}
  }
}
