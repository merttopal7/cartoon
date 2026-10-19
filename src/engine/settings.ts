/**
 * SQLite Settings Client
 * Communicates with Vite SQLite API (/api/settings) to persist app & audio engine settings in SQLite.
 * STRICT RULE: All settings are stored in SQLite (scenarios.db -> settings table).
 */

export interface EngineSettings {
  sync_lead_in: number;
  sync_lead_out: number;
  sync_linked: boolean;
  safe_zone?: boolean;
  volume?: number;
  viewport_mode?: 'preview' | 'render';
  music_enabled?: boolean;
  music_track?: string;
  music_volume?: number;
  music_ducking?: number;
  music_loop?: boolean;
  music_fade_in?: number;
  music_fade_out?: number;
}

export class SettingsClient {
  private cache: EngineSettings = {
    sync_lead_in: 700,
    sync_lead_out: 700,
    sync_linked: true,
    safe_zone: true,
    volume: 1.0,
    viewport_mode: 'preview',
    music_enabled: true,
    music_track: 'procedural:main',
    music_volume: 0.35,
    music_ducking: 0.25,
    music_loop: true,
    music_fade_in: 1.0,
    music_fade_out: 1.5,
  };
  private isLoaded = false;

  get isReady(): boolean {
    return this.isLoaded;
  }

  async load(): Promise<EngineSettings> {
    try {
      const res = await fetch('/api/settings');
      if (res.ok) {
        const data = await res.json();
        if (data.ok && data.settings) {
          const s = data.settings;
          this.cache = {
            sync_lead_in: s.sync_lead_in !== undefined ? Number(s.sync_lead_in) : 700,
            sync_lead_out: s.sync_lead_out !== undefined ? Number(s.sync_lead_out) : 700,
            sync_linked: s.sync_linked !== undefined ? s.sync_linked === 'true' || s.sync_linked === true : true,
            safe_zone: s.safe_zone !== undefined ? s.safe_zone === 'true' || s.safe_zone === true : true,
            volume: s.volume !== undefined ? Number(s.volume) : 1.0,
            viewport_mode: (s.viewport_mode === 'render' || s.viewport_mode === 'preview') ? s.viewport_mode : 'preview',
            music_enabled: s.music_enabled !== undefined ? s.music_enabled === 'true' || s.music_enabled === true : true,
            // Silinen hazır parçalar (/audio/main-theme/…) kayıtlıysa yordamsal temaya dön
            music_track: s.music_track && !String(s.music_track).startsWith('/audio/main-theme/') ? s.music_track : 'procedural:main',
            music_volume: s.music_volume !== undefined ? Number(s.music_volume) : 0.35,
            music_ducking: s.music_ducking !== undefined ? Number(s.music_ducking) : 0.25,
            music_loop: s.music_loop !== undefined ? s.music_loop === 'true' || s.music_loop === true : true,
            music_fade_in: s.music_fade_in !== undefined ? Number(s.music_fade_in) : 1.0,
            music_fade_out: s.music_fade_out !== undefined ? Number(s.music_fade_out) : 1.5,
          };
          this.isLoaded = true;
          return this.cache;
        }
      }
    } catch (err) {
      console.warn('[SettingsClient] SQLite API erişilemedi, varsayılanlar devrede:', err);
    }
    this.isLoaded = true;
    return this.cache;
  }

  get(): EngineSettings {
    return this.cache;
  }

  async save(partial: Partial<EngineSettings>): Promise<EngineSettings> {
    this.cache = { ...this.cache, ...partial };
    try {
      const stringifiedMap: Record<string, string> = {};
      for (const [k, v] of Object.entries(partial)) {
        stringifiedMap[k] = String(v);
      }
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: stringifiedMap }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.ok && data.settings) {
          const s = data.settings;
          this.cache = {
            sync_lead_in: s.sync_lead_in !== undefined ? Number(s.sync_lead_in) : this.cache.sync_lead_in,
            sync_lead_out: s.sync_lead_out !== undefined ? Number(s.sync_lead_out) : this.cache.sync_lead_out,
            sync_linked: s.sync_linked !== undefined ? (s.sync_linked === 'true' || s.sync_linked === true) : this.cache.sync_linked,
            safe_zone: s.safe_zone !== undefined ? (s.safe_zone === 'true' || s.safe_zone === true) : this.cache.safe_zone,
            volume: s.volume !== undefined ? Number(s.volume) : this.cache.volume,
            viewport_mode: (s.viewport_mode === 'render' || s.viewport_mode === 'preview') ? s.viewport_mode : this.cache.viewport_mode,
            music_enabled: s.music_enabled !== undefined ? (s.music_enabled === 'true' || s.music_enabled === true) : this.cache.music_enabled,
            music_track: s.music_track ?? this.cache.music_track,
            music_volume: s.music_volume !== undefined ? Number(s.music_volume) : this.cache.music_volume,
            music_ducking: s.music_ducking !== undefined ? Number(s.music_ducking) : this.cache.music_ducking,
            music_loop: s.music_loop !== undefined ? (s.music_loop === 'true' || s.music_loop === true) : this.cache.music_loop,
            music_fade_in: s.music_fade_in !== undefined ? Number(s.music_fade_in) : this.cache.music_fade_in,
            music_fade_out: s.music_fade_out !== undefined ? Number(s.music_fade_out) : this.cache.music_fade_out,
          };
        }
      }
    } catch (err) {
      console.warn('[SettingsClient] SQLite kaydetme hatası:', err);
    }
    return this.cache;
  }
}

export const settingsClient = new SettingsClient();
