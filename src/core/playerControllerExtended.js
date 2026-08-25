// src/core/playerControlExtended.js
//
// Same interface and same underlying physics (spring suspension, stair
// stepping, moving-platform support) as core/playerController.js, but with
// two changes aimed at a more "standard third-person game" camera:
//
// 1. FOLLOW CAMERA: the orbit target eases toward the player each frame
//    instead of snapping to it instantly, giving the camera a touch of
//    trailing "catch up" motion rather than feeling welded to the capsule.
//
// 2. NO STRAIGHT-DOWN MOVEMENT BUG: movement direction is now built from
//    OrbitControls' azimuthal (horizontal-only) angle instead of from
//    camera.getWorldDirection() flattened onto the XZ plane. The old
//    approach breaks down as the camera pitches toward straight down --
//    the flattened vector's length shrinks toward zero, and normalizing a
//    near-zero vector produces unstable, spinning directions. The
//    azimuthal angle has no such singularity; it stays well-defined at any
//    pitch, so this fixes the bug outright rather than just working around
//    it. A conservative minPolarAngle clamp is kept too, mostly for feel
//    (a fully overhead third-person view is disorienting in most games
//    regardless of whether the math holds up).
//
// Also same as playerController.js: the physics collider is always a
// capsule (radius/height), but what gets *drawn* at its location is
// decoupled and delegated to playerVisual.js -- pass options.visual to
// swap between the primitive capsule mesh (default), a loaded GLTF/GLB
// model, or nothing at all. See playerVisual.js for the full option list.
//
// Drop-in compatible with core/playerController.js: same constructor
// signature (scene, physicsWorld, domElement, options) and same returned
// interface, so swapping one for the other in main.js is a one-line change.

import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { createPlayerVisual } from "./playerVisual.js";

const UP = new THREE.Vector3(0, 1, 0);

export function createPlayerControlExtended(
  scene,
  physicsWorld,
  domElement,
  options = {},
) {
  // 1. Destructure options with sensible defaults
  const {
    // physics body / capsule
    initialPosition = [0, 4, 5],
    radius = 0.4,
    height = 1.0,
    floatHeight = 0.92,
    maxStepHeight = 0.3,
    springK = 600.0,
    damperC = 45.0,
    moveSpeed = 8.0,
    jumpImpulse = 8.5,
    color = 0x81b29a,
    // visual representation drawn at the physics body's location -- see
    // playerVisual.js for { type: 'capsule' | 'model' | 'none', path,
    // scale, position, rotation, castShadow, receiveShadow }
    visual = {},
    // camera / controls
    fov = 60,
    near = 0.1,
    far = 1000,
    // Starting distance behind/above the player -- this is what sets the
    // camera's initial zoom level before any scroll input.
    cameraOffset = [0, 2.5, 4],
    enableDamping = true,
    dampingFactor = 0.05,
    enablePan = false,
    // How close/far the player is allowed to scroll-zoom the camera.
    // Tightened from the original [3, 14] range so it can't be pushed as
    // far back.
    minDistance = 2.0,
    maxDistance = 8.0,
    // Keeps the camera out of a fully top-down view. Not what fixes the
    // movement bug (see beforePhysicsStep below) -- just feels better.
    minPolarAngle = 0.25,
    maxPolarAngle = Math.PI / 2 - 0.05,
    // How quickly the orbit target catches up to the player each frame.
    // 0 = camera never moves, 1 = instant snap (same as playerController).
    // Raised from 0.2 -> 0.35 so the camera feels more welded to the
    // player and less like it's trailing behind.
    // NOTE: this is a plain per-frame lerp, not corrected for frame time,
    // so the amount of "catch up" will vary a bit with frame rate. Good
    // enough for a demo; for frame-rate-independent easing you'd want
    // something like 1 - Math.exp(-sharpness * dt) driven off the real
    // render delta rather than the physics alpha this receives.
    followLerp = 0.35,
  } = options;

  const world = physicsWorld.world;
  const [ix, iy, iz] = initialPosition;

  // 2. Visual Mesh -- delegated to playerVisual.js, which builds either a
  // capsule primitive, a loaded GLTF/GLB model, or nothing at all
  // (options.visual.type), and hands back a Group ("mesh" below) that
  // every line below treats exactly like the old bare capsule Mesh: it's
  // lerped between physics samples, tracked by OrbitControls' target, etc.
  const playerVisual = createPlayerVisual(scene, { radius, height, color, visual });
  const mesh = playerVisual.root;

  // 3. Rapier Rigidbody & Collider -- always a capsule, independent of
  // whatever gets drawn above
  const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(ix, iy, iz)
    .setLinearDamping(0.2)
    .enabledRotations(false, false, false);
  const body = world.createRigidBody(bodyDesc);

  const colliderDesc = RAPIER.ColliderDesc.capsule(
    height / 2,
    radius,
  ).setFriction(0.0);
  world.createCollider(colliderDesc, body);

  // 4. Camera + OrbitControls
  const camera = new THREE.PerspectiveCamera(
    fov,
    window.innerWidth / window.innerHeight,
    near,
    far,
  );
  camera.position.set(
    ix + cameraOffset[0],
    iy + cameraOffset[1],
    iz + cameraOffset[2],
  );

  const controls = new OrbitControls(camera, domElement);
  controls.target.set(ix, iy, iz);
  controls.enableDamping = enableDamping;
  controls.dampingFactor = dampingFactor;
  controls.enablePan = enablePan;
  controls.minDistance = minDistance;
  controls.maxDistance = maxDistance;
  controls.minPolarAngle = minPolarAngle;
  controls.maxPolarAngle = maxPolarAngle;

  // 5. Interpolation state -- captured either side of each fixed physics step
  const prevPos = new THREE.Vector3().copy(body.translation());
  const currPos = new THREE.Vector3().copy(body.translation());

  // 6. Input state
  let isGrounded = false;
  let jumpTimer = 0.0;
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

    if (jumpTimer > 0) jumpTimer -= dt;

    // Movement direction from the camera's horizontal rotation only.
    // controls.getAzimuthalAngle() is a persisted angle tracked internally
    // by OrbitControls -- it stays well-defined even when the polar angle
    // approaches 0 (looking straight down) or PI (straight up), unlike
    // deriving forward/right from camera.getWorldDirection() and zeroing
    // out Y, which degenerates to a near-zero-length vector at those
    // extremes and produces unstable movement.
    const azimuth = controls.getAzimuthalAngle();
    const camForward = new THREE.Vector3(
      -Math.sin(azimuth),
      0,
      -Math.cos(azimuth),
    );
    const camRight = new THREE.Vector3()
      .crossVectors(camForward, UP)
      .normalize();

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

    // Ground / stair raycasting
    const playerPos = body.translation();
    const centerRay = new RAPIER.Ray(playerPos, { x: 0, y: -1, z: 0 });
    const centerHit = world.castRayAndGetNormal(
      centerRay,
      floatHeight + maxStepHeight,
      true,
      RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC,
    );

    let activeHit = centerHit;

    if (moveDir.lengthSq() > 0) {
      const stepRayOrigin = {
        x: playerPos.x + moveDir.x * (radius + 0.05),
        y: playerPos.y,
        z: playerPos.z + moveDir.z * (radius + 0.05),
      };
      const stepRay = new RAPIER.Ray(stepRayOrigin, { x: 0, y: -1, z: 0 });
      const stepHit = world.castRayAndGetNormal(
        stepRay,
        floatHeight + maxStepHeight,
        true,
        RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC,
      );

      if (stepHit) {
        const centerDist = centerHit
          ? centerHit.timeOfImpact
          : floatHeight + maxStepHeight;
        if (centerDist - stepHit.timeOfImpact > 0.02) activeHit = stepHit;
      }
    }

    isGrounded = false;
    let platformVelocity = { x: 0, y: 0, z: 0 };

    if (activeHit && activeHit.collider) {
      const groundBody = activeHit.collider.parent();
      if (groundBody) {
        const lin = groundBody.linvel();
        const ang = groundBody.angvel();
        const gPos = groundBody.translation();
        const relX = playerPos.x - gPos.x;
        const relY = playerPos.y - gPos.y;
        const relZ = playerPos.z - gPos.z;

        platformVelocity = {
          x: lin.x + (ang.y * relZ - ang.z * relY),
          y: lin.y + (ang.z * relX - ang.x * relZ),
          z: lin.z + (ang.x * relY - ang.y * relX),
        };
      }
    }

    // Spring suspension
    if (activeHit && jumpTimer <= 0) {
      const rayDist = activeHit.timeOfImpact;
      const deltaY = floatHeight - rayDist;

      if (deltaY >= -0.15) {
        isGrounded = true;
        const currentVel = body.linvel();
        const relativeVelY = currentVel.y - platformVelocity.y;
        const springForceY = deltaY * springK - relativeVelY * damperC;

        body.applyImpulse({ x: 0, y: springForceY * dt, z: 0 }, true);
      }
    }

    // Target velocities
    const currentVel = body.linvel();
    const targetVelX = moveDir.x * moveSpeed + platformVelocity.x;
    const targetVelZ = moveDir.z * moveSpeed + platformVelocity.z;

    const velX = THREE.MathUtils.lerp(currentVel.x, targetVelX, 0.25);
    const velZ = THREE.MathUtils.lerp(currentVel.z, targetVelZ, 0.25);
    let velY = currentVel.y;

    if (isGrounded && jumpTimer <= 0) {
      velY = THREE.MathUtils.lerp(currentVel.y, platformVelocity.y, 0.3);
    }

    // Jump
    if (keys.Space && isGrounded && jumpTimer <= 0) {
      velY = jumpImpulse + Math.max(0, platformVelocity.y);
      jumpTimer = 0.2;
      isGrounded = false;
    }

    body.setLinvel({ x: velX, y: velY, z: velZ }, true);
  }

  // Called by physicsWorld.step() AFTER each fixed world.step()
  function afterPhysicsStep() {
    currPos.copy(body.translation());
  }

  // Called once per render frame by physicsWorld.updateMeshes(alpha, debug)
  function updateMesh(alpha, debugMode = false) {
    if (debugMode) {
      // Rapier's debug wireframes always draw the exact current physics
      // state, so snap the mesh straight to it too -- otherwise the
      // interpolated mesh visibly trails the collider by up to one
      // physics step while debugging.
      mesh.position.copy(currPos);
    } else {
      mesh.position.lerpVectors(prevPos, currPos, alpha);
    }

    // Ease the orbit target toward the player instead of snapping to it --
    // the "camera follows the player" trailing feel.
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
    playerVisual.dispose();
    world.removeRigidBody(body);
  }

  // 7. Return module interface
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
