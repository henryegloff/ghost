import "../src/styles/base.css";

import * as THREE from "three";
import { Timer } from "three";
import Stats from "three/examples/jsm/libs/stats.module.js";
import { createPhysicsWorld } from "./physics/physicsWorld.js";
import { SceneManager } from "./core/sceneManager.js";
import { getSceneBuilder } from "./scenes/levelGraph.js";
import { createLoadingScreen } from "./core/loadingScreen.js";
import { preloadAll, onProgress } from "./core/assetLoader.js";
import { PLAYER_ASSETS, SCENE_ASSETS } from "./scenes/assetManifest.js";
import { createPlayerControlExtended } from "./core/playerControllerExtended.js";

const CONFIG = {
  showStats: false,
  showPhysicsDebug: false,
  gravityStrength: 9.81,
  cameraFollowSpeed: 0.5,
  cameraMinDistance: 2,
  cameraMaxDistance: 60,
  fallThreshold: -20,
  startingScene: "sceneOne",
};

// Create Player
// type (model, capsule mesh or no mesh)

function createPlayer(scene, physicsWorld, domElement, spawnPoint) {
  return createPlayerControlExtended(scene, physicsWorld, domElement, {
    initialPosition: spawnPoint,
    cameraOffset: [0, 2, 3.5],
    minDistance: CONFIG.cameraMinDistance,
    maxDistance: CONFIG.cameraMaxDistance,
    followLerp: CONFIG.cameraFollowSpeed,
    visual: {
      type: "model",
      path: "/models/ghost_4.03.glb",
      scale: 1,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      castShadow: true,
      facing: {
        turnSpeed: 10, // radians/sec
        forward: [0, 0, -1], // flip to [0,0,1] if the model faces backwards
      },
      // Gentle floating bob, since ghosts shouldn't plant their feet
      hover: {
        enabled: true,
        amplitude: 0.18, // bob distance
        frequency: 0.55, // bob speed
        sway: 0.08, // tilt amount
        swayFrequency: 0.4,
      },
    },
  });
}

async function main() {
  const loadingScreen = createLoadingScreen();
  loadingScreen.show();

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const canvasContainer = document.getElementById("threejs-canvas");
  canvasContainer.appendChild(renderer.domElement);

  const physicsWorld = createPhysicsWorld({
    gravity: [0, -CONFIG.gravityStrength, 0],
    debug: CONFIG.showPhysicsDebug,
  });
  await physicsWorld.init(new THREE.Scene());

  const sceneManager = new SceneManager(physicsWorld, {
    fallThreshold: CONFIG.fallThreshold,
  });

  const startId = CONFIG.startingScene;
  const startBuilder = getSceneBuilder(startId);

  // BOOT SEQUENCE, PART 1: block only on what's needed to actually start
  // playing -- the player's own model plus whatever the starting scene
  // itself needs (see assetManifest.js). Everything else preloads in the
  // background after gameplay begins (part 2, below the render loop).
  //
  // This is also what actually fixes intermittent "unreachable" crashes
  // that could happen when switching into a scene whose GLB assets
  // hadn't loaded yet: previously that fetch happened live, in the
  // middle of the switch, with physicsWorld.step() still running every
  // frame against a half-built scene for however long it took. Once an
  // asset is preloaded, createPhysicsGLB.js's loader resolves it
  // instantly from cache instead, so a switch into an already-preloaded
  // scene collapses back to being effectively synchronous. See
  // sceneManager.js and createPhysicsGLB.js for more on why that gap
  // was a problem in the first place.
  const startingAssets = [...PLAYER_ASSETS, ...(SCENE_ASSETS[startId] ?? [])];

  const unsubscribeProgress = onProgress(({ loaded, total }) => {
    if (total > 0) {
      loadingScreen.setProgress(loaded / total);
      loadingScreen.setLabel(`Loading assets (${loaded}/${total})`);
    }
  });

  const startResults = await preloadAll(startingAssets);
  unsubscribeProgress();

  for (const { url, status, error } of startResults) {
    if (status === "rejected") {
      console.warn(
        `main.js: failed to preload "${url}" -- continuing without it.`,
        error,
      );
    }
  }

  // Load the configured starting scene and spawn the player into it. Each
  // scene looks up where its own level switcher should lead via
  // levelGraph.js (see that file for the full sceneOne -> sceneTwo ->
  // sceneThree -> sceneOne routing), keyed off the `sceneId` builder arg
  // passed here -- none of the scene files import each other directly.
  // Its own GLB loads (if any) resolve instantly now, from the cache
  // just populated above.
  await sceneManager.loadScene(startBuilder, {
    createPlayer: (scene, physicsWorld, spawnPoint) =>
      createPlayer(scene, physicsWorld, renderer.domElement, spawnPoint),
    builderArgs: { sceneId: startId },
  });

  loadingScreen.hide();

  // FPS stats box
  const stats = new Stats();
  if (CONFIG.showStats) {
    document.body.appendChild(stats.dom);
  }

  const timer = new Timer();

  // Rapier's WASM module is a module-level singleton -- re-running
  // main() via Vite's HMR (e.g. after saving a file while the game is
  // already open) creates a new RAPIER.World() while the previous
  // requestAnimationFrame loop, still holding stale closures over the
  // old world/player/bodies, keeps running in the background. Any call
  // into a body from that orphaned world then fails, since the WASM
  // memory it was reading from has since been reinitialized. `stopped`
  // guards against that: it's flipped by the HMR dispose hook below, and
  // checked at the top of every frame so the old loop stops calling into
  // Rapier as soon as a hot reload starts a new instance rather than
  // continuing to run alongside it.
  let stopped = false;

  function animate(timestamp) {
    if (stopped) return;
    requestAnimationFrame(animate);
    timer.update(timestamp);
    const deltaTime = timer.getDelta();

    // Step physics forward, get leftover time as an interpolation alpha
    const alpha = physicsWorld.step(deltaTime);

    // Move every mesh to match its physics body for this frame
    physicsWorld.updateMeshes(alpha);

    // Perform any scene switch requested during this step (e.g. by a
    // LevelSwitcher the player just walked into). Deliberately called
    // after step()/updateMeshes() have both finished with the current
    // scene's objects for this frame -- see sceneManager.js for why a
    // switch can't safely happen mid-step.
    sceneManager.update();

    if (CONFIG.showStats) stats.update();
    renderer.render(sceneManager.scene, sceneManager.player.camera);
  }
  requestAnimationFrame(animate);

  // BOOT SEQUENCE, PART 2: now that the player is already in the starting
  // scene and the game is running, keep preloading every other scene's
  // assets in the background -- non-blocking, and not awaited here. By
  // the time the player reaches a LevelSwitcher into one of these scenes,
  // its assets should already be cached (see PART 1's comment above for
  // why that matters).
  const backgroundAssets = Object.entries(SCENE_ASSETS)
    .filter(([id]) => id !== startId)
    .flatMap(([, assets]) => assets);

  preloadAll(backgroundAssets).then((results) => {
    for (const { url, status, error } of results) {
      if (status === "rejected") {
        console.warn(`main.js: background preload of "${url}" failed.`, error);
      }
    }
  });

  function handleResize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    sceneManager.player.handleResize(width, height);
    renderer.setSize(width, height);
  }
  window.addEventListener("resize", handleResize);

  // Vite HMR cleanup: on a hot reload of this module, stop the old loop
  // and release its resources before the new main() runs, instead of
  // leaving it running alongside a freshly re-initialized Rapier world.
  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      stopped = true;
      window.removeEventListener("resize", handleResize);
      loadingScreen.destroy();
      // Best-effort: the old Rapier world's WASM state may already be
      // unreachable by the time this runs, so a failure here shouldn't
      // block the rest of teardown.
      try {
        sceneManager.destroy();
      } catch (err) {
        console.warn("SceneManager teardown during HMR dispose failed:", err);
      }
      renderer.dispose();
      canvasContainer.removeChild(renderer.domElement);
    });
  }
}

main();
