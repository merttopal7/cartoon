import * as THREE from 'three';
import { toonMaterial } from '../toon';
import type { Pose, Rig } from '../pose';

export type CharacterKind = 'bear' | 'bunny';

const DEFAULT_COLORS: Record<CharacterKind, string> = { bear: '#c98a4b', bunny: '#f1ece4' };

/**
 * Model gelene kadar kullanılan, primitiflerden kurulu test karakteri.
 * Önü +Z yönüne bakar; "sağ" karakterin kendi sağıdır (-X).
 */
export class PlaceholderRig implements Rig {
  readonly root = new THREE.Group();
  readonly height: number;
  readonly width = 0.95;

  private readonly body = new THREE.Group();
  private readonly torso = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly armL = new THREE.Group();
  private readonly armR = new THREE.Group();
  private readonly legL = new THREE.Group();
  private readonly legR = new THREE.Group();
  private readonly eyeL = new THREE.Group();
  private readonly eyeR = new THREE.Group();
  private readonly browL: THREE.Mesh;
  private readonly browR: THREE.Mesh;
  private readonly mouth: THREE.Mesh;
  private readonly smile: THREE.Mesh;

  constructor(kind: CharacterKind, colorHex?: string) {
    const base = new THREE.Color(colorHex ?? DEFAULT_COLORS[kind]);
    const fur = toonMaterial(base);
    const light = toonMaterial(base.clone().lerp(new THREE.Color('#ffffff'), 0.55));
    const dark = toonMaterial('#2a1d17', { outline: false });
    const white = toonMaterial('#ffffff', { outline: false });
    const mouthMat = toonMaterial('#5a2328', { outline: false });

    const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      return m;
    };

    this.root.add(this.body);

    // gövde
    this.torso.position.y = 0.78;
    const torsoMesh = mesh(new THREE.SphereGeometry(0.42, 32, 24), fur);
    torsoMesh.scale.set(1, 1.12, 0.92);
    const belly = mesh(new THREE.SphereGeometry(0.3, 24, 16), light, 0, -0.05, 0.2);
    belly.scale.set(1, 1.1, 0.6);
    this.torso.add(torsoMesh, belly);
    this.body.add(this.torso);

    // bacaklar
    for (const [leg, x] of [[this.legL, 0.19], [this.legR, -0.19]] as const) {
      leg.position.set(x, 0.45, 0);
      leg.add(mesh(new THREE.CapsuleGeometry(0.13, 0.22, 6, 16), fur, 0, -0.2, 0));
      this.body.add(leg);
    }

    // kollar
    for (const [arm, x] of [[this.armL, 0.38], [this.armR, -0.38]] as const) {
      arm.position.set(x, 1.02, 0);
      arm.add(mesh(new THREE.CapsuleGeometry(0.1, 0.3, 6, 16), fur, 0, -0.24, 0));
      this.body.add(arm);
    }

    // kafa
    this.head.position.y = 1.42;
    this.head.rotation.order = 'YXZ';
    this.head.add(mesh(new THREE.SphereGeometry(0.36, 32, 24), fur));
    if (kind === 'bear') {
      for (const s of [1, -1]) {
        this.head.add(mesh(new THREE.SphereGeometry(0.12, 16, 12), fur, 0.26 * s, 0.27, -0.02));
        const inner = mesh(new THREE.SphereGeometry(0.07, 12, 8), light, 0.26 * s, 0.27, 0.06);
        inner.scale.z = 0.5;
        this.head.add(inner);
      }
    } else {
      for (const s of [1, -1]) {
        const ear = mesh(new THREE.CapsuleGeometry(0.075, 0.3, 6, 12), fur, 0.13 * s, 0.47, -0.03);
        ear.rotation.z = -0.15 * s;
        const inner = mesh(new THREE.CapsuleGeometry(0.04, 0.24, 4, 8), light, 0, 0, 0.05);
        inner.scale.z = 0.4;
        ear.add(inner);
        this.head.add(ear);
      }
    }
    const muzzle = mesh(new THREE.SphereGeometry(0.15, 24, 16), light, 0, -0.08, 0.28);
    muzzle.scale.set(kind === 'bear' ? 1.2 : 1, kind === 'bear' ? 0.85 : 0.75, 0.8);
    this.head.add(muzzle);
    this.head.add(
      kind === 'bear'
        ? mesh(new THREE.SphereGeometry(0.055, 12, 8), dark, 0, -0.03, 0.4)
        : mesh(new THREE.SphereGeometry(0.04, 12, 8), toonMaterial('#f08a9b', { outline: false }), 0, -0.04, 0.385),
    );

    for (const [eye, x] of [[this.eyeL, 0.13], [this.eyeR, -0.13]] as const) {
      eye.position.set(x, 0.07, 0.31);
      eye.add(mesh(new THREE.SphereGeometry(0.052, 16, 12), dark));
      eye.add(mesh(new THREE.SphereGeometry(0.016, 8, 6), white, 0.015, 0.02, 0.04));
      this.head.add(eye);
    }
    this.browL = mesh(new THREE.BoxGeometry(0.11, 0.024, 0.02), dark, 0.13, 0.17, 0.3);
    this.browR = mesh(new THREE.BoxGeometry(0.11, 0.024, 0.02), dark, -0.13, 0.17, 0.3);
    this.mouth = mesh(new THREE.SphereGeometry(0.05, 16, 12), mouthMat, 0, -0.16, 0.385);
    // gülümseme: U biçiminde yarım halka
    this.smile = mesh(new THREE.TorusGeometry(0.075, 0.016, 8, 20, Math.PI), mouthMat, 0, -0.13, 0.392);
    this.smile.rotation.z = Math.PI;
    this.head.add(this.browL, this.browR, this.mouth, this.smile);
    this.body.add(this.head);

    // Kadraj yüksekliği kafanın tepesine kadar; kulaklar sayılmaz (yakın planda göz hizasına bakılsın).
    this.height = this.head.position.y + 0.36;
  }

  apply(p: Pose) {
    const { happy, sad, surprised, angry } = p.expr;

    this.root.position.copy(p.position);
    this.root.rotation.y = p.facing;

    const sy = 1 + p.squash;
    const sxz = 1 / Math.sqrt(sy);
    this.body.position.y = p.bob + p.jumpLift;
    this.body.scale.set(sxz, sy, sxz);

    this.torso.scale.set(1 - p.breathe * 0.5, 1 + p.breathe, 1 - p.breathe * 0.5);
    this.torso.rotation.z = p.sway;

    this.legL.rotation.x = p.legSwing;
    this.legR.rotation.x = -p.legSwing;

    // kol kalktıkça yürüme salınımı azalır
    const swingR = p.armSwing * (1 - Math.min(1, p.raise.right / 1.5));
    const swingL = p.armSwing * (1 - Math.min(1, p.raise.left / 1.5));
    this.armR.rotation.set(-swingR, 0, -(0.12 + p.raise.right + p.wave.right));
    this.armL.rotation.set(swingL, 0, 0.12 + p.raise.left + p.wave.left);

    this.head.rotation.set(p.headPitch + 0.15 * sad - 0.08 * surprised, p.headYaw, p.sway * 0.6);

    const eyeOpen = Math.max(0.08, (1 - p.blink) * (1 - 0.4 * happy + 0.25 * surprised) * (1 - 0.25 * sad));
    this.eyeL.scale.y = this.eyeR.scale.y = eyeOpen;

    const browY = 0.17 + 0.05 * surprised + 0.02 * happy - 0.02 * angry;
    const browTilt = 0.4 * angry - 0.35 * sad;
    this.browL.position.y = this.browR.position.y = browY;
    this.browL.rotation.z = browTilt;
    this.browR.rotation.z = -browTilt;

    // Ağız: konuşurken / şaşırınca açılan oval; mutlulukta üstüne gülümseme çizgisi biner.
    const open = 0.9 * p.mouth + 0.8 * surprised;
    this.mouth.scale.set(1.3 - 0.3 * surprised - 0.2 * sad, 0.16 + open, 0.5);
    this.mouth.position.y = -0.16 - 0.03 * happy;
    this.mouth.visible = open > 0.05 || happy < 0.5;
    const smile = Math.max(1e-3, happy);
    this.smile.scale.set(smile, smile * (1 - 0.5 * Math.min(1, open)), smile);
    this.smile.visible = happy > 0.01;
  }
}
