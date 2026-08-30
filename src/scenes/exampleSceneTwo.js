import * as THREE from "three";
import { Grid } from "@pmndrs/vanilla";
import { createPhysicsBox } from "../objects/createPhysicsBox.js";
import { createStairs } from "../objects/createStairs.js";
import { MovingPlatform } from "../objects/createMovingPlatform.js";
import { LevelSwitcher } from "../objects/createLevelSwitcher.js";
import { getNextSceneId, getSceneBuilder } from "./levelGraph.js";

export function createSceneTwo(
  scene,
  physicsWorld,
  { requestSwitch, sceneId = "sceneTwo" } = {},
) {
  const ambientLight = new THREE.AmbientLight(0x88a9ff, 0.5);
  scene.add(ambientLight);

  const dirLight = new THREE.DirectionalLight(0xbcd4ff, 1.0);
  dirLight.position.set(-12, 20, 8);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.set(2048, 2048);
  dirLight.shadow.camera.left = -20;
  dirLight.shadow.camera.right = 20;
  dirLight.shadow.camera.top = 20;
  dirLight.shadow.camera.bottom = -20;
  dirLight.shadow.camera.near = 0.5;
  dirLight.shadow.camera.far = 40;
  scene.add(dirLight);

  const grid = Grid({
    args: [20, 20],
    cellSize: 1,
    cellThickness: 1.3,
    cellColor: new THREE.Color("#2a2a44"),
    sectionSize: 5,
    sectionThickness: 1.8,
    sectionColor: new THREE.Color("#2a2a44"),
    fadeDistance: 80,
    fadeStrength: 20,
    followCamera: true,
  });

  grid.mesh.material.depthWrite = false;
  grid.mesh.position.y = 0.01;
  scene.add(grid.mesh);

  // A sunken circular-ish arena floor, built from a single flat box
  // rather than the staircase-heavy layout of exampleScene.js.
  const floor = createPhysicsBox(scene, physicsWorld, {
    size: [20, 1, 20],
    position: [0, -0.5, 0],
    color: 0x1b1b2f,
    isDynamic: false,
    friction: 0.8,
  });
  physicsWorld.add(floor);

  createStairs(scene, physicsWorld, {
    position: [-5, 0, -5],
    stepCount: 15,
    stepWidth: 4,
    stepHeight: 0.25,
    stepDepth: 0.5,
    direction: Math.PI / 2,
  });

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

  // A ring of raised static blocks around the edge, standing in for
  // walls/cover.
  const pillarPositions = [
    [-8, 1, -8],
    [8, 1, -8],
    [-8, 1, 8],
    [8, 1, 8],
  ];
  const pillars = pillarPositions.map(([x, y, z]) => {
    const pillar = createPhysicsBox(scene, physicsWorld, {
      size: [1.2, 3, 1.2],
      position: [x, y, z],
      color: 0x4361ee,
      isDynamic: false,
      friction: 0.6,
    });
    physicsWorld.add(pillar);
    return pillar;
  });

  // A few bouncy dynamic boxes dropped near the centre.
  const box1 = createPhysicsBox(scene, physicsWorld, {
    size: [1, 1, 1],
    position: [-1, 4, 0],
    color: 0x4cc9f0,
    isDynamic: true,
    restitution: 0.5,
  });
  physicsWorld.add(box1);

  const box2 = createPhysicsBox(scene, physicsWorld, {
    size: [1, 1, 1],
    position: [1, 6, 0.5],
    color: 0x7209b7,
    isDynamic: true,
    restitution: 0.5,
  });
  physicsWorld.add(box2);

  // Sends the player to whichever scene levelGraph.js says comes after
  // this one. Placed at [6, 1, 6] -- open floor space, clear of both this
  // scene's own spawnPoint (0, 3, 0) and the four pillars at (±8, 1, ±8),
  // any of which would otherwise physically block the player from ever
  // reaching it (a switcher's sensor doesn't collide with anything, but
  // solid geometry occupying the same spot still makes it unreachable).
  let switcher = null;
  if (requestSwitch) {
    const nextSceneId = getNextSceneId(sceneId);
    const nextSceneBuilder = getSceneBuilder(nextSceneId);
    switcher = new LevelSwitcher(scene, physicsWorld, {
      position: [6, 1, 6],
      triggerRadius: 1.2,
      color: 0xf72585,
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
    floor,
    pillars,
    boxes: [box1, box2],
    switcher,
    spawnPoint: [0, 3, 0],
    destroy,
  };
}
