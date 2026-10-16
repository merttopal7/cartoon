# Cartoon Engine (Faz 0)

YAML senaryodan cel-shade 3D çizgi film üreten, tarayıcıda çalışan motor (three.js).
Çıktı YouTube ve Instagram uyumlu MP4 (H.264) olarak doğrudan tarayıcıda kodlanır; sunucu gerekmez.

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # tip kontrolü + üretim derlemesi
```

Dışa aktarım için **Chrome veya Edge** gerekir (WebCodecs).

## Nasıl çalışır

```
senaryo.yaml → şema doğrulama (zod) → sahne derleyici → zaman çizelgesi
                                                      ↓
                    film.evaluate(t, format)  ← her kare t = kare / fps
                                                      ↓
                 önizleme (canlı)   |   dışa aktarım: WebCodecs H.264 → MP4
```

- **Deterministik:** Bir kare yalnızca `t`'ye bağlıdır. Dışa aktarım gerçek zamandan bağımsız olarak kare kare render eder, bu yüzden makine yavaş olsa da video takılmaz.
- **Formata göre kadraj:** Aynı çekim her en-boy oranı için ayrı kamera konumuyla render edilir (kırpma yok). Dikey formatta hedefler sığmazsa kamera kendiliğinden geri çekilir.

| Format | Çözünürlük |
|---|---|
| YouTube 16:9 | 1920×1080 |
| YouTube 4K | 3840×2160 |
| Reels / Shorts 9:16 | 1080×1920 |
| Instagram Feed 4:5 | 1080×1350 |
| Instagram Kare 1:1 | 1080×1080 |

## Senaryo biçimi

JSON da kabul edilir (JSON geçerli bir YAML'dır). Örnekler: [demo.yaml](public/scenarios/demo.yaml) (test karakterleri), [bolum-1.yaml](public/scenarios/bolum-1.yaml) (Mixamo karakteri, orman haritası) [bolum-2.yaml](public/scenarios/bolum-2.yaml) (yol boyunca yürüyüş) [bolum-3.yaml](public/scenarios/bolum-3.yaml) (iki karakter, retarget) ve [bolum-4.yaml](public/scenarios/bolum-4.yaml) (üç karakter, Mixamo olmayan iskelet).

```yaml
film: { title: bolum-1, fps: 30 }

assets:
  ayi:  { placeholder: bear }                  # test karakterleri: bear, bunny
  agac: { placeholder: tree }                  # test dekorları: tree, bush, rock, house
  kedi: { src: models/kedi.fbx, animations: { idle: models/kedi-idle.fbx, walk: models/kedi-walk.fbx } }

scenes:
  - id: park
    environment: { preset: day }               # day | sunset | night, isteğe bağlı sky/ground renk
    props:      [{ asset: agac, at: [3, 0, -4], rotation: 0, scale: 1 }]
    characters: [{ id: ayi, asset: ayi, at: [0, 0, 0], facing: 0 }]
    shots:
      - duration: 3
        camera: { target: ayi, size: full }
        actions:
          - { who: ayi, do: wave, at: 0.5 }
```

Koordinatlar metre cinsinden: Y yukarı, `facing: 0` = +Z yönü (varsayılan kameraya doğru). Açılar derece.

### Film ve kurgu

```yaml
film:
  fade_in: 1.2      # siyahtan açılış (sn)
  fade_out: 2       # siyaha kararak kapanış (sn)
  handheld: 0.35    # tüm çekimlerde hafif el kamerası canlılığı (0–1); çekim başına camera.handheld ile ezilir
  impact_shake: 1   # yetenek isabetlerinde kamera sarsıntısı (0 = kapalı, en çok 2)
  hit_stop: 1       # isabette karakterler ve efektler ~2–3 kare ağırlaşır, sonra yetişir (0 = kapalı, en çok 2)
shots:
  - duration: 4
    transition: fade   # bu çekime siyaha kararıp açılarak geç (zaman atlaması); varsayılan cut
```

Klipler idle'a `fade` sürede (varsayılan 0.4 sn) yumuşakça girer ve çıkar: `{ do: clip, name: capoeira, fade: 0.5 }`. Arka arkaya gelen iki klip arasındaki geçiş de yeni klibin `fade` süresidir (kısa klipte en çok %40'ı). Başı ile sonu uyuşmayan döngü klipleri (ör. "Action Idle To Fight Idle" gibi geçiş animasyonları) yüklemede tespit edilir; her turun sonu yeni turun başıyla 0.3 sn karıştırılır ki döngüde sıçrama olmasın. Yürüme/koşu döngüleri bundan muaftır.

### Yetenekler (`do: ability`)

```yaml
- { who: toprak, do: ability, name: ates_topu, target: karabey, at: 34.6, knockback: 0.4, impact_clip: impact_3 }
- { who: karabey, do: ability, name: karanlik_buyu, target: [toprak, defne, mese], at: 43.9 }   # çoklu hedef
- { who: karabey, do: ability, name: agac_devirme, target: Realistic_Pine_057, at: 31.2 }      # harita ağacı
```

**Elementler:** Ormanın Bekçileri'nde Karabey ateş, Meşe su, Toprak toprak, Defne hava elementindedir. Karakter varlığına `element: toprak` yazılır; karakter başka elementten bir yetenek kullanırsa yüklemede uyarı verilir. Yetenekler: Karabey `alev_buyusu` (tek/çoklu hedef) ve `agac_devirme`, Toprak `yer_dikeni`, Defne `ruzgar_hortumu`, Meşe `firtina_oku` (Sağanak Oku). Yer dikenleri gibi yerden ilerleyen efektlerde kamera saldırı çizgisini yandan görecek şekilde en çok 45° döner. Seslendirmesiz örnek: [test-dort-element.yaml](public/scenarios/test-dort-element.yaml).

Yetenekler [src/data/abilities.yaml](src/data/abilities.yaml) dosyasında tanımlıdır: adlar ve takma adlar, oynatılan klipler, fırlatma anı (`release: { clip, at }`), uçuş ve sönme süreleri, savrulma, hedefin tepki klibi ve HUD ikonu. Yeni yetenek eklemek ya da zamanlamayı değiştirmek için yalnızca bu dosya düzenlenir; geçerli adlar, karakterlere yüklenecek klipler ve doğrulama oradan türetilir. Süresi yazılmayan klip gerçek süresiyle oynar; fırlatma anı klibe bağlı olduğundan klip değişince birlikte kayar. Kullananda olmayan ya da yazılan süreden belirgin kısa klipler yüklemede uyarı verir. Görsel efektler (`effect`) `src/engine/abilities.ts` içindedir. Testler: `node tools/test_abilities.mjs`.

**Vuruş hissi:** Her yetenek isabetinde (devrilen ağacın yere çarpışı dahil) kamera kısa ve sönümlü bir sarsıntı yapar, karakterler ve efektler bir an duraksar (hit-stop). Güç savrulma mesafesinden hesaplanır (0.35 m ≈ 0.7, 2.8 m ≈ 1.45); eylem başına `impact: 1.2` ile ezilir, `impact: 0` kapatır. Hit-stop toplam süreyi değiştirmez: duraksamadan sonra hareket ~0.25 sn biraz hızlı akıp gerçek zamana yetişir; sesler, müzik ve sonraki eylemler kaymaz. Kamera hareketi duraksamaz. Bkz. `src/engine/impact.ts`.

### Ses efektleri

Ses efektleri dosyadan okunmaz, koddan sentezlenir ([src/engine/sfx/](src/engine/sfx/)); telif hakkı sorunu yoktur. Senaryoya bir şey yazmadan otomatik eklenirler:

- **Yetenekler:** her elementin güç toplama, fırlatma ve isabet sesi (ateş uğultusu ve patlama, yerden fışkıran kaya dikenleri, hortum rüzgârı; Sağanak Okunda dönen su, kiriş ve okun ıslığı, isabette şimşek, gök gürültüsü ve sağanak), ağaç devirmede vuruş, yanan kesik, kırılma, devrilme, çarpma ve sürüklenme; isabette darbe
- **Hareket:** ayak sesleri (yürüme/koşu klibinde ayağın yere bastığı karede), savrulma ve zıplama sonrası yere düşüş
- **Ekran (isteğe bağlı, varsayılan kapalı):** çizgi roman balonunda "pop", başlık kartında zil, isim kartında ve kamera geçişlerinde hışırtı
- **Ortam:** döngülü orman sesi (rüzgâr, yaprak, kuşlar; `night` ön ayarında cırcır böcekleri), konuşmada kısılır

Sesler kameraya uzaklıkla kısılır ve ekrandaki yerine göre sağa/sola kayar; hit-stop'tan etkilenmez, görüntüyle aynı karede duyulur. Defne'nin hortumu fırlatılınca sesi onunla hareket eder: uzaklaştıkça kısılır, ekranda kayar ve Doppler ile perdesi değişir (kameraya yaklaşırken incelir, uzaklaşırken kalınlaşır; çizgi film için abartılı, en çok ±5 yarım ton). Önizlemede ve MP4/WAV dışa aktarımında aynıdır.

```yaml
film:
  sfx:
    volume: 1        # efekt seviyesi (0–1.5)
    ambience: 0.3    # orman ortamı (0 = kapalı)
    footsteps: true
    ui: false        # yazı ve geçiş sesleri (varsayılan kapalı)
    # enabled: false  → tüm efektler kapalı
```

Dinlemek ve test için: `node tools/test_sfx.mjs <klasör>` her sesi art arda içeren `sfx_galeri.wav` ve bölümlerden miks kesitleri yazar.

### Görünüm: kontur, parlama, renk tonu

Son işlem ([src/render/post.ts](src/render/post.ts)) önizlemede ve dışa aktarımda aynıdır:

- **Mürekkep konturu** yalnızca karakterlerde: siluet ve üst üste binen uzuvlar (kol gövdenin önündeyken). Kalınlık 1080p'de piksel cinsindendir; karakter uzaklaştıkça incelir ve 25–60 m arasında soluklaşır, uzaktaki küçük karakter kontura boğulmaz (eski ters-kabuk konturunun sorunu). Karakteri örten ağaç ya da başka karakter varsa çizgi onların üstüne taşmaz; ateş, şimşek gibi parlak efektlerin içinde çizgi söner. Ağaç ve çimenler kontur almaz.
- **Parlama (bloom)** yalnızca ışık niteliğindeki efektlerde (alev, şimşek, ışıltı izleri); kaya, hortum gövdesi, gökyüzü parlamaz. Ekranda yetenek yokken maliyeti yoktur.
- **Renk tonu** film ya da sahne başına: `neutral`, `soft` (tanıtım), `battle` (savaş: sıcak, kontrastlı, vinyet), `golden` (gün batımı), `night`. Ekran yazıları (isim kartı, balon) tonlanmaz.

```yaml
film:
  look:
    outline: 2.2     # kontur kalınlığı (1080p'de piksel; 0 = kapalı)
    bloom: 0.3       # parlama gücü (0 = kapalı)
    grade: battle    # ya da { preset: battle, warmth: 0.02, vignette: 0.15, contrast: 1.05, saturation: 1.1, exposure: 1 }
scenes:
  - id: gece-sahnesi
    environment: { preset: night, grade: night }   # sahne bazında ezilir
```

### Yüz: ağız ve ifadeler

- **Konuşma:** ağız sesin yüksekliğiyle açılıp kapanır. Toprak'ta ağız doku tablosundan, Defne'de çizilen anime ağızdan, şekil anahtarı olan modellerde `jawopen`/`mouth` şeklinden gelir.
- **Ağız şekli olmayan yüz** (Meşe/Erika): varlığa `face` yazılır, yüklemede çene açma, gülümseme ve üzgün şekilleri üretilir ([face-morphs.ts](src/engine/rigs/face-morphs.ts)). Değerler modelin bağlama uzayında (FBX birimi; y yukarı, z ileri):
  `face: { mesh: Body_Mesh, seam: 159.0, hinge: [161.5, 0.5], width: 5.3, corner: [2.3, 10.1] }` (dudak çizgisi, çene menteşesi, alt çene yarı genişliği, ağız köşesi).
- **Otomatik ifadeler:** yetenek kullanan güç toplarken kızgın/kararlı, vurulan karakter ~1 sn şaşkın, sevinç kliplerinde (`jump_joy`, dans, şarkı) mutlu. Senaryodaki `emote` eylemleriyle birleşir (en güçlüsü geçerli). Karabey'in yüzü miğferle kapalıdır.

Testler: `node tools/test_face.mjs`.

**Karakter renk dengesi:** dokusu çok açık (pastel) bir karakter aynı ışıkta diğerlerinden fırlıyorsa varlığına `brightness` (renk çarpanı, doğrusal ışıkta; 0.6 ≈ göze %20 daha koyu) ve `saturation` yazılır. Defne: `brightness: 0.6, saturation: 0.88`.

Maliyet (önizleme, 759×427): renk tonu ~2 ms, kontur ~1.5 ms; parlama yalnızca yetenek sırasında. Shader'lar yüklemede hazırlanır, ilk karelerde takılma olmaz. Kareleri gözle kontrol etmek için: `node tools/capture_frames.mjs <senaryo> <klasör> <t1,t2> render 1920` (`CROP=x,y,genişlik,yükseklik` oranlarıyla kırpma).

### Kamera

| Alan | Değer | Açıklama |
|---|---|---|
| `target` | `ayi` · `[ayi, tavsan]` · `[x, y, z]` | Birden çok karakter verilirse hepsi kadraja sığdırılır |
| `size` | `wide` · `full` · `medium` · `close` · sayı | Plan boyu (sayı = karakter boyunun katı) |
| `angle` | derece | Yatay açı. 0 = önden |
| `relative` | `true` / `false` | `true` ise açı karakterin yüzüne göre hesaplanır |
| `elevation` | derece | Dikey açı |
| `fov` | derece (varsayılan 30) | Görüş açısı |
| `ease` | `linear` · `in` · `out` · `inOut` | from→to geçişinin eğrisi |
| `handheld` | 0–1 | El kamerası canlılığı (verilmezse `film.handheld`) |
| `formats` | `{ portrait: {...}, youtube_16x9: {...} }` | Formata veya yöne (`landscape` / `portrait` / `square`) göre ezme |

`size`, `angle` ve `elevation` alanlarına `{ from: ..., to: ... }` verilirse çekim boyunca hareket eder (dolly, orbit, crane).

**Yetenek odağı:** Yetenek kullanılırken kamera, çekim tanımının üstüne yeteneğin etkisine doğru yaklaşır. Bu odak zaman içinde yumuşatılır: 2 sn'den kısa aralarla gelen yeteneklerde kamera geri çekilmez, odak karakterden karaktere akarak geçer, kadraj boyutu yavaş değişir. Hareketi önceden sezer (gelecek yetenekler de hesaba katılır); yine yalnızca zamana bağlıdır. Bkz. `src/engine/focus-track.ts`.

**Kamera açıklığı:** Kamera arazinin altına inmez. Haritadaki çamlardan o çekimde kameranın içine girdiği, hedefi örttüğü ya da kameranın hemen önünde kadrajı kapattığı ağaçlar çekimin tamamında ana kameradan gizlenir (gölgeleri kalır). Ağaç yalnızca kesmede kaybolduğu için fark edilmez. Yetenekle devrilen ağaçlar, devrildikleri çekimde hiç gizlenmez; sonraki çekimlerde kamera onlara girerse onlar da gizlenir. Gizlenen ağaçları kaldırmak için kamerayı o ağaçtan uzaklaştırın. Bkz. `src/engine/camera-clearance.ts`.

### Hareketler (`actions`)

Her hareket `who` (karakter) ve `at` (çekim başından itibaren saniye) alır.

| `do` | Alanlar | Not |
|---|---|---|
| `walk_to` | `to: [x, z]` veya nokta listesi `[[x, z], …]`, `duration` veya `speed` | Liste verilirse yol boyunca durmadan, sabit hızla yürür; köşeler en çok 2 m yarıçapla yuvarlatılır. Yola dönüş açıyla orantılı sürer (en çok 0.7 sn). Aynı klipte, öncekinin bitişinden en çok 0.35 sn sonra başlayan `walk_to` öncekine eklenir: her biri kendi süresini korur, aradaki durup kalkma kalkar. Bir yürüyüşü yarıda kesen yeni hareket (yürüyüş, savrulma), karakteri kesildiği yerden alır; kesilmeden önceki hareket değişmez |
| `walk_to` + `road` | `road: true`, `lane`, `to: [x, z]` | Yol boyunca yürür: karakter bulunduğu yerden yola girer, yolun orta çizgisini (ya da `lane` ile yürüme yönüne göre sağdaki (+) / soldaki (−) şeridi) izler ve `to` noktasında yoldan çıkar. Harita varlığında `road: roads/dirt-road.json` olmalı. Ör. `{ who: toprak, do: walk_to, road: true, lane: -1.5, to: [56, 41], speed: 2 }` |
| `turn` | `to: derece` veya karakter kimliği | |
| `look_at` | `target: karakter` · `camera` · `[x, y, z]` | Yalnızca baş döner |
| `wave` | `hand: right/left`, `duration` | |
| `jump` | `height`, `duration` | Hazırlık, squash ve stretch içerir |
| `talk` | `duration` | Ağız hareketi (TTS ve lip-sync sonraki fazda) |
| `emote` | `expression: happy/sad/surprised/angry` | |
| `clip` | `name`, `loop`, `duration` | Modeldeki veya `animations` ile eklenen klibi oynatır |

Göz kırpma, nefes alma ve hafif sallanma otomatik eklenir.

## Modeller (FBX / GLB)

Dosyaları `public/models/` altına koyun. `src` alanı `.fbx`, `.glb` veya `.gltf` olabilir.

### Mixamo'dan (FBX)

Karakteri ve her animasyonu ayrı ayrı **FBX Binary (.fbx)** olarak indirin:

| Dosya | Skin | FPS | Keyframe Reduction | Ek |
|---|---|---|---|---|
| Karakter | With Skin | 30 | none | |
| Her animasyon | Without Skin | 30 | none | Yürüme/koşma için **In Place** |

```yaml
assets:
  kedi:
    src: models/kedi.fbx
    height: 1.2                      # isteğe bağlı; verilmezse FBX cm → m çevrilir
    animations:                      # ad → dosya (her dosyanın ilk klibi bu adı alır)
      idle: models/kedi-idle.fbx
      walk: models/kedi-walk.fbx
      wave: models/kedi-wave.fbx
      jump: models/kedi-jump.fbx
      dans: models/kedi-samba.fbx    # serbest ad: { do: clip, name: dans }
```

### Motorun klipleri nasıl kullandığı

- `idle`, `walk`, `wave` ve `jump` adlı klipler ilgili hareketlerde otomatik oynar. `idle` boşta dururken çalar; yoksa karakter T-pozda kalır ve motor uyarı verir.
- Diğer klipler `{ do: clip, name: ... }` ile oynatılır.
- Model içindeki klip adları farklıysa `clips: { walk: "Walking" }` ile eşlenir.
- Klip yoksa motor prosedürel karşılığını kullanır: zıplama, squash, baş çevirme, yüz morph'ları.
  - `walk` klibi yoksa Mixamo iskeletine prosedürel yürüyüş uygulanır: kalça ve kol salınımı, öne gelen bacakta diz bükme. Bacaklar açıldıkça gövde alçalır ki basan ayak zeminde kalsın. Gerçek bir Walking klibi her zaman daha doğal görünür.
- Kalça ötelemesi (root motion) otomatik sıfırlanır; konumu `walk_to` yönetir.

### Genel standartlar

- **İskelet:** Mixamo kemik adları. Baş çevirme için `Head` kemiği aranır.
- **Göz kırpma:** Morph yoksa motor göz mesh'ini (adında `eye` geçen) bulur. Kırpma anında, göz dokusunun saydamlık maskesini kullanarak yalnızca gözün görünen kısmını yüzden örneklenen ten rengine boyar. Her göze, gözün gerçek genişliğinde ve başla birlikte hareket eden bir kirpik çizgisi çizer.
- **Karakter ışığı:** Karanlık sahnelerde karakter malzemelerine kendi dokusundan öz ışık eklenir (gece 0.35, gün batımı 0.12). `environment.character_light` ile değiştirilebilir.
- **Animasyon paylaşımı (retarget):** Bir Mixamo karakteri için indirilmiş klipler başka bir Mixamo karakterinde de kullanılabilir (ör. Jackie, çocuğun animasyonlarını kullanıyor). Kemik adları önekten bağımsız eşlenir (`mixamorig` / `mixamorig1`). Kalça izi, iki iskeletin duruş pozundaki kalça yüksekliği oranında ölçeklenir; hedefte karşılığı olmayan kemikler (ör. kapüşon ipi) atlanır.
- **Mixamo olmayan iskeletler (insansı retarget):** Kemik adları Mixamo'ya benzemeyen karakterlere de (ör. Amy: `Hips`, `Thigh_L`, `UpperArm_L`…) Mixamo klipleri uyarlanır. Kemikler ada göre eşlenir. İki iskelet farklı pozda (A/T) olsa bile, dinlenme pozunda uzuvların yönleri hizalanır ve dönüşler dünya uzayında aktarılır.
- **Kemikli göz kapakları:** Kapakları kemikle yapılmış karakterlerde `eyelids: { bones: "eyelidup", axis: y, open: -0.6 }` ile kapaklar açık tutulur ve göz kırpılır.
- **Yürüme klibi:** Kök hareketli (In Place olmayan) bir yürüme klibi de kullanılabilir. Motor ilerlemeyi sıfırlar ve klibi karakterin sahnedeki hızına göre hızlandırıp yavaşlatır; ayaklar kaymaz.
- **Yüz morph target'ları (isteğe bağlı):** `blink_L`, `blink_R` (veya `blink`), `mouth_A` (veya `jawOpen`), `smile`, `sad`, `surprised`, `angry`. ARKit adları da tanınır. Mixamo karakterlerinde genelde yoktur; o durumda yüz ifadesi ve ağız hareketi görünmez.
- **Bütçe:** Karakter ≤ 50 bin üçgen, dekor ≤ 200 bin üçgen, dokular ≤ 2K.
- Malzemeler otomatik olarak cel-shade + konturlu malzemeye çevrilir. Renk ve doku korunur.
- GLB dosyalarında Meshopt sıkıştırması desteklenir. Çok sayıda karakterde GLB daha hızlı yüklenir.

## Haritalar

Büyük statik modeller (harita, dekor) önce optimize GLB'ye çevrilir:

```bash
npm run convert -- assets-src/maps/forest/source/forest.fbx public/models/maps/forest.glb --crop -5.5,-10,10,10
```

Dönüştürücü ne yapar:
- Aynı malzemeyi kullanan mesh'leri birleştirir ve köşeleri indeksler. Orman haritasında 1395 parça 3 parçaya, 39 MB 12.7 MB'a indi.
- Birimi metreye çevirir. FBX için varsayılan `--scale 0.01`.
- Dokuları en fazla `--max-texture` (2048) boyutuna küçültür. Saydamlığı olmayan dokular JPEG olarak yazılır.
- `--crop minX,minZ,maxX,maxZ` verilirse bu alanın dışında kalan parçaları atar. Asset paketlerinde haritanın yanına dizilmiş örnek modelleri temizlemek için kullanılır.
- Dönüşüm three.js ile headless Chrome/Edge içinde yapılır. Tarayıcı bulunamazsa yolunu `CHROME_PATH` ile verin.

Ham dosyalar `assets-src/` altında tutulur; bu klasör git'e girmez.

Senaryoda kullanım:

```yaml
assets:
  orman: { src: models/maps/forest.glb, align: none }   # align: none → haritanın orijini korunur
scenes:
  - id: orman-yolu
    environment: { preset: night, ground_level: -2, ground: "#1c2a22" }   # kenarların altını kapatan koyu zemin
    props:
      - { asset: orman, at: [0, 0, 0], scale: 6, terrain: true }
```

- `terrain: true` olan modelden bir yükseklik haritası çıkarılır ve karakterler arazinin yüzeyine basar. Yürürken, zıplarken ve inişlerde zemini takip ederler. Arazi otomatik bulunur: saydam olmayan mesh'ler arasında düz üçgenlerinin alanı en büyük olan. Ağaç, çalı ve çimen kartları elenir.
- **Ayak IK'sı:** Eğimde ayaklar arazinin üstüne basar: kalça, basan ayaklardan en alçaktakine göre iner, her bacak iki kemikli IK ile ayağı araziye taşır (havadaki ayak yüksekliğini korur), basan ayağın tabanı eğime en çok 25° yatar. Zıplama ve savrulmada, ayrıca hızlı koşuda (2.5–5 m/sn arası söner) devre dışıdır; düz zeminde poz değişmez. Mixamo ve insansı (Thigh_L, Calf_L, Foot_L …) iskeletlerde çalışır. Bkz. `src/engine/rigs/foot-ik.ts`; ölçüm: `node tools/measure_feet.mjs`.
- Harita kendi zeminini getiriyorsa düz zemin `ground_plane: false` ile kapatılabilir ya da `ground_level` ile aşağı indirilebilir.
- Statik modeller yüklenirken de otomatik birleştirilir. Dönüştürülmemiş bir FBX harita da çalışır, yalnızca daha yavaş yüklenir.

### Orman haritası (`forest.glb`)

`scale: 6` ile yaklaşık 60×58 m büyüklüğünde, ağaçlar ~15 m. Toprak yolun orta çizgisi (kuşbakışından ölçüldü):
`(4.6, 28.9) → (-0.3, 22.5) → (-5.8, 17.3) → (-9.4, 11.6) → (-10.6, 3.5) → (-8.4, -2.3) → (-1.4, -4.9) → (4.9, -9.0) → (10.1, -13.0) → (13.6, -17.1) → (14.2, -20.5)`.
Ağaçlar sık olduğundan kamerayı yol boyunca konumlayın; yanlara geniş orbitlerde kamera dalların içine girer.

### Toprak yol haritası (`dirt-road.glb`) — gerçekçi orman

Kaynak: `public/models/maps/update-dirt-road-through-forest` (FBX + dokular). FBX'teki doku yolları başka bir bilgisayara aitti; Blender betiği dokuları dosya adına göre yeniden bağlıyor:

```bash
blender -b --python tools/blender/export_map.py -- "<harita>.fbx" "<TEXTURES klasörü>" assets-src/maps/dirt-road/dirt-road-raw.glb 1024
npm run convert -- assets-src/maps/dirt-road/dirt-road-raw.glb public/models/maps/dirt-road.glb --max-texture 1024
```

- Birim metre, ~550×550 m, 25 malzeme; ağaçlar hariç ~240 bin üçgen; 85.6 MB.
- Harita kendi koordinatlarında kullanılır: `{ asset: harita, at: [0, 0, 0] }`, `align: none`. Yükseklikler ~100–200 m.
- Zemin olarak yalnızca şu parçalar sayılmalı (uzak arazi, kayalar ve bitkiler hariç):
  `terrain: [Aerial_Grass, Dirt_Road, Dirt_Road_Bare, Ground_Dirt, Grass_Close]`
- Yol verisi motor için `public/roads/dirt-road.json` olarak da kopyalandı; harita varlığına `road: roads/dirt-road.json` eklenirse `walk_to` eylemleri `road: true` ile yol boyunca yürür (koordinat yazmaya gerek kalmaz).
- Yolun orta çizgisi yol mesh'inden hesaplandı: [assets-src/maps/dirt-road/road.json](assets-src/maps/dirt-road/road.json) (`[x, z, genişlik, yükseklik]`, 122 nokta, ~435 m). Hesaplayan betik: `tools/blender/road_centerline.py`.
  Güneydeki çıkmaz `(-30, 80)` → düz kesit `(16, 43)…(56, 41)` → doğuda firkete `(87, 16)` → `(1, -14)` → kuzeybatı `(-116, -47)`.
- Çam ağaçları (`Realistic_Pine_*`, 171 adet) üç LOD seviyesiyle gelir: LOD0 ~24k üçgen (< 35 m), LOD1 ~10k (35–80 m), LOD2 ~4k (> 80 m). Seviyeler `tools/blender/pine_lods.py` ile üretilir (`build_realistic_forest_map.py` bunu çağırır) ve her ağaçta `<ad>_LOD1`, `<ad>_LOD2` alt nesneleri olarak dışa aktarılır. Motor bunları `src/engine/lod.ts` ile `THREE.LOD`'a çevirir; uzaklıklar orada ayarlanır.
- Gündüz ışığı ve uzun sis önerilir: `environment: { preset: day, ground_plane: false, fog_near: 80, fog_far: 320 }`.
- Kamera yol koridorunda kalmalı: yol ~8 m genişliğinde, kenarları sık çalılık ve ağaç. Yola dik bakan geniş planlar ağaçlara girer.
- Gölge alanı (±14 m) kameranın hedefini kendiliğinden takip eder.
- Örnek: [public/scenarios/harita-toprak-yol.yaml](public/scenarios/harita-toprak-yol.yaml).

## Klasörler

```
src/
  schema.ts            senaryo şeması + doğrulama + referans kontrolü
  formats.ts           platform presetleri ve güvenli alanlar
  engine/
    film.ts            senaryo → sahne derleme, evaluate(t)
    character.ts       zaman çizelgesi → poz (prosedürel animasyonlar)
    camera.ts          formata duyarlı kamera kadrajı
    rigs/placeholder.ts  test karakteri
    rigs/model.ts        FBX/GLB karakter: klipler + morph + baş çevirme
    toon.ts            cel-shade malzeme, kontur ayarları
    environment.ts     ışık presetleri, zemin, gökyüzü
    props.ts           test dekorları
    assets.ts          FBX/GLB yükleme, ayrı animasyon dosyaları, ölçekleme
    merge.ts           statik modellerde malzemeye göre mesh birleştirme
    terrain.ts         araziden yükseklik haritası (karakterler yüzeye basar; adla seçilebilir)
  render/viewport.ts   WebGL çizimi; post.ts kontur, parlama, renk tonu
  export/mp4.ts        WebCodecs H.264 + mp4-muxer
public/models/         modeller (git dışı)
  animations/          bütün karakterlerin ortak Mixamo animasyonları ("Without Skin"); yeni klip buraya
  characters/<ad>/     karakter modelleri; Erika ve sword-and-shield kendi paketlerini de taşır
tools/
  convert-model.mjs    FBX/GLB → optimize GLB (npm run convert)
  blender/export_amy.py  Amy'yi orijinal .blend'den temiz GLB'ye aktaran Blender betiği
  blender/export_map.py  doku yolları kırık FBX haritayı GLB'ye çeviren Blender betiği
  blender/road_centerline.py  yol mesh'inden orta çizgi çıkaran Blender betiği
assets-src/            ham kaynaklar (git dışı)
```

## Sonraki adımlar

- Müzik: telifsiz, kendi ürettiğimiz müzik (Pixabay müziği YouTube'da telif uyarısı aldı)
- TTS ve lip-sync (viseme → morph)
- Sahne geçişleri (fade, wipe), altyazı gömme, kapak görseli (thumbnail)
- Zaman çizelgesi editörü
- Sunucuda toplu render (headless Chrome)
