// src/objects/createPhysicsBox.js
//
// Kept as a plain factory function rather than a class: it holds no state
// of its own and has no lifecycle methods -- it just translates a config
// object into THREE geometry/material + Rapier descriptors and hands them
// to `PhysicsObject`, which is where the actual mesh/body/collider state
// and update()/destroy() lifecycle live. The caller is responsible for
// registering the result with physicsWorld.add() -- this factory only
// builds the object, it doesn't decide when it becomes "live".
import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { PhysicsObject } from "../physics/createPhysicsObject.js";

export function createPhysicsBox(
  scene,
  physicsWorld,
  {
    size = [1, 1, 1],
    position = [0, 0, 0],
    color = 0x2a9d8f,
    isDynamic = true,
    friction = 0.5,
    restitution = 0.2,
  } = {},
) {
  const [width, height, depth] = size;
  const [x, y, z] = position;

  const geometry = new THREE.BoxGeometry(width, height, depth);
  const material = new THREE.MeshStandardMaterial({ color });

  const bodyDesc = isDynamic
    ? RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, z)
    : RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z);

  // Rapier cuboids use half-extents
  const colliderDesc = RAPIER.ColliderDesc.cuboid(
    width / 2,
    height / 2,
    depth / 2,
  )
    .setFriction(friction)
    .setRestitution(restitution);

  return new PhysicsObject(scene, physicsWorld, {
    geometry,
    material,
    bodyDesc,
    colliderDesc,
    castShadow: isDynamic,
  });
}
