import * as THREE from "three";
import { Grid } from "@pmndrs/vanilla";
import { createPhysicsBox } from "../objects/createPhysicsBox.js";
import { LevelSwitcher } from "../objects/createLevelSwitcher.js";
import {
  loadPhysicsGLB,
  loadPhysicsPropGLB,
} from "../objects/createPhysicsGLB.js";
import { getNextSceneId, getSceneBuilder } from "./levelGraph.js";

export async function createSceneThree(
  scene,
  physicsWorld,
  { requestSwitch, sceneId = "sceneThree" } = {},
) {
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.55);
  scene.add(ambientLight);

  const dirLightSize = 42;
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.8); //11
  dirLight.position.set(-3, 20, 3);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.width = 2048;
  dirLight.shadow.mapSize.height = 2048;
  dirLight.shadow.camera.far = 18;
  dirLight.shadow.bias = -0.02;
  dirLight.shadow.radius = 3;
  // dirLight.shadow.blurSamples = 11;
  dirLight.shadow.camera.left = -dirLightSize;
  dirLight.shadow.camera.right = dirLightSize;
  dirLight.shadow.camera.top = dirLightSize;
  dirLight.shadow.camera.bottom = -dirLightSize;
  dirLight.shadow.camera.far = 30;
  scene.add(dirLight);

  const shadowHelper = new THREE.CameraHelper(dirLight.shadow.camera);
  scene.add(shadowHelper);

  const floor = createPhysicsBox(scene, physicsWorld, {
    size: [20, 1, 20],
    position: [0, -0.5, 0],
    color: 0x1b1b2f,
    isDynamic: false,
    friction: 0.8,
  });
  physicsWorld.add(floor);

  const grid = Grid({
    args: [24, 24],
    cellSize: 1,
    cellThickness: 1.3,
    cellColor: new THREE.Color("#5a4326"),
    sectionSize: 5,
    sectionThickness: 1.8,
    sectionColor: new THREE.Color("#5a4326"),
    fadeDistance: 90,
    fadeStrength: 20,
    followCamera: true,
  });

  grid.mesh.material.depthWrite = false;
  grid.mesh.position.y = 0.01;
  scene.add(grid.mesh);

  let crate = null;
  try {
    crate = await loadPhysicsPropGLB(scene, physicsWorld, {
      url: "/models/crate.glb",
      position: [0, 4, 0],
      mass: 5, // kg-equivalent; the crate's total mass regardless of its mesh volume
      friction: 0.7,
      restitution: 0.1,
    });
  } catch (err) {
    console.warn(
      'createSceneThree: failed to load "/models/crate.glb" -- add a ' +
        "matching file under your project's public/models folder to see " +
        "the dynamic prop example. Continuing without it.",
      err,
    );
  }

  let switcher = null;
  if (requestSwitch) {
    const nextSceneId = getNextSceneId(sceneId);
    const nextSceneBuilder = getSceneBuilder(nextSceneId);
    switcher = new LevelSwitcher(scene, physicsWorld, {
      position: [8, 1, 8],
      triggerRadius: 1.2,
      color: 0xffffff,
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
  // physicsWorld.clear() during a scene switch. The GLB props (if they
  // loaded) and the switcher are all physics-managed and don't need
  // repeating here.
  function destroy() {
    scene.remove(ambientLight);
    scene.remove(dirLight);
    scene.remove(grid.mesh);
    grid.mesh.geometry?.dispose();
    grid.mesh.material?.dispose();
  }

  return {
    grid,

    crate,
    floor,
    switcher,
    spawnPoint: [0, 3, -6],
    destroy,
  };
}
