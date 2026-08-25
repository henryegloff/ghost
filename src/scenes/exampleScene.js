// src/scenes/exampleScene.js
//
// Kept as a plain function: it's a one-shot "populate this scene" script,
// not a stateful entity with its own ongoing lifecycle -- it runs once and
// hands back a few references for convenience.
import * as THREE from "three";
import { Grid } from "@pmndrs/vanilla";

import { createPhysicsBox } from "../objects/createPhysicsBox.js";

import { createStairs } from "../objects/createStairs.js";
import { MovingPlatform } from "../objects/createMovingPlatform.js";

// physicsWorld is created and initialized by main.js and passed in here --
// this module just populates it, it doesn't own the world or step it.
export function createScene(scene, physicsWorld) {
  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
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

  return {
    grid,
    groundBox,
    boxes: [box1, box2, box3],
  };
}
