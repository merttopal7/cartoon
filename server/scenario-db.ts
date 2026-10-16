import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export interface ScenarioRecord {
  id: string;
  title: string;
  description: string;
  content: string;
  category: 'builtin' | 'custom';
  tags: string;
  created_at: string;
  updated_at: string;
}

const BUILTIN_METADATA: Record<string, { title: string; description: string; tags: string }> = {
  'bolum-1-ormanin-bekcileri': {
    title: 'Bölüm 1: İlk Devriye',
    description: 'Ormanın Bekçileri açılış sahnesi: Toprak, Defne ve Meşe ormanın kadim sırlarını korumak için göreve çıkıyor.',
    tags: 'orman, bekçiler, toprak, defne, meşe, açılış',
  },
  'bolum-2-karabeyin-golgesi': {
    title: 'Bölüm 2: Karabey\'in Gölgesi',
    description: 'Ulu Çınar Yolu\'nda büyük karşılaşma: Toprak, Defne ve Meşe, Karanlık Muhafız Karabey\'e karşı akrobatik mücadele veriyor.',
    tags: 'orman, bekçiler, karabey, toprak, defne, meşe, düello, aksiyon',
  },
  'harita-toprak-yol': {
    title: 'Orman Haritası (Toprak Yol)',
    description: 'Toprak yol haritasında Toprak, Meşe ve Defne\'nin Türkçe seslendirmeli ve mimikli animasyon sahnesi.',
    tags: 'toprak, meşe, defne, orman, seslendirme',
  },
};

export class ScenarioDatabase {
  private db: DatabaseSync;
  private rootDir: string;

  constructor(rootDir: string = process.cwd()) {
    this.rootDir = rootDir;
    const dbPath = path.join(this.rootDir, 'scenarios.db');
    this.db = new DatabaseSync(dbPath);
    this.init();
  }

  private init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS scenarios (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        content TEXT NOT NULL,
        category TEXT DEFAULT 'custom',
        tags TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);

    this.seedBuiltins();
  }

  seedBuiltins() {
    const scenariosDir = path.join(this.rootDir, 'public', 'scenarios');
    if (!fs.existsSync(scenariosDir)) return;

    const files = fs.readdirSync(scenariosDir).filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'));
    const ids = files.map((f) => f.replace(/\.(yaml|yml)$/, ''));

    // Diskten silinmiş yerleşik senaryoları SQLite veritabanından da sil
    if (ids.length > 0) {
      const placeholders = ids.map(() => '?').join(', ');
      this.db.prepare(`DELETE FROM scenarios WHERE category = 'builtin' AND id NOT IN (${placeholders})`).run(...ids);
    } else {
      this.db.prepare(`DELETE FROM scenarios WHERE category = 'builtin'`).run();
    }

    const now = new Date().toISOString();

    const insertStmt = this.db.prepare(`
      INSERT INTO scenarios (id, title, description, content, category, tags, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'builtin', ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        description = excluded.description,
        content = excluded.content,
        tags = excluded.tags,
        updated_at = excluded.updated_at
      WHERE category = 'builtin'
    `);

    for (const file of files) {
      const id = file.replace(/\.(yaml|yml)$/, '');
      const meta = BUILTIN_METADATA[id] ?? {
        title: id,
        description: `${id} senaryosu`,
        tags: 'senaryo',
      };
      try {
        const content = fs.readFileSync(path.join(scenariosDir, file), 'utf8');
        insertStmt.run(id, meta.title, meta.description, content, meta.tags, now, now);
      } catch (err) {
        console.warn(`[SQLite] Senaryo okunamadı: ${file}`, err);
      }
    }
  }

  getAll(): Omit<ScenarioRecord, 'content'>[] {
    const stmt = this.db.prepare(`
      SELECT id, title, description, category, tags, created_at, updated_at
      FROM scenarios
      ORDER BY CASE WHEN category = 'builtin' THEN 0 ELSE 1 END, updated_at DESC
    `);
    return stmt.all() as unknown as Omit<ScenarioRecord, 'content'>[];
  }

  getById(id: string): ScenarioRecord | null {
    // Yerleşik senaryolarda diskteki güncel dosyayı daima kontrol et ve SQLite'ı senkronize tut
    const scenariosDir = path.join(this.rootDir, 'public', 'scenarios');
    for (const ext of ['.yaml', '.yml']) {
      const diskPath = path.join(scenariosDir, `${id}${ext}`);
      if (fs.existsSync(diskPath)) {
        try {
          const freshContent = fs.readFileSync(diskPath, 'utf8');
          const meta = BUILTIN_METADATA[id] ?? {
            title: id,
            description: `${id} senaryosu`,
            tags: 'senaryo',
          };
          const now = new Date().toISOString();
          this.db.prepare(`
            INSERT INTO scenarios (id, title, description, content, category, tags, created_at, updated_at)
            VALUES (?, ?, ?, ?, 'builtin', ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              content = excluded.content,
              updated_at = excluded.updated_at
          `).run(id, meta.title, meta.description, freshContent, meta.tags, now, now);
        } catch (e) {
          console.warn(`[SQLite] Disk dosyası senkronize edilemedi: ${diskPath}`, e);
        }
        break;
      }
    }

    const stmt = this.db.prepare(`SELECT * FROM scenarios WHERE id = ?`);
    const row = stmt.get(id);
    return (row as unknown as ScenarioRecord) ?? null;
  }

  save(data: { id?: string; title: string; description?: string; content: string; tags?: string }): ScenarioRecord {
    const now = new Date().toISOString();
    const id = data.id && data.id.trim() ? data.id.trim() : `custom-${Date.now()}`;
    const existing = this.getById(id);

    if (existing) {
      const stmt = this.db.prepare(`
        UPDATE scenarios
        SET title = ?, description = ?, content = ?, tags = ?, updated_at = ?
        WHERE id = ?
      `);
      stmt.run(
        data.title || existing.title,
        data.description ?? existing.description,
        data.content,
        data.tags ?? existing.tags,
        now,
        id
      );
    } else {
      const stmt = this.db.prepare(`
        INSERT INTO scenarios (id, title, description, content, category, tags, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'custom', ?, ?, ?)
      `);
      stmt.run(
        id,
        data.title,
        data.description ?? '',
        data.content,
        data.tags ?? 'özel',
        now,
        now
      );
    }

    return this.getById(id)!;
  }

  delete(id: string): boolean {
    const scenario = this.getById(id);
    if (!scenario) return false;
    if (scenario.category === 'builtin') {
      throw new Error('Yerleşik senaryolar silinemez.');
    }
    const stmt = this.db.prepare(`DELETE FROM scenarios WHERE id = ?`);
    stmt.run(id);
    return true;
  }

  getSetting(key: string): string | null {
    const stmt = this.db.prepare(`SELECT value FROM settings WHERE key = ?`);
    const row = stmt.get(key) as unknown as { value: string } | undefined;
    return row ? row.value : null;
  }

  getAllSettings(): Record<string, string> {
    const stmt = this.db.prepare(`SELECT key, value FROM settings`);
    const rows = stmt.all() as unknown as { key: string; value: string }[];
    const result: Record<string, string> = {
      sync_lead_in: '700',
      sync_lead_out: '700',
      sync_linked: 'true',
      viewport_mode: 'preview',
    };
    for (const r of rows) {
      result[r.key] = r.value;
    }
    return result;
  }

  setSetting(key: string, value: string): void {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO settings (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `);
    stmt.run(key, String(value), now);
  }

  setSettings(settings: Record<string, string>): Record<string, string> {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO settings (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `);
    for (const [k, v] of Object.entries(settings)) {
      stmt.run(k, String(v), now);
    }
    return this.getAllSettings();
  }
}
