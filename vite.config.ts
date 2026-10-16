import { defineConfig, Plugin } from 'vite';
import { ScenarioDatabase } from './server/scenario-db';

function scenarioApiPlugin(): Plugin {
  let db: ScenarioDatabase;

  return {
    name: 'scenario-api-plugin',
    configureServer(server) {
      db = new ScenarioDatabase();

      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/')) {
          return next();
        }

        const url = new URL(req.url, 'http://localhost');
        const method = req.method?.toUpperCase();
        res.setHeader('Content-Type', 'application/json; charset=utf-8');

        // /api/settings
        if (url.pathname.startsWith('/api/settings')) {
          try {
            if (method === 'GET') {
              const settings = db.getAllSettings();
              res.statusCode = 200;
              return res.end(JSON.stringify({ ok: true, settings }));
            }
            if (method === 'POST' || method === 'PUT') {
              const body = await readRequestBody(req);
              const data = JSON.parse(body || '{}');
              let updated: Record<string, string>;
              if (data.key !== undefined && data.value !== undefined) {
                db.setSetting(data.key, String(data.value));
                updated = db.getAllSettings();
              } else if (data.settings && typeof data.settings === 'object') {
                updated = db.setSettings(data.settings);
              } else {
                updated = db.setSettings(data);
              }
              res.statusCode = 200;
              return res.end(JSON.stringify({ ok: true, settings: updated }));
            }
            res.statusCode = 405;
            return res.end(JSON.stringify({ ok: false, error: 'Desteklenmeyen metod' }));
          } catch (err: unknown) {
            console.error('[Settings API Error]:', err);
            res.statusCode = 500;
            const msg = err instanceof Error ? err.message : String(err);
            return res.end(JSON.stringify({ ok: false, error: msg }));
          }
        }

        // /api/scenarios
        if (!url.pathname.startsWith('/api/scenarios')) {
          return next();
        }

        const pathParts = url.pathname.replace(/^\/api\/scenarios\/?/, '').split('/').filter(Boolean);

        try {
          // GET /api/scenarios
          if (method === 'GET' && pathParts.length === 0) {
            const list = db.getAll();
            res.statusCode = 200;
            return res.end(JSON.stringify({ ok: true, scenarios: list }));
          }

          // GET /api/scenarios/:id
          if (method === 'GET' && pathParts.length === 1) {
            const id = decodeURIComponent(pathParts[0]);
            const item = db.getById(id);
            if (!item) {
              res.statusCode = 404;
              return res.end(JSON.stringify({ ok: false, error: 'Senaryo bulunamadı' }));
            }
            res.statusCode = 200;
            return res.end(JSON.stringify({ ok: true, scenario: item }));
          }

          // POST /api/scenarios/reset-builtin
          if (method === 'POST' && pathParts[0] === 'reset-builtin') {
            db.seedBuiltins();
            res.statusCode = 200;
            return res.end(JSON.stringify({ ok: true, message: 'Yerleşik senaryolar yenilendi' }));
          }

          // POST /api/scenarios (kaydet/güncelle)
          if (method === 'POST') {
            const body = await readRequestBody(req);
            const data = JSON.parse(body);
            if (!data.title || !data.content) {
              res.statusCode = 400;
              return res.end(JSON.stringify({ ok: false, error: 'Başlık ve senaryo içeriği gereklidir' }));
            }
            const saved = db.save(data);
            res.statusCode = 200;
            return res.end(JSON.stringify({ ok: true, scenario: saved }));
          }

          // DELETE /api/scenarios/:id
          if (method === 'DELETE' && pathParts.length === 1) {
            const id = decodeURIComponent(pathParts[0]);
            const success = db.delete(id);
            if (!success) {
              res.statusCode = 404;
              return res.end(JSON.stringify({ ok: false, error: 'Silinecek senaryo bulunamadı' }));
            }
            res.statusCode = 200;
            return res.end(JSON.stringify({ ok: true, message: 'Senaryo silindi' }));
          }

          res.statusCode = 405;
          return res.end(JSON.stringify({ ok: false, error: 'Desteklenmeyen metod' }));
        } catch (err: unknown) {
          console.error('[Scenario API Error]:', err);
          res.statusCode = 500;
          const msg = err instanceof Error ? err.message : String(err);
          return res.end(JSON.stringify({ ok: false, error: msg }));
        }
      });
    },
  };
}

function readRequestBody(req: import('node:http').IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 5 * 1024 * 1024) {
        reject(new Error('İçerik boyutu çok büyük (maks 5MB)'));
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

export default defineConfig({
  plugins: [scenarioApiPlugin()],
  server: {
    port: 5174,
  },
});
