// src/scenes/exampleScene.js
//
// Populates a scene with example level geometry: lighting, a reference
// grid, a staircase, two moving platforms, a static ground box, a few
// dynamic boxes, and a level switcher that sends the player to another
// scene. It's a one-shot builder rather than a stateful object -- it runs
// once against whatever `scene` and `physicsWorld` it's given and hands
// back references to what it created.
//
// physicsWorld is created and initialized by the caller and passed in
// here -- this module populates it, it doesn't own or step it.
//
// Follows the scene-builder contract used by SceneManager
// (src/core/sceneManager.js): returns a `spawnPoint` for where the player
// should be placed, and a `destroy()` that cleans up the plain scene-graph
// content this function added directly (lights, grid) rather than through
// physicsWorld.add(). Everything registered with physicsWorld -- the
// stairs, platforms, boxes, and the level switcher -- is torn down
// automatically by physicsWorld.clear() during a scene switch and doesn't
// need to be repeated in destroy().
//
// This module has no import-time knowledge of any other SCENE FILE --
// it never imports exampleSceneTwo.js or exampleSceneThree.js directly.
// It does import levelGraph.js, the single shared module that knows the
// full set of scenes and the order they switch between; this scene only
// needs to know its own id (see `sceneId` below, passed in as a builder
// arg by whoever loads it -- see main.js) to look up where its own level
// switcher should lead via levelGraph's getNextSceneId()/getSceneBuilder().
import * as THREE from "three";
import { Grid } from "@pmndrs/vanilla";

import { createPhysicsBox } from "../objects/createPhysicsBox.js";
import { createStairs } from "../objects/createStairs.js";
import { MovingPlatform } from "../objects/createMovingPlatform.js";
import { LevelSwitcher } from "../objects/createLevelSwitcher.js";
import { getNextSceneId, getSceneBuilder } from "./levelGraph.js";

export function createScene(scene, physicsWorld, { requestSwitch, sceneId = "sceneOne" } = {}) {
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambientLight);

  const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
  dirLight.position.set(10, 25, 10);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.set(2048, 2048);
  dirLight.shadow.camera.left = -28;
  dirLight.shadow.camera.right = 28;
  dirLight.shadow.camera.top = 28;
  dirLight.shadow.camera.bottom = -28;
  dirLight.shadow.camera.near = 0.5;
  dirLight.shadow.camera.far = 50;
  scene.add(dirLight);

  const grid = Grid({
    args: [30, 30],
    cellSize: 1,
    cellThickness: 1.3,
    cellColor: new THREE.Color("#444"),
    sectionSize: 5,
    sectionThickness: 1.8,
    sectionColor: new THREE.Color("#444"),
    fadeDistance: 100,
    fadeStrength: 20,
    followCamera: true,
  });

  grid.mesh.material.depthWrite = false;
  grid.mesh.position.y = 0.01;
  scene.add(grid.mesh);

  // A 15-step staircase ascending along +X
  createStairs(scene, physicsWorld, {
    position: [-5, 0, -5],
    stepCount: 15,
    stepWidth: 4,
    stepHeight: 0.25,
    stepDepth: 0.5,
    direction: Math.PI / 2,
  });

  // A platform touring a 3-stop loop, 2.5s per leg for the first two legs,
  // 1.5s for the return leg
  const platform = new MovingPlatform(scene, physicsWorld, {
    positions: [
      [10, 1, -5],
      [10, 4, -5],
      [10, 1, 5],
    ],
    durations: [2.5, 2.5, 1.5],
    size: [4, 0.5, 4],
  });
  physicsWorld.add(platform); // explicit -- this one follows the createPhysicsBox convention

  const platform2 = new MovingPlatform(scene, physicsWorld, {
    positions: [
      [5, 1, -5],
      [5, 8, -5],
    ],
    durations: [2.5, 2.5],
    size: [4, 0.5, 4],
  });
  physicsWorld.add(platform2); // explicit -- this one follows the createPhysicsBox convention

  // --- 1. Static Ground Box ---
  const groundBox = createPhysicsBox(scene, physicsWorld, {
    size: [30, 1, 30],
    position: [0, -0.5, 0],
    color: 0x22222e,
    isDynamic: false,
    friction: 0.8,
  });
  physicsWorld.add(groundBox);

  // --- 2. Dynamic Boxes ---
  const box1 = createPhysicsBox(scene, physicsWorld, {
    size: [1, 1, 1],
    position: [0, 2, 0],
    color: 0x2a9d8f,
    isDynamic: true,
  });
  physicsWorld.add(box1);

  const box2 = createPhysicsBox(scene, physicsWorld, {
    size: [1.2, 1.2, 1.2],
    position: [0, 5, 0],
    color: 0xe76f51,
    isDynamic: true,
    restitution: 0.6,
  });
  physicsWorld.add(box2);

  const box3 = createPhysicsBox(scene, physicsWorld, {
    size: [0.8, 0.8, 0.8],
    position: [0.2, 8, 0.1],
    color: 0xe07a5f,
    isDynamic: true,
  });
  physicsWorld.add(box3);

  // Sends the player to whichever scene levelGraph.js says comes after
  // this one. Placed at [12, 1, 8] -- away from this scene's own
  // spawnPoint (see the file header's placement note) so landing here
  // from another scene doesn't immediately trigger a switch back, and
  // clear of the staircase and both platforms so it stays physically
  // reachable. Only created when requestSwitch was actually supplied --
  // lets this scene still be loaded standalone (e.g. in isolation)
  // without needing the whole switching setup wired up.
  let switcher = null;
  if (requestSwitch) {
    const nextSceneId = getNextSceneId(sceneId);
    const nextSceneBuilder = getSceneBuilder(nextSceneId);
    switcher = new LevelSwitcher(scene, physicsWorld, {
      position: [12, 1, 8],
      triggerRadius: 1.2,
      color: 0x9b5de5,
      requestSwitch: () =>
        requestSwitch(nextSceneBuilder, {
          keepPlayer: true,
          builderArgs: { sceneId: nextSceneId },
        }),
    });
    physicsWorld.add(switcher);
  }

  // Cleans up the scene-graph content added directly above (lights, grid)
  // that physicsWorld never tracks and so wouldn't be caught by
  // physicsWorld.clear() during a scene switch.
  function destroy() {
    scene.remove(ambientLight);
    scene.remove(dirLight);
    scene.remove(grid.mesh);
    grid.mesh.geometry?.dispose();
    grid.mesh.material?.dispose();
  }

  return {
    grid,
    groundBox,
    boxes: [box1, box2, box3],
    switcher,
    spawnPoint: [0, 4, 5],
    destroy,
  };
}
