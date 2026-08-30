import * as THREE from "three";

import { LevelSwitcher } from "../objects/createLevelSwitcher.js";
import { getNextSceneId, getSceneBuilder } from "./levelGraph.js";

import { loadPhysicsPropGLB } from "../objects/createPhysicsGLB.js";

export async function createScene(
  scene,
  physicsWorld,
  { requestSwitch, sceneId = "sceneOne" } = {},
) {
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
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

  // const shadowHelper = new THREE.CameraHelper(dirLight.shadow.camera);
  // scene.add(shadowHelper);

  let ground = null;
  try {
    ground = await loadPhysicsPropGLB(scene, physicsWorld, {
      url: "/models/example_scene_with_lightmap.glb",
      position: [0, 0, 0],
      isDynamic: false,
      friction: 0.7,
      restitution: 0.1,
      castShadow: true, // except for ..._castnoshadow meshes
    });
  } catch (err) {
    console.warn(
      'createSceneThree: failed to load "/models/custom_scene_example.glb" -- add a ' +
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
      position: [6, 2, -6],
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

  function destroy() {
    scene.remove(ambientLight);
    scene.remove(dirLight);
  }

  return {
    ground,
    switcher,
    spawnPoint: [0, 4, 5],
    destroy,
  };
}
