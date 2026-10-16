# Proje Kuralları (Project Rules)

> [!IMPORTANT]
> **AŞIRI KATI KURAL: EMOJİ KULLANIMI KESİNLİKLE YASAKTIR. SADECE SVG KULLANILACAKTIR.**
> Projede kullanıcı arayüzü, HTML sayfaları, TypeScript/JavaScript kodları, bileşenler ve veri modellerinde hiçbir şekilde emoji bulunamaz. Bütün simgeler için `src/ui/icons.ts` içerisindeki SVG ikonları kullanılmalıdır.

## Kurallar ve Standartlar

1. **Sıfır Emoji Toleransı:**
   - Butonlar, başlıklar, kartlar, listeler, rozetler ve bildirimlerde emoji bulunamaz.
   - Açılır menülerde (`<select>`, `<option>`, `<optgroup>`) metinler emoji içermemelidir.
   - Simgelerin hepsi vektörel SVG olarak tanımlanır ve CSS sınıflarıyla stillendirilir.

2. **Senaryo Yazma ve Kamera Yönetmenliği Kuralları (Karakter Konuşması):**
   - **Karakter Konuşmaya Başlamadan Önce Kamera Ona Çevrilmelidir:**
     - Karakter anında (0.1s - 0.25s) konuşmaya başlamaz. Çekim açıldığında kamera karaktere çevrilir/döner (`angle: { from: ..., to: ... }` veya shot kesmesi).
     - İzleyicinin konuşacak karaktere odaklanması için en az **0.6 - 0.8 saniyelik bir ön hazırlık / nefes payı** (`talk.at: 0.7 - 0.8`) verilir.
     - Konuşma bittikten sonra da en az **0.6 - 0.8 saniyelik bitiş/reaksiyon payı** kalmalıdır.
   - **Aşırı Yakınlaştırma Yasaktır:**
     - Yüzü ekrana dayayan aşırı yakın plan (`size: close` / 0.55) kullanılmaz.
     - Bunun yerine ferah büst/gövde planı olan **`size: medium`** (veya `size: 0.9` - `1.05`) kullanılmalıdır.
   - **Ağız - Ses Zamanlaması (700ms Kuralı):**
     - Ağız hareketi ses kaydı başlamadan yaklaşık **700 ms (0.7 saniye)** önce başlar (karakterin nefes alıp konuşmaya hazırlanması ve ilk hece açılışı).
     - Ağız hareketi ses kaydı bitmeden yaklaşık **700 ms (0.7 saniye)** önce biter (son hecede ağız kapanır, sesin son sönümünde ağız kapalı kalır).
   - **Kamera Konuşana Odaklanmalıdır:** Bir karakter konuştuğunda (`talk` eylemi olduğunda), kameranın hedefi (`target`) istisnasız konuşan karakter olmalıdır (`target: jackie`, `target: amy`, `target: cocuk`). Kamera açısı **`relative: true`** ve **`angle: -15` ile `15`** derece arasında konuşanın yüzüne bakmalıdır.
   - **Çekim Bölme (Shot-Reverse-Shot):** Her konuşma repliği için ayrı bir çekim (`shot`) tanımlanmalı, konuşma sırası değiştikçe kamera doğrudan konuşan yeni karaktere kesilmelidir (`cut`).

3. **SVG İkon Yönetimi:**
   - Yeni ikonlar `src/ui/icons.ts` modülüne eklenir.
   - İkonlar `viewBox="0 0 24 24"`, `width="15"`, `height="15"`, `fill="currentColor"` veya `stroke="currentColor"` biçimindedir.
   - Dinamik ikon güncellemelerinde (`play/pause`, `volume`, vb.) `setElementIcon()` veya SVG şablonu kullanılır.

4. **Toolbox ve SQLite Ayar Mimarisi:**
   - Senkron ayarları (`sync_lead_in`, `sync_lead_out`) `localStorage`'da değil, SQLite veritabanındaki `settings` tablosunda saklanır.
   - Sol panel Toolbox yapısıyla donatılmıştır: `Senaryo` (Editör), `Senaryolar` (Kütüphane), `Ayarlar` (Sistem & Senkron), `Araçlar` (Sahne Araçları).
   - Hem Transport çubuğundan hem de Toolbox Ayarlar panelinden yapılan ayar değişiklikleri gerçek zamanlı olarak SQLite'a yazılır.
