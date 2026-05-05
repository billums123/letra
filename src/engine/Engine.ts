import * as THREE from "three";
import { buildAvatar, type PlayerHandles } from "./player";
import type { AvatarKind } from "../state/store";
import { buildWorld, type Obstacle } from "./world";
import { getBiome } from "./biomes";
import { readInput } from "../input/useInput";

const PLAYER_RADIUS = 0.55;

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
  readonly obstacles: Obstacle[];
  readonly worldRadius: number;

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

  // Tracks which obstacles the player was overlapping last frame, so we
  // can fire the obstacle's onBump callback once on the rising edge of
  // a collision instead of every frame the player is wedged against it.
  private prevOverlap = new Set<Obstacle>();

  // Actors with their own per-frame update (letter characters, particles, etc.).
  private actors = new Set<{ update: (dt: number, t: number) => void }>();
  addActor(actor: { update: (dt: number, t: number) => void }) {
    this.actors.add(actor);
  }
  removeActor(actor: { update: (dt: number, t: number) => void }) {
    this.actors.delete(actor);
  }

  // Cleanup hook the active biome registers via applyScene — runs in
  // dispose() so removing the engine takes the biome's lights with it.
  private disposeBiome: (() => void) | null = null;
  // Optional ground-height sampler from the active biome. When set,
  // the per-frame loop offsets the player Y by it so e.g. the car
  // visibly dips into moon craters. Public so games can place spawn
  // props (letters, etc.) at the correct height.
  terrainHeight: ((x: number, z: number) => number) | null = null;
  // Optional walkable predicate from biomes whose play area is not a
  // single connected disc (sky islands etc.). Games pass this to
  // pickClearSpawn so letters land only on surfaces the avatar can
  // actually reach.
  isWalkable: ((x: number, z: number) => boolean) | null = null;
  // Optional XZ anchor for the end-of-game celebration. When set,
  // games should teleport the player here and arrange the ring of
  // dancing letters around it. Sky islands uses this to relocate the
  // dance party to the central island so all 26 letters fit on a
  // single walkable surface.
  celebrationCenter: { x: number; z: number; ringRadius?: number } | null = null;

  // Directional lights with castShadow that we move with the player so
  // the orthographic shadow frustum (typically ~50 units across) always
  // covers them. Without this the player's shadow gets clipped at a
  // hard rectangle once they wander past ~25 units from origin.
  // Each entry caches the original position→target offset so we keep
  // the sun direction constant while the camera follows.
  private shadowSuns: { light: THREE.DirectionalLight; offset: THREE.Vector3 }[] = [];

  constructor(
    canvas: HTMLCanvasElement,
    events: EngineEvents = {},
    avatar: AvatarKind = "kid",
    biomeId: string = "meadow"
  ) {
    this.events = events;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();

    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 500);
    this.camera.position.copy(this.cameraOffset);
    this.camera.lookAt(0, 1.2, 0);

    // Biome owns sky / fog / lighting. applyScene returns a cleanup
    // function the engine runs on dispose so swapping biomes between
    // mounts doesn't leak lights.
    const biome = getBiome(biomeId);
    this.disposeBiome = biome.applyScene(this.scene);

    // World + player. The biome's tick callbacks may want to read the
    // player position (e.g. moon aliens that wave when bumped) — pass
    // a getter so they can null-check during teardown. Biomes that
    // deform the ground can also register a height sampler we read in
    // the per-frame loop so the avatar dips into depressions.
    const world = buildWorld(biome, () => this.player?.group.position ?? null);
    this.scene.add(world.group);
    this.terrainHeight = world.terrainHeight;
    this.isWalkable = world.isWalkable;
    this.celebrationCenter = world.celebrationCenter;
    this.obstacles = world.obstacles;
    this.worldRadius = world.worldRadius;
    // Per-frame world animations (drifting butterflies etc) are
    // exposed by buildWorld as a list of update callbacks.
    for (const fn of world.tick) {
      this.addActor({ update: fn });
    }

    this.player = buildAvatar(avatar);
    this.scene.add(this.player.group);

    // Find every shadow-casting directional light the biome added and
    // wire it up to follow the player. Targets need to be in the scene
    // graph so their matrixWorld stays current — three.js doesn't add
    // a light's default target automatically.
    this.scene.traverse((obj) => {
      if (obj instanceof THREE.DirectionalLight && obj.castShadow) {
        if (!obj.target.parent) this.scene.add(obj.target);
        const offset = obj.position.clone().sub(obj.target.position);
        this.shadowSuns.push({ light: obj, offset });
      }
    });

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

      // Snapshot pre-update XZ so the walkable clamp at the end of the
      // tick has a "last known good" to revert to if the avatar's
      // movement would step off a non-contiguous biome's walkable
      // surface (e.g. into the void between sky islands).
      const pp = this.player.group.position;
      const prevX = pp.x;
      const prevZ = pp.z;

      // Player update from current input
      const input = readInput();
      this.player.update(dt, input.move);

      // Push player out of any obstacle they overlap with. We resolve in a
      // single pass per frame: for each overlap, slide along the contact
      // normal so the player stops at the obstacle edge instead of sticking
      // or jittering. New overlaps (rising edge) fire the obstacle's
      // onBump callback so e.g. trees can shake when bumped.
      const overlap = new Set<Obstacle>();
      for (const o of this.obstacles) {
        const dx = pp.x - o.x;
        const dz = pp.z - o.z;
        const dist = Math.hypot(dx, dz);
        const minDist = o.radius + PLAYER_RADIUS;
        if (dist < minDist && dist > 0.0001) {
          overlap.add(o);
          // Soft obstacles (e.g. flowers) just trigger onBump without
          // physically pushing the player out — the kid drives right
          // through but the prop still gets to react.
          if (o.solid !== false) {
            const push = (minDist - dist) / dist;
            pp.x += dx * push;
            pp.z += dz * push;
          }
          if (!this.prevOverlap.has(o)) {
            // Intensity scales with how deeply the player drove into the
            // obstacle — light grazes shouldn't shake a tree as hard as
            // a full-speed collision.
            const overlap01 = (minDist - dist) / minDist;
            o.onBump?.(Math.min(1, overlap01 * 6));
          }
        }
      }
      this.prevOverlap = overlap;
      // Hard world boundary — independent of the visible boundary props
      // so a kid can never sneak through a gap and drive off the map.
      // Clamp the player back inside a circle of radius (worldRadius -
      // PLAYER_RADIUS) so they stop a half-step short of the edge.
      const distFromCenter = Math.hypot(pp.x, pp.z);
      const maxDist = this.worldRadius - PLAYER_RADIUS;
      if (distFromCenter > maxDist) {
        const k = maxDist / distFromCenter;
        pp.x *= k;
        pp.z *= k;
      }

      // Walkable-surface clamp — biomes with a non-contiguous play
      // area (sky islands, etc.) register an isWalkable predicate.
      // If the post-update XZ falls off a walkable surface, we try
      // the move along each axis individually so the avatar can
      // slide along an edge, then fall back to fully reverting if
      // both single-axis moves are also off the surface. This is the
      // sole containment for those biomes — no invisible-obstacle
      // ring required.
      const walkable = this.isWalkable;
      if (walkable && !walkable(pp.x, pp.z)) {
        if (walkable(pp.x, prevZ)) {
          pp.z = prevZ;
        } else if (walkable(prevX, pp.z)) {
          pp.x = prevX;
        } else {
          pp.x = prevX;
          pp.z = prevZ;
        }
      }

      // Terrain follow — biomes that deform the ground (e.g. moon
      // craters) register a height sampler. We add the sampled offset
      // to the player Y AFTER the avatar's own bob so the kid/car
      // settles into the depression and the rocket dips with it.
      if (this.terrainHeight) {
        pp.y += this.terrainHeight(pp.x, pp.z);
      }

      // Sun follow — keep each shadow camera centered on the player so
      // the directional-light frustum doesn't clip the player's shadow
      // once they walk past its bounds. We snap the target to ground
      // level (y=0) so the angle of the shadow stays consistent.
      for (const s of this.shadowSuns) {
        s.light.target.position.set(pp.x, 0, pp.z);
        s.light.position.copy(s.light.target.position).add(s.offset);
        s.light.target.updateMatrixWorld();
      }

      // Smooth follow camera. We follow only the XZ plane — the player's
      // Y oscillates from idle bob, but a camera that bobs with them
      // makes the whole world feel like it's nodding. Anchor Y to the
      // terrain so the camera dips into craters along with the player.
      const pos = this.player.position();
      const cameraAnchorY = this.terrainHeight ? this.terrainHeight(pos.x, pos.z) : 0;
      this.tmpVec.set(pos.x, cameraAnchorY, pos.z).add(this.cameraOffset);
      this.camera.position.lerp(this.tmpVec, 0.08);
      this.tmpVec.set(pos.x, cameraAnchorY, pos.z).add(this.cameraLookOffset);
      this.camera.lookAt(this.tmpVec);

      // Per-actor update first (so collected letters can hide before render).
      for (const actor of this.actors) actor.update(dt, t);

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
    // Avatars own continuous resources (e.g., the car's motor loop) —
    // give them a chance to tear down before we dispose meshes.
    this.player.dispose?.();
    // Biomes own scene-level resources (lights, fog, background) —
    // tear those down so consecutive mounts don't stack lights.
    this.disposeBiome?.();
    this.disposeBiome = null;
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
