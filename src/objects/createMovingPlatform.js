// src/objects/createMovingPlatform.js
//
// A kinematic platform that tours an array of waypoint positions. Movement
// is fully authored (position-based kinematic body, not forces) -- each
// physics step it computes exactly where it should be along the current
// leg of the journey and sets that directly via setNextKinematicTranslation,
// the same technique flowController.js uses for the player. Dynamic bodies
// resting on top (the player, boxes) get carried along automatically --
// Rapier derives the platform's effective velocity from its position delta
// each step for contact/friction purposes.
//
// Refactored into a class: a platform carries mutable timeline state
// (segmentIndex, direction, elapsed, prevPos/currPos) that evolves across
// many beforePhysicsStep()/updateMesh() calls for the lifetime of the
// object -- a textbook case for a class over a one-shot factory closure.
//
// Unlike createStairs.js, this is a single physics object (one mesh, one
// body) -- same footprint as createPhysicsBox.js -- so it follows that
// convention instead: it does NOT self-register. Call physicsWorld.add()
// on the returned instance yourself.
//
// `durations` controls how long each leg takes:
//   - a single number  -> applied to every leg
//   - an array         -> one entry per leg, aligned with `positions`
//     (length must be positions.length in loop mode, or
//     positions.length - 1 in pingPong mode)
//
// `pingPong`:
//   - false (default): loops back to positions[0] after the last waypoint
//   - true: reverses direction at each end instead of jumping back

import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";

export class MovingPlatform {
  constructor(scene, physicsWorld, options = {}) {
    const {
      positions,
      durations = 2.0,
      size = [4, 0.5, 4],
      color = 0xf4a261,
      pingPong = false,
      startIndex = 0,
      friction = 0.8,
    } = options;

    if (!Array.isArray(positions) || positions.length < 2) {
      throw new Error("MovingPlatform: `positions` needs at least 2 waypoints");
    }

    this.waypoints = positions.map(([x, y, z]) => new THREE.Vector3(x, y, z));
    this.pingPong = pingPong;

    const segmentCount = pingPong ? this.waypoints.length - 1 : this.waypoints.length;
    this.segmentDurations = Array.isArray(durations)
      ? durations
      : new Array(segmentCount).fill(durations);

    if (this.segmentDurations.length !== segmentCount) {
      throw new Error(
        `MovingPlatform: durations array length (${this.segmentDurations.length}) must ` +
          `match the number of segments (${segmentCount} for ${pingPong ? "pingPong" : "loop"} mode)`,
      );
    }

    const [width, height, depth] = size;
    const [ix, iy, iz] = positions[startIndex];

    this.scene = scene;
    this.physicsWorld = physicsWorld;

    // --- Mesh ---
    this.mesh = new THREE.Mesh(
      new THREE.BoxGeometry(width, height, depth),
      new THREE.MeshStandardMaterial({ color }),
    );
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.position.set(ix, iy, iz);
    scene.add(this.mesh);

    // --- Kinematic body + collider ---
    const bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(ix, iy, iz);
    this.body = physicsWorld.world.createRigidBody(bodyDesc);
    const colliderDesc = RAPIER.ColliderDesc.cuboid(width / 2, height / 2, depth / 2).setFriction(
      friction,
    );
    physicsWorld.world.createCollider(colliderDesc, this.body);

    // --- Timeline state ---
    this.segmentIndex = startIndex;
    this.direction = 1; // only used in pingPong mode
    this.elapsed = 0;

    this.prevPos = new THREE.Vector3().copy(this.waypoints[startIndex]);
    this.currPos = new THREE.Vector3().copy(this.waypoints[startIndex]);
  }

  // Returns [fromIndex, toIndex, durationIndex] for the leg currently
  // being traveled.
  _currentLeg() {
    if (this.pingPong) {
      const toIndex = this.segmentIndex + this.direction;
      return [this.segmentIndex, toIndex, Math.min(this.segmentIndex, toIndex)];
    }
    const toIndex = (this.segmentIndex + 1) % this.waypoints.length;
    return [this.segmentIndex, toIndex, this.segmentIndex];
  }

  // Called by physicsWorld.step() BEFORE each fixed world.step()
  beforePhysicsStep(dt) {
    this.prevPos.copy(this.currPos);

    const [fromIndex, toIndex, durationIndex] = this._currentLeg();
    const legDuration = this.segmentDurations[durationIndex];

    this.elapsed += dt;
    // NOTE: if legDuration is shorter than one physics step (~1/60s),
    // only a single leg advance is processed per step -- fine for
    // reasonable durations, but very short ones (sub-16ms) would need a
    // while-loop here to fully "catch up" within a single step.
    const t = legDuration > 0 ? Math.min(this.elapsed / legDuration, 1) : 1;

    this.currPos.lerpVectors(this.waypoints[fromIndex], this.waypoints[toIndex], t);

    if (this.elapsed >= legDuration) {
      this.elapsed -= legDuration;
      this.segmentIndex = toIndex;

      if (
        this.pingPong &&
        (this.segmentIndex === 0 || this.segmentIndex === this.waypoints.length - 1)
      ) {
        this.direction *= -1;
      }
    }

    this.body.setNextKinematicTranslation({
      x: this.currPos.x,
      y: this.currPos.y,
      z: this.currPos.z,
    });
  }

  // Called by physicsWorld.step() AFTER each fixed world.step(). No-op
  // here -- currPos already holds the authoritative target for this step
  // (we authored it ourselves above), unlike force-driven bodies where you
  // need to read the solver's result back out.
  afterPhysicsStep() {}

  // Called once per render frame by physicsWorld.updateMeshes(alpha)
  updateMesh(alpha) {
    this.mesh.position.lerpVectors(this.prevPos, this.currPos, alpha);
  }

  destroy() {
    this.scene.remove(this.mesh);
    this.physicsWorld.world.removeRigidBody(this.body);
  }
}

// Thin factory wrapper for drop-in compatibility with code that still
// calls createMovingPlatform(...) instead of `new MovingPlatform(...)`.
export function createMovingPlatform(scene, physicsWorld, options = {}) {
  return new MovingPlatform(scene, physicsWorld, options);
}
