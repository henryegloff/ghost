// src/core/playerVisual.js
//
// Builds the *visual* representation of the player and hands back a
// THREE.Group ("root") that the physics-driven controllers move exactly
// the way they used to move the bare capsule Mesh -- Group and Mesh share
// the same Object3D position interface, so every existing lerp/target/
// interpolation line in playerController.js, playerControllerExtended.js,
// and flowController.js keeps working with position unmodified.
//
// The physics collider is always a capsule (radius/height, see those
// files) -- this module never touches physics. It only decides what gets
// *drawn* at the body's location, via options.visual.type:
//
//   'capsule' (default) -- a primitive capsule mesh sized to match the
//                            physics collider (radius/height, color).
//                            This is the original look, unchanged.
//
//   'model'             -- loads a glTF/GLB file (options.visual.path)
//                            and nests it with its own local scale/
//                            position/rotation offset, independent of the
//                            capsule's dimensions -- so a model with a
//                            totally different size or origin than the
//                            collider still lines up visually once you
//                            dial in the offset.
//
//   'none'              -- an empty physics body with nothing drawn.
//                            Useful for a first-person rig (nothing to
//                            see if the camera sits inside the collider)
//                            or if you want to attach your own object to
//                            `root` from outside this module.
//
// Object hierarchy:
//
//   root                 <- physics-tracked: controllers set root.position
//     (rotated by meshFacing to face the movement direction)
//     +- hoverPivot       <- purely cosmetic local offset, driven by
//          (bobbed/swayed by hoverEffect)   hoverEffect.js. Kept as its
//                                            own node so the hover motion
//                                            never fights with root's
//                                            physics-driven position.
//          +- capsule mesh OR loaded model  <- the visual.scale/position/
//                                               rotation offset from
//                                               options lives here.
//
// Two extra per-frame behaviors, both optional and both driven by
// playerVisual.update(dt) (called once per render frame from each
// controller's updateMesh):
//
//   visual.facing -- eases root's yaw to face wherever the player is
//                     currently moving, via the shortest rotational path.
//                     Feed it a fresh direction each physics step with
//                     playerVisual.setMoveDirection(dir); see
//                     meshFacing.js for the mechanics.
//
//   visual.hover  -- a smooth vertical bob (+ optional sway) applied to
//                     hoverPivot; see hoverEffect.js. Off by default --
//                     turn it on for e.g. a ghost that should float in
//                     place rather than plant its feet on the ground.
//
// glTF loading is async, so createPlayerVisual() still returns
// synchronously -- `root` exists and can be added to the scene /
// registered with physicsWorld on the very first frame, it just stays
// empty until the model finishes loading and gets attached. A `ready`
// promise is exposed if calling code wants to know when that happens
// (e.g. to hide a loading spinner, or to know loading failed and it fell
// back to nothing).

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { createMeshFacing } from "./meshFacing.js";
import { createHoverEffect } from "./hoverEffect.js";

const loader = new GLTFLoader();

export function createPlayerVisual(scene, options = {}) {
  // Physics-matched capsule dimensions -- used directly when
  // visual.type === 'capsule', and irrelevant (but harmless) otherwise.
  const { radius = 0.4, height = 1.0, color = 0x81b29a, visual = {} } =
    options;

  const {
    type = "capsule", // 'capsule' | 'model' | 'none'
    path = null, // e.g. "/models/ghost_4_01.glb" (served from /public)
    scale = 1, // number (uniform) or [x, y, z]
    position = [0, 0, 0], // local offset from the physics anchor
    rotation = [0, 0, 0], // local euler offset, radians, order 'XYZ'
    castShadow = true,
    receiveShadow = false,
    // Face the movement direction -- see meshFacing.js. Pass
    // `false`/`{ enabled: false }` to keep a fixed orientation instead.
    facing = {},
    // Smooth vertical bob/sway, off by default -- see hoverEffect.js.
    // Pass `true`/`{ enabled: true }` to turn it on with its defaults.
    hover = {},
  } = visual;

  const facingOptions = facing === false ? { enabled: false } : facing;
  const hoverOptions =
    hover === true ? {} : hover === false ? { enabled: false } : hover;

  // Root group: this is what the physics controller drags around every
  // frame (mesh.position.lerpVectors(...), controls.target.copy(...),
  // etc). It always sits exactly at the physics body's own position --
  // any scale/position/rotation a model needs, and any cosmetic hover
  // bob, live further down the hierarchy so they can never leak into the
  // physics or camera-follow code. Its rotation, however, IS driven by
  // this module (see facing, below) -- controllers never touch
  // root.quaternion themselves, so there's no conflict.
  const root = new THREE.Group();
  scene.add(root);

  // Cosmetic-only child: hoverEffect.js owns this node's local position/
  // rotation entirely once hover is enabled, bobbing it relative to a
  // fixed base pose. Keeping it separate from root means the bob never
  // competes with the physics-driven position lerp, and separate from the
  // model/capsule child means the hover module doesn't need to know
  // anything about visual.position/rotation/scale.
  const hoverPivot = new THREE.Group();
  root.add(hoverPivot);

  let resolveReady;
  const ready = new Promise((resolve) => {
    resolveReady = resolve;
  });

  let mixer = null; // only populated if a loaded model has animation clips
  const clock = new THREE.Clock();

  const meshFacing = createMeshFacing(root, facingOptions);
  const hoverEffect = createHoverEffect(hoverPivot, hoverOptions);

  function applyLocalTransform(object3d) {
    object3d.position.set(...position);
    object3d.rotation.set(...rotation);
    if (Array.isArray(scale)) object3d.scale.set(...scale);
    else object3d.scale.setScalar(scale);
  }

  if (type === "capsule") {
    const mesh = new THREE.Mesh(
      new THREE.CapsuleGeometry(radius, height, 8, 16),
      new THREE.MeshStandardMaterial({ color }),
    );
    mesh.castShadow = castShadow;
    mesh.receiveShadow = receiveShadow;
    hoverPivot.add(mesh);
    resolveReady(root);
  } else if (type === "model") {
    if (!path) {
      console.warn(
        "createPlayerVisual: visual.type is 'model' but no visual.path " +
          "was given -- falling back to an empty body.",
      );
      resolveReady(root);
    } else {
      loader.load(
        path,
        (gltf) => {
          const model = gltf.scene;
          applyLocalTransform(model);
          model.traverse((child) => {
            if (child.isMesh) {
              child.castShadow = castShadow;
              child.receiveShadow = receiveShadow;
            }
          });
          hoverPivot.add(model);

          // Auto-play the first clip if the file has any. Fine for a
          // simple idle/loop; swap in your own animation-selection logic
          // here if you need blending between multiple clips.
          if (gltf.animations && gltf.animations.length > 0) {
            mixer = new THREE.AnimationMixer(model);
            mixer.clipAction(gltf.animations[0]).play();
          }

          resolveReady(root);
        },
        undefined, // onProgress -- unused
        (error) => {
          console.error(
            `createPlayerVisual: failed to load model at "${path}", ` +
              "falling back to an empty body.",
            error,
          );
          resolveReady(root);
        },
      );
    }
  } else if (type === "none") {
    resolveReady(root);
  } else {
    console.warn(
      `createPlayerVisual: unknown visual.type "${type}" -- expected ` +
        "'capsule', 'model', or 'none'. Falling back to an empty body.",
    );
    resolveReady(root);
  }

  // Call once per physics step (or any time you have a fresh horizontal
  // movement vector) to update where the character should be *facing*.
  // A near-zero vector is ignored, so the character keeps its last facing
  // while stationary rather than snapping to some default -- see
  // meshFacing.js.
  function setMoveDirection(dirVector3) {
    meshFacing.setDirection(dirVector3);
  }

  // Call once per render frame (e.g. from updateMesh()). Drives the
  // facing easing, the hover bob/sway, and any animation mixer, all off
  // this module's own real-time clock -- deliberately decoupled from the
  // fixed physics timestep / interpolation alpha, so none of these
  // stutter just because the physics accumulator ran zero or two steps
  // this frame.
  function update() {
    const dt = clock.getDelta();
    meshFacing.update(dt);
    hoverEffect.update(dt);
    if (mixer) mixer.update(dt);
  }

  function dispose() {
    root.traverse((child) => {
      if (child.isMesh) {
        child.geometry?.dispose();
        if (Array.isArray(child.material)) {
          child.material.forEach((m) => m.dispose());
        } else {
          child.material?.dispose();
        }
      }
    });
    scene.remove(root);
  }

  return {
    root,
    hoverPivot,
    ready,
    setMoveDirection,
    update,
    dispose,
    facing: meshFacing,
    hover: hoverEffect,
    get mixer() {
      return mixer;
    },
  };
}
