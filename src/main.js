import "../src/styles/base.css";

import * as THREE from "three";
import { Timer } from "three";
import Stats from "three/examples/jsm/libs/stats.module.js";

import { createPhysicsWorld } from "./physics/physicsWorld.js";
import { createScene } from "./scenes/exampleScene.js";

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
};
// =============================================================

async function main() {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const canvasContainer = document.getElementById("threejs-canvas");
  canvasContainer.appendChild(renderer.domElement);

  // Scene + physics world, shared by everything below
  const scene = new THREE.Scene();
  const physicsWorld = createPhysicsWorld({
    gravity: [0, -CONFIG.gravityStrength, 0],
    debug: CONFIG.showPhysicsDebug,
  });
  await physicsWorld.init(scene);

  // Add the ground, stairs, platforms, boxes, etc.
  createScene(scene, physicsWorld);

  // The player: camera + controls + physics, all bundled together.
  //
  // `visual` controls what gets drawn at the player's location:
  //   'model'   -- a loaded 3D model (used below, a ghost)
  //   'capsule' -- the default plain capsule shape
  //   'none'    -- nothing drawn (e.g. first-person view)
  //
  // const player = createPlayerController(scene, physicsWorld, renderer.domElement, {
  //   initialPosition: [0, 4, 5],
  // });
  // physicsWorld.add(player);

  const player = createPlayerControlExtended(
    scene,
    physicsWorld,
    renderer.domElement,
    {
      initialPosition: [0, 4, 5],
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
    },
  );

  // Other visual options, for reference:
  //   visual: { type: "capsule" }   -- plain capsule
  //   visual: { type: "none" }      -- no mesh at all

  // const player = createFlowController(
  //   scene,
  //   physicsWorld,
  //   renderer.domElement,
  //   {
  //     initialPosition: [0, 4, 5],
  //     interpolate: true,
  //   },
  // );

  physicsWorld.add(player);

  // FPS stats box
  const stats = new Stats();
  if (CONFIG.showStats) {
    document.body.appendChild(stats.dom);
  }

  const timer = new Timer();

  function animate(timestamp) {
    requestAnimationFrame(animate);
    timer.update(timestamp);
    const deltaTime = timer.getDelta();

    // Step physics forward, get leftover time as an interpolation alpha
    const alpha = physicsWorld.step(deltaTime);

    // Move every mesh to match its physics body for this frame
    physicsWorld.updateMeshes(alpha);

    if (CONFIG.showStats) stats.update();
    renderer.render(scene, player.camera);
  }
  requestAnimationFrame(animate);

  window.addEventListener("resize", () => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    player.handleResize(width, height);
    renderer.setSize(width, height);
  });
}

main();
