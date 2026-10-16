import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { characterMask, type FilmLook, type Grade } from '../engine/look';

/** Son işlemin sahneden ayrıca çizdiği kökler: karakterler (kontur derinliği) ve yetenek efektleri (maske, parlama). */
export interface PostTargets {
  characters: THREE.Object3D[];
  /** Etkin yetenek yoksa null (efekt çizimi ve parlama atlanır) */
  effects: THREE.Object3D | null;
}

/**
 * Çizgi film görünümü için son işlem (post-process):
 *
 * 1. Sahne 8 bit sRGB (MSAA) tampona çizilir; karakterler alfa kanalına "görünen karakter" işareti bırakır.
 * 2. Yalnızca karakterler ayrı bir derinlik tamponuna çizilir.
 * 3. Ekranda yetenek efekti varsa efektler yarım çözünürlükte ayrıca çizilir: hem konturun söneceği yerin
 *    maskesi hem parlamanın (bloom) kaynağıdır. Böylece yalnızca efektler parlar (gökyüzü, beyaz giysi değil)
 *    ve parlama efekt yokken hiç maliyet getirmez.
 * 4. Son geçiş: mürekkep konturu + parlama + renk düzenleme + vinyet, sRGB çıkış.
 *
 * Kontur: karakter derinliğindeki sıçramalardan (siluet, kolun gövdenin önüne geçtiği yerler). Kalınlık
 * piksel cinsinden ve uzaklıkla incelir, uzakta soluklaşır: uzaktaki küçük karakter kontura boğulmaz (eski
 * ters-kabuk konturunun sorunu). Çizgi karakterin kendi renginin koyusudur, düz siyah değil. Karakteri örten
 * ağaç/nesne varsa çizgi onların üstüne taşmaz; parlak efektin altında kalan çizgi efekti karartmaz.
 * Ağaç ve çimenler kontur almaz (orman binlerce çizgiyle gürültüye dönerdi).
 */
export class PostPipeline {
  private readonly sceneRT: THREE.WebGLRenderTarget;
  private readonly charRT: THREE.WebGLRenderTarget;
  /** Yetenek efektlerinin kapladığı alan (yarım çözünürlük); yalnızca ekranda efekt varken çizilir. */
  private readonly fxRT: THREE.WebGLRenderTarget;
  private readonly bloom: UnrealBloomPass;
  private readonly quad: FullScreenQuad;
  private readonly material: THREE.ShaderMaterial;
  private readonly size = new THREE.Vector2(1, 1);
  private useEffect = false;

  constructor(private readonly renderer: THREE.WebGLRenderer) {
    // 8 bit sRGB: doğrusal renk sRGB olarak saklanır (koyu tonlarda kademelenme yok), half float'ın yarı bant genişliği
    this.sceneRT = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.UnsignedByteType,
      colorSpace: THREE.SRGBColorSpace,
      samples: 4,
    });
    this.charRT = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.UnsignedByteType,
      depthTexture: new THREE.DepthTexture(1, 1),
    });
    this.fxRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
    // Kaynak yalnızca efektler olduğu için eşik 0: efektin her parlak pikseli parlar
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.5, 0.4, 0.0);
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tColor: { value: null },
        tCharDepth: { value: null },
        tEffect: { value: null },
        useEffect: { value: 0 },
        tBloom: { value: null },
        useBloom: { value: 0 },
        texel: { value: new THREE.Vector2() },
        cameraNear: { value: 0.1 },
        cameraFar: { value: 1000 },
        lineWidth: { value: 0 },
        inkStrength: { value: 0.85 },
        exposure: { value: 1 },
        contrast: { value: 1 },
        saturation: { value: 1 },
        warmth: { value: 0 },
        vignette: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        #include <packing>
        uniform sampler2D tColor;
        uniform sampler2D tCharDepth;
        uniform sampler2D tEffect;
        uniform float useEffect;
        uniform sampler2D tBloom;
        uniform float useBloom;
        uniform vec2 texel;
        uniform float cameraNear;
        uniform float cameraFar;
        uniform float lineWidth;
        uniform float inkStrength;
        uniform float exposure;
        uniform float contrast;
        uniform float saturation;
        uniform float warmth;
        uniform float vignette;
        varying vec2 vUv;

        // Mürekkep rengi (doğrusal): koyu kahve-siyah
        const vec3 INK = vec3(0.0086, 0.0056, 0.0056);

        float viewDist(float d) {
          return -perspectiveDepthToViewZ(d, cameraNear, cameraFar);
        }
        float charZ(vec2 uv) { return viewDist(texture2D(tCharDepth, clamp(uv, 0.0, 1.0)).x); }
        // Görünen yüzey karakter mi (alfa işareti: karakter 0, önündeki her şey 1; MSAA kenarı yumuşatır)
        float charVis(vec2 uv) { return 1.0 - smoothstep(0.15, 0.6, texture2D(tColor, clamp(uv, 0.0, 1.0)).a); }
        // Çizginin yarı kalınlığı (piksel): 6 m'ye kadar tam, uzakta orantılı incelir; 25–60 m arası soluklaşır
        float halfWidth(float z) { return 0.5 * lineWidth * clamp(6.0 / z, 0.2, 1.0) * (1.0 - smoothstep(25.0, 60.0, z)); }

        vec3 toSRGB(vec3 c) {
          c = max(c, 0.0);
          return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
        }

        void main() {
          vec3 c = texture2D(tColor, vUv).rgb;

          // --- Mürekkep konturu: karakter derinliğindeki sıçramada, siluetin iki yanına
          if (lineWidth > 0.0) {
            float zc = charZ(vUv);
            bool inside = zc < cameraFar * 0.99 && charVis(vUv) > 0.5;
            float ink = 0.0;
            // Yakında karakter yoksa erken çık (orman piksellerinin çoğu)
            bool near = inside;
            for (int i = 0; i < 4 && !near; i++) {
              float a = float(i) * 1.570796;
              near = charZ(vUv + vec2(cos(a), sin(a)) * 3.0 * texel) < cameraFar * 0.99;
            }
            if (near) {
              for (int ring = 1; ring <= 3; ring++) {
                float R = float(ring);
                for (int i = 0; i < 8; i++) {
                  float a = float(i) * 0.785398 + (R - 1.0) * 0.3927;
                  vec2 uv = vUv + vec2(cos(a), sin(a)) * R * texel;
                  float nc = charZ(uv);
                  float k = 0.0;
                  float z = zc;
                  if (inside) {
                    // İç taraf: komşu karakter derinliğinde belirgin geride (siluet ya da üst üste binen uzuv)
                    k = smoothstep(0.03, 0.09, (nc - zc) / zc);
                  } else if (nc < cameraFar * 0.99) {
                    // Dış taraf: komşu görünen bir karakter (bu piksel arka plan ya da karakterin önündeki nesne)
                    k = charVis(uv);
                    z = nc;
                  }
                  // Bu halka çizgi kalınlığının içindeyse sayılır; kalınlık bir pikselin altındaysa soluklaşır
                  ink = max(ink, k * clamp(halfWidth(z) - (R - 1.0), 0.0, 1.0));
                }
              }
              // Yetenek efektinin (ateş, şimşek, hortum) kapladığı yerde çizgi söner; efektin içinde hayalet çizgi kalmasın
              if (useEffect > 0.5) {
                float fx = dot(texture2D(tEffect, vUv).rgb, vec3(0.2126, 0.7152, 0.0722));
                ink *= 1.0 - smoothstep(0.06, 0.3, fx);
              }
              c = mix(c, INK, ink * inkStrength);
            }
          }

          // --- Parlama (yalnızca yetenek efektlerinden)
          if (useBloom > 0.5) c += texture2D(tBloom, vUv).rgb;

          // --- Renk düzenleme (görüntü uzayında)
          c *= exposure;
          c = toSRGB(c);
          c += vec3(warmth, warmth * 0.35, -warmth) * 0.5;
          float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
          c = mix(vec3(l), c, saturation);
          c = (c - 0.5) * contrast + 0.5;
          vec2 q = vUv - 0.5;
          c *= 1.0 - vignette * smoothstep(0.25, 0.85, dot(q, q) * 2.2);
          gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
        }`,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new FullScreenQuad(this.material);
  }

  private resize(w: number, h: number) {
    if (this.size.x === w && this.size.y === h) return;
    this.size.set(w, h);
    this.sceneRT.setSize(w, h);
    this.charRT.setSize(w, h);
    this.fxRT.setSize(Math.max(1, w >> 1), Math.max(1, h >> 1));
    this.bloom.setSize(Math.max(1, w >> 1), Math.max(1, h >> 1));
  }

  /**
   * Sahneyi görünüm ayarlarıyla çizim tamponuna çizer. Karakterler ve efektler kendi köklerinden çizilir:
   * tüm sahneyi (binlerce ağaç/çimen) yeniden gezmek kare başına ~3 ms tutuyordu.
   */
  render(scene: THREE.Scene, camera: THREE.PerspectiveCamera, look: FilmLook, grade: Grade, targets: PostTargets) {
    const r = this.renderer;
    const buf = r.getDrawingBufferSize(new THREE.Vector2());
    this.resize(buf.x, buf.y);

    // 1) Sahne (karakterler alfa işaretini yalnızca bu çizimde bırakır)
    characterMask.value = 1;
    r.setRenderTarget(this.sceneRT);
    r.render(scene, camera);
    characterMask.value = 0;

    // 2) Yalnızca karakterlerin derinliği (kendi malzemeleriyle: saç/kirpik kesikleri doğru)
    const outline = look.outline > 0;
    this.useEffect = false;
    if (outline || look.bloom > 0) {
      const shadows = r.shadowMap.enabled;
      const autoClear = r.autoClear;
      const clear = r.getClearColor(new THREE.Color());
      const alpha = r.getClearAlpha();
      r.shadowMap.enabled = false;
      r.autoClear = false;
      r.setClearColor(0x000000, 0);
      if (outline) {
        r.setRenderTarget(this.charRT);
        r.clear(true, true, false);
        for (const c of targets.characters) r.render(c, camera);
      }
      // Yetenek efektleri (etkin yetenek varsa): siyah zemin üstüne kendi malzemeleriyle
      this.useEffect = targets.effects !== null;
      if (targets.effects) {
        // Yalnızca ışık niteliğindeki (toplamalı karışımlı) parçalar: alev, şimşek, ışıltı izleri. Kaya dikenleri,
        // hortum gövdesi ve bulut parlamasın; konturu da zaten kendileri örter (alfa işaretini ezerler).
        const hidden: THREE.Object3D[] = [];
        targets.effects.traverse((o) => {
          const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
          if (!m || !o.visible) return;
          const mats = Array.isArray(m) ? m : [m];
          if (!mats.some((x) => x.blending === THREE.AdditiveBlending)) {
            o.visible = false;
            hidden.push(o);
          }
        });
        r.setRenderTarget(this.fxRT);
        r.clear(true, true, false);
        r.render(targets.effects, camera);
        for (const o of hidden) o.visible = true;
      }
      r.setClearColor(clear, alpha);
      r.autoClear = autoClear;
      r.shadowMap.enabled = shadows;
    }

    // 3) Parlama: efekt çiziminden bulanıklaştırılır (sonuç bloom'un ilk ara tamponunda kalır)
    const bloom = look.bloom > 0 && this.useEffect;
    if (bloom) {
      this.bloom.strength = look.bloom;
      this.bloom.render(r, this.fxRT, this.fxRT, 0, false);
    }

    // 4) Son geçiş
    const u = this.material.uniforms;
    u.tColor.value = this.sceneRT.texture;
    u.tCharDepth.value = this.charRT.depthTexture;
    u.tEffect.value = this.fxRT.texture;
    u.useEffect.value = outline && this.useEffect ? 1 : 0;
    u.tBloom.value = this.bloom.renderTargetsHorizontal[0].texture;
    u.useBloom.value = bloom ? 1 : 0;
    u.texel.value.set(1 / buf.x, 1 / buf.y);
    u.cameraNear.value = camera.near;
    u.cameraFar.value = camera.far;
    // Kalınlık 1080p'ye göre verilir, çözünürlükle ölçeklenir
    u.lineWidth.value = outline ? look.outline * (buf.y / 1080) : 0;
    u.exposure.value = grade.exposure;
    u.contrast.value = grade.contrast;
    u.saturation.value = grade.saturation;
    u.warmth.value = grade.warmth;
    u.vignette.value = grade.vignette;
    r.setRenderTarget(null);
    this.quad.render(r);
  }

  /** Çizimde kullanılacak her shader türevini, gerçekte çizildiği tamponda derler (yükleme sırasında). */
  async compile(scene: THREE.Scene, camera: THREE.Camera, targets: PostTargets) {
    const r = this.renderer;
    const prev = r.getRenderTarget();
    const shadows = r.shadowMap.enabled;
    // Tamponlar gerçek boyutta ayrılsın (yoksa ilk efekt karesinde ayrılıp takılırdı)
    const buf = r.getDrawingBufferSize(new THREE.Vector2());
    this.resize(buf.x, buf.y);
    // Derlemek yetmez: Windows'ta (ANGLE/Direct3D) shader'ın hedef biçimine özgü son hâli ilk çizimde üretilir.
    // Her şey ayıklama kapalıyken kendi tamponunun tek pikseline bir kez çizilir (yoksa ilk görüldüğü karede ~60 ms).
    const culled: THREE.Object3D[] = [];
    scene.traverse((o) => {
      if (o.frustumCulled) {
        o.frustumCulled = false;
        culled.push(o);
      }
    });
    const scissorTest = r.getScissorTest();
    const touch = (target: THREE.WebGLRenderTarget, root: THREE.Object3D) => {
      r.setRenderTarget(target);
      r.setScissorTest(true);
      r.setScissor(0, 0, 1, 1);
      r.render(root, camera);
      r.setScissorTest(scissorTest);
    };
    try {
      r.setRenderTarget(this.sceneRT);
      await r.compileAsync(scene, camera);
      characterMask.value = 1;
      touch(this.sceneRT, scene);
      characterMask.value = 0;
      r.shadowMap.enabled = false;
      r.setRenderTarget(this.charRT);
      for (const c of targets.characters) {
        await r.compileAsync(c, camera);
        touch(this.charRT, c);
      }
      if (targets.effects) {
        r.setRenderTarget(this.fxRT);
        await r.compileAsync(targets.effects, camera);
        touch(this.fxRT, targets.effects);
      }
      // Parlama ve son geçiş tam ekran dörtgenlerdir; birer kez çizmek yeter (yükleme ekranının arkasında)
      this.bloom.render(r, this.fxRT, this.fxRT, 0, false);
      r.setRenderTarget(null);
      this.quad.render(r);
    } finally {
      for (const o of culled) o.frustumCulled = true;
      characterMask.value = 0;
      r.shadowMap.enabled = shadows;
      r.setRenderTarget(prev);
    }
  }

  dispose() {
    this.sceneRT.dispose();
    this.charRT.dispose();
    this.fxRT.dispose();
    this.bloom.dispose();
    this.quad.dispose();
    this.material.dispose();
  }
}
