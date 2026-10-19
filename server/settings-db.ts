import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Kalıcı arayüz ayarları (ses, müzik, senkron, görünüm modu) — SQLite `settings` tablosu (settings.db).
 * Senaryolar burada tutulmaz; diskteki YAML dosyalarından okunur (server/scenario-files.ts).
 */
export class SettingsDatabase {
  private db: DatabaseSync;

  constructor(rootDir: string = process.cwd()) {
    const dbPath = path.join(rootDir, 'settings.db');
    const legacyPath = path.join(rootDir, 'scenarios.db');
    const fresh = !fs.existsSync(dbPath);
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    // Eski veritabanındaki (scenarios.db) ayarlar ilk açılışta taşınır
    if (fresh && fs.existsSync(legacyPath)) this.migrateFrom(legacyPath);
  }

  private migrateFrom(legacyPath: string) {
    try {
      const legacy = new DatabaseSync(legacyPath, { readOnly: true });
      const rows = legacy.prepare(`SELECT key, value, updated_at FROM settings`).all() as unknown as { key: string; value: string; updated_at: string }[];
      const stmt = this.db.prepare(`INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)`);
      for (const r of rows) stmt.run(r.key, r.value, r.updated_at);
      legacy.close();
      console.log(`[Ayarlar] ${rows.length} ayar scenarios.db'den settings.db'ye taşındı`);
    } catch (err) {
      console.warn('[Ayarlar] Eski ayarlar taşınamadı:', err);
    }
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
