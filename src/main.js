import "../src/styles/base.css";

import * as THREE from "three";
import { Timer } from "three";
import Stats from "three/examples/jsm/libs/stats.module.js";

import { createPhysicsWorld } from "./physics/physicsWorld.js";
import { SceneManager } from "./core/sceneManager.js";
import { getSceneBuilder } from "./scenes/levelGraph.js";

//import { createPlayerController } from "./core/playerController.js";
//import { createFlowController } from "./core/flowController.js";
import { createPlayerControlExtended } from "./core/playerControllerExtended.js";

// =============================================================
// SETTINGS — change these to customize the game
// =============================================================
const CONFIG = {
  // Show the little FPS box in the corner
  showStats: false,

  // Show the wireframe outlines around physics objects
  showPhysicsDebug: false,

  // How hard gravity pulls down. Bigger = falls faster
  gravityStrength: 9.81,

  // How fast the camera catches up to the player. Higher = snappier
  cameraFollowSpeed: 0.5,

  // How close/far the camera can zoom
  cameraMinDistance: 3,
  cameraMaxDistance: 12,

  // If the player's y position drops below this, they're teleported back
  // to the current scene's spawn point (catches falling through a gap or
  // off the edge of the world). Set lower than any scene's floor.
  fallThreshold: -20,

  // Which scene to load when the game starts. Must be a scene id known to
  // levelGraph.js ("sceneOne", "sceneTwo", or "sceneThree").
  startingScene: "sceneOne",
};
// =============================================================

// Builds the player: camera + controls + physics, all bundled together.
// Passed to SceneManager.loadScene() as `createPlayer` so it can be
// (re)built with whatever spawnPoint the active scene reports, and so a
// scene switch that doesn't set keepPlayer can rebuild it from scratch.
//
// `visual` controls what gets drawn at the player's location:
//   'model'   -- a loaded 3D model (used below, a ghost)
//   'capsule' -- the default plain capsule shape
//   'none'    -- nothing drawn (e.g. first-person view)
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
      // Scale/position/rotation to line the model up with the capsule
      scale: 1,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      castShadow: true,
      // Turns to face the direction the player is moving
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

// Other visual options, for reference:
//   visual: { type: "capsule" }   -- plain capsule
//   visual: { type: "none" }      -- no mesh at all

async function main() {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const canvasContainer = document.getElementById("threejs-canvas");
  canvasContainer.appendChild(renderer.domElement);

  // A single PhysicsWorld (and Rapier World) lives for the app's entire
  // lifetime -- SceneManager swaps its active THREE.Scene and clears its
  // managed objects between scenes rather than recreating either. init()
  // still needs some THREE.Scene to attach its debug-line mesh to; the
  // placeholder here is immediately replaced by SceneManager.loadScene().
  const physicsWorld = createPhysicsWorld({
    gravity: [0, -CONFIG.gravityStrength, 0],
    debug: CONFIG.showPhysicsDebug,
  });
  await physicsWorld.init(new THREE.Scene());

  const sceneManager = new SceneManager(physicsWorld, {
    fallThreshold: CONFIG.fallThreshold,
  });

  // Load the configured starting scene and spawn the player into it. Each
  // scene looks up where its own level switcher should lead via
  // levelGraph.js (see that file for the full sceneOne -> sceneTwo ->
  // sceneThree -> sceneOne routing), keyed off the `sceneId` builder arg
  // passed here -- none of the scene files import each other directly.
  const startId = CONFIG.startingScene;
  const startBuilder = getSceneBuilder(startId);

  await sceneManager.loadScene(startBuilder, {
    createPlayer: (scene, physicsWorld, spawnPoint) =>
      createPlayer(scene, physicsWorld, renderer.domElement, spawnPoint),
    builderArgs: { sceneId: startId },
  });

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
