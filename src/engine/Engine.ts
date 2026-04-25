import * as THREE from "three";
import { buildPlayer, type PlayerHandles } from "./player";
import { buildWorld } from "./world";
import { readInput } from "../input/useInput";

// Engine — owns the renderer, scene, camera, and per-frame loop.
// Pure three.js, no R3F. React mounts it via a useEffect.

export type EngineEvents = {
  onPlayerPosition?: (pos: THREE.Vector3) => void;
  onTick?: (dt: number, t: number) => void;
};

export class Engine {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly clock: THREE.Clock;
  readonly player: PlayerHandles;

  private rafId = 0;
  private events: EngineEvents;
  private resizeObserver: ResizeObserver;
  private onResizeBound: () => void;
  private cameraOffset = new THREE.Vector3(0, 7, 9);
  private cameraLookOffset = new THREE.Vector3(0, 1.2, 0);
  private tmpVec = new THREE.Vector3();
  private disposed = false;

  // Game-mode hook: called every frame so modes can react to the player position.
  // The function decides whether anything happens; engine just calls it.
  tickHook?: (dt: number, t: number, playerPos: THREE.Vector3) => void;

  constructor(canvas: HTMLCanvasElement, events: EngineEvents = {}) {
    this.events = events;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xa8e2ff);
    this.scene.fog = new THREE.Fog(0xa8e2ff, 60, 160);

    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 500);
    this.camera.position.copy(this.cameraOffset);
    this.camera.lookAt(0, 1.2, 0);

    // Lights
    const hemi = new THREE.HemisphereLight(0xfff7d6, 0x86d36a, 0.6);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(15, 25, 10);
    sun.castShadow = true;
    // Modest shadow map: kid-game scale doesn't need high-res shadows, and
    // smaller maps keep the integrated GPU happy on Macs and mobile.
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -25;
    sun.shadow.camera.right = 25;
    sun.shadow.camera.top = 25;
    sun.shadow.camera.bottom = -25;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 70;
    sun.shadow.bias = -0.0005;
    this.scene.add(sun);

    const ambient = new THREE.AmbientLight(0xffffff, 0.4);
    this.scene.add(ambient);

    // World + player
    const world = buildWorld();
    this.scene.add(world.group);

    this.player = buildPlayer();
    this.scene.add(this.player.group);

    this.clock = new THREE.Clock();

    // Sizing — listen to both window resize and parent ResizeObserver.
    this.onResizeBound = this.onResize.bind(this);
    window.addEventListener("resize", this.onResizeBound);
    this.resizeObserver = new ResizeObserver(this.onResizeBound);
    if (canvas.parentElement) this.resizeObserver.observe(canvas.parentElement);
    this.onResize();

    this.start();
  }

  private onResize() {
    const parent = this.renderer.domElement.parentElement;
    const w = parent?.clientWidth || window.innerWidth;
    const h = parent?.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, true);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private start() {
    const tick = () => {
      if (this.disposed) return;
      const dt = Math.min(this.clock.getDelta(), 0.1);
      const t = this.clock.elapsedTime;

      // Player update from current input
      const input = readInput();
      this.player.update(dt, input.move);

      // Smooth follow camera
      const pos = this.player.position();
      this.tmpVec.copy(pos).add(this.cameraOffset);
      this.camera.position.lerp(this.tmpVec, 0.08);
      this.tmpVec.copy(pos).add(this.cameraLookOffset);
      this.camera.lookAt(this.tmpVec);

      this.tickHook?.(dt, t, pos);
      this.events.onPlayerPosition?.(pos);
      this.events.onTick?.(dt, t);

      this.renderer.render(this.scene, this.camera);
      this.rafId = requestAnimationFrame(tick);
    };
    this.clock.start();
    this.rafId = requestAnimationFrame(tick);
  }

  setEvents(events: EngineEvents) {
    this.events = events;
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.rafId);
    window.removeEventListener("resize", this.onResizeBound);
    this.resizeObserver.disconnect();
    this.scene.traverse((obj) => {
      const m = obj as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else if (mat) (mat as THREE.Material).dispose();
    });
    this.renderer.dispose();
  }
}
