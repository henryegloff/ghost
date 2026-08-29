// src/core/flowController.js
//
// A deliberately different implementation strategy from playerController.js
// / playerControlExtended.js. Those drive a DYNAMIC rigidbody with a
// hand-rolled raycast + spring/damper suspension to fake "grounded"
// movement. This one uses Rapier's built-in KinematicCharacterController
// instead: you describe a desired movement each step, Rapier resolves
// collisions/slopes/steps for you, and you author the resulting position
// directly onto a KINEMATIC body.
//
// Why this is worth having as an alternative:
//   - No spring constants to tune, no oscillation/overshoot risk -- ground
//     snapping, slope limits, and step-up are handled by Rapier's solver.
//   - Movement is fully authored: the body ends up exactly where the
//     resolved movement says, not wherever forces happened to leave it.
//   - More predictable to reason about and debug than a force-integrated
//     spring system.
//
// Trade-offs to know about:
//   - Kinematic bodies ignore gravity entirely -- vertical velocity is
//     accumulated by hand each frame (see beforePhysicsStep). This is
//     standard practice for character controllers, not a workaround.
//   - Kinematic bodies don't push dynamic bodies out of the way unless you
//     opt in (see setApplyImpulsesToDynamicBodies below).
//
// On mesh/body sync: this exposes an `interpolate` option (default true).
// With it on, the mesh eases between physics samples like the other
// controllers (smooth, but a fraction of a physics step "behind" the true
// current state). With it off, the mesh snaps straight to the body's exact
// current position every frame -- zero lag, at the cost of visible
// micro-stutter on frames where the fixed-step accumulator runs 0 or 2
// physics steps instead of 1. Neither is strictly "correct" -- it's a
// smoothness-vs-lag trade-off inherent to mixing a fixed physics rate with
// a variable render rate. Flip it and see which you prefer.
//
// As with the other two controllers, the physics collider is always a
// capsule (radius/height), but what gets *drawn* at its location is
// decoupled and delegated to playerVisual.js -- pass options.visual to
// swap between the primitive capsule mesh (default), a loaded GLTF/GLB
// model, or nothing at all. See playerVisual.js for the full option list.
//
// Same constructor signature and returned interface as the other two
// controllers, so it's a drop-in swap in main.js.

import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { createPlayerVisual } from "./playerVisual.js";

const UP = new THREE.Vector3(0, 1, 0);

export function createFlowController(scene, physicsWorld, domElement, options = {}) {
  // 1. Destructure options with sensible defaults
  const {
    // capsule
    initialPosition = [0, 4, 5],
    radius = 0.4,
    height = 1.0,
    color = 0x81b29a,
    // visual representation drawn at the physics body's location -- see
    // playerVisual.js for { type: 'capsule' | 'model' | 'none', path,
    // scale, position, rotation, castShadow, receiveShadow }
    visual = {},
    // movement
    moveSpeed = 8.0,
    jumpSpeed = 8.5,
    gravity = -30.0,
    // character controller tuning (Rapier-native, replaces the old
    // spring/raycast setup entirely)
    maxSlopeClimbAngle = THREE.MathUtils.degToRad(45),
    minSlopeSlideAngle = THREE.MathUtils.degToRad(30),
    autoStepMaxHeight = 0.3,
    autoStepMinWidth = 0.2,
    snapToGroundDistance = 0.3,
    pushDynamicBodies = true,
    // camera / controls
    fov = 60,
    near = 0.1,
    far = 1000,
    cameraOffset = [0, 2.5, 4],
    enableDamping = true,
    dampingFactor = 0.05,
    enablePan = false,
    minDistance = 2.0,
    maxDistance = 8.0,
    minPolarAngle = 0.25,
    maxPolarAngle = Math.PI / 2 - 0.05,
    followLerp = 0.35,
    // sync behaviour -- see file header
    interpolate = true,
  } = options;

  const world = physicsWorld.world;
  const [ix, iy, iz] = initialPosition;

  // 2. Visual Mesh -- delegated to playerVisual.js, which builds either a
  // capsule primitive, a loaded GLTF/GLB model, or nothing at all
  // (options.visual.type), and hands back a Group ("mesh" below) that
  // every line below treats exactly like the old bare capsule Mesh: it's
  // synced/interpolated to the body's transform, tracked by OrbitControls'
  // target, etc.
  const playerVisual = createPlayerVisual(scene, { radius, height, color, visual });
  const mesh = playerVisual.root;

  // 3. KINEMATIC body + collider (position-based, not dynamic -- we author
  // its translation directly each step rather than letting forces move it)
  const bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(ix, iy, iz);
  const body = world.createRigidBody(bodyDesc);

  const colliderDesc = RAPIER.ColliderDesc.capsule(height / 2, radius);
  const collider = world.createCollider(colliderDesc, body);

  // 4. Rapier's built-in character controller does the heavy lifting that
  // used to be hand-rolled raycasts + a spring: slope limits, step-up,
  // ground snapping, and collision sliding.
  const characterController = world.createCharacterController(0.01); // small skin offset
  characterController.setUp({ x: 0, y: 1, z: 0 });
  characterController.setMaxSlopeClimbAngle(maxSlopeClimbAngle);
  characterController.setMinSlopeSlideAngle(minSlopeSlideAngle);
  characterController.enableAutostep(autoStepMaxHeight, autoStepMinWidth, true);
  characterController.enableSnapToGround(snapToGroundDistance);
  characterController.setApplyImpulsesToDynamicBodies(pushDynamicBodies);

  // 5. Camera + OrbitControls (same follow-cam approach as
  // playerControlExtended.js)
  const camera = new THREE.PerspectiveCamera(
    fov,
    window.innerWidth / window.innerHeight,
    near,
    far,
  );
  camera.position.set(ix + cameraOffset[0], iy + cameraOffset[1], iz + cameraOffset[2]);

  const controls = new OrbitControls(camera, domElement);
  controls.target.set(ix, iy, iz);
  controls.enableDamping = enableDamping;
  controls.dampingFactor = dampingFactor;
  controls.enablePan = enablePan;
  controls.minDistance = minDistance;
  controls.maxDistance = maxDistance;
  controls.minPolarAngle = minPolarAngle;
  controls.maxPolarAngle = maxPolarAngle;

  // 6. Interpolation state (only matters when interpolate === true)
  const prevPos = new THREE.Vector3().copy(body.translation());
  const currPos = new THREE.Vector3().copy(body.translation());

  // 7. Input + hand-rolled vertical velocity (kinematic bodies ignore
  // gravity -- this is the standard workaround)
  let verticalVelocity = 0;
  let isGrounded = false;
  const keys = {};

  const validKeys = [
    "KeyW",
    "KeyS",
    "KeyA",
    "KeyD",
    "ArrowUp",
    "ArrowDown",
    "ArrowLeft",
    "ArrowRight",
    "Space",
  ];
  const onKeyDown = (e) => {
    if (validKeys.includes(e.code)) keys[e.code] = true;
  };
  const onKeyUp = (e) => {
    if (validKeys.includes(e.code)) keys[e.code] = false;
  };
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);

  // Called by physicsWorld.step() BEFORE each fixed world.step()
  function beforePhysicsStep(dt) {
    prevPos.copy(body.translation());

    // Movement direction from the camera's azimuthal angle only -- same
    // gimbal-safe approach as playerControlExtended.js.
    const azimuth = controls.getAzimuthalAngle();
    const camForward = new THREE.Vector3(-Math.sin(azimuth), 0, -Math.cos(azimuth));
    const camRight = new THREE.Vector3().crossVectors(camForward, UP).normalize();

    const moveDir = new THREE.Vector3();
    if (keys.KeyW || keys.ArrowUp) moveDir.add(camForward);
    if (keys.KeyS || keys.ArrowDown) moveDir.sub(camForward);
    if (keys.KeyD || keys.ArrowRight) moveDir.add(camRight);
    if (keys.KeyA || keys.ArrowLeft) moveDir.sub(camRight);
    if (moveDir.lengthSq() > 0) moveDir.normalize();

    // Feed this step's movement direction to the visual layer so it can
    // ease the mesh to face it (ignored internally if it's ~zero -- see
    // meshFacing.js). Purely cosmetic, no effect on the physics below.
    playerVisual.setMoveDirection(moveDir);

    // Manual gravity accumulation. Reset to a small downward value while
    // grounded (rather than 0) so the controller keeps a slight downward
    // intent each step -- that's what lets enableSnapToGround() do its job
    // on the way down slopes/steps instead of the player "floating" a
    // frame behind the ground.
    if (isGrounded && verticalVelocity < 0) {
      verticalVelocity = -0.1;
    }
    verticalVelocity += gravity * dt;

    if (keys.Space && isGrounded) {
      verticalVelocity = jumpSpeed;
    }

    const desiredMovement = {
      x: moveDir.x * moveSpeed * dt,
      y: verticalVelocity * dt,
      z: moveDir.z * moveSpeed * dt,
    };

    // Ask Rapier to resolve this movement against the world (collisions,
    // slopes, steps) rather than hand-rolling raycasts ourselves.
    characterController.computeColliderMovement(collider, desiredMovement);
    const corrected = characterController.computedMovement();
    isGrounded = characterController.computedGrounded();

    const pos = body.translation();
    body.setNextKinematicTranslation({
      x: pos.x + corrected.x,
      y: pos.y + corrected.y,
      z: pos.z + corrected.z,
    });
  }

  // Called by physicsWorld.step() AFTER each fixed world.step() (this is
  // when the kinematic translation set above actually takes effect)
  function afterPhysicsStep() {
    currPos.copy(body.translation());
  }

  // Called once per render frame by physicsWorld.updateMeshes(alpha, debug)
  function updateMesh(alpha, debugMode = false) {
    if (!interpolate || debugMode) {
      // Exact sync: mesh is always precisely where the body is right now.
      // See the file header for the trade-off this makes.
      mesh.position.copy(currPos);
    } else {
      mesh.position.lerpVectors(prevPos, currPos, alpha);
    }

    controls.target.lerp(mesh.position, followLerp);
    controls.update();
    playerVisual.update();
  }

  function handleResize(width, height) {
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  function destroy() {
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    playerVisual.destroy();
    world.removeRigidBody(body);
  }

  // 8. Return module interface
  return {
    mesh,
    body,
    camera,
    controls,
    visual: playerVisual, // access .ready / .mixer, or swap models later
    beforePhysicsStep,
    afterPhysicsStep,
    updateMesh,
    handleResize,
    destroy,
  };
}
