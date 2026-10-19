import fs from 'node:fs';
import path from 'node:path';

/**
 * Senaryolar doğrudan diskteki YAML dosyalarından okunur (veritabanı yok; dosya neyse o):
 * - yerleşik bölümler: public/scenarios/<id>.yaml (silinemez, düzenlemek için dosya düzenlenir)
 * - arayüzden kaydedilen özel senaryolar: public/scenarios/ozel/<id>.yaml
 * Başlık/açıklama/etiketler dosyanın başındaki yorumlardan (`# senaryo:`, `# açıklama:`, `# etiketler:`) okunur;
 * yoksa yerleşik bölümler için aşağıdaki tablodan, o da yoksa `film.title` satırından.
 */

export interface ScenarioRecord {
  id: string;
  title: string;
  description: string;
  content: string;
  category: 'builtin' | 'custom';
  tags: string;
  created_at: string;
  updated_at: string;
  /** Proje köküne göre dosya yolu */
  path: string;
}

const BUILTIN_METADATA: Record<string, { title: string; description: string; tags: string }> = {
  'bolum-1-ormanin-bekcileri': {
    title: 'Bölüm 1: İlk Devriye',
    description: 'Ormanın Bekçileri açılış sahnesi: Toprak, Defne ve Meşe ormanın kadim sırlarını korumak için göreve çıkıyor.',
    tags: 'orman, bekçiler, toprak, defne, meşe, açılış',
  },
  'bolum-2-karabeyin-golgesi': {
    title: "Bölüm 2: Karabey'in Gölgesi",
    description: "Ulu Çınar Yolu'nda dört elementin düellosu: Toprak (toprak), Defne (hava) ve Meşe (su), ateşin efendisi Karabey'e karşı.",
    tags: 'orman, bekçiler, karabey, toprak, defne, meşe, düello, aksiyon, element',
  },
  'test-dort-element': {
    title: 'Test: Dört Element',
    description: 'Seslendirmesiz test bölümü: Karabey ateş, Meşe su, Toprak toprak, Defne hava; her element yeteneği sırayla ve birlikte.',
    tags: 'test, element, ateş, su, toprak, hava, yetenek',
  },
  'harita-toprak-yol': {
    title: 'Orman Haritası (Toprak Yol)',
    description: "Toprak yol haritasında Toprak, Meşe ve Defne'nin Türkçe seslendirmeli ve mimikli animasyon sahnesi.",
    tags: 'toprak, meşe, defne, orman, seslendirme',
  },
};

const YAML = /\.ya?ml$/i;
/** Kimlik yalnızca harf, rakam, tire ve alt çizgi: dosya yolu dışına çıkılamasın. */
const SAFE_ID = /^[a-z0-9][a-z0-9_-]*$/i;

export class ScenarioFiles {
  private readonly builtinDir: string;
  private readonly customDir: string;

  constructor(private readonly rootDir: string = process.cwd()) {
    this.builtinDir = path.join(rootDir, 'public', 'scenarios');
    this.customDir = path.join(this.builtinDir, 'ozel');
  }

  getAll(): Omit<ScenarioRecord, 'content'>[] {
    const list = [...this.scan(this.builtinDir, 'builtin'), ...this.scan(this.customDir, 'custom')];
    return list
      .sort((a, b) => (a.category === b.category ? (a.category === 'builtin' ? a.id.localeCompare(b.id) : b.updated_at.localeCompare(a.updated_at)) : a.category === 'builtin' ? -1 : 1))
      .map(({ content: _content, ...meta }) => meta);
  }

  getById(id: string): ScenarioRecord | null {
    if (!SAFE_ID.test(id)) return null;
    for (const [dir, category] of [[this.builtinDir, 'builtin'], [this.customDir, 'custom']] as const) {
      for (const ext of ['.yaml', '.yml']) {
        const file = path.join(dir, id + ext);
        if (fs.existsSync(file)) return this.read(file, category);
      }
    }
    return null;
  }

  /** Özel senaryoyu public/scenarios/ozel/ altına yazar (varsa günceller). Yerleşik bölümler buradan değiştirilmez. */
  save(data: { id?: string; title: string; description?: string; content: string; tags?: string }): ScenarioRecord {
    let id = data.id?.trim();
    if (id) {
      if (!SAFE_ID.test(id)) throw new Error(`Geçersiz senaryo kimliği: ${id}`);
      if (this.findFile(this.builtinDir, id)) throw new Error(`"${id}" yerleşik bir bölüm; değiştirmek için public/scenarios/${id}.yaml dosyasını düzenleyin.`);
    } else {
      id = this.uniqueId(slug(data.title) || 'senaryo');
    }
    fs.mkdirSync(this.customDir, { recursive: true });
    const header = [
      `# senaryo: ${oneLine(data.title)}`,
      `# açıklama: ${oneLine(data.description ?? '')}`,
      `# etiketler: ${oneLine(data.tags ?? 'özel')}`,
    ].join('\n');
    const file = path.join(this.customDir, `${id}.yaml`);
    fs.writeFileSync(file, `${header}\n${stripMetaHeader(data.content)}`, 'utf8');
    return this.read(file, 'custom');
  }

  delete(id: string): boolean {
    if (!SAFE_ID.test(id)) return false;
    if (this.findFile(this.builtinDir, id)) throw new Error('Yerleşik senaryolar silinemez.');
    const file = this.findFile(this.customDir, id);
    if (!file) return false;
    fs.unlinkSync(file);
    return true;
  }

  private findFile(dir: string, id: string): string | null {
    for (const ext of ['.yaml', '.yml']) {
      const file = path.join(dir, id + ext);
      if (fs.existsSync(file)) return file;
    }
    return null;
  }

  private uniqueId(base: string): string {
    let id = base;
    for (let n = 2; this.findFile(this.builtinDir, id) || this.findFile(this.customDir, id); n++) id = `${base}-${n}`;
    return id;
  }

  private scan(dir: string, category: 'builtin' | 'custom'): ScenarioRecord[] {
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && YAML.test(e.name))
      .map((e) => this.read(path.join(dir, e.name), category));
  }

  private read(file: string, category: 'builtin' | 'custom'): ScenarioRecord {
    const content = fs.readFileSync(file, 'utf8');
    const stat = fs.statSync(file);
    const id = path.basename(file).replace(YAML, '');
    const header = readMetaHeader(content);
    const known = category === 'builtin' ? BUILTIN_METADATA[id] : undefined;
    const filmTitle = content.match(/^\s*title:\s*([^\r\n#]+)/m)?.[1].trim();
    return {
      id,
      title: header.title || known?.title || filmTitle || id,
      description: header.description || known?.description || '',
      tags: header.tags || known?.tags || (category === 'custom' ? 'özel' : 'senaryo'),
      content,
      category,
      created_at: stat.birthtime.toISOString(),
      updated_at: stat.mtime.toISOString(),
      path: path.relative(this.rootDir, file).replace(/\\/g, '/'),
    };
  }
}

/** Dosya başındaki `# senaryo:` / `# açıklama:` / `# etiketler:` yorumları. */
function readMetaHeader(content: string): { title?: string; description?: string; tags?: string } {
  const out: { title?: string; description?: string; tags?: string } = {};
  for (const line of content.split(/\r?\n/).slice(0, 8)) {
    const m = line.match(/^#\s*(senaryo|açıklama|etiketler):\s*(.*)$/i);
    if (!m) continue;
    const value = m[2].trim();
    const key = m[1].toLowerCase();
    if (key === 'senaryo') out.title = value;
    else if (key === 'açıklama') out.description = value;
    else out.tags = value;
  }
  return out;
}

/** Yeniden kaydederken eski bilgi yorumları tekrarlanmasın. */
function stripMetaHeader(content: string): string {
  const lines = content.split(/\r?\n/);
  let i = 0;
  while (i < lines.length && /^#\s*(senaryo|açıklama|etiketler):/i.test(lines[i])) i++;
  return lines.slice(i).join('\n');
}

const oneLine = (s: string) => s.replace(/[\r\n]+/g, ' ').trim();

/** Başlıktan dosya adı: Türkçe harfler ASCII'ye, boşluklar tireye. */
function slug(title: string): string {
  const map: Record<string, string> = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u', Ç: 'c', Ğ: 'g', İ: 'i', Ö: 'o', Ş: 's', Ü: 'u' };
  return title
    .replace(/[çğıöşüÇĞİÖŞÜ]/g, (c) => map[c] ?? c)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}
