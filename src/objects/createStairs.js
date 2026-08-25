// src/objects/createStairs.js
//
// Generates a straight staircase out of static physics boxes -- one per
// step, each individually meshed and collidered via the shared
// PhysicsObject class (see physics/createPhysicsObject.js).
//
// Kept as a factory function rather than a class: a staircase isn't a
// single stateful entity with its own ongoing lifecycle methods -- it's a
// one-shot generator that produces N independent PhysicsObject instances
// and hands back a plain list. There's nothing here that needs its own
// update()/destroy() beyond what each individual step already has.
//
// Unlike createPhysicsBox.js, this DOES self-register every step with
// physicsWorld internally. That's a deliberate exception to the "caller
// registers explicitly" convention used elsewhere: a staircase is one
// logical piece of level geometry from the caller's point of view (you
// place a staircase, not N individual boxes), so it owns its own
// children's registration/lifecycle. The returned `steps` array is still
// there if you need to inspect or destroy individual steps later.
//
// `direction` is a yaw angle in radians describing which way the stairs
// ascend, rather than a fixed set of named directions -- this lets you
// orient a staircase at any angle, not just axis-aligned:
//   0            -> ascends along +Z
//   Math.PI / 2  -> ascends along +X
//   Math.PI      -> ascends along -Z
//   -Math.PI / 2 -> ascends along -X
// Each step's box (mesh AND collider) is rotated to match, so the width
// stays perpendicular to the direction of travel regardless of the angle.

import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { PhysicsObject } from "../physics/createPhysicsObject.js";

export function createStairs(scene, physicsWorld, options = {}) {
  const {
    position = [0, 0, 0],
    stepCount = 10,
    stepWidth = 3,
    stepHeight = 0.25,
    stepDepth = 0.5,
    direction = 0, // radians, see file header
    color = 0x5a5a7c,
    friction = 0.8,
  } = options;

  const [ox, oy, oz] = position;

  // Unit vector the staircase ascends along, derived from the yaw angle.
  const forward = new THREE.Vector3(
    Math.sin(direction),
    0,
    Math.cos(direction),
  );

  // Same rotation applied to every step so each box's width/depth align
  // with the travel direction instead of always being world-axis-aligned.
  const rotation = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 1, 0),
    direction,
  );

  const steps = [];

  for (let i = 0; i < stepCount; i++) {
    const centerHeight = (i + 0.5) * stepHeight;
    const centerDistance = (i + 0.5) * stepDepth;

    const x = ox + forward.x * centerDistance;
    const y = oy + centerHeight;
    const z = oz + forward.z * centerDistance;

    const geometry = new THREE.BoxGeometry(stepWidth, stepHeight, stepDepth);
    const material = new THREE.MeshStandardMaterial({ color });

    const bodyDesc = RAPIER.RigidBodyDesc.fixed()
      .setTranslation(x, y, z)
      .setRotation({
        x: rotation.x,
        y: rotation.y,
        z: rotation.z,
        w: rotation.w,
      });

    const colliderDesc = RAPIER.ColliderDesc.cuboid(
      stepWidth / 2,
      stepHeight / 2,
      stepDepth / 2,
    ).setFriction(friction);

    const step = new PhysicsObject(scene, physicsWorld, {
      geometry,
      material,
      bodyDesc,
      colliderDesc,
      castShadow: true,
    });

    physicsWorld.add(step);
    steps.push(step);
  }

  return { steps };
}
