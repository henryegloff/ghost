// src/physics/createPhysicsObject.js
//
// Shared base class for simple physics-driven props (boxes, spheres,
// ramps, ...). It owns the boilerplate every prop needs -- building the
// mesh, adding it to the scene, creating the Rapier body/collider from
// already-constructed descriptors, syncing the mesh to the body each
// frame, and tearing it all down again. This holds state across its
// lifetime (mesh, body, collider) and exposes lifecycle methods
// (update/destroy) that get called repeatedly for as long as the object
// exists -- exactly the case a class fits better than a one-shot factory.
//
// Shape-specific factories (see createPhysicsBox.js) just build the THREE
// geometry/material and the Rapier RigidBodyDesc/ColliderDesc, and either
// hand them to `new PhysicsObject(...)` directly or subclass it.
//
// This intentionally does NOT self-register with physicsWorld -- the
// caller does that explicitly via physicsWorld.add(obj). Keeping
// registration explicit (rather than a side effect buried in a
// constructor) keeps every physics object's lifecycle consistent and
// visible at the call site, the same way main.js explicitly registers the
// player.
import * as THREE from "three";

export class PhysicsObject {
  constructor(
    scene,
    physicsWorld,
    {
      geometry,
      material,
      bodyDesc,
      colliderDesc,
      castShadow = true,
      receiveShadow = true,
    },
  ) {
    this.scene = scene;
    this.physicsWorld = physicsWorld;

    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.castShadow = castShadow;
    this.mesh.receiveShadow = receiveShadow;
    scene.add(this.mesh);

    this.body = physicsWorld.world.createRigidBody(bodyDesc);
    this.collider = physicsWorld.world.createCollider(colliderDesc, this.body);

    // Sync immediately so the mesh reflects the body's starting
    // position/rotation from frame one, rather than sitting at the origin
    // until the first physicsWorld.step() + updateMeshes() call.
    this.update();
  }

  // Straight snap-to-transform sync. Fine for simple props -- they don't
  // need the prevPos/currPos interpolation the player controller uses,
  // since nothing is orbiting or tracking them closely enough for a
  // fraction of a physics step to be visible.
  update() {
    const pos = this.body.translation();
    const rot = this.body.rotation();
    this.mesh.position.set(pos.x, pos.y, pos.z);
    this.mesh.quaternion.set(rot.x, rot.y, rot.z, rot.w);
  }

  destroy() {
    this.scene.remove(this.mesh);
    this.physicsWorld.world.removeRigidBody(this.body);
  }
}

// Thin factory wrapper for drop-in compatibility with code that still
// calls createPhysicsObject(...) instead of `new PhysicsObject(...)`.
export function createPhysicsObject(scene, physicsWorld, opts) {
  return new PhysicsObject(scene, physicsWorld, opts);
}
