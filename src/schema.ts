import { z } from 'zod';
import { parse as parseYaml, YAMLParseError } from 'yaml';
import { abilityNames, casterClipNames, resolveAbility, targetClipNames } from './engine/ability-registry';

// ---------------------------------------------------------------------------
// Senaryo şeması. YAML (veya JSON) önce bu şemaya göre doğrulanır; motorun geri
// kalanı yalnızca doğrulanmış `Scenario` nesnesiyle çalışır.
// ---------------------------------------------------------------------------

const vec3 = z.tuple([z.number(), z.number(), z.number()]);
/** [x, z] (yerde) veya [x, y, z] */
const point = z.union([vec3, z.tuple([z.number(), z.number()])]);
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Renk "#rrggbb" biçiminde olmalı');

/** Sabit bir değer ya da çekim boyunca { from, to } arasında animasyon. */
const animatable = <T extends z.ZodTypeAny>(s: T) => z.union([s, z.object({ from: s, to: s }).strict()]);

export const SHOT_SIZES = ['wide', 'full', 'medium', 'close'] as const;
const shotSize = z.union([z.enum(SHOT_SIZES), z.number().positive()]);
const cameraWaypoint = z.union([vec3, z.string()]);
const cameraTarget = z.union([z.string(), z.array(z.string()).min(1), vec3, z.array(cameraWaypoint).min(2)]);

const cameraFields = {
  target: cameraTarget.optional(),
  size: animatable(shotSize).optional(),
  angle: animatable(z.number()).optional(),
  elevation: animatable(z.number()).optional(),
  fov: z.number().min(10).max(90).optional(),
  ease: z.enum(['linear', 'in', 'out', 'inOut']).optional(),
  /** El kamerası canlılığı (0–1): çok hafif, deterministik sallantı. Verilmezse film.handheld. */
  handheld: z.number().min(0).max(1).optional(),
  /** true: angle hedef karakterin yüzüne göre (0 = tam karşıdan); false: dünya eksenine göre. */
  relative: z.boolean().optional(),
  /** false: bu çekim yetenek kamera odağından (yakınlaşma, yandan bakış) etkilenmez (ör. tepki çekimi). */
  focus: z.boolean().optional(),
};
const cameraOverride = z.object(cameraFields).strict();
const camera = z
  .object({
    ...cameraFields,
    target: cameraTarget,
    /** Format kimliğine (youtube_16x9…) veya yöne (landscape/portrait/square) göre ezme. */
    formats: z.record(z.string(), cameraOverride).optional(),
  })
  .strict();

const actionBase = { who: z.string(), at: z.number().min(0).default(0) };
const action = z.discriminatedUnion('do', [
  z.object({ ...actionBase, do: z.literal('wave'), duration: z.number().positive().default(2), hand: z.enum(['right', 'left']).default('right') }).strict(),
  z.object({ ...actionBase, do: z.literal('jump'), duration: z.number().positive().default(1), height: z.number().positive().default(0.8) }).strict(),
  z
    .object({
      ...actionBase,
      do: z.literal('walk_to'),
      /** Tek nokta ya da nokta listesi (yol). Liste verilirse durmadan, sabit hızla tüm noktalardan geçer. */
      to: z.union([point, z.array(point).min(1)]),
      duration: z.number().positive().optional(),
      speed: z.number().positive().default(1.2),
      /** Yürüyüş yerine kullanılacak döngü klibi (ör. kosu, jogging). Hız, ayaklar kaymasın diye klibe göre ayarlanır. */
      clip: z.string().optional(),
      /**
       * Yol boyunca yürü: true = sahnedeki haritanın yolu (varlıkta `road` tanımlı), ya da yolu olan varlığın adı.
       * Karakter bulunduğu yerden yola girer, orta çizgiyi izler ve `to` noktasında yoldan çıkar.
       */
      road: z.union([z.boolean(), z.string()]).optional(),
      /** Yolda şerit: yürüme yönüne göre sağa (+) / sola (−) metre; yol genişliğinin içinde tutulur. */
      lane: z.number().default(0),
    })
    .strict(),
  z.object({ ...actionBase, do: z.literal('turn'), to: z.union([z.number(), z.string()]), duration: z.number().positive().default(0.5) }).strict(),
  z.object({ ...actionBase, do: z.literal('look_at'), target: z.union([z.string(), vec3]), duration: z.number().positive().default(2) }).strict(),
  z
    .object({
      ...actionBase,
      do: z.literal('talk'),
      duration: z.number().positive().default(2),
      /** Seslendirilecek konuşma metni (TTS için) */
      text: z.string().optional(),
      /** Karakterin konuşacağı ElevenLabs ses kimliği (voice_id) veya ses adı */
      voice: z.string().optional(),
      /** Doğrudan veya üretilmiş ses dosyası yolu (ör. audio/toprak-yol/amy_1.mp3) */
      audio: z.string().optional(),
    })
    .strict(),
  z.object({ ...actionBase, do: z.literal('emote'), expression: z.enum(['happy', 'sad', 'surprised', 'angry']), duration: z.number().positive().default(2) }).strict(),
  z
    .object({
      ...actionBase,
      do: z.literal('clip'),
      name: z.string(),
      duration: z.number().positive().optional(),
      loop: z.boolean().default(true),
      /** Klibe giriş/çıkış karışım süresi (sn); idle ile yumuşak geçiş. */
      fade: z.number().positive().default(0.4),
    })
    .strict(),
  z
    .object({
      ...actionBase,
      do: z.literal('ability'),
      /** Yetenek adı veya takma adı; tanımlar ve geçerli adlar: src/data/abilities.yaml */
      name: z
        .string()
        .default('ates_topu')
        .superRefine((n, ctx) => {
          if (!resolveAbility(n))
            ctx.addIssue({ code: 'custom', message: `Bilinmeyen yetenek "${n}". Geçerli adlar: ${abilityNames().join(', ')}` });
        }),
      /** Hedef düşman karakter kimliği, çoklu hedef listesi veya harita ağacı adı (agac_devirme gibi çevre yeteneklerinde isteğe bağlıdır) */
      target: z.union([z.string(), z.array(z.string()).min(1)]).optional(),
      /** İsteğe bağlı özel 1, 2 veya 3 animasyon zinciri (belirtilmezse yeteneğin kendi animasyonları kullanılır) */
      clips: z.array(z.string()).min(1).max(3).optional(),
      /** Düşmanın geriye savrulacağı mesafe (metre, varsayılan: 4.0) */
      knockback: z.number().min(0).default(4.0),
      /** Düşmanın savrulurken oynatacağı animasyon (varsayılan: yeteneğe göre impact_2, impact_3, death veya fall_flat) */
      impact_clip: z.string().optional(),
      /** Vuruş gücü (sarsıntı + hit-stop, ~0.6 hafif … 1.5 sert). Verilmezse savrulma mesafesinden hesaplanır; 0 = vuruş hissi yok. */
      impact: z.number().min(0).max(3).optional(),
    })
    .strict(),
]);

export const CHARACTER_PLACEHOLDERS = ['bear', 'bunny'] as const;
export const PROP_PLACEHOLDERS = ['tree', 'bush', 'rock', 'house'] as const;

const placeholderAsset = z
  .object({
    placeholder: z.enum([...CHARACTER_PLACEHOLDERS, ...PROP_PLACEHOLDERS]),
    color: color.optional(),
    voice: z.string().optional(),
    element: z.enum(['ates', 'su', 'toprak', 'hava']).optional(),
  })
  .strict();
const modelAsset = z
  .object({
    /** .glb, .gltf veya .fbx */
    src: z.string(),
    /** Modeli bu boya (metre) ölçekle. */
    height: z.number().positive().optional(),
    /** Ölçek çarpanı. Verilmezse FBX için 0.01 (cm → m), GLB için 1. */
    scale: z.number().positive().optional(),
    /** Motor hareket adı → model içindeki klip adı, ör. { walk: "Walking" } */
    clips: z.record(z.string(), z.string()).optional(),
    /** feet: en alt nokta y=0'a oturtulur (varsayılan). none: modelin kendi orijini korunur (haritalar için). */
    align: z.enum(['feet', 'none']).default('feet'),
    /**
     * Haritanın yol orta çizgisi (JSON: { points: [[x, z, genişlik, yükseklik], …] }, haritanın kendi koordinatlarında).
     * Varsa `walk_to` eylemleri `road: true` ile yol boyunca yürüyebilir.
     */
    road: z.string().optional(),
    /**
     * Göz kapağı kemikleriyle göz kırpma (morph'u olmayan, kapakları kemikli karakterler için).
     * bones: kemik adı deseni, axis/open: kapağı açan yerel eksen ve açı (radyan). 0 = kapalı.
     */
    eyelids: z
      .object({ bones: z.string().default('eyelidup'), axis: z.enum(['x', 'y', 'z']), open: z.number() })
      .strict()
      .optional(),
    /**
     * Ağız / çene kemikleriyle konuşma / ağız açma (morph'u olmayan, ağzı kemikli karakterler için).
     * bones: kemik adı deseni, axis/open: ağzı açan yerel eksen ve açı (radyan). 0 = kapalı.
     */
    mouth: z
      .object({ bones: z.string().default('lip_btm|teeth_low|jaw'), axis: z.enum(['x', 'y', 'z']), open: z.number() })
      .strict()
      .optional(),
    /**
     * Ağız şekil anahtarı da ağız kemiği de olmayan yüze yüklemede ağız şekilleri üretilir (çene açma, gülümseme,
     * üzgün); konuşma ve ifadeler bunları kullanır. Değerler modelin bağlama uzayında (FBX birimi; y yukarı, z ileri).
     * Bkz. src/engine/rigs/face-morphs.ts.
     */
    face: z
      .object({
        mesh: z.string(),
        bone: z.string().default('Head$'),
        /** Dudak çizgisinin yüksekliği */
        seam: z.number(),
        /** Çene menteşesi [y, z] (kulak hizası) */
        hinge: z.tuple([z.number(), z.number()]),
        /** Alt çenenin yarı genişliği */
        width: z.number().positive(),
        /** Ağız köşesi [x, z] */
        corner: z.tuple([z.number(), z.number()]),
        /** Dudakların ortadaki ön yüzeyi (z); dişler bunun arkasına yerleşir */
        front: z.number().optional(),
      })
      .strict()
      .optional(),
    /** Karakterin varsayılan ElevenLabs ses kimliği veya ses adı */
    voice: z.string().optional(),
    /** Karakterin elementi; kullandığı yeteneklerin elementiyle uyuşmazsa yüklemede uyarı verilir. */
    element: z.enum(['ates', 'su', 'toprak', 'hava']).optional(),
    /**
     * Renk parlaklığı çarpanı (1 = dokunun kendisi). Dokusu çok açık (pastel) bir karakter aynı ışıkta diğerlerinden
     * "fırlıyorsa" düşürülür; ör. 0.8.
     */
    brightness: z.number().min(0.3).max(1.5).optional(),
    /**
     * Karakterin kendi doku renginde dolgu ışığı (0–1); gölgedeki yüz sahnenin (ör. yeşil zemin) ışığına değil
     * kendi rengine kayar, göz çukurları kararmaz. Verilmezse sahnenin character_light değeri.
     */
    fill: z.number().min(0).max(1).optional(),
    /** Renk doygunluğu çarpanı (1 = dokunun kendisi; 0 = gri). */
    saturation: z.number().min(0).max(1.5).optional(),
    /** Ayrı dosyadaki animasyonlar: klip adı → dosya, ör. { walk: models/kedi-walk.fbx } (Mixamo "Without Skin") */
    animations: z.record(z.string(), z.string()).optional(),
  })
  .strict();

export const TRANSITION_TYPES = ['cut', 'fade', 'iris', 'stripes', 'flash'] as const;
export type TransitionType = (typeof TRANSITION_TYPES)[number];

/**
 * Renk düzenleme: ön ayar adı (neutral | soft | battle | golden | night) ya da ön ayar + ayrıntı
 * (exposure, contrast, saturation, warmth, vignette). Bkz. src/engine/look.ts.
 */
const grade = z
  .union([
    z.enum(['neutral', 'soft', 'battle', 'golden', 'night']),
    z
      .object({
        preset: z.enum(['neutral', 'soft', 'battle', 'golden', 'night']).optional(),
        exposure: z.number().min(0.3).max(2).optional(),
        contrast: z.number().min(0.5).max(1.6).optional(),
        saturation: z.number().min(0).max(2).optional(),
        warmth: z.number().min(-0.3).max(0.3).optional(),
        vignette: z.number().min(0).max(1).optional(),
      })
      .strict(),
  ]);

const overlayBase = {
  /** Sahne içindeki başlangıç zamanı (sn). */
  at: z.number().min(0).default(0),
  /** Animasyonun ekranda kalma süresi (sn). */
  duration: z.number().positive().default(3.5),
  /** Vurgu rengi (#rrggbb). */
  accent: color.default('#22c55e'),
};

const overlay = z.discriminatedUnion('type', [
  z
    .object({
      ...overlayBase,
      type: z.literal('title_card'),
      badge: z.string().optional(),
      title: z.string(),
      subtitle: z.string().optional(),
      position: z.enum(['top', 'center', 'bottom-left']).default('top'),
    })
    .strict(),
  z
    .object({
      ...overlayBase,
      type: z.literal('lower_third'),
      name: z.string(),
      role: z.string().optional(),
      tag: z.string().optional(),
      align: z.enum(['left', 'right']).default('left'),
    })
    .strict(),
  z
    .object({
      ...overlayBase,
      type: z.literal('comic_pop'),
      text: z.string(),
      subtext: z.string().optional(),
      position: z.enum(['top-left', 'top-right', 'bottom-left', 'bottom-right', 'top-center']).default('top-right'),
    })
    .strict(),
  z
    .object({
      ...overlayBase,
      type: z.literal('interstitial'),
      badge: z.string().optional(),
      title: z.string(),
      subtitle: z.string().optional(),
    })
    .strict(),
]);

const cameraCut = z
  .object({
    /** Opsiyonel başlangıç zamanı (sn). Verilmezse bir önceki kameranın bitişinden devam eder. */
    at: z.number().min(0).optional(),
    duration: z.number().positive(),
    camera,
    /** Bu kameraya geçiş: cut, fade, iris (çizgi film daire kapanışı), stripes (dinamik şeritler) ya da flash. */
    transition: z.enum(TRANSITION_TYPES).default('cut'),
    /**
     * Kurgu kapsaması: bu kamera aralığını otomatik kısa çekimlere böler (src/engine/coverage.ts).
     * dialogue = karşılıklı çekim (konuşana kes, dinleyenin tepkisi, 180° kuralı; kameraya konuşmada orta → yakın),
     * fight = vuruşlardan sonra vurulanın kısa yakın planı. İkisi birlikte verilebilir: [dialogue, fight].
     */
    coverage: z.union([z.enum(['dialogue', 'fight']), z.array(z.enum(['dialogue', 'fight']))]).optional(),
  })
  .strict();

const legacyShot = z
  .object({
    at: z.number().min(0).optional(),
    duration: z.number().positive(),
    camera,
    /** Bu çekime geçiş: cut, fade, iris, stripes ya da flash. */
    transition: z.enum(TRANSITION_TYPES).default('cut'),
    actions: z.array(action).default([]),
  })
  .strict();

const scene = z
  .object({
    id: z.string(),
    environment: z
      .object({
        preset: z.enum(['day', 'sunset', 'night']).default('day'),
        /** Bu sahnenin renk tonu (film.look.grade'i ezer). */
        grade: grade.optional(),
        sky: color.optional(),
        ground: color.optional(),
        /** false: düz zemin çizilmez (harita modeli kendi zeminini getiriyorsa). */
        ground_plane: z.boolean().default(true),
        /**
         * Karakterlere kendi dokularından eklenen öz ışık (0–1). Karanlık sahnelerde karakter arka
         * plandan ayrışsın diye. Verilmezse: gece 0.35, gün batımı 0.12, gündüz 0.
         */
        character_light: z.number().min(0).max(1).optional(),
        /** Düz zeminin yüksekliği (m); harita kenarlarının altını kapatmak için aşağı alınabilir. */
        ground_level: z.number().default(0),
        fog: z.boolean().default(true),
        /** Sisin başladığı ve tamamen kapattığı mesafeler (m). Büyük haritalarda uzatın. */
        fog_near: z.number().positive().default(30),
        fog_far: z.number().positive().default(90),
        /** Rüzgar ayarları (bitki salınımı ve uçuşan yapraklar). */
        wind: z
          .object({
            enabled: z.boolean().default(true),
            speed: z.number().default(1.0),
            strength: z.number().default(0.5),
            direction: z.tuple([z.number(), z.number()]).default([1.0, 0.3]),
            leaves: z.boolean().default(true),
          })
          .strict()
          .optional(),
      })
      .strict()
      .default({}),
    props: z
      .array(
        z
          .object({
            asset: z.string(),
            at: vec3,
            rotation: z.number().default(0),
            scale: z.number().positive().default(1),
            /**
             * Karakterler bu modelin yüzeyine (arazi) basar. true: zemin otomatik bulunur.
             * Ad listesi: yalnızca bu adlı parçalar (malzeme ya da mesh adı) zemin sayılır, en üstteki yüzey kullanılır.
             */
            terrain: z.union([z.boolean(), z.array(z.string()).min(1)]).default(false),
          })
          .strict(),
      )
      .default([]),
    characters: z
      .array(z.object({ id: z.string(), asset: z.string(), at: vec3, facing: z.number().default(0) }).strict())
      .default([]),
    /** Senaryodan (karakter eylemlerinden) tamamen bağımsız kamera açıları ve geçişleri. */
    cameras: z.array(cameraCut).min(1).optional(),
    /** Kamera geçişlerinden bağımsız, sahne boyunca kesintisiz akan karakter eylemleri (senaryo akışı). */
    actions: z.array(action).default([]),
    /** Remotion tarzı yay (spring) ve enterpolasyon tabanlı 2B hareketli grafik / yazı katmanları. */
    overlays: z.array(overlay).default([]),
    /** Geriye dönük uyumluluk için çekim listesi (cameras yerine kullanılabilir). */
    shots: z.array(legacyShot).min(1).optional(),
  })
  .strict();

export const scenarioSchema = z
  .object({
    film: z
      .object({
        title: z.string().default('film'),
        fps: z.number().int().min(12).max(60).default(30),
        /** Başta siyahtan açılma ve sonda siyaha kararma süreleri (sn). */
        fade_in: z.number().min(0).default(0),
        fade_out: z.number().min(0).default(0),
        /** Tüm çekimler için varsayılan el kamerası canlılığı (0–1). */
        handheld: z.number().min(0).max(1).default(0),
        /** Yetenek isabetlerinde kamera sarsıntısı çarpanı (0 = kapalı, 1 = varsayılan). */
        impact_shake: z.number().min(0).max(2).default(1),
        /** Yetenek isabetlerinde vuruş duraksaması (hit-stop) çarpanı (0 = kapalı). Toplam süreyi ve ses senkronunu değiştirmez. */
        hit_stop: z.number().min(0).max(2).default(1),
        /** Arkaplan müziği ayarları */
        music: z
          .object({
            src: z.string().default('/audio/main-theme/jyproject-carousel-dreams-396029.mp3'),
            volume: z.number().min(0).max(1).default(0.35),
            loop: z.boolean().default(true),
            ducking: z.number().min(0).max(1).default(0.25),
            fade_in: z.number().min(0).default(1.0),
            fade_out: z.number().min(0).default(1.5),
            start: z.number().default(0),
            enabled: z.boolean().default(true),
          })
          .partial()
          .optional(),
        /**
         * Çizgi film görünümü (son işlem): mürekkep konturu (yalnızca karakterler), aşırı parlak efektlerde
         * parlama ve renk düzenleme. Önizlemede ve dışa aktarımda aynı.
         */
        look: z
          .object({
            /** Kontur kalınlığı (1080p'de piksel; uzakta incelir ve soluklaşır). 0 = kapalı */
            outline: z.number().min(0).max(5).default(2.2),
            /** Parlama gücü (yalnızca ateş, şimşek gibi aşırı parlak efektler). 0 = kapalı */
            bloom: z.number().min(0).max(2).default(0.3),
            /** Varsayılan renk tonu (sahne environment.grade ile ezer) */
            grade: grade.default('neutral'),
          })
          .strict()
          .default({}),
        /**
         * Ses efektleri: koddan sentezlenir (telifsiz). Yetenekler, ayak sesleri, düşüşler, ekran yazıları,
         * geçişler ve orman ortam sesi otomatik eklenir.
         */
        sfx: z
          .object({
            enabled: z.boolean().default(true),
            /** Efektlerin seviyesi (1 = varsayılan) */
            volume: z.number().min(0).max(1.5).default(1),
            /** Ortam sesi (rüzgâr, kuşlar; gece cırcır böcekleri) seviyesi; 0 = kapalı */
            ambience: z.number().min(0).max(1).default(0.3),
            footsteps: z.boolean().default(true),
            /** Ekran yazıları (balon, başlık, isim kartı) ve kamera geçişi sesleri (varsayılan kapalı) */
            ui: z.boolean().default(false),
          })
          .strict()
          .default({}),
      })
      .strict()
      .default({}),
    /** Dosya başında tanımlanan ortak içe aktarmalar (tüm karakterlere otomatik dağıtılır) */
    imports: z
      .union([
        z.object({
          animations: z.record(z.string(), z.string()).optional(),
        }),
        z.record(z.string(), z.any()),
      ])
      .optional(),
    /** Dosya başında doğrudan ortak animasyon kütüphanesi */
    animations: z.record(z.string(), z.string()).optional(),
    assets: z.record(z.string(), z.union([placeholderAsset, modelAsset])).default({}),
    scenes: z.array(scene).min(1),
  })
  .strict();

export type Scenario = z.infer<typeof scenarioSchema>;
export type SceneDef = Scenario['scenes'][number];
export type CameraCutDef = z.infer<typeof cameraCut>;
export type ShotDef = z.infer<typeof legacyShot>;
export type OverlayDef = z.infer<typeof overlay>;
export type EnvironmentDef = SceneDef['environment'];
export type AssetDef = Scenario['assets'][string];
export type Action = z.infer<typeof action>;
export type CameraDef = z.infer<typeof camera>;
export type CameraOverride = z.infer<typeof cameraOverride>;
export type CameraTarget = z.infer<typeof cameraTarget>;
export type Animatable<T> = T | { from: T; to: T };

export type ParseResult = { ok: true; scenario: Scenario } | { ok: false; errors: string[] };

/** Ortak Mixamo genel karakter animasyon kataloğu (Toprak, Defne, Meşe ve tüm insansı karakterler için) */
export const SHARED_MIXAMO_ANIMATIONS: Record<string, string> = {
  // Temel duruş ve yürüyüş / koşu
  idle: 'models/animations/Neutral Idle.fbx',
  fight_idle: 'models/animations/Action Idle To Fight Idle.fbx',
  /** Neşeli, zıplayan bekleme (2 sn döngü); Defne'nin bekleme klibi */
  happy_idle: 'models/animations/Happy Idle.fbx',
  briefcase_idle: 'models/animations/Standing W_Briefcase Idle.fbx',
  sitting: 'models/animations/Sitting.fbx',
  crouch_to_stand: 'models/animations/Crouch To Stand.fbx',
  walk: 'models/animations/Walking.fbx',
  drunk_walk: 'models/animations/Drunk Walk.fbx',
  jog: 'models/animations/Jogging.fbx',
  run: 'models/animations/Running.fbx',
  run_forward: 'models/animations/Standing Run Forward.fbx',
  run_arc_left: 'models/animations/Run Forward Arc Left.fbx',
  run_to_turn: 'models/animations/Running To Turn.fbx',
  turn_left: 'models/animations/Left Turn.fbx',
  turn_right: 'models/animations/Right Turn.fbx',
  rifle_turn: 'models/animations/Rifle Turn.fbx',
  swimming: 'models/animations/Swimming.fbx',

  // Zıplama, spor ve akrobasi
  jump: 'models/animations/Jump.fbx',
  jump_joy: 'models/animations/Joyful Jump.fbx',
  /** Uzun sevinç/coşku hareketi (10 sn, yerinde) */
  happy: 'models/animations/Happy.fbx',
  /** Sola kavis çizerek neşeli yürüyüş: her adımda ~38° döner, düz walk_to için uygun değil */
  happy_walk_arc_left: 'models/animations/Happy Walk Forward Arc Left.fbx',
  running_jump: 'models/animations/Running Jump.fbx',
  jump_down: 'models/animations/Jumping Down.fbx',
  pushup: 'models/animations/Jump Push Up.fbx',
  bicycle_crunch: 'models/animations/Bicycle Crunch.fbx',
  stretch: 'models/animations/Arm Stretching.fbx',
  goalkeeper: 'models/animations/Goalkeeper Catch.fbx',

  // Dövüş, savunma, saldırı ve özel yetenek animasyonları
  hook_punch: 'models/animations/Hook Punch.fbx',
  hurricane_kick: 'models/animations/Hurricane Kick.fbx',
  flying_kick: 'models/animations/Flying Kick.fbx',
  chapa_giratoria: 'models/animations/Chapa-Giratoria.fbx',
  macaco_side: 'models/animations/Macaco Side.fbx',
  kick: 'models/animations/Martelo 2.fbx',
  mma_kick: 'models/animations/Mma Kick.fbx',
  rifle_kick: 'models/animations/Rifle Turn And Kick.fbx',
  dodge_back: 'models/animations/Standing Dodge Backward.fbx',

  // Dans, kutlama ve sahne şovu (yalnızca kutlama/dans sahnelerinde kullanılır, düşmana karşı kullanılmaz)
  dance: 'models/animations/Silly Dancing.fbx',
  silly_dance: 'models/animations/Silly Dancing.fbx',
  capoeira: 'models/animations/Capoeira.fbx',
  hip_hop: 'models/animations/Hip Hop Dancing.fbx',
  breakdance: 'models/animations/Breakdance 1990.fbx',
  flair: 'models/animations/Flair.fbx',
  singing: 'models/animations/Singing.fbx',

  // Tepki, jest ve dramatik durumlar
  taunt: 'models/animations/Taunt.fbx',
  point: 'models/animations/Kneeling Pointing.fbx',
  surprised: 'models/animations/Surprised.fbx',
  defeated: 'models/animations/Defeated.fbx',
  fall_flat: 'models/animations/Fall Flat.fbx',
  dying: 'models/animations/Dying.fbx',
  death_left: 'models/animations/Standing Death Left 01.fbx',

  // Longbow (Okçu) hareket paketi
  bow_idle: 'models/animations/Longbow Locomotion Pack/standing idle 01.fbx',
  bow_walk: 'models/animations/Longbow Locomotion Pack/standing walk forward.fbx',
  bow_walk_back: 'models/animations/Longbow Locomotion Pack/standing walk back.fbx',
  bow_walk_left: 'models/animations/Longbow Locomotion Pack/standing walk left.fbx',
  bow_walk_right: 'models/animations/Longbow Locomotion Pack/standing walk right.fbx',
  bow_run: 'models/animations/Longbow Locomotion Pack/standing run forward.fbx',
  bow_run_stop: 'models/animations/Longbow Locomotion Pack/standing run forward stop.fbx',
  bow_run_back: 'models/animations/Longbow Locomotion Pack/standing run back.fbx',
  bow_run_left: 'models/animations/Longbow Locomotion Pack/standing run left.fbx',
  bow_run_right: 'models/animations/Longbow Locomotion Pack/standing run right.fbx',
  bow_turn_left: 'models/animations/Longbow Locomotion Pack/standing turn 90 left.fbx',
  bow_turn_right: 'models/animations/Longbow Locomotion Pack/standing turn 90 right.fbx',
};

/** Sword and Shield (Paladin) karakter paketindeki yerleşik Mixamo animasyon kataloğu */
export const SWORD_AND_SHIELD_ANIMATIONS: Record<string, string> = {
  idle: 'models/characters/sword-and-shield/sword and shield idle.fbx',
  idle_2: 'models/characters/sword-and-shield/sword and shield idle (2).fbx',
  idle_3: 'models/characters/sword-and-shield/sword and shield idle (3).fbx',
  idle_4: 'models/characters/sword-and-shield/sword and shield idle (4).fbx',
  walk: 'models/characters/sword-and-shield/sword and shield walk.fbx',
  walk_2: 'models/characters/sword-and-shield/sword and shield walk (2).fbx',
  run: 'models/characters/sword-and-shield/sword and shield run.fbx',
  run_2: 'models/characters/sword-and-shield/sword and shield run (2).fbx',
  jump: 'models/characters/sword-and-shield/sword and shield jump.fbx',
  jump_2: 'models/characters/sword-and-shield/sword and shield jump (2).fbx',
  kick: 'models/characters/sword-and-shield/sword and shield kick.fbx',
  slash: 'models/characters/sword-and-shield/sword and shield slash.fbx',
  slash_2: 'models/characters/sword-and-shield/sword and shield slash (2).fbx',
  slash_3: 'models/characters/sword-and-shield/sword and shield slash (3).fbx',
  slash_4: 'models/characters/sword-and-shield/sword and shield slash (4).fbx',
  slash_5: 'models/characters/sword-and-shield/sword and shield slash (5).fbx',
  attack: 'models/characters/sword-and-shield/sword and shield attack.fbx',
  attack_2: 'models/characters/sword-and-shield/sword and shield attack (2).fbx',
  attack_3: 'models/characters/sword-and-shield/sword and shield attack (3).fbx',
  attack_4: 'models/characters/sword-and-shield/sword and shield attack (4).fbx',
  block: 'models/characters/sword-and-shield/sword and shield block.fbx',
  block_2: 'models/characters/sword-and-shield/sword and shield block (2).fbx',
  block_idle: 'models/characters/sword-and-shield/sword and shield block idle.fbx',
  casting: 'models/characters/sword-and-shield/sword and shield casting.fbx',
  casting_2: 'models/characters/sword-and-shield/sword and shield casting (2).fbx',
  power_up: 'models/characters/sword-and-shield/sword and shield power up.fbx',
  sheath: 'models/characters/sword-and-shield/sheath sword 1.fbx',
  sheath_2: 'models/characters/sword-and-shield/sheath sword 2.fbx',
  crouch: 'models/characters/sword-and-shield/sword and shield crouch.fbx',
  crouch_idle: 'models/characters/sword-and-shield/sword and shield crouch idle.fbx',
  crouch_block: 'models/characters/sword-and-shield/sword and shield crouch block.fbx',
  crouch_block_2: 'models/characters/sword-and-shield/sword and shield crouch block (2).fbx',
  crouch_block_idle: 'models/characters/sword-and-shield/sword and shield crouch block idle.fbx',
  crouching: 'models/characters/sword-and-shield/sword and shield crouching.fbx',
  crouching_2: 'models/characters/sword-and-shield/sword and shield crouching (2).fbx',
  crouching_3: 'models/characters/sword-and-shield/sword and shield crouching (3).fbx',
  impact: 'models/characters/sword-and-shield/sword and shield impact.fbx',
  impact_2: 'models/characters/sword-and-shield/sword and shield impact (2).fbx',
  impact_3: 'models/characters/sword-and-shield/sword and shield impact (3).fbx',
  strafe: 'models/characters/sword-and-shield/sword and shield strafe.fbx',
  strafe_2: 'models/characters/sword-and-shield/sword and shield strafe (2).fbx',
  strafe_3: 'models/characters/sword-and-shield/sword and shield strafe (3).fbx',
  strafe_4: 'models/characters/sword-and-shield/sword and shield strafe (4).fbx',
  turn: 'models/characters/sword-and-shield/sword and shield turn.fbx',
  turn_2: 'models/characters/sword-and-shield/sword and shield turn (2).fbx',
  turn_180: 'models/characters/sword-and-shield/sword and shield 180 turn.fbx',
  turn_180_2: 'models/characters/sword-and-shield/sword and shield 180 turn (2).fbx',
  death: 'models/characters/sword-and-shield/sword and shield death.fbx',
  death_2: 'models/characters/sword-and-shield/sword and shield death (2).fbx',
};

/** Erika (Pro Longbow Pack) yaylı okçu karakter paketindeki yerleşik Mixamo animasyon kataloğu */
export const ERIKA_BOW_ANIMATIONS: Record<string, string> = {
  idle: 'models/characters/Erika/standing idle 01.fbx',
  idle_2: 'models/characters/Erika/standing idle 02 looking.fbx',
  idle_3: 'models/characters/Erika/standing idle 03 examine.fbx',
  ready_idle: 'models/characters/Erika/standing idle 02 looking.fbx',
  inspect_bow: 'models/characters/Erika/standing idle 03 examine.fbx',
  unarmed_idle: 'models/characters/Erika/unarmed idle 01.fbx',
  walk: 'models/characters/Erika/standing walk forward.fbx',
  walk_back: 'models/characters/Erika/standing walk back.fbx',
  walk_left: 'models/characters/Erika/standing walk left.fbx',
  walk_right: 'models/characters/Erika/standing walk right.fbx',
  run: 'models/characters/Erika/standing run forward.fbx',
  jog: 'models/characters/Erika/standing run forward.fbx',
  run_stop: 'models/characters/Erika/standing run forward stop.fbx',
  run_back: 'models/characters/Erika/standing run back.fbx',
  run_left: 'models/characters/Erika/standing run left.fbx',
  run_right: 'models/characters/Erika/standing run right.fbx',
  turn_left: 'models/characters/Erika/standing turn 90 left.fbx',
  turn_right: 'models/characters/Erika/standing turn 90 right.fbx',
  draw_arrow: 'models/characters/Erika/standing draw arrow.fbx',
  aim_overdraw: 'models/characters/Erika/standing aim overdraw.fbx',
  aim_recoil: 'models/characters/Erika/standing aim recoil.fbx',
  aim_walk: 'models/characters/Erika/standing aim walk forward.fbx',
  aim_walk_back: 'models/characters/Erika/standing aim walk back.fbx',
  aim_walk_left: 'models/characters/Erika/standing aim walk left.fbx',
  aim_walk_right: 'models/characters/Erika/standing aim walk right.fbx',
  equip_bow: 'models/characters/Erika/standing equip bow.fbx',
  disarm_bow: 'models/characters/Erika/standing disarm bow.fbx',
  block: 'models/characters/Erika/standing block.fbx',
  dodge_back: 'models/characters/Erika/standing dodge backward.fbx',
  dodge_forward: 'models/characters/Erika/standing dodge forward.fbx',
  dodge_left: 'models/characters/Erika/standing dodge left.fbx',
  dodge_right: 'models/characters/Erika/standing dodge right.fbx',
  dive_forward: 'models/characters/Erika/standing dive forward.fbx',
  melee_kick: 'models/characters/Erika/standing melee kick.fbx',
  melee_punch: 'models/characters/Erika/standing melee punch.fbx',
  impact: 'models/characters/Erika/standing react small from front.fbx',
  impact_2: 'models/characters/Erika/standing react small from front.fbx',
  impact_3: 'models/characters/Erika/standing react small from headshot.fbx',
  death: 'models/characters/Erika/standing death backward 01.fbx',
  death_2: 'models/characters/Erika/standing death forward 01.fbx',
  fall_loop: 'models/characters/Erika/fall a loop.fbx',
  fall_to_idle: 'models/characters/Erika/fall a land to standing idle 01.fbx',
  fall_to_run: 'models/characters/Erika/fall a land to run forward.fbx',
};

const SHARED_CORE_KEYS = ['idle', 'walk', 'run', 'jog'] as const;

const SWORD_AND_SHIELD_CORE_KEYS = [
  'idle',
  'walk',
  'walk_2',
  'run',
  'run_2',
] as const;

const ERIKA_BOW_CORE_KEYS = [
  'idle',
  'walk',
  'run',
  'jog',
] as const;

/** YAML veya JSON metnini ayrıştırır ve doğrular. JSON geçerli bir YAML olduğundan ikisi de kabul edilir. */
export function parseScenario(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch (e) {
    if (e instanceof YAMLParseError) {
      const pos = e.linePos?.[0];
      const where = pos ? ` (satır ${pos.line}, sütun ${pos.col})` : '';
      return { ok: false, errors: [`YAML hatası${where}: ${e.message.split('\n')[0]}`] };
    }
    throw e;
  }

  // Ortak animasyonları (imports veya animations) tüm karakter modellerine otomatik aktar
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const rawObj = raw as Record<string, any>;
    let sharedAnimations: Record<string, string> = {};

    if (rawObj.animations && typeof rawObj.animations === 'object') {
      sharedAnimations = { ...sharedAnimations, ...rawObj.animations };
    }
    if (rawObj.imports && typeof rawObj.imports === 'object') {
      if (rawObj.imports.animations && typeof rawObj.imports.animations === 'object') {
        sharedAnimations = { ...sharedAnimations, ...rawObj.imports.animations };
      } else {
        for (const [k, v] of Object.entries(rawObj.imports)) {
          if (typeof v === 'string') {
            sharedAnimations[k] = v;
          }
        }
      }
    }

    // Her karakter varlığı (asset) için yalnızca o karakterin sahnede kullandığı klip adlarını topla
    const usedClipsByAsset = new Map<string, Set<string>>();
    const addAssetClip = (assetName: string | undefined, clipName: string | undefined) => {
      if (!assetName || !clipName) return;
      let set = usedClipsByAsset.get(assetName);
      if (!set) {
        set = new Set<string>();
        usedClipsByAsset.set(assetName, set);
      }
      set.add(clipName);
    };

    if (Array.isArray(rawObj.scenes)) {
      for (const sc of rawObj.scenes) {
        const charToAsset = new Map<string, string>();
        if (Array.isArray(sc?.characters)) {
          for (const ch of sc.characters) {
            if (ch && typeof ch.id === 'string' && typeof ch.asset === 'string') {
              charToAsset.set(ch.id, ch.asset);
            }
          }
        }

        const collectActs = (acts: any) => {
          if (!Array.isArray(acts)) return;
          for (const a of acts) {
            if (a && typeof a === 'object') {
              const whoAsset = typeof a.who === 'string' ? charToAsset.get(a.who) : undefined;
              if (a.do === 'clip' && typeof a.name === 'string') {
                addAssetClip(whoAsset, a.name);
              }
              if (a.do === 'walk_to' && typeof a.clip === 'string') {
                addAssetClip(whoAsset, a.clip);
              }
              if (a.do === 'ability') {
                // Yüklenecek klipler yetenek tanımından (src/data/abilities.yaml); bilinmeyen ad şemada hata verir
                const def = resolveAbility(typeof a.name === 'string' ? a.name : 'ates_topu');
                const custom = Array.isArray(a.clips) ? a.clips.filter((c: unknown): c is string => typeof c === 'string') : undefined;
                const casterClips = def ? casterClipNames(def, custom) : (custom ?? []);
                for (const c of casterClips) addAssetClip(whoAsset, c);

                const targetIds = Array.isArray(a.target)
                  ? a.target
                  : typeof a.target === 'string'
                    ? [a.target]
                    : [];
                for (const tid of targetIds) {
                  const targetAsset = typeof tid === 'string' ? charToAsset.get(tid) : undefined;
                  for (const tc of def ? targetClipNames(def) : []) {
                    addAssetClip(targetAsset, tc);
                  }
                  if (typeof a.impact_clip === 'string') {
                    addAssetClip(targetAsset, a.impact_clip);
                  }
                }
              }
            }
          }
        };
        collectActs(sc?.actions);
        if (Array.isArray(sc?.shots)) {
          for (const sh of sc.shots) collectActs(sh?.actions);
        }
      }
    }

    if (rawObj.assets && typeof rawObj.assets === 'object') {
      for (const [assetKey, assetDef] of Object.entries(rawObj.assets)) {
        if (assetDef && typeof assetDef === 'object') {
          const isMapOrProp =
            (assetDef as any).align === 'none' ||
            ('placeholder' in assetDef && ['tree', 'bush', 'rock', 'house'].includes((assetDef as any).placeholder));
          if (!isMapOrProp && 'src' in assetDef) {
            const srcStr = String((assetDef as any).src ?? '');
            const isSwordAndShield = /sword-and-shield/i.test(srcStr);
            const isErikaBow = /\/erika\//i.test(srcStr);
            const catalogDefaults: Record<string, string> = {};
            const charUsedClips = usedClipsByAsset.get(assetKey) ?? new Set<string>();

            // Genel katalogdan temel yürüyüş/koşu ve bu karakterin sahnede kullandığı klipleri bağla
            for (const k of SHARED_CORE_KEYS) {
              catalogDefaults[k] = SHARED_MIXAMO_ANIMATIONS[k];
            }
            for (const clipName of charUsedClips) {
              if (SHARED_MIXAMO_ANIMATIONS[clipName]) {
                catalogDefaults[clipName] = SHARED_MIXAMO_ANIMATIONS[clipName];
              }
              if (SWORD_AND_SHIELD_ANIMATIONS[clipName] && !catalogDefaults[clipName]) {
                catalogDefaults[clipName] = SWORD_AND_SHIELD_ANIMATIONS[clipName];
              }
              if (ERIKA_BOW_ANIMATIONS[clipName] && !catalogDefaults[clipName]) {
                catalogDefaults[clipName] = ERIKA_BOW_ANIMATIONS[clipName];
              }
            }

            // Sword-and-shield ve Erika (Yaylı Okçu) karakterleri için kendi özel paket klipleri önceliklidir
            const packDefaults: Record<string, string> = {};
            if (isSwordAndShield) {
              for (const k of SWORD_AND_SHIELD_CORE_KEYS) {
                packDefaults[k] = SWORD_AND_SHIELD_ANIMATIONS[k];
              }
              for (const clipName of charUsedClips) {
                if (SWORD_AND_SHIELD_ANIMATIONS[clipName]) {
                  packDefaults[clipName] = SWORD_AND_SHIELD_ANIMATIONS[clipName];
                }
              }
            } else if (isErikaBow) {
              for (const k of ERIKA_BOW_CORE_KEYS) {
                packDefaults[k] = ERIKA_BOW_ANIMATIONS[k];
              }
              for (const clipName of charUsedClips) {
                if (ERIKA_BOW_ANIMATIONS[clipName]) {
                  packDefaults[clipName] = ERIKA_BOW_ANIMATIONS[clipName];
                }
              }
            }

            (assetDef as any).animations = {
              ...catalogDefaults,
              ...sharedAnimations,
              ...packDefaults,
              ...((assetDef as any).animations || {}),
            };
          }
        }
      }
    }
  }

  const result = scenarioSchema.safeParse(raw);
  if (!result.success) {
    return { ok: false, errors: result.error.issues.map((i) => `${formatPath(i.path)}: ${i.message}`) };
  }
  const refErrors = checkReferences(result.data);
  return refErrors.length ? { ok: false, errors: refErrors } : { ok: true, scenario: result.data };
}

function formatPath(path: (string | number)[]): string {
  return path.reduce<string>((s, p) => (typeof p === 'number' ? `${s}[${p}]` : s ? `${s}.${p}` : p), '') || '(kök)';
}

/** Şemanın tek başına yakalayamadığı çapraz referansları kontrol eder. */
function checkReferences(s: Scenario): string[] {
  const errors: string[] = [];
  const isCharacterAsset = (a: AssetDef) => !('placeholder' in a) || (CHARACTER_PLACEHOLDERS as readonly string[]).includes(a.placeholder);

  s.scenes.forEach((sc, si) => {
    const at = `scenes[${si}] (${sc.id})`;
    const ids = new Set<string>();

    sc.characters.forEach((c, ci) => {
      const p = `${at}.characters[${ci}]`;
      if (ids.has(c.id)) errors.push(`${p}: "${c.id}" kimliği bu sahnede tekrar ediyor`);
      ids.add(c.id);
      const asset = s.assets[c.asset];
      if (!asset) errors.push(`${p}: "${c.asset}" adlı varlık assets altında tanımlı değil`);
      else if (!isCharacterAsset(asset)) errors.push(`${p}: "${c.asset}" bir dekor varlığı, karakter olarak kullanılamaz`);
    });
    sc.props.forEach((pr, pi) => {
      if (!s.assets[pr.asset]) errors.push(`${at}.props[${pi}]: "${pr.asset}" adlı varlık assets altında tanımlı değil`);
    });

    const camEntries = sc.cameras ?? sc.shots ?? [];
    if (camEntries.length === 0) {
      errors.push(`${at}: en az bir kamera açısı ("cameras" veya "shots") tanımlanmalı`);
    }

    const camLabel = sc.cameras ? 'cameras' : 'shots';
    camEntries.forEach((shot, shi) => {
      const sp = `${at}.${camLabel}[${shi}]`;
      const targets = [shot.camera.target, ...Object.values(shot.camera.formats ?? {}).map((o) => o.target)];
      for (const tg of targets) {
        if (tg === undefined) continue;
        const names = typeof tg === 'string' ? [tg] : (tg as unknown[]).filter((x): x is string => typeof x === 'string');
        for (const id of names) if (!ids.has(id)) errors.push(`${sp}.camera: hedef "${id}" bu sahnede yok`);
      }
      if ('actions' in shot && Array.isArray(shot.actions)) {
        shot.actions.forEach((a, ai) => {
          const ap = `${sp}.actions[${ai}]`;
          if (!ids.has(a.who)) errors.push(`${ap}: "${a.who}" bu sahnede yok`);
          if (a.do === 'turn' && typeof a.to === 'string' && !ids.has(a.to)) errors.push(`${ap}: dönülecek "${a.to}" bu sahnede yok`);
          if (a.do === 'look_at' && typeof a.target === 'string' && a.target !== 'camera' && !ids.has(a.target))
            errors.push(`${ap}: bakılacak "${a.target}" bu sahnede yok (karakter kimliği veya "camera" olmalı)`);
          if (a.do === 'ability' && resolveAbility(a.name)?.target !== 'map_tree') {
            const tList = a.target ? (Array.isArray(a.target) ? a.target : [a.target]) : [];
            if (tList.length === 0) {
              errors.push(`${ap}: yetenek hedefi belirtilmeli`);
            }
            for (const tid of tList) {
              if (!ids.has(tid)) errors.push(`${ap}: yetenek hedefi "${tid}" bu sahnede yok`);
            }
          }
        });
      }
    });

    sc.actions.forEach((a, ai) => {
      const ap = `${at}.actions[${ai}]`;
      if (!ids.has(a.who)) errors.push(`${ap}: "${a.who}" bu sahnede yok`);
      if (a.do === 'turn' && typeof a.to === 'string' && !ids.has(a.to)) errors.push(`${ap}: dönülecek "${a.to}" bu sahnede yok`);
      if (a.do === 'look_at' && typeof a.target === 'string' && a.target !== 'camera' && !ids.has(a.target))
        errors.push(`${ap}: bakılacak "${a.target}" bu sahnede yok (karakter kimliği veya "camera" olmalı)`);
      if (a.do === 'ability' && resolveAbility(a.name)?.target !== 'map_tree') {
        const tList = a.target ? (Array.isArray(a.target) ? a.target : [a.target]) : [];
        if (tList.length === 0) {
          errors.push(`${ap}: yetenek hedefi belirtilmeli`);
        }
        for (const tid of tList) {
          if (!ids.has(tid)) errors.push(`${ap}: yetenek hedefi "${tid}" bu sahnede yok`);
        }
      }
    });
  });
  return errors;
}
