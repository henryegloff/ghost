// src/scenes/exampleSceneThree.js
//
// A third example scene: a small warm-lit workshop-ish floor, mainly built
// to demonstrate loading GLB files as physics objects (see
// objects/createPhysicsGLB.js) rather than the code-authored primitives
// exampleScene.js / exampleSceneTwo.js use. It shows both modes that
// loader supports:
//
//   - a DYNAMIC prop (a crate), given an explicit mass, dropped above the
//     floor so it visibly falls and settles under gravity -- via
//     loadPhysicsPropGLB(), which defaults to isDynamic: true.
//   - a STATIC prop (a lantern), sitting fixed on the floor -- via
//     loadPhysicsGLB() directly with isDynamic: false, showing the same
//     underlying loader also covers the static case.
//
// GLB PATHS ARE PLACEHOLDERS. `/models/crate.glb` and `/models/lantern.glb`
// below won't exist until you export and drop matching files into your
// project's public/models folder (same place ghost_4.03.glb already
// lives, referenced from main.js). Each load is wrapped in a try/catch so
// a missing file logs a warning and the scene still loads and functions
// -- it just won't show that particular prop -- rather than breaking the
// whole scene switch.
//
// Follows the same scene-builder contract as exampleScene.js /
// exampleSceneTwo.js, including the `sceneId`/levelGraph.js wiring (see
// levelGraph.js for why scenes look each other up by id through that
// shared module rather than importing one another directly). Unlike the
// other two scenes, this builder is `async`, since it awaits GLB loads
// before finishing -- SceneManager.loadScene() awaits whatever a scene
// builder returns either way, so a sync or async builder both work.
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
  const ambientLight = new THREE.AmbientLight(0xffd9a0, 0.55);
  scene.add(ambientLight);

  const dirLight = new THREE.DirectionalLight(0xffb86c, 1.3);
  dirLight.position.set(8, 18, -6);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.set(2048, 2048);
  dirLight.shadow.camera.left = -18;
  dirLight.shadow.camera.right = 18;
  dirLight.shadow.camera.top = 18;
  dirLight.shadow.camera.bottom = -18;
  dirLight.shadow.camera.near = 0.5;
  dirLight.shadow.camera.far = 40;
  scene.add(dirLight);

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

  // const floor = createPhysicsBox(scene, physicsWorld, {
  //   size: [24, 1, 24],
  //   position: [0, -0.5, 0],
  //   color: 0x3a2e1f,
  //   isDynamic: false,
  //   friction: 0.8,
  // });
  // physicsWorld.add(floor);

  // Dynamic GLB prop: dropped a couple of metres above the floor so it's
  // visibly falling and settling under gravity when the scene loads --
  // demonstrates isDynamic + mass. See createPhysicsGLB.js's MASS section
  // for exactly what `mass` controls.
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

  let ground = null;
  try {
    ground = await loadPhysicsPropGLB(scene, physicsWorld, {
      url: "/models/ground-01.glb",
      position: [0, -5, 0],
      isDynamic: false,
      friction: 0.7,
      restitution: 0.1,
    });
  } catch (err) {
    console.warn(
      'createSceneThree: failed to load "/models/ground-01.glb" -- add a ' +
        "matching file under your project's public/models folder to see " +
        "the dynamic prop example. Continuing without it.",
      err,
    );
  }

  // let lantern = null;
  // try {
  //   lantern = await loadPhysicsGLB(scene, physicsWorld, {
  //     url: "/models/lantern.glb",
  //     position: [-4, 0, 3],
  //     isDynamic: false,
  //     friction: 0.8,
  //   });
  // } catch (err) {
  //   console.warn(
  //     'createSceneThree: failed to load "/models/lantern.glb" -- add a ' +
  //       "matching file under your project's public/models folder to see " +
  //       "the static prop example. Continuing without it.",
  //     err,
  //   );
  // }

  // Sends the player to whichever scene levelGraph.js says comes after
  // this one (sceneOne, closing the sceneOne -> sceneTwo -> sceneThree ->
  // sceneOne loop). Placed away from this scene's own spawnPoint and
  // clear of the floor's prop placements so it stays reachable.
  let switcher = null;
  if (requestSwitch) {
    const nextSceneId = getNextSceneId(sceneId);
    const nextSceneBuilder = getSceneBuilder(nextSceneId);
    switcher = new LevelSwitcher(scene, physicsWorld, {
      position: [8, 3, 8],
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
    // lantern,
    // floor,
    crate,
    ground,
    switcher,
    spawnPoint: [0, 3, -6],
    destroy,
  };
}
