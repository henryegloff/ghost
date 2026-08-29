// src/core/playerController.js
//
// An alternative to orbitController.js: instead of a free-look camera with
// a fixed target, this bundles a third-person camera + OrbitControls with a
// physics-driven player capsule (spring-suspension ground follow, stair
// stepping, moving-platform support). The camera orbits the player instead
// of a static point.
//
// Physics/render sync follows the same fixed-timestep + interpolation
// pattern proven out in player-controller-demo.js: beforePhysicsStep()/
// afterPhysicsStep() capture the body's transform either side of each
// world.step(), and updateMesh(alpha) lerps between them at render time.
// physicsWorld.js calls these automatically once this object is registered
// via physicsWorld.add(player).
//
// The physics collider is always a capsule (radius/height below), but what
// gets *drawn* at its location is decoupled and delegated to
// playerVisual.js -- pass options.visual to swap between the primitive
// capsule mesh (default, unchanged behavior), a loaded GLTF/GLB model, or
// nothing at all. See playerVisual.js for the full option list.

import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { createPlayerVisual } from "./playerVisual.js";

export function createPlayerController(
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
    // camera + controls (mirrors orbitController.js's option shape)
    fov = 60,
    near = 0.1,
    far = 1000,
    cameraOffset = [0, 6, 8],
    enableDamping = true,
    dampingFactor = 0.05,
    enablePan = false,
    minDistance = 4.0,
    maxDistance = 35.0,
    maxPolarAngle = Math.PI / 2 - 0.05,
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

  // 4. Camera + OrbitControls, chasing the player instead of a fixed target
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
  controls.maxPolarAngle = maxPolarAngle;

  // 5. Interpolation state — captured either side of each fixed physics step
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

    // Movement relative to camera facing
    const camForward = new THREE.Vector3();
    camera.getWorldDirection(camForward);
    camForward.y = 0;
    camForward.normalize();

    const camRight = new THREE.Vector3()
      .crossVectors(camForward, new THREE.Vector3(0, 1, 0))
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

  // Called once per render frame by physicsWorld.updateMeshes(alpha).
  // Interpolates the capsule between its last two physics states, then
  // drags the orbit target along with it so the camera keeps tracking
  // smoothly rather than snapping every physics tick.
  function updateMesh(alpha, debugMode = false) {
    if (debugMode) {
      mesh.position.copy(currPos);
    } else {
      mesh.position.lerpVectors(prevPos, currPos, alpha);
    }
    controls.target.copy(mesh.position);
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
