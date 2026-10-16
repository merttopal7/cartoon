import * as THREE from 'three';
import type { Film } from '../engine/film';

export type ViewportMode = 'preview' | 'render';

/** Tek WebGL bağlamı: önizleme de dışa aktarım da bunu kullanır. */
export class Viewport {
  readonly renderer: THREE.WebGLRenderer;
  private mode: ViewportMode = 'preview';
  /** Karartmalar için tam ekran siyah örtü (ayrı sahne, ortografik kamera). */
  private readonly overlayScene = new THREE.Scene();
  private readonly overlayCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly overlay = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, depthTest: false, depthWrite: false }),
  );

  /** Remotion tarzı 2B hareketli grafikler ve geçişler için tam ekran CanvasTexture katmanı. */
  private readonly motionCanvas: HTMLCanvasElement;
  private readonly motionCtx: CanvasRenderingContext2D | null;
  private motionTexture: THREE.CanvasTexture;
  private readonly motionMat: THREE.MeshBasicMaterial;
  private readonly motionScene = new THREE.Scene();
  private readonly motionMesh: THREE.Mesh;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.shadowMap.enabled = false;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.overlay.material.userData.outlineParameters = { visible: false };
    this.overlayScene.add(this.overlay);

    this.motionCanvas = document.createElement('canvas');
    this.motionCanvas.width = Math.max(1, canvas.width || 1920);
    this.motionCanvas.height = Math.max(1, canvas.height || 1080);
    this.motionCtx = this.motionCanvas.getContext('2d');
    this.motionTexture = this.createMotionTexture();

    this.motionMat = new THREE.MeshBasicMaterial({
      map: this.motionTexture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    this.motionMat.userData.outlineParameters = { visible: false };
    this.motionMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.motionMat);
    this.motionScene.add(this.motionMesh);
  }

  private createMotionTexture(): THREE.CanvasTexture {
    const tex = new THREE.CanvasTexture(this.motionCanvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    return tex;
  }

  setRenderMode(mode: ViewportMode) {
    this.mode = mode;
    this.renderer.shadowMap.enabled = (mode === 'render');
  }

  getRenderMode(): ViewportMode {
    return this.mode;
  }

  /** CSS boyutu dokunulmadan çizim tamponunu ayarlar. */
  setSize(width: number, height: number, pixelRatio: number) {
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(width, height, false);
  }

  render(film: Film) {
    // Önizleme ve Render modlarında doğrudan sahne çizimi (Render modunda tam çözünürlük ve PCFSoftShadowMap gölgeleri aktif)
    this.renderer.render(film.scene, film.camera);

    if (this.motionCtx) {
      const w = Math.max(1, this.canvas.width);
      const h = Math.max(1, this.canvas.height);
      if (this.motionCanvas.width !== w || this.motionCanvas.height !== h) {
        this.motionCanvas.width = w;
        this.motionCanvas.height = h;
        this.motionTexture.dispose();
        this.motionTexture = this.createMotionTexture();
        this.motionMat.map = this.motionTexture;
        this.motionMat.needsUpdate = true;
      }
      if (film.renderMotionOverlay(this.motionCtx, w, h)) {
        this.motionTexture.needsUpdate = true;
        const autoClear = this.renderer.autoClear;
        this.renderer.autoClear = false;
        this.renderer.render(this.motionScene, this.overlayCamera);
        this.renderer.autoClear = autoClear;
      }
    }

    if (film.fade > 0.001) {
      this.overlay.material.opacity = film.fade;
      const autoClear = this.renderer.autoClear;
      this.renderer.autoClear = false;
      this.renderer.render(this.overlayScene, this.overlayCamera);
      this.renderer.autoClear = autoClear;
    }
  }

  /** Hareketli grafik ve karartma katmanlarının shader'larını önceden derler (ilk HUD / geçiş karesinde takılmasın). */
  async warmupOverlays() {
    await this.renderer.compileAsync(this.motionScene, this.overlayCamera);
    await this.renderer.compileAsync(this.overlayScene, this.overlayCamera);
  }

  /** Dışa aktarım için tamponu tam çözünürlüğe ve Render Moduna getirir; dönen fonksiyon eski duruma döndürür. */
  beginOffscreen(width: number, height: number): () => void {
    const prevRatio = this.renderer.getPixelRatio();
    const prev = this.renderer.getSize(new THREE.Vector2());
    const prevMode = this.mode;
    this.setRenderMode('render');
    this.setSize(width, height, 1);
    return () => {
      this.setRenderMode(prevMode);
      this.setSize(prev.x, prev.y, prevRatio);
    };
  }
}
