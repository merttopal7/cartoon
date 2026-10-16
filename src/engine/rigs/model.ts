import * as THREE from 'three';
import type { Pose, Rig } from '../pose';
import { ROOT_SPEED, SOURCE_HIPS_HEIGHT, SOURCE_SKELETON } from '../clips';
import { mapHumanoid, retargetHumanoid } from './humanoid';
import { FootIK, type GroundFn, type Leg } from './foot-ik';
import { toonMaterial } from '../toon';

/** Motorun aradığı morph target adları (küçük harf, "_"/boşluk/"." olmadan). ARKit ve VRM adları da tanınır. */
const MORPHS = {
  blinkL: ['blinkl', 'eyeblinkleft', 'blinkleft'],
  blinkR: ['blinkr', 'eyeblinkright', 'blinkright'],
  blink: ['blink'],
  mouth: ['mouth', 'moutha', 'jawopen', 'mouthopen', 'visemeaa', 'aa'],
  smile: ['smile', 'mouthsmile', 'happy'],
  sad: ['sad', 'mouthfrown'],
  surprised: ['surprised', 'surprise'],
  angry: ['angry', 'browdown'],
};
type MorphKey = keyof typeof MORPHS;

const normalize = (s: string) => s.toLowerCase().replace(/[\s_.\-:]/g, '');
const tmpQ = new THREE.Quaternion();
const tmpQ2 = new THREE.Quaternion();
const lateral = new THREE.Vector3();

/**
 * Pose.legSwing (genlik 0.7) → kalça açısı. Genlik ≈ 0.41 rad: adım uzunluğu (boyun %36'sı) ile
 * bacak boyu (boyun %45'i) arasındaki asin(0.4); böylece basan ayak yerde kaymaz.
 */
const LEG_SWING = 0.59;

/** Döngü dikişi: başı ile sonu arasında bu kadar (rad) fark olan klip dikişsiz sayılmaz (~6°). */
const LOOP_SEAM_TOLERANCE = 0.1;
/** Dikişli döngülerde bir turun sonu ile yenisinin başının üst üste bindirilip karıştırıldığı süre (sn). */
const LOOP_SEAM_BLEND = 0.3;

/** Klibin son karesi ile ilk karesi arasındaki en büyük kemik dönüşü farkı (rad). */
function loopSeamError(clip: THREE.AnimationClip): number {
  let worst = 0;
  const a = new THREE.Quaternion();
  const b = new THREE.Quaternion();
  for (const track of clip.tracks) {
    if (!(track instanceof THREE.QuaternionKeyframeTrack)) continue;
    const n = track.values.length / 4;
    if (n < 2) continue;
    a.fromArray(track.values, 0);
    b.fromArray(track.values, (n - 1) * 4);
    worst = Math.max(worst, a.angleTo(b));
  }
  return worst;
}

/** Prosedürel yürüyüş için gereken Mixamo kemikleri (ad sonekine göre aranır). */
const LIMBS = {
  upLegL: /leftupleg$/, upLegR: /rightupleg$/,
  legL: /leftleg$/, legR: /rightleg$/,
  footL: /leftfoot$/, footR: /rightfoot$/,
  armL: /leftarm$/, armR: /rightarm$/,
  foreArmL: /leftforearm$/, foreArmR: /rightforearm$/,
  spine: /spine1?$/,
};
type Limb = keyof typeof LIMBS;

/**
 * Bir kemiği dünya uzayındaki bir eksen etrafında döndürür (kemiğin kendi ekseninden bağımsız).
 * Böylece yerel eksenleri farklı kurulmuş iskeletlerde de bacak/kol doğru yöne salınır.
 */
function rotateWorld(bone: THREE.Object3D, axisWorld: THREE.Vector3, angle: number) {
  if (!angle || !bone.parent) return;
  bone.parent.updateMatrixWorld(true);
  bone.parent.getWorldQuaternion(tmpQ2);
  tmpQ.setFromAxisAngle(axisWorld, angle);
  // yerel = ebeveyn⁻¹ · R · ebeveyn · yerel
  bone.quaternion.premultiply(tmpQ2.clone().invert().multiply(tmpQ).multiply(tmpQ2));
  bone.updateMatrixWorld(true);
}

/**
 * GLB/FBX karakter rig'i. Klipler (idle/walk/wave/jump + serbest klipler) zaman çizelgesinden
 * gelen sürelerle deterministik oynatılır; üzerine baş çevirme ve yüz morph'ları eklenir.
 */
export class ModelRig implements Rig {
  readonly root = new THREE.Group();
  readonly height: number;
  readonly width: number;

  private readonly inner = new THREE.Group();
  private readonly mixer: THREE.AnimationMixer;
  private readonly actions = new Map<string, THREE.AnimationAction>();
  /**
   * Başı ile sonu uyuşmayan (dikişli) döngü klipleri için ikinci oynatıcı: bir önceki turun kuyruğunu
   * yeni turun başıyla aynı anda oynatıp karıştırmak için. Yoksa her turda son pozdan ilk poza atlanır.
   */
  private readonly seamActions = new Map<THREE.AnimationAction, THREE.AnimationAction>();
  /** idle klibi yoksa boşta duruş: ilk klibin ilk karesi (Mixamo klipleri ayakta başlar). T-pozdan iyidir. */
  private readonly rest?: THREE.AnimationAction;
  private readonly head?: THREE.Bone;
  /**
   * Prosedürel olarak değiştirilen kemiklerin karıştırıcı sonrası (taban) halleri. AnimationMixer
   * değer değişmediyse kemiğe yeniden yazmaz; geri yüklemezsek eklemeler her karede üst üste biner.
   */
  private readonly touched = new Map<THREE.Object3D, THREE.Quaternion>();
  private readonly touchedPos = new Map<THREE.Object3D, THREE.Vector3>();
  private readonly morphs = new Map<MorphKey, { mesh: THREE.Mesh; index: number }[]>();
  private readonly limbs: Partial<Record<Limb, THREE.Bone>> = {};
  /** Ayak IK'sı için bacaklar (uyluk, baldır, ayak); arazi verilince FootIK kurulur. */
  private readonly legs: Leg[] = [];
  private footIK?: FootIK;
  /** Model biriminden metreye çarpan (kök hareket hızını metre/sn'ye çevirmek için). */
  private readonly unitScale: number;
  /** Göz kapağı morph'u yoksa: kırpma anında göz mesh'i ten rengine boyanır. */
  private eyeBlink?: EyeBlink;
  /** Kemikli göz kapakları: açık = lidOpen, kapalı = 0 (dinlenme pozu). */
  private readonly lids: THREE.Object3D[] = [];
  private lidAxis = new THREE.Vector3();
  private lidOpen = 0;
  /** Kemikli ağız: alt dudak ve çene kemikleri. */
  private readonly mouthBones: THREE.Object3D[] = [];
  /** Kemikli ağız: üst dudak ve üst diş kemikleri. */
  private readonly mouthTopBones: THREE.Object3D[] = [];
  private mouthAxis = new THREE.Vector3();
  private mouthOpen = 0;
  /** Doku kaydırmalı ağız (ör. Kid/Boy anime karakterinin 10x10 mimik tablosu). */
  private uvMouth?: {
    map: THREE.Texture;
    baseX: number;
    baseY: number;
    mesh?: THREE.Mesh;
  };
  /** Yaylı okçu karakterlerde (ör. Erika) yay gövdesi, yay kirişi ve sağ el kiriş çekme parmağı kemikleri. */
  private readonly bowArch1?: THREE.Bone;
  private readonly bowArch2?: THREE.Bone;
  private readonly rightStringFinger?: THREE.Bone;

  constructor(
    model: THREE.Object3D,
    size: { height: number; width: number; scale: number },
    clips: THREE.AnimationClip[],
    private readonly aliases: Record<string, string> = {},
    eyelids?: { bones: string; axis: 'x' | 'y' | 'z'; open: number },
    mouth?: { bones: string; axis: 'x' | 'y' | 'z'; open: number },
  ) {
    this.height = size.height;
    this.unitScale = size.scale;
    // Bağlama pozu genelde T-poz; açık kollar kadraj genişliğini şişirmesin.
    this.width = Math.min(size.width, size.height * 0.5);
    this.root.add(this.inner);
    this.inner.add(model);
    this.mixer = new THREE.AnimationMixer(model);
    clips = retargetClips(model, clips, this.unitScale);
    for (const clip of clips) {
      const a = this.mixer.clipAction(clip);
      a.play();
      a.setEffectiveWeight(0);
      this.actions.set(normalize(clip.name), a);
      if (clip.duration > LOOP_SEAM_BLEND * 2 && loopSeamError(clip) > LOOP_SEAM_TOLERANCE) {
        const tail = this.mixer.clipAction(clip.clone());
        tail.play();
        tail.setEffectiveWeight(0);
        this.seamActions.set(a, tail);
      }
    }
    if (clips.length && !this.findAction('idle')) {
      const restClip = clips[0].clone();
      restClip.name = '__rest';
      this.rest = this.mixer.clipAction(restClip);
      this.rest.play();
      this.rest.time = 0;
      this.rest.setEffectiveWeight(0);
    }

    let head: THREE.Bone | undefined;
    let bowArch1: THREE.Bone | undefined;
    let bowArch2: THREE.Bone | undefined;
    let rightStringFinger: THREE.Bone | undefined;
    model.traverse((o) => {
      if ((o as THREE.Bone).isBone) {
        if (!head && /head$/i.test(o.name)) head = o as THREE.Bone;
        if (!bowArch1 && /left_arch1$/i.test(o.name)) bowArch1 = o as THREE.Bone;
        if (!bowArch2 && /left_arch2$/i.test(o.name)) bowArch2 = o as THREE.Bone;
        if (!rightStringFinger && /righthandmiddle1$/i.test(o.name)) rightStringFinger = o as THREE.Bone;
        const n = normalize(o.name);
        for (const [limb, re] of Object.entries(LIMBS) as [Limb, RegExp][]) {
          if (!this.limbs[limb] && re.test(n)) this.limbs[limb] = o as THREE.Bone;
        }
      }
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        if (!this.uvMouth && (/mouth/i.test(mesh.name) || /h_geo/i.test(mesh.name) || (mesh.material && /mouth/i.test((mesh.material as any).name ?? '')))) {
          const mat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshToonMaterial;
          if (mat && mat.map) {
            const map = mat.map.clone();
            map.wrapS = THREE.RepeatWrapping;
            map.wrapT = THREE.RepeatWrapping;
            mat.map = map;
            mat.needsUpdate = true;
            this.uvMouth = { map, baseX: map.offset.x, baseY: map.offset.y };
          }
        }
        if (mesh.morphTargetDictionary) {
          for (const [name, index] of Object.entries(mesh.morphTargetDictionary)) {
            const n = normalize(name);
            for (const [key, names] of Object.entries(MORPHS) as [MorphKey, string[]][]) {
              if (!names.includes(n)) continue;
              // Ch29 modelinin 'mouth' blendshape'i ağız yerine şapkayı deforme ettiği için hariç tut
              if (key === 'mouth' && /ch29/i.test(mesh.name)) continue;
              const list = this.morphs.get(key) ?? [];
              list.push({ mesh, index });
              this.morphs.set(key, list);
            }
          }
        }
      }
    });

    // Jackie (Ch29): Yüzü doku boyalı anime karakteri; konuşma anında Ch29'un ağız derisi
    // üçgenlerinden birebir kopyalanan SkinnedMesh üzerine yüksek kontrastlı anime konuşma
    // visemeleri çizilir. Böylece şapka bozulmaz ve ağız yüz derisine tam yapışık hareket eder.
    let ch29Mesh: THREE.SkinnedMesh | null = null;
    model.traverse((o) => {
      if ((o as THREE.SkinnedMesh).isSkinnedMesh && /ch29/i.test(o.name)) {
        ch29Mesh = o as THREE.SkinnedMesh;
      }
    });
    if (ch29Mesh && !this.uvMouth) {
      const ch29 = ch29Mesh as THREE.SkinnedMesh;
      const geom = ch29.geometry;
      const pos = geom.attributes.position;
      const norm = geom.attributes.normal;
      const uv = geom.attributes.uv;
      const skinIndex = geom.attributes.skinIndex;
      const skinWeight = geom.attributes.skinWeight;

      if (pos && norm && uv && skinIndex && skinWeight) {
        const triCount = pos.count / 3;
        const mPos: number[] = [];
        const mNorm: number[] = [];
        const mUV: number[] = [];
        const mSkinIdx: number[] = [];
        const mSkinW: number[] = [];

        // Ch29 ağız çizgisi bind-space'te (0, 138.6, 12.18); çene yönünde hafif aşağı merkezlenir
        const xSpan = 1.65;
        const yCenter = 138.45;
        const ySpan = 1.3;

        for (let t = 0; t < triCount; t++) {
          const i0 = t * 3;
          const i1 = t * 3 + 1;
          const i2 = t * 3 + 2;
          const cx = (pos.getX(i0) + pos.getX(i1) + pos.getX(i2)) / 3;
          const cy = (pos.getY(i0) + pos.getY(i1) + pos.getY(i2)) / 3;
          const cz = (pos.getZ(i0) + pos.getZ(i1) + pos.getZ(i2)) / 3;
          const cu = (uv.getX(i0) + uv.getX(i1) + uv.getX(i2)) / 3;
          const cv = (uv.getY(i0) + uv.getY(i1) + uv.getY(i2)) / 3;

          if (Math.abs(cx) < 2.3 && cy >= 136.9 && cy <= 140.2 && cz > 10.6 && cu > 0.83 && cv < 0.425) {
            for (const idx of [i0, i1, i2]) {
              const vx = pos.getX(idx);
              const vy = pos.getY(idx);
              const vz = pos.getZ(idx);

              mPos.push(vx, vy, vz + 0.15);
              mNorm.push(norm.getX(idx), norm.getY(idx), norm.getZ(idx));

              const cellU = Math.min(0.99, Math.max(0.01, 0.5 + vx / (xSpan * 2)));
              const cellV = Math.min(0.99, Math.max(0.01, 0.5 + (vy - yCenter) / (ySpan * 2)));
              mUV.push(0.6 + cellU * 0.1, 0.9 + cellV * 0.1);

              mSkinIdx.push(skinIndex.getX(idx), skinIndex.getY(idx), skinIndex.getZ(idx), skinIndex.getW(idx));
              mSkinW.push(skinWeight.getX(idx), skinWeight.getY(idx), skinWeight.getZ(idx), skinWeight.getW(idx));
            }
          }
        }

        if (mPos.length > 0) {
          const mouthGeo = new THREE.BufferGeometry();
          mouthGeo.setAttribute('position', new THREE.Float32BufferAttribute(mPos, 3));
          mouthGeo.setAttribute('normal', new THREE.Float32BufferAttribute(mNorm, 3));
          mouthGeo.setAttribute('uv', new THREE.Float32BufferAttribute(mUV, 2));
          mouthGeo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(mSkinIdx, 4));
          mouthGeo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(mSkinW, 4));

          const map = createJackieVisemeTexture();
          const mat = new THREE.MeshBasicMaterial({
            map,
            transparent: true,
            alphaTest: 0.15,
            depthWrite: false,
            polygonOffset: true,
            polygonOffsetFactor: -3,
            polygonOffsetUnits: -3,
          });
          mat.userData.outlineParameters = { visible: false };

          const mouthSkinned = new THREE.SkinnedMesh(mouthGeo, mat);
          mouthSkinned.name = 'jackie_mouth_viseme';
          mouthSkinned.frustumCulled = false;
          mouthSkinned.visible = false;
          mouthSkinned.bind(ch29.skeleton, ch29.bindMatrix);
          (ch29.parent ?? model).add(mouthSkinned);

          this.uvMouth = { map, baseX: 0, baseY: 0, mesh: mouthSkinned };
        }
      }
    }

    this.head = head;

    // Ayak IK'sı için bacaklar: önce Mixamo adları, yoksa genel insansı eşleme (Thigh_L, Calf_L, Foot_L …)
    const L = this.limbs;
    if (L.upLegL && L.legL && L.footL && L.upLegR && L.legR && L.footR) {
      this.legs.push({ upLeg: L.upLegL, leg: L.legL, foot: L.footL }, { upLeg: L.upLegR, leg: L.legR, foot: L.footR });
    } else {
      const h = mapHumanoid(model);
      const [ul, ll, fl, ur, lr, fr] = ['leftupleg', 'leftleg', 'leftfoot', 'rightupleg', 'rightleg', 'rightfoot'].map((k) => h?.get(k));
      if (ul && ll && fl && ur && lr && fr) this.legs.push({ upLeg: ul, leg: ll, foot: fl }, { upLeg: ur, leg: lr, foot: fr });
    }
    this.bowArch1 = bowArch1;
    this.bowArch2 = bowArch2;
    this.rightStringFinger = rightStringFinger;
    if (eyelids) {
      const re = new RegExp(eyelids.bones, 'i');
      model.traverse((o) => {
        if ((o as THREE.Bone).isBone && re.test(o.name)) this.lids.push(o);
      });
      this.lidAxis = new THREE.Vector3(eyelids.axis === 'x' ? 1 : 0, eyelids.axis === 'y' ? 1 : 0, eyelids.axis === 'z' ? 1 : 0);
      this.lidOpen = eyelids.open;
    } else if (!this.morphs.has('blink') && !this.morphs.has('blinkL')) this.eyeBlink = setupEyeBlink(model);

    if (mouth) {
      const re = new RegExp(mouth.bones, 'i');
      const reTop = /lip_top|teeth_up/i;
      model.traverse((o) => {
        if ((o as THREE.Bone).isBone) {
          if (re.test(o.name)) this.mouthBones.push(o);
          else if (reTop.test(o.name)) this.mouthTopBones.push(o);
        }
      });
      this.mouthAxis = new THREE.Vector3(mouth.axis === 'x' ? 1 : 0, mouth.axis === 'y' ? 1 : 0, mouth.axis === 'z' ? 1 : 0);
      this.mouthOpen = mouth.open;
    } else {
      // Otomatik algılama: lip_btm, teeth_low veya jaw kemikleri varsa otomatik eşle
      const re = /lip_btm|teeth_low|jaw/i;
      const reTop = /lip_top|teeth_up/i;
      model.traverse((o) => {
        if ((o as THREE.Bone).isBone) {
          if (re.test(o.name)) this.mouthBones.push(o);
          else if (reTop.test(o.name)) this.mouthTopBones.push(o);
        }
      });
      if (this.mouthBones.length) {
        this.mouthAxis = new THREE.Vector3(0, 1, 0);
        this.mouthOpen = -0.55;
      }
    }
  }

  clipDuration(name: string) {
    return this.findAction(name)?.getClip().duration;
  }

  setGround(ground: GroundFn) {
    this.footIK = this.legs.length === 2 ? new FootIK(this.legs, this.height, ground) : undefined;
  }

  prepareWarmup(): () => void {
    const e = this.eyeBlink;
    if (!e) return () => {};
    if (!e.ready) initEyeBlink(e);
    if (!e.closed) return () => {};
    // Kapalı göz, açık gözün yanında aynı iskelete bağlı geçici bir kopya ile derlenir (açık göz de yerinde kalır)
    const src = e.mesh as THREE.SkinnedMesh;
    let probe: THREE.Mesh;
    if (src.isSkinnedMesh) {
      const skinned = new THREE.SkinnedMesh(src.geometry, e.closed);
      skinned.bind(src.skeleton, src.bindMatrix);
      probe = skinned;
    } else probe = new THREE.Mesh(src.geometry, e.closed);
    probe.position.copy(src.position);
    probe.quaternion.copy(src.quaternion);
    probe.scale.copy(src.scale);
    probe.frustumCulled = false;
    // Gölge geçişinin derinlik shader'ı da derlensin
    probe.castShadow = src.castShadow;
    probe.receiveShadow = src.receiveShadow;
    src.parent?.add(probe);
    const hiddenLashes = e.lashes.filter((l) => !l.visible);
    for (const l of hiddenLashes) l.visible = true;
    return () => {
      probe.removeFromParent();
      for (const l of hiddenLashes) l.visible = false;
    };
  }

  private findAction(name: string): THREE.AnimationAction | undefined {
    const key = normalize(this.aliases[name] ?? name);
    const exact = this.actions.get(key);
    if (exact) return exact;
    for (const [k, a] of this.actions) if (k.includes(key)) return a;
    return undefined;
  }

  apply(p: Pose) {
    this.root.position.copy(p.position);
    this.root.rotation.y = p.facing;

    for (const a of this.actions.values()) a.setEffectiveWeight(0);
    for (const a of this.seamActions.values()) a.setEffectiveWeight(0);
    let used = 0;
    const addWeight = (a: THREE.AnimationAction, w: number) => a.setEffectiveWeight(Math.min(1, a.getEffectiveWeight() + w));
    // seamBlend: yürüme/koşu döngülerinde kapalı; dikiş karıştırma tur süresini kısaltır, adım ritmi
    // hıza göre ayarlandığı için ayaklar kayardı.
    const drive = (name: string, time: number, weight: number, loop: boolean, seamBlend = true) => {
      if (weight <= 0) return false;
      const a = this.findAction(name);
      if (!a) return false;
      const d = a.getClip().duration;
      const tail = loop && seamBlend ? this.seamActions.get(a) : undefined;
      if (tail) {
        // Dikişli döngü: tur süresi d - xf; yeni tur başlarken önceki tur xf boyunca sonuna kadar oynamaya
        // devam eder ve ikisi karışır. İki taraf da hareket ettiği için donma ya da sıçrama olmaz.
        const xf = LOOP_SEAM_BLEND;
        const period = d - xf;
        const n = Math.floor(Math.max(0, time) / period);
        const local = Math.max(0, time) - n * period;
        a.time = Math.min(local, d - 1e-4);
        if (n > 0 && local < xf) {
          const k = local / xf;
          const w = k * k * (3 - 2 * k);
          tail.time = Math.min(local + period, d - 1e-4);
          addWeight(a, weight * w);
          addWeight(tail, weight * (1 - w));
        } else addWeight(a, weight);
      } else {
        a.time = loop ? time % d : Math.min(time, d - 1e-4);
        addWeight(a, weight);
      }
      used += weight;
      return true;
    };
    for (const c of p.clips) drive(c.name, c.time, c.weight, c.loop);
    // Yürüme klibini sahnedeki hıza göre oynat: klip 1.4 m/sn'de çekildiyse ve karakter 1.15 m/sn
    // yürüyorsa klip %82 hızda oynar; ayaklar zeminde kaymaz.
    const walkName = p.walkClip || 'walk';
    const walkAction = this.findAction(walkName);
    const natural = walkAction ? (ROOT_SPEED.get(walkAction.getClip()) ?? 0) * this.unitScale : 0;
    const walkRate =
      natural > 0.1 && p.walkSpeed > 0
        ? Math.min(1.65, Math.max(0.6, p.walkSpeed / natural))
        : p.walkSpeed > 3.5
          ? 1.45
          : 1;
    const hasWalk = drive(walkName, p.walkTime * walkRate, p.walkWeight, true, false);
    drive('wave', p.waveTime, p.waveWeight, false);
    const hasJump = drive('jump', p.jumpTime, p.jumpWeight, false);
    if (!drive('idle', p.time, Math.max(0, 1 - used), true) && this.rest) {
      this.rest.time = 0;
      this.rest.setEffectiveWeight(Math.max(0, 1 - used));
    }

    // Klip yoksa prosedürel karşılıkları kullan. Prosedürel yürüyüşte gövde yukarı sekmez;
    // bacaklar açıldıkça kalça L·(1−cos θ) kadar iner ki basan ayak zeminde kalsın.
    // %60: gerçek yürüyüşte destek bacağının dizi hafif esner, gövde geometrik inişin hepsini yaşamaz (~4 cm).
    const stride = hasWalk ? 0 : -this.height * 0.45 * (1 - Math.cos(p.legSwing * LEG_SWING)) * 0.6;
    const lift = stride + (hasJump ? 0 : p.jumpLift);
    const sy = 1 + (hasJump ? 0 : p.squash);
    this.inner.position.y = lift;
    this.inner.scale.set(1 / Math.sqrt(sy), sy, 1 / Math.sqrt(sy));

    // Önceki karenin prosedürel eklemelerini geri al, sonra klipleri uygula.
    for (const [bone, base] of this.touched) bone.quaternion.copy(base);
    this.touched.clear();
    for (const [bone, base] of this.touchedPos) bone.position.copy(base);
    this.touchedPos.clear();
    this.mixer.update(0);

    // Yaylı okçu karakterlerde (Erika) yay kirişi kemiğini (mixamorigLeft_arch2) kiriş çekme ve
    // bırakma anlarında sağ elin parmaklarına kilitleyip ok çıktığı anda geri yaylandır.
    if (this.bowArch1 && this.bowArch2 && this.rightStringFinger) {
      let bowPull = 0;
      for (const c of p.clips) {
        if (c.weight <= 0) continue;
        if (c.name === 'draw_arrow') {
          const pullPhase = Math.max(0, Math.min(1, (c.time - 0.48) / 0.24));
          bowPull += pullPhase * c.weight;
        } else if (c.name === 'aim_overdraw') {
          bowPull += c.weight;
        } else if (c.name === 'aim_recoil') {
          if (c.time < 0.15) {
            bowPull += c.weight;
          } else if (c.time < 0.22) {
            const releasePhase = Math.max(0, Math.min(1, 1 - (c.time - 0.15) / 0.05));
            bowPull += releasePhase * c.weight;
          }
        }
      }
      bowPull = Math.max(0, Math.min(1, bowPull));
      if (bowPull > 0.001) {
        this.touchPos(this.bowArch2);
        this.root.updateMatrixWorld(true);
        const fingerWorld = this.rightStringFinger.getWorldPosition(new THREE.Vector3());
        const fingerLocal = this.bowArch1.worldToLocal(fingerWorld);
        this.bowArch2.position.lerp(fingerLocal, bowPull);
        this.bowArch2.updateMatrixWorld(true);
      }
    }

    if (!hasWalk && p.walkWeight > 0) this.proceduralWalk(p);
    if (this.footIK) {
      // Havadayken (zıplama, savrulma yayı) ayaklar araziye çekilmez
      const airborne = THREE.MathUtils.smoothstep(p.jumpLift, 0.02, 0.12) + (hasJump ? p.jumpWeight : 0);
      // Hızlı koşuda söner: ayak her karede ~20 cm ilerler, altındaki eğim sürekli değişir ve IK dizi
      // titretirdi; ayak yere zaten çok kısa basar. Yürüyüş ve normal koşu (~2 m/sn) tam etkili.
      const sprint = THREE.MathUtils.smoothstep(p.walkSpeed * p.walkWeight, 2.5, 5);
      this.footIK.apply(this.root, this.inner, Math.max(0, 1 - airborne) * (1 - sprint), (b) => this.touch(b));
    }
    if (this.head && (p.headPitch || p.headYaw)) {
      this.touch(this.head);
      this.root.updateMatrixWorld(true);
      lateral.set(1, 0, 0).applyQuaternion(this.root.getWorldQuaternion(tmpQ));
      const up = new THREE.Vector3(0, 1, 0);
      if (p.headYaw) rotateWorld(this.head, up, p.headYaw);
      if (p.headPitch) rotateWorld(this.head, lateral, p.headPitch);
    }

    const { happy, sad, surprised, angry } = p.expr;
    if (this.lids.length) {
      const angle = this.lidOpen * (1 - p.blink);
      for (const lid of this.lids) {
        this.touch(lid);
        lid.quaternion.multiply(tmpQ.setFromAxisAngle(this.lidAxis, angle));
      }
    }
    if (this.eyeBlink) {
      const e = this.eyeBlink;
      // Dokular asenkron yüklenir; kapalı göz malzemesi ve kirpikler dokular hazır olunca kurulur.
      if (!e.ready) initEyeBlink(e);
      if (e.closed) {
        const closedNow = p.blink > 0.5;
        e.mesh.material = closedNow ? e.closed : e.open;
        for (const lash of e.lashes) lash.visible = closedNow;
      }
    }
    if (this.morphs.has('blinkL') || this.morphs.has('blinkR')) {
      this.setMorph('blinkL', p.blink);
      this.setMorph('blinkR', p.blink);
    } else this.setMorph('blink', p.blink);
    const mouthAmount = Math.max(p.mouth, surprised * 0.6);
    if (this.mouthBones.length) {
      const angle = this.mouthOpen * mouthAmount;
      const transY = -Math.abs(this.mouthOpen) * 0.035 * mouthAmount;
      for (const bone of this.mouthBones) {
        this.touch(bone);
        this.touchPos(bone);
        bone.quaternion.multiply(tmpQ.setFromAxisAngle(this.mouthAxis, angle));
        bone.position.y += transY;
      }
      if (this.mouthTopBones.length) {
        const topAngle = -this.mouthOpen * 0.45 * mouthAmount;
        const topTransY = Math.abs(this.mouthOpen) * 0.015 * mouthAmount;
        for (const bone of this.mouthTopBones) {
          this.touch(bone);
          this.touchPos(bone);
          bone.quaternion.multiply(tmpQ.setFromAxisAngle(this.mouthAxis, topAngle));
          bone.position.y += topTransY;
        }
      }
    }
    if (this.uvMouth) {
      const m = this.uvMouth;
      let ox = 0;
      let oy = 0;
      let visible = true;
      if (surprised > 0.4) {
        ox = 0.1;
        oy = -0.3; // r3 c7: şaşırmış yuvarlak "o" ağız
      } else if (angry > 0.4) {
        ox = 0.0;
        oy = -0.5; // r5 c6: öfkeli diş sıkma
      } else if (mouthAmount > 0.15) {
        // Canlı anime konuşma visemeleri (hece adımına göre fonem değişimi)
        const visemeStep = Math.floor(p.time * 5.3) % 4;
        if (mouthAmount > 0.45) {
          // Belirgin açık heceler (sesli harfler ve vurgular)
          switch (visemeStep) {
            case 0:
              ox = 0.0;
              oy = -0.3; // r3 c6: geniş açık ağız, parlak beyaz dişler ve koyu ağız boşluğu
              break;
            case 1:
              ox = 0.1;
              oy = -0.2; // r2 c7: yuvarlak 'O' / 'U' ağzı
              break;
            case 2:
              ox = 0.0;
              oy = -0.2; // r2 c6: geniş konuşma ağzı
              break;
            default:
              ox = 0.1;
              oy = -0.5; // r5 c7: dişli açık konuşma visemesi
              break;
          }
        } else {
          // Orta açıklıkta geçiş heceleri
          if (visemeStep % 2 === 0) {
            ox = 0.1;
            oy = -0.5; // r5 c7: orta açık dişli
          } else {
            ox = 0.2;
            oy = 0.0; // r0 c8: hafif açık gülümseme
          }
        }
      } else if (happy > 0.4) {
        ox = 0.2;
        oy = 0.0; // r0 c8: gülen ağız
      } else {
        visible = false;
      }
      if (m.mesh) {
        m.mesh.visible = visible;
      }
      m.map.offset.set(m.baseX + ox, m.baseY + oy);
    }
    this.setMorph('mouth', mouthAmount * 3.5);
    this.setMorph('smile', happy);
    this.setMorph('sad', sad);
    this.setMorph('surprised', surprised);
    this.setMorph('angry', angry);
  }

  /**
   * Yürüme klibi yoksa: duruş pozunun üzerine bacak, diz ve kol salınımı ekler.
   * Dönüşler karakterin yan ekseni etrafında; negatif açı = uzuv öne gider.
   */
  private proceduralWalk(p: Pose) {
    const L = this.limbs;
    if (!L.upLegL || !L.upLegR) return;
    this.root.updateMatrixWorld(true);
    lateral.set(1, 0, 0).applyQuaternion(this.root.getWorldQuaternion(tmpQ));

    const swing = p.legSwing * LEG_SWING; // sol bacağın öne-arkaya açısı (+ = geri)
    const w = p.walkWeight;
    // Bacak öne doğru gelirken (salınım fazı) diz bükülür, ayak yerden kalkar.
    const kneeL = Math.max(0, -p.legSwingVelocity) * 0.9;
    const kneeR = Math.max(0, p.legSwingVelocity) * 0.9;

    for (const bone of Object.values(L)) if (bone) this.touch(bone);
    rotateWorld(L.upLegL, lateral, swing);
    rotateWorld(L.upLegR, lateral, -swing);
    if (L.legL) rotateWorld(L.legL, lateral, kneeL);
    if (L.legR) rotateWorld(L.legR, lateral, kneeR);
    // Kollar bacakların tersine; dirsek hafif bükük.
    if (L.armL) rotateWorld(L.armL, lateral, -swing * 0.8);
    if (L.armR) rotateWorld(L.armR, lateral, swing * 0.8);
    if (L.foreArmL) rotateWorld(L.foreArmL, lateral, -0.25 * w);
    if (L.foreArmR) rotateWorld(L.foreArmR, lateral, -0.25 * w);
  }

  private touch(bone: THREE.Object3D) {
    if (!this.touched.has(bone)) this.touched.set(bone, bone.quaternion.clone());
  }

  private touchPos(bone: THREE.Object3D) {
    if (!this.touchedPos.has(bone)) this.touchedPos.set(bone, bone.position.clone());
  }

  private setMorph(key: MorphKey, value: number) {
    for (const { mesh, index } of this.morphs.get(key) ?? []) {
      if (mesh.morphTargetInfluences) mesh.morphTargetInfluences[index] = value;
    }
  }
}

/**
 * Göz kapağı morph'u olmayan karakterler (ör. Mixamo hazır karakterleri) için göz kırpma.
 * Bu karakterlerde göz, gözden büyük bir kart üzerine saydamlık maskeli doku olarak çizilir.
 * Kırpma anında kart, aynı maskeyle (yalnızca gözün görünen kısmı) ten rengine boyanır ve
 * gözün ortasına başla birlikte hareket eden bir kirpik çizgisi çizilir.
 */
interface EyeBlink {
  mesh: THREE.Mesh;
  body: THREE.Mesh;
  open: THREE.Material | THREE.Material[];
  closed?: THREE.MeshToonMaterial;
  /** Kapalı gözde görünen kirpik çizgileri (baş kemiğine bağlı). */
  lashes: THREE.Object3D[];
  has3DLashes?: boolean;
  ready: boolean;
}

function setupEyeBlink(model: THREE.Object3D): EyeBlink | undefined {
  let eyes: THREE.Mesh | undefined;
  let body: THREE.Mesh | undefined;
  let has3DLashes = false;
  model.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    if (/lash/i.test(m.name)) has3DLashes = true;
    if (/eye/i.test(m.name) && !/brow|lash|lid/i.test(m.name)) eyes ??= m;
    if (!body || m.geometry.attributes.position.count > body.geometry.attributes.position.count) body = m;
  });
  if (!eyes || !body || eyes === body) return undefined;
  return { mesh: eyes, body, open: eyes.material, lashes: [], has3DLashes, ready: false };
}

interface AlphaMask {
  alpha: Uint8ClampedArray;
  width: number;
  height: number;
  flipY: boolean;
}

/** Göz dokusu ve ten rengi hazırsa kapalı göz malzemesini ve kirpikleri kurar. */
function initEyeBlink(e: EyeBlink) {
  const open = (Array.isArray(e.open) ? e.open[0] : e.open) as THREE.MeshToonMaterial;
  const map = open.map;
  const img = map?.image as (CanvasImageSource & { width: number; height: number; complete?: boolean }) | undefined;
  if (!map || !img || !img.width || img.complete === false) return;
  const skin = sampleSkinAbove(e.mesh, e.body);
  if (!skin) return;

  // Maske: göz dokusunun saydamlığı korunur, rengi beyaz yapılır; malzeme rengi (ten) ile çarpılır.
  const size = Math.min(2048, img.width);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return;
  ctx.drawImage(img, 0, 0, size, size);
  const data = ctx.getImageData(0, 0, size, size);
  const alpha = new Uint8ClampedArray(size * size);
  for (let i = 0; i < alpha.length; i++) {
    alpha[i] = data.data[i * 4 + 3];
    data.data[i * 4] = data.data[i * 4 + 1] = data.data[i * 4 + 2] = 255;
  }
  ctx.putImageData(data, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.flipY = map.flipY;
  tex.colorSpace = THREE.SRGBColorSpace;

  // Göz kartı kameraya yüzden daha dönük olduğundan daha çok ışık alır; ton biraz koyulaştırılır.
  skin.multiplyScalar(0.9);
  const closed = toonMaterial(skin, { outline: false, map: tex });
  closed.name = 'eyelid';
  closed.alphaTest = 0.5;
  closed.side = open.side;
  // Karakter ışığı (öz ışık) açık göze ne verildiyse kapalı göze de aynısı.
  closed.emissive.copy(skin);
  closed.emissiveMap = tex;
  closed.emissiveIntensity = open.emissiveIntensity ?? 0;

  e.closed = closed;
  e.lashes = e.has3DLashes ? [] : buildLashes(e.mesh, { alpha, width: size, height: size, flipY: map.flipY });
  e.ready = true;
}

/**
 * Gövde dokusundan ten rengini okur: her gözün altındaki yanak bölgesinden birkaç nokta örnekler
 * ve ten tonuna en çok benzeyeni seçer (şapka, gözlük, saç gibi parçalar elenir).
 */
function sampleSkinAbove(eyes: THREE.Mesh, body: THREE.Mesh): THREE.Color | null {
  const mat = (Array.isArray(body.material) ? body.material[0] : body.material) as THREE.MeshToonMaterial;
  const img = mat.map?.image as (CanvasImageSource & { width: number; height: number; complete?: boolean }) | undefined;
  const uv = body.geometry.attributes.uv;
  if (!img || !uv || !img.width || img.complete === false) return null;

  eyes.geometry.computeBoundingBox();
  const box = eyes.geometry.boundingBox!;
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const eyeH = Math.max(size.y, size.x * 0.15);

  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  const pos = body.geometry.attributes.position;
  const v = new THREE.Vector3();

  let best: THREE.Color | null = null;
  let bestScore = 0;
  for (const side of [-0.25, 0.25]) {
    for (const down of [1.2, 1.8, 2.5, 3.2]) {
      const target = new THREE.Vector3(center.x + size.x * side, center.y - eyeH * down, box.max.z);
      let idx = -1;
      let bestD = Infinity;
      for (let i = 0; i < pos.count; i++) {
        const d = v.fromBufferAttribute(pos, i).distanceToSquared(target);
        if (d < bestD) {
          bestD = d;
          idx = i;
        }
      }
      if (idx < 0) continue;
      try {
        const u = uv.getX(idx);
        const t = mat.map!.flipY ? 1 - uv.getY(idx) : uv.getY(idx);
        ctx.drawImage(img, Math.floor(u * img.width), Math.floor(t * img.height), 1, 1, 0, 0, 1, 1);
        const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
        const c = new THREE.Color().setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace);
        const score = skinScore(r, g, b);
        if (score > bestScore) {
          bestScore = score;
          best = c;
        }
      } catch {
        return null;
      }
    }
  }
  return best;
}

/** 0..1: renk ten tonuna ne kadar benziyor (sıcak, orta doygunlukta, ne çok koyu ne çok açık). */
function skinScore(r: number, g: number, b: number): number {
  if (!(r > g && g > b)) return 0;
  const hsl = { h: 0, s: 0, l: 0 };
  new THREE.Color(r / 255, g / 255, b / 255).getHSL(hsl);
  const hue = hsl.h * 360;
  if (hue > 50 || hsl.l < 0.2 || hsl.l > 0.92 || hsl.s < 0.12) return 0;
  return (1 - Math.abs(hue - 25) / 30) * (1 - Math.abs(hsl.s - 0.45));
}

/**
 * Her göz için kapalı göz kapağı çizgisi (hafif aşağı kavisli "‿") üretir ve baş kemiğine bağlar.
 * Gözün boyutu kartın kutusundan değil, dokudaki görünür (opak) göz alanından hesaplanır:
 * kartın UV aralığında opak pikseller taranır, bulunan sınırlar UV→konum eşlemesiyle karta taşınır.
 */
function buildLashes(eyes: THREE.Mesh, mask: AlphaMask): THREE.Object3D[] {
  const skinned = eyes as THREE.SkinnedMesh;
  if (!skinned.isSkinnedMesh || !skinned.skeleton) return [];
  const bones = skinned.skeleton.bones;
  const headIndex = bones.findIndex((b) => /head$/i.test(normalize(b.name)));
  if (headIndex < 0) return [];
  const head = bones[headIndex];
  const toHead = skinned.skeleton.boneInverses[headIndex].clone().multiply(skinned.bindMatrix);

  const pos = eyes.geometry.attributes.position;
  const uv = eyes.geometry.attributes.uv;
  if (!uv) return [];
  const verts: EyeVertex[] = [];
  let minX = Infinity;
  let maxX = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    const p = new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(skinned.bindMatrix);
    verts.push({ p, u: uv.getX(i), v: uv.getY(i) });
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
  }
  const midX = (minX + maxX) / 2;

  const material = new THREE.MeshBasicMaterial({ color: 0x1a0f0a });
  material.userData.outlineParameters = { visible: false };
  const lashes: THREE.Object3D[] = [];

  for (const side of [verts.filter((q) => q.p.x < midX), verts.filter((q) => q.p.x >= midX)]) {
    const eye = visibleEyeRect(side, mask);
    if (!eye) continue;
    const geo = new THREE.TorusGeometry(eye.width * 0.45, eye.width * 0.05, 6, 24, Math.PI);
    geo.rotateZ(Math.PI); // ∩ → ∪
    geo.scale(1, 0.3, 0.3);
    const lash = new THREE.Mesh(geo, material);
    const placed = new THREE.Matrix4().makeTranslation(eye.center.x, eye.center.y, eye.front + eye.width * 0.02);
    lash.matrixAutoUpdate = false;
    lash.matrix.copy(toHead.clone().multiply(placed));
    lash.visible = false;
    lash.frustumCulled = false;
    head.add(lash);
    lashes.push(lash);
  }
  return lashes;
}

interface EyeVertex {
  p: THREE.Vector3;
  u: number;
  v: number;
}

/** Bir göz kartının köşelerinden, dokudaki opak göz alanının kart üzerindeki merkezini ve genişliğini bulur. */
function visibleEyeRect(side: EyeVertex[], mask: AlphaMask) {
  if (side.length < 3) return null;
  const box = new THREE.Box3();
  let u0 = 1, u1 = 0, v0 = 1, v1 = 0;
  let atU0 = side[0], atU1 = side[0], atV0 = side[0], atV1 = side[0];
  for (const q of side) {
    box.expandByPoint(q.p);
    if (q.u < u0) { u0 = q.u; atU0 = q; }
    if (q.u > u1) { u1 = q.u; atU1 = q; }
    if (q.v < v0) { v0 = q.v; atV0 = q; }
    if (q.v > v1) { v1 = q.v; atV1 = q; }
  }
  if (u1 - u0 < 1e-4 || v1 - v0 < 1e-4) return null;

  // Kartın UV aralığındaki opak pikselleri tara.
  const { alpha, width: W, height: H, flipY } = mask;
  const pyOf = (v: number) => (flipY ? (1 - v) * H : v * H);
  const x0 = Math.max(0, Math.floor(u0 * W));
  const x1 = Math.min(W - 1, Math.ceil(u1 * W));
  const ya = pyOf(v0);
  const yb = pyOf(v1);
  const y0 = Math.max(0, Math.floor(Math.min(ya, yb)));
  const y1 = Math.min(H - 1, Math.ceil(Math.max(ya, yb)));
  let ou0 = Infinity, ou1 = -Infinity, ov0 = Infinity, ov1 = -Infinity;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (alpha[y * W + x] < 128) continue;
      const u = (x + 0.5) / W;
      const v = flipY ? 1 - (y + 0.5) / H : (y + 0.5) / H;
      ou0 = Math.min(ou0, u);
      ou1 = Math.max(ou1, u);
      ov0 = Math.min(ov0, v);
      ov1 = Math.max(ov1, v);
    }
  }
  if (!Number.isFinite(ou0)) return null;

  // UV → konum: kartın uç köşelerinden doğrusal eşleme (yön işareti köşelerden okunur).
  const xOf = (u: number) => atU0.p.x + ((u - u0) / (u1 - u0)) * (atU1.p.x - atU0.p.x);
  const yOf = (v: number) => atV0.p.y + ((v - v0) / (v1 - v0)) * (atV1.p.y - atV0.p.y);
  const xa = xOf(ou0);
  const xb = xOf(ou1);
  const yc = yOf(ov0);
  const yd = yOf(ov1);
  return {
    center: new THREE.Vector2((xa + xb) / 2, (yc + yd) / 2),
    width: Math.abs(xb - xa),
    front: box.max.z,
  };
}

/** Mixamo kemik adının öneksiz hali: "mixamorig1:LeftUpLeg" → "leftupleg". */
const boneSuffix = (name: string) => normalize(name).replace(/^mixamorig\d*/, '');

/**
 * Başka bir Mixamo karakteri için indirilmiş klipleri bu modele uyarlar (retarget):
 *  - Kemik adları önekten bağımsız eşlenir (mixamorig → mixamorig1 gibi).
 *  - Kalça konum izi iki iskeletin kalça yüksekliği oranında ölçeklenir; kısa/uzun karakterde
 *    ayaklar yere gömülmez ya da havada kalmaz. Doğal ilerleme hızı da aynı oranda ölçeklenir.
 * Adları zaten uyan klipler olduğu gibi kullanılır.
 */
function retargetClips(model: THREE.Object3D, clips: THREE.AnimationClip[], unitScale: number): THREE.AnimationClip[] {
  // Mixamo olmayan iskelet (ör. Source/Blender rig): insansı retarget (dünya uzayında yön hizalamalı).
  let isMixamo = false;
  model.traverse((o) => (isMixamo ||= (o as THREE.Bone).isBone && /^mixamorig/i.test(o.name)));
  const humanoid = isMixamo ? null : mapHumanoid(model);
  if (humanoid) {
    const boneNames = new Set<string>();
    model.traverse((o) => (o as THREE.Bone).isBone && boneNames.add(o.name));
    return clips.map((clip) => {
      // Zaten bu iskelet için yapılmış klipler olduğu gibi kalır.
      if (clip.tracks.some((t) => boneNames.has(THREE.PropertyBinding.parseTrackName(t.name).nodeName))) return clip;
      const source = SOURCE_SKELETON.get(clip);
      return (source && retargetHumanoid(clip, source, model, humanoid, unitScale)) || clip;
    });
  }

  const names = new Set<string>();
  const bySuffix = new Map<string, THREE.Object3D>();
  model.traverse((o) => {
    if (!(o as THREE.Bone).isBone) return;
    names.add(o.name);
    if (!bySuffix.has(boneSuffix(o.name))) bySuffix.set(boneSuffix(o.name), o);
  });
  const hips = bySuffix.get('hips');

  return clips.map((clip) => {
    let renamed = false;
    const tracks: THREE.KeyframeTrack[] = [];
    for (const track of clip.tracks) {
      const parsed = THREE.PropertyBinding.parseTrackName(track.name);
      if (names.has(parsed.nodeName)) {
        tracks.push(track);
        continue;
      }
      const target = bySuffix.get(boneSuffix(parsed.nodeName));
      renamed = true;
      if (!target) continue; // kaynak iskelete özgü kemik (ör. kapüşon ipi): hedefte yok, atla
      const t = track.clone();
      t.name = target.name + track.name.slice(parsed.nodeName.length);
      tracks.push(t);
    }
    let ratio = 1;
    let hipsScaled = false;
    if (hips) {
      const hipsTrackIdx = tracks.findIndex((t) => t.name === `${hips.name}.position`);
      const hipsTrack = hipsTrackIdx >= 0 ? tracks[hipsTrackIdx] : undefined;
      // Kaynak iskeletin duruş pozu kalça yüksekliği; yoksa klibin ilk karesi (çömelik başlayan
      // kliplerde yanıltıcı olabilir).
      const srcY = SOURCE_HIPS_HEIGHT.get(clip) ?? hipsTrack?.values[1];
      if (hipsTrack) {
        if (srcY && srcY > 0 && hips.position.y > 0 && Math.abs(hips.position.y - srcY) / srcY > 0.02) {
          ratio = hips.position.y / srcY;
        }
        const clonedHipsTrack = renamed ? hipsTrack : hipsTrack.clone();
        const values = clonedHipsTrack.values;
        for (let i = 0; i < values.length; i += 3) {
          values[i] = hips.position.x;
          values[i + 1] *= ratio;
          values[i + 2] = hips.position.z;
        }
        tracks[hipsTrackIdx] = clonedHipsTrack;
        hipsScaled = true;
      }
    }
    if (!renamed && !hipsScaled) return clip;

    const out = new THREE.AnimationClip(clip.name, clip.duration, tracks, clip.blendMode);
    const speed = ROOT_SPEED.get(clip);
    if (speed !== undefined) ROOT_SPEED.set(out, speed * ratio);
    return out;
  });
}

let cachedJackieVisemeMap: THREE.CanvasTexture | null = null;

/**
 * Jackie (Ch29) için 10x10 hücreli (Boy01_FacialAnimMap UV düzeniyle uyumlu) yüksek kontrastlı
 * anime konuşma viseme dokusu üretir.
 */
function createJackieVisemeTexture(): THREE.Texture {
  if (cachedJackieVisemeMap) {
    const clone = cachedJackieVisemeMap.clone();
    clone.needsUpdate = true;
    return clone;
  }

  const S = 1024;
  const cell = S / 10;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d')!;

  const drawCell = (col: number, rowFromTop: number, drawFn: (c: CanvasRenderingContext2D) => void) => {
    ctx.save();
    ctx.translate((col + 0.5) * cell, (rowFromTop + 0.5) * cell);
    // Alttaki sabit boyalı ağız çizgisinin kenarlardan taşmasını önleyen ten rengi örtü
    ctx.fillStyle = '#dfb299';
    ctx.beginPath();
    ctx.ellipse(0, -5, 31, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    drawFn(ctx);
    ctx.restore();
  };

  // Col 6, Row 3 (ox=0.0, oy=-0.3): Geniş açık 'A' ağzı (parlak üst dişler, koyu ağız içi, pembe dil)
  drawCell(6, 3, (c) => {
    c.save();
    c.beginPath();
    c.moveTo(-31, -11);
    c.quadraticCurveTo(0, -16, 31, -11);
    c.bezierCurveTo(33, 19, 19, 32, 0, 32);
    c.bezierCurveTo(-19, 32, -33, 19, -31, -11);
    c.closePath();
    c.fillStyle = '#3b0e14';
    c.fill();
    c.clip();

    c.fillStyle = '#ea6878';
    c.beginPath();
    c.ellipse(0, 26, 23, 16, 0, 0, Math.PI * 2);
    c.fill();

    c.fillStyle = '#ffffff';
    c.fillRect(-29, -15, 58, 12);
    c.restore();

    c.strokeStyle = '#4a1c17';
    c.lineWidth = 5.0;
    c.beginPath();
    c.moveTo(-31, -11);
    c.quadraticCurveTo(0, -16, 31, -11);
    c.bezierCurveTo(33, 19, 19, 32, 0, 32);
    c.bezierCurveTo(-19, 32, -33, 19, -31, -11);
    c.closePath();
    c.stroke();
  });

  // Col 7, Row 2 (ox=0.1, oy=-0.2): Yuvarlak 'O' / 'U' ağzı
  drawCell(7, 2, (c) => {
    c.save();
    c.beginPath();
    c.ellipse(0, 4, 22, 25, 0, 0, Math.PI * 2);
    c.fillStyle = '#3b0e14';
    c.fill();
    c.clip();

    c.fillStyle = '#ea6878';
    c.beginPath();
    c.ellipse(0, 21, 16, 12, 0, 0, Math.PI * 2);
    c.fill();

    c.fillStyle = '#ffffff';
    c.fillRect(-18, -20, 36, 10);
    c.restore();

    c.strokeStyle = '#4a1c17';
    c.lineWidth = 5.0;
    c.beginPath();
    c.ellipse(0, 4, 22, 25, 0, 0, Math.PI * 2);
    c.stroke();
  });

  // Col 6, Row 2 (ox=0.0, oy=-0.2): Geniş konuşma 'E' / 'İ' ağzı
  drawCell(6, 2, (c) => {
    c.save();
    c.beginPath();
    c.moveTo(-30, -9);
    c.quadraticCurveTo(0, -13, 30, -9);
    c.bezierCurveTo(29, 15, 17, 25, 0, 25);
    c.bezierCurveTo(-17, 25, -29, 15, -30, -9);
    c.closePath();
    c.fillStyle = '#3b0e14';
    c.fill();
    c.clip();

    c.fillStyle = '#ea6878';
    c.beginPath();
    c.ellipse(0, 21, 20, 12, 0, 0, Math.PI * 2);
    c.fill();

    c.fillStyle = '#ffffff';
    c.fillRect(-27, -13, 54, 11);
    c.restore();

    c.strokeStyle = '#4a1c17';
    c.lineWidth = 4.8;
    c.beginPath();
    c.moveTo(-30, -9);
    c.quadraticCurveTo(0, -13, 30, -9);
    c.bezierCurveTo(29, 15, 17, 25, 0, 25);
    c.bezierCurveTo(-17, 25, -29, 15, -30, -9);
    c.closePath();
    c.stroke();
  });

  // Col 7, Row 5 (ox=0.1, oy=-0.5): Dişli belirgin konuşma hecesi
  drawCell(7, 5, (c) => {
    c.save();
    c.beginPath();
    c.roundRect(-28, -10, 56, 26, 12);
    c.fillStyle = '#3b0e14';
    c.fill();
    c.clip();

    c.fillStyle = '#ffffff';
    c.fillRect(-26, -10, 52, 11);
    c.fillStyle = '#ea6878';
    c.beginPath();
    c.ellipse(0, 15, 19, 10, 0, 0, Math.PI * 2);
    c.fill();
    c.restore();

    c.strokeStyle = '#4a1c17';
    c.lineWidth = 4.8;
    c.beginPath();
    c.roundRect(-28, -10, 56, 26, 12);
    c.stroke();
  });

  // Col 8, Row 0 (ox=0.2, oy=0.0): Gülümseyen açık konuşma ağzı
  drawCell(8, 0, (c) => {
    c.save();
    c.beginPath();
    c.moveTo(-29, -8);
    c.quadraticCurveTo(0, -4, 29, -8);
    c.bezierCurveTo(26, 14, 14, 22, 0, 22);
    c.bezierCurveTo(-14, 22, -26, 14, -29, -8);
    c.closePath();
    c.fillStyle = '#3b0e14';
    c.fill();
    c.clip();

    c.fillStyle = '#ffffff';
    c.fillRect(-26, -9, 52, 10);
    c.fillStyle = '#ea6878';
    c.beginPath();
    c.ellipse(0, 19, 16, 9, 0, 0, Math.PI * 2);
    c.fill();
    c.restore();

    c.strokeStyle = '#4a1c17';
    c.lineWidth = 4.6;
    c.beginPath();
    c.moveTo(-29, -8);
    c.quadraticCurveTo(0, -4, 29, -8);
    c.bezierCurveTo(26, 14, 14, 22, 0, 22);
    c.bezierCurveTo(-14, 22, -26, 14, -29, -8);
    c.closePath();
    c.stroke();
  });

  // Col 7, Row 3 (ox=0.1, oy=-0.3): Şaşırmış yuvarlak ağız
  drawCell(7, 3, (c) => {
    c.fillStyle = '#3b0e14';
    c.strokeStyle = '#4a1c17';
    c.lineWidth = 5.0;
    c.beginPath();
    c.ellipse(0, 4, 20, 25, 0, 0, Math.PI * 2);
    c.fill();
    c.stroke();
  });

  // Col 6, Row 5 (ox=0.0, oy=-0.5): Öfkeli diş sıkma
  drawCell(6, 5, (c) => {
    c.fillStyle = '#ffffff';
    c.strokeStyle = '#4a1c17';
    c.lineWidth = 4.6;
    c.beginPath();
    c.roundRect(-27, -8, 54, 18, 7);
    c.fill();
    c.stroke();
  });

  cachedJackieVisemeMap = new THREE.CanvasTexture(canvas);
  cachedJackieVisemeMap.wrapS = THREE.RepeatWrapping;
  cachedJackieVisemeMap.wrapT = THREE.RepeatWrapping;
  cachedJackieVisemeMap.colorSpace = THREE.SRGBColorSpace;

  const clone = cachedJackieVisemeMap.clone();
  clone.needsUpdate = true;
  return clone;
}

