import * as THREE from "three";
import { buildAvatar, type PlayerHandles } from "./player";
import type { AvatarKind } from "../state/store";
import { buildWorld, type Obstacle } from "./world";
import { getBiome } from "./biomes";
import type { Biome } from "./biomes/types";
import { subscribeForcedTOD } from "./biomes/timeOfDay";
import { PlanetWalker, type PlanetSpec } from "./planet";
import { readInput } from "../input/useInput";

const PLAYER_RADIUS = 0.55;

// Engine — owns the renderer, scene, camera, and per-frame loop.
// Pure three.js, no R3F. React mounts it via a useEffect.

export type EngineEvents = {
  onPlayerPosition?: (pos: THREE.Vector3) => void;
  onTick?: (dt: number, t: number) => void;
  // iOS Safari aggressively kills WebGL on backgrounding / memory
  // pressure. Without context-loss handling the canvas freezes silently.
  // The host (Game.tsx) listens to surface a "tap to resume" overlay
  // and remount the engine, since restoring a fully populated Three.js
  // scene cleanly is harder than rebuilding it.
  onContextLost?: () => void;
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
  // Optional biome-supplied camera anchor. See the follow-camera block
  // in the tick loop.
  private cameraFocus: { x: number; y: number; z: number; zoom?: number } | null = null;
  private tmpVec = new THREE.Vector3();
  private disposed = false;

  // Avatar orientation working state. Each frame the engine composes
  // yaw (from the avatar) with a terrain-tilt quaternion (smoothed
  // below) onto group.quaternion, so the kid leans into slopes
  // instead of standing bolt upright on a rainbow arch.
  private currentTilt = new THREE.Quaternion();
  private tmpYawQuat = new THREE.Quaternion();
  private tmpTargetTilt = new THREE.Quaternion();
  private tmpNormal = new THREE.Vector3();
  private static readonly WORLD_UP = new THREE.Vector3(0, 1, 0);
  private static readonly ZERO_MOVE = { x: 0, y: 0 };

  // Game-mode hook: called every frame so modes can react to the player position.
  // The function decides whether anything happens; engine just calls it.
  tickHook?: (dt: number, t: number, playerPos: THREE.Vector3) => void;

  // Tracks which obstacles the player was overlapping last frame, so we
  // can fire the obstacle's onBump callback once on the rising edge of
  // a collision instead of every frame the player is wedged against it.
  private prevOverlap = new Set<Obstacle>();

  // Ballistic launch state (jungle volcano, etc). While set, the tick
  // loop flies the avatar along a parabolic arc instead of applying
  // input / collision / terrain-follow, and the camera anchor tracks
  // the flight height so the avatar stays in frame at the apex.
  private flight: {
    t: number;
    duration: number;
    fromX: number;
    fromZ: number;
    fromGroundY: number;
    toX: number;
    toZ: number;
    toGroundY: number;
    peakY: number;
    spin: number;
    flips: number;
    onLand?: () => void;
  } | null = null;
  private tmpTumble = new THREE.Quaternion();
  private static readonly TUMBLE_AXIS = new THREE.Vector3(1, 0, 0);

  // Off-world travel. A space flight is a free 3D arc between two
  // points — unlike `flight` above it is not tied to the ground
  // plane at either end, because one end is a point in orbit. When it
  // arrives it either hands the avatar to a PlanetWalker (outbound)
  // or drops it back into the flat world (homebound).
  private spaceFlight: {
    t: number;
    duration: number;
    from: THREE.Vector3;
    ctrl: THREE.Vector3;
    to: THREE.Vector3;
    flips: number;
    spin: number;
    onArrive?: () => void;
    // Set on the outbound leg: the sphere to start walking on landing.
    arriveOn?: { spec: PlanetSpec; landDir: THREE.Vector3; faceHint?: THREE.Vector3 };
    // How hard the camera chases. See the camera block.
    camLerp?: number;
    // Consumed on the first frame: place the camera outright instead
    // of easing it in. Used when the avatar arrives somewhere by
    // teleport rather than by travelling there, where easing would
    // mean a long swoop across the map from wherever it used to be.
    snap?: boolean;
  } | null = null;
  // While set, the flat pipeline is replaced entirely by a walk
  // around a sphere. See planet.ts.
  private planet: PlanetWalker | null = null;
  // Camera up-vector, eased rather than snapped so the horizon rolls
  // over smoothly when the avatar leaves the flat world for a sphere
  // (and back again).
  private camUp = new THREE.Vector3(0, 1, 0);
  private tmpPoint = new THREE.Vector3();
  private tmpLook = new THREE.Vector3();
  private tmpUpTarget = new THREE.Vector3();
  private tmpAxis = new THREE.Vector3();
  // Touchdown squash-and-stretch timer (seconds remaining). Applied to
  // the player group's scale for a beat after landing so the arrival
  // reads as an impact instead of a freeze-frame stop.
  private landSquash = 0;
  private static readonly LAND_SQUASH_DURATION = 0.38;

  // True whenever the avatar is not under the kid's control on the
  // ground. Games use it to hold off letter pickups mid-arc; walking
  // on a planet is deliberately NOT included, because there the kid
  // is very much driving.
  get inFlight(): boolean {
    return this.flight !== null || this.spaceFlight !== null;
  }

  get onPlanet(): boolean {
    return this.planet !== null;
  }

  // Fling the avatar to (x, z) on a ballistic arc. Ignored if a flight
  // is already running. Ground heights at both ends come from the
  // biome's terrain sampler so a launch out of a crater lands flush on
  // flat ground (and vice versa).
  launchPlayer(
    to: { x: number; z: number },
    opts: { duration?: number; peakY?: number; onLand?: () => void } = {}
  ): void {
    if (this.flight) return;
    const pp = this.player.group.position;
    const sample = this.terrainHeight;
    const duration = opts.duration ?? 1.6;
    const peakY = opts.peakY ?? 12;
    // Whole turns, so touchdown lands on an exact multiple of 2π and
    // the avatar is never left tilted. The rate climbs with height as
    // well as time: a short hop keeps its lazy couple of turns (1.8s
    // at peak 15 still gives exactly 2), while a launch into space is
    // a proper tumble rather than two slow rolls over five seconds.
    const flips = Math.max(1, Math.round(duration * (1.1 + peakY / 100)));
    this.flight = {
      t: 0,
      duration,
      fromX: pp.x,
      fromZ: pp.z,
      fromGroundY: sample ? sample(pp.x, pp.z) : 0,
      toX: to.x,
      toZ: to.z,
      toGroundY: sample ? sample(to.x, to.z) : 0,
      peakY,
      spin: 0,
      flips,
      onLand: opts.onLand,
    };
  }

  // Throw the avatar off the flat world and set it down on a sphere.
  // The arc is a quadratic Bezier so it can bow out sideways as well
  // as up — a straight climb to something 300 units away reads as a
  // dull elevator ride, and the bow keeps the destination in frame
  // the whole way.
  launchToPlanet(
    spec: PlanetSpec,
    opts: {
      duration?: number;
      // Where on the sphere to touch down, as a unit direction from
      // its centre. Defaults to the north pole, which is also the one
      // landing where the planet camera and the flat camera agree
      // exactly, so the handover is invisible.
      landDir?: THREE.Vector3;
      // Which way the avatar should be looking on arrival.
      faceHint?: THREE.Vector3;
      // How far the arc bows above the straight line, in units.
      arcHeight?: number;
      onArrive?: () => void;
    } = {}
  ): void {
    if (this.spaceFlight || this.planet) return;
    this.flight = null;
    const landDir = (opts.landDir ?? new THREE.Vector3(0, 1, 0)).clone().normalize();
    const to = spec.center
      .clone()
      .addScaledVector(landDir, spec.radius + (spec.hover ?? 0));
    const from = this.player.group.position.clone();
    const duration = opts.duration ?? 5.6;
    const arcHeight = opts.arcHeight ?? from.distanceTo(to) * 0.35;
    // Control point on the perpendicular bisector, lifted along world
    // up. At t=0.5 a quadratic Bezier sits halfway between the
    // midpoint and the control point, so the actual apex is half of
    // arcHeight — doubling here keeps the parameter meaning what its
    // name says.
    const ctrl = from.clone().lerp(to, 0.5).add(new THREE.Vector3(0, arcHeight * 2, 0));
    this.spaceFlight = {
      t: 0,
      duration,
      from,
      ctrl,
      to,
      flips: Math.max(2, Math.round(duration * 1.1)),
      spin: 0,
      onArrive: opts.onArrive,
      arriveOn: { spec, landDir, faceHint: opts.faceHint },
    };
  }

  // Leave the planet and come down out of the sky at (x, z).
  //
  // This is a cut, not a journey. An earlier version flew an arc all
  // the way home from wherever on the sphere the avatar happened to
  // be standing, which meant the framing — and, if the exit was on the
  // far side, whether the path went straight through the star —
  // depended entirely on where you left from. Nothing about that was
  // predictable. Dropping out of the sky above the destination is the
  // same distance every time, from the same angle, with the world the
  // right way up from the first frame.
  //
  // The caller is expected to have covered the cut: hide the avatar,
  // let the thing it went into be seen swallowing it, then call this.
  leavePlanet(
    to: { x: number; z: number },
    opts: { duration?: number; dropFrom?: number; onLand?: () => void } = {}
  ): void {
    if (!this.planet || this.spaceFlight) return;
    const landY = this.terrainHeight ? this.terrainHeight(to.x, to.z) : 0;
    const dest = new THREE.Vector3(to.x, landY, to.z);
    const duration = opts.duration ?? 2.6;
    const dropFrom = opts.dropFrom ?? 150;
    // Offset sideways so it falls at an angle rather than dead
    // vertically — the camera has nothing to read from a plumb line.
    const lean = 22;
    const from = new THREE.Vector3(to.x - lean * 0.4, dropFrom, to.z + lean);
    this.planet = null;
    this.player.group.position.copy(from);
    this.spaceFlight = {
      t: 0,
      duration,
      from,
      // Control point on the start means the quadratic collapses to
      // `from + (to - from) * t^2` — a straight line eased like
      // gravity, slow off the top and fast into the water.
      ctrl: from.clone(),
      to: dest,
      flips: 2,
      spin: 0,
      onArrive: opts.onLand,
      // Chases harder than the usual follow. A gravity fall outruns
      // the default easing badly enough that the camera is still
      // twenty-odd units back at the moment of the splash, and then
      // swoops in to catch up afterwards.
      camLerp: 0.16,
      snap: true,
    };
  }

  // WebGL context-loss bookkeeping. iOS Safari silently kills the GL
  // context when the tab backgrounds or memory pressure spikes; without
  // listeners the canvas freezes with no recovery path. We pause the
  // tick loop on loss and notify the host so it can remount.
  private onContextLostBound: ((e: Event) => void) | null = null;
  private onContextRestoredBound: (() => void) | null = null;
  private contextLost = false;

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
  // Also re-run when reapplyBiomeScene() swaps the time-of-day mood
  // mid-session: tear down the old lights/sky/fog, then re-call
  // applyScene to install the new mood.
  private disposeBiome: (() => void) | null = null;
  private biome: Biome | null = null;
  private unsubscribeTOD: (() => void) | null = null;
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
  // the orthographic shadow frustum (~90 units across) always covers
  // them. Without this the player's shadow gets clipped at a hard
  // rectangle once they wander past the frustum half-width from origin.
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
    this.biome = biome;
    this.applyBiomeScene();
    // Live-mood swaps: when a dev forces a different time-of-day via
    // setForcedTOD(), re-apply the biome's scene so the new lighting
    // takes effect without a page reload.
    this.unsubscribeTOD = subscribeForcedTOD(() => this.reapplyBiomeScene());

    // World + player. The biome's tick callbacks may want to read the
    // player position (e.g. moon aliens that wave when bumped) — pass
    // a getter so they can null-check during teardown. Biomes that
    // deform the ground can also register a height sampler we read in
    // the per-frame loop so the avatar dips into depressions.
    const world = buildWorld(
      biome,
      () => this.player?.group.position ?? null,
      (to, opts) => this.launchPlayer(to, opts),
      (visible) => {
        if (this.player) this.player.group.visible = visible;
      },
      (focus) => {
        this.cameraFocus = focus;
      },
      (planet, opts) => this.launchToPlanet(planet, opts),
      (to, opts) => this.leavePlanet(to, opts)
    );
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

    // Wire every shadow-casting directional light the biome added up
    // to follow the player. Re-run on biome-scene re-apply so a
    // mood swap doesn't leave us holding a reference to a disposed sun.
    this.collectShadowSuns();

    this.clock = new THREE.Clock();

    // Sizing — listen to both window resize and parent ResizeObserver.
    this.onResizeBound = this.onResize.bind(this);
    window.addEventListener("resize", this.onResizeBound);
    this.resizeObserver = new ResizeObserver(this.onResizeBound);
    if (canvas.parentElement) this.resizeObserver.observe(canvas.parentElement);
    this.onResize();

    // WebGL context-loss handling. preventDefault() is what tells the
    // browser we'll restore manually — without it the canvas is
    // permanently dead. We pause the tick loop and let the host remount
    // a fresh Engine; restoring a populated scene in place is more
    // fragile than rebuilding it.
    this.onContextLostBound = (e: Event) => {
      e.preventDefault();
      this.contextLost = true;
      cancelAnimationFrame(this.rafId);
      this.events.onContextLost?.();
    };
    this.onContextRestoredBound = () => {
      // Intentionally no-op: the host's onContextLost handler tears
      // this engine down and mounts a new one. If a host wants in-place
      // restore later, it can swap that strategy in here.
    };
    canvas.addEventListener("webglcontextlost", this.onContextLostBound, false);
    canvas.addEventListener("webglcontextrestored", this.onContextRestoredBound, false);

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
      // If the GL context was lost (iOS background / memory pressure),
      // the tick loop must not call renderer.render — that would throw
      // on a dead context. We've already fired onContextLost so the
      // host is responsible for remounting.
      if (this.contextLost) return;
      const dt = Math.min(this.clock.getDelta(), 0.1);
      const t = this.clock.elapsedTime;

      // Snapshot pre-update XZ so the walkable clamp at the end of the
      // tick has a "last known good" to revert to if the avatar's
      // movement would step off a non-contiguous biome's walkable
      // surface (e.g. into the void between sky islands).
      const pp = this.player.group.position;
      const prevX = pp.x;
      const prevZ = pp.z;

      // Ballistic flight (volcano launch etc.) replaces the whole
      // input → collision → terrain pipeline while airborne: position
      // comes from the arc, and obstacles/boundary/walkable clamps are
      // skipped because the avatar is above all of them. The avatar
      // still gets a zero-input update so idle animation + engine
      // audio keep running.
      const spaceFlight = this.spaceFlight;
      const planet = this.planet;
      const flight = this.flight;
      if (spaceFlight) {
        // Free 3D arc between two points in space. Quadratic Bezier
        // rather than the ground flight's parabola, because neither
        // end is on the ground plane and the path has to bow toward
        // wherever the destination happens to be.
        this.player.update(dt, Engine.ZERO_MOVE);
        spaceFlight.t += dt;
        const k = Math.min(1, spaceFlight.t / spaceFlight.duration);
        const inv = 1 - k;
        pp.set(0, 0, 0)
          .addScaledVector(spaceFlight.from, inv * inv)
          .addScaledVector(spaceFlight.ctrl, 2 * inv * k)
          .addScaledVector(spaceFlight.to, k * k);
        spaceFlight.spin = Math.PI * 2 * spaceFlight.flips * k;
        if (k >= 1) {
          this.spaceFlight = null;
          const arriveOn = spaceFlight.arriveOn;
          if (arriveOn) {
            this.planet = new PlanetWalker(arriveOn.spec, arriveOn.landDir, arriveOn.faceHint);
          }
          this.landSquash = Engine.LAND_SQUASH_DURATION;
          spaceFlight.onArrive?.();
        }
      } else if (planet) {
        // Walking a sphere. The avatar still moves itself in flat
        // coordinates — we read back the delta it applied to x/z this
        // frame (prevX/prevZ hold the surface point we wrote last
        // frame) and walk that along the matching great circle. Its
        // y is its own bob, which becomes the lift above the surface.
        const input = readInput();
        this.player.update(dt, input.move);
        const lift = pp.y;
        planet.step(pp.x - prevX, pp.z - prevZ);
        planet.tick(dt);
        planet.point(pp, lift);
      } else if (flight) {
        this.player.update(dt, Engine.ZERO_MOVE);
        flight.t += dt;
        const k = Math.min(1, flight.t / flight.duration);
        pp.x = flight.fromX + (flight.toX - flight.fromX) * k;
        pp.z = flight.fromZ + (flight.toZ - flight.fromZ) * k;
        const baseY = flight.fromGroundY + (flight.toGroundY - flight.fromGroundY) * k;
        // Parabolic arc: peaks at k=0.5, zero at both ends. Ground Y
        // is lerped underneath so crater-rim → flat-ground flights
        // stay smooth.
        pp.y = baseY + flight.peakY * 4 * k * (1 - k);
        // Whole front-flips across the flight, so touchdown lands on an
        // exact multiple of 2π and the avatar is never left tilted.
        flight.spin = Math.PI * 2 * flight.flips * k;
        if (k >= 1) {
          this.flight = null;
          this.landSquash = Engine.LAND_SQUASH_DURATION;
          flight.onLand?.();
        }
      } else {

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

      } // end grounded (non-flight) branch

      // Avatar orientation — compose yaw (from the avatar) with a
      // terrain-tilt quaternion that aligns the avatar's local +Y to
      // the ground normal. We sample the height field with a small
      // finite-difference stencil to estimate the gradient, fall back
      // to the player's height for off-surface samples (so the void
      // edge of a sky island doesn't yank the avatar sideways), and
      // slerp toward the target so slope discontinuities don't snap.
      if (planet) {
        // On a sphere the "tilt" is the whole tangent frame, so the
        // planet composes yaw and up in one go.
        planet.orientation(this.player.group.quaternion, this.player.facing());
        this.currentTilt.identity();
      } else {
      this.tmpYawQuat.setFromAxisAngle(Engine.WORLD_UP, this.player.facing());
      this.tmpTargetTilt.identity();
      if (!this.flight && !this.spaceFlight && this.terrainHeight && this.player.terrainAlign !== false) {
        const sample = this.terrainHeight;
        const walkable = this.isWalkable;
        const eps = 0.35;
        const here = sample(pp.x, pp.z);
        const safe = (x: number, z: number): number => {
          if (walkable && !walkable(x, z)) return here;
          const h = sample(x, z);
          // Cap the apparent step against pathological gradients
          // (e.g. a corridor sample that briefly exits the walk
          // surface) so a single bad sample can't yank the tilt.
          if (Math.abs(h - here) > 1.5) return here;
          return h;
        };
        const dhdx = (safe(pp.x + eps, pp.z) - safe(pp.x - eps, pp.z)) / (2 * eps);
        const dhdz = (safe(pp.x, pp.z + eps) - safe(pp.x, pp.z - eps)) / (2 * eps);
        this.tmpNormal.set(-dhdx, 1, -dhdz).normalize();
        this.tmpTargetTilt.setFromUnitVectors(Engine.WORLD_UP, this.tmpNormal);
      }
      // Smooth tilt across frames; yaw remains immediate because the
      // avatar already lerps its own facing internally.
      this.currentTilt.slerp(this.tmpTargetTilt, 0.2);
      // Order matters: yaw first (in world frame), then tilt — this
      // leaves local +Y along the normal and local +Z along the
      // projection of the facing direction onto the slope plane.
      this.player.group.quaternion.copy(this.currentTilt).multiply(this.tmpYawQuat);
      // Mid-flight tumble — front-flips about the avatar's local X so
      // the launch reads as a joyful somersault rather than a frozen
      // statue sliding along an arc.
      const tumbling = this.flight ?? this.spaceFlight;
      if (tumbling) {
        this.tmpTumble.setFromAxisAngle(Engine.TUMBLE_AXIS, tumbling.spin);
        this.player.group.quaternion.multiply(this.tmpTumble);
      }
      } // end flat-world orientation
      // Touchdown squash-and-stretch: strongest the frame we land,
      // easing back to rest. Pure scale, so it composes with whatever
      // pose the avatar is in.
      if (this.landSquash > 0) {
        this.landSquash = Math.max(0, this.landSquash - dt);
        const k = 1 - this.landSquash / Engine.LAND_SQUASH_DURATION;
        const squash = (1 - k) * (1 - k);
        this.player.group.scale.set(1 + 0.22 * squash, 1 - 0.3 * squash, 1 + 0.22 * squash);
        if (this.landSquash === 0) this.player.group.scale.set(1, 1, 1);
      }

      // Sun follow — keep each shadow camera centered on the player so
      // the directional-light frustum doesn't clip the player's shadow
      // once they walk past its bounds. We snap the target to ground
      // level (y=0) so the angle of the shadow stays consistent.
      for (const s of this.shadowSuns) {
        // Ground level normally; the avatar's own height once it is
        // off the flat world, or the shadow frustum sits hundreds of
        // units below whatever it is meant to be covering.
        s.light.target.position.set(pp.x, planet || this.spaceFlight ? pp.y - 1 : 0, pp.z);
        s.light.position.copy(s.light.target.position).add(s.offset);
        s.light.target.updateMatrixWorld();
      }

      // Smooth follow camera. We follow only the XZ plane — the player's
      // Y oscillates from idle bob, but a camera that bobs with them
      // makes the whole world feel like it's nodding. Anchor Y to the
      // terrain so the camera dips into craters along with the player.
      const pos = this.player.position();
      // A biome can take the camera off the avatar and park it on a
      // fixed world point — used when the avatar is out of sight and
      // the interesting thing is elsewhere (inside the sea-cave
      // volcano, waiting to be launched out of the crater). The 0.08
      // lerp below carries the camera over and back smoothly, so
      // setting and clearing a focus needs no easing of its own.
      const focus = this.cameraFocus;
      const focusZoom = focus?.zoom ?? 1;
      // While airborne, anchor the camera to (most of) the flight
      // height so the avatar stays in frame at the apex; the 0.08
      // position lerp below smooths both the climb and the settle
      // back to ground level after touchdown.
      const anchorX = focus ? focus.x : pos.x;
      const anchorZ = focus ? focus.z : pos.z;
      const cameraAnchorY = focus
        ? focus.y
        : this.flight || this.spaceFlight
          ? // Trail a fixed distance below the avatar rather than a
            // fraction of its height. The two agree exactly up to 15
            // units (a normal volcano launch), but on a mega-launch a
            // fraction leaves the camera hundreds of units low and the
            // avatar sails off the top of the frame.
            pos.y - Math.min(3, pos.y * 0.2)
          : this.terrainHeight
            ? this.terrainHeight(pos.x, pos.z)
            : 0;
      if (planet) {
        // Same offset, read in the tangent frame instead of world
        // axes — so the framing is identical to the flat game's, and
        // at the pole of a planet it is literally the same arithmetic.
        planet.cameraPoint(this.tmpVec, this.cameraOffset);
        this.camera.position.lerp(this.tmpVec, 0.08);
        planet
          .point(this.tmpLook, 0)
          .addScaledVector(planet.dir, this.cameraLookOffset.y);
        this.tmpUpTarget.copy(planet.dir);
      } else {
        this.tmpVec
          .set(anchorX, cameraAnchorY, anchorZ)
          .addScaledVector(this.cameraOffset, focusZoom);
        // A flight that begins with a teleport has nothing to ease
        // from: the camera's last position was next to a star three
        // hundred units away, and lerping toward the new one would
        // fly it across the sky for two seconds while the avatar
        // falls. Place it, and let the same frame put the world back
        // the right way up.
        if (spaceFlight?.snap) {
          spaceFlight.snap = false;
          this.camera.position.copy(this.tmpVec);
          this.camUp.copy(Engine.WORLD_UP);
        } else {
          this.camera.position.lerp(this.tmpVec, spaceFlight?.camLerp ?? 0.08);
        }
        this.tmpLook.set(anchorX, cameraAnchorY, anchorZ).add(this.cameraLookOffset);
        this.tmpUpTarget.copy(Engine.WORLD_UP);
      }
      // Which way is up depends on which world we are standing on, so
      // it has to swing over when the avatar leaves one for the other.
      // On a planet it tracks the surface normal exactly (any lag
      // there reads as a tilted horizon); everywhere else it eases
      // back to world up at a capped rate, which is what carries the
      // camera through the ride home.
      if (planet) {
        this.camUp.copy(this.tmpUpTarget);
      } else {
        const angle = this.camUp.angleTo(this.tmpUpTarget);
        if (angle > 1e-4) {
          this.tmpAxis.crossVectors(this.camUp, this.tmpUpTarget);
          if (this.tmpAxis.lengthSq() < 1e-10) {
            // Exactly upside down — any perpendicular gets us moving.
            this.tmpAxis.set(1, 0, 0).cross(this.camUp);
            if (this.tmpAxis.lengthSq() < 1e-10) this.tmpAxis.set(0, 0, 1).cross(this.camUp);
          }
          this.camUp.applyAxisAngle(this.tmpAxis.normalize(), Math.min(angle, 1.4 * dt));
        }
      }
      this.camera.up.copy(this.camUp);
      this.camera.lookAt(this.tmpLook);

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

  // Merge instead of replace. Earlier this overwrote this.events
  // wholesale, which made constructor-only callbacks (notably
  // onContextLost) get wiped the first time a host re-keyed an
  // ergonomic callback like onPlayerPosition. Partial<> here lets
  // hosts update one key at a time without having to re-pass
  // every other event they previously registered.
  setEvents(events: Partial<EngineEvents>) {
    this.events = { ...this.events, ...events };
  }

  // Install the active biome's lights / sky / fog. Safe to call on a
  // fresh engine (constructor) or to swap in a new mood mid-game (the
  // dev TOD picker calls reapplyBiomeScene which composes both halves).
  private applyBiomeScene() {
    if (!this.biome) return;
    this.disposeBiome = this.biome.applyScene(this.scene);
  }

  // Re-roll and re-install the biome's scene without rebuilding world
  // props. Used by the dev TOD picker so a kid can preview each mood
  // without losing their place. Tears down old biome lights, re-adds
  // fresh ones, then re-discovers shadow-casting suns so the per-frame
  // shadow-follow loop tracks the new lights instead of disposed ones.
  reapplyBiomeScene() {
    if (!this.biome) return;
    this.disposeBiome?.();
    this.disposeBiome = null;
    this.applyBiomeScene();
    this.collectShadowSuns();
  }

  // Walk the scene and cache every shadow-casting directional light so
  // the per-frame loop can keep their orthographic frustums centred on
  // the player. Called from the constructor after the biome is applied
  // and again whenever the biome scene is re-applied.
  private collectShadowSuns() {
    this.shadowSuns = [];
    this.scene.traverse((obj) => {
      if (obj instanceof THREE.DirectionalLight && obj.castShadow) {
        if (!obj.target.parent) this.scene.add(obj.target);
        const offset = obj.position.clone().sub(obj.target.position);
        this.shadowSuns.push({ light: obj, offset });
      }
    });
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.rafId);
    window.removeEventListener("resize", this.onResizeBound);
    this.resizeObserver.disconnect();
    if (this.onContextLostBound) {
      this.renderer.domElement.removeEventListener("webglcontextlost", this.onContextLostBound);
      this.onContextLostBound = null;
    }
    if (this.onContextRestoredBound) {
      this.renderer.domElement.removeEventListener("webglcontextrestored", this.onContextRestoredBound);
      this.onContextRestoredBound = null;
    }
    this.unsubscribeTOD?.();
    this.unsubscribeTOD = null;
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
