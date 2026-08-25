// src/core/meshFacing.js
//
// Eases an Object3D's yaw so it faces its current horizontal movement
// direction, always turning via the SHORTEST rotational path rather than
// potentially spinning the long way around when the target direction
// flips (e.g. player reverses from forward to backward).
//
// The shortest-path guarantee comes from THREE.Quaternion.rotateTowards():
// it steps the object's current quaternion toward a target quaternion by
// at most a fixed angle per call, always choosing the smaller of the two
// possible arcs between them -- no manual angle-wrapping or sign-flipping
// needed.
//
// Usage:
//   const facing = createMeshFacing(someObject3D, { turnSpeed: 10 });
//   // whenever you have a fresh horizontal movement vector (once per
//   // physics step is the common case):
//   facing.setDirection(moveDir);
//   // once per render frame, with a real elapsed-time delta:
//   facing.update(dt);
//
// A near-zero-length direction passed to setDirection() is ignored, so
// the object keeps facing wherever it last faced while stationary instead
// of snapping back to some default orientation.

import * as THREE from "three";

export function createMeshFacing(object3D, options = {}) {
  const {
    enabled = true,
    // Max turn rate in radians/sec. Higher = snappier direction changes.
    // ~10 (≈573°/s) turns a full 180° in well under a third of a second
    // while still visibly easing rather than popping instantly.
    turnSpeed = 10,
    // Which local +axis of object3D counts as "forward" before this
    // module starts rotating it. Accepts either a THREE.Vector3 or a
    // plain [x, y, z] array (handy when passing this inline through
    // options, e.g. from main.js, without importing THREE there).
    // Defaulted to -Z rather than +Z here since that's the axis this
    // project's models (e.g. the ghost) actually face -- if you add a
    // model that faces the opposite way, override this per-instance via
    // visual.facing.forward: [0, 0, 1] rather than changing the default.
    forward = [0, 0, -1],
    // Squared-length threshold below which a direction is treated as "no
    // meaningful input" and ignored, rather than as a real (tiny) target.
    minMoveLengthSq = 1e-6,
  } = options;

  const targetQuaternion = new THREE.Quaternion().copy(object3D.quaternion);
  const forwardVec = (
    Array.isArray(forward) ? new THREE.Vector3(...forward) : forward.clone()
  ).normalize();
  const _dir = new THREE.Vector3();
  let isEnabled = enabled;

  function setDirection(dirVector3) {
    if (!isEnabled || !dirVector3) return;
    _dir.copy(dirVector3);
    _dir.y = 0; // yaw only -- vertical movement (jumping, falling) shouldn't pitch the character
    if (_dir.lengthSq() < minMoveLengthSq) return; // keep last facing
    _dir.normalize();
    targetQuaternion.setFromUnitVectors(forwardVec, _dir);
  }

  // Call once per render frame with a real elapsed-time delta (not the
  // physics interpolation alpha) -- rotation easing should track wall-clock
  // time, independent of how many physics sub-steps ran this frame.
  function update(dt) {
    if (!isEnabled) return;
    if (turnSpeed <= 0) {
      object3D.quaternion.copy(targetQuaternion);
      return;
    }
    object3D.quaternion.rotateTowards(targetQuaternion, turnSpeed * dt);
  }

  // Skips the easing and jumps straight to the current target -- handy
  // right after spawning/teleporting so the character doesn't visibly
  // wind up to face the right way from an arbitrary starting rotation.
  function snapToTarget() {
    object3D.quaternion.copy(targetQuaternion);
  }

  function setEnabled(next) {
    isEnabled = next;
  }

  return {
    setDirection,
    update,
    snapToTarget,
    setEnabled,
    get enabled() {
      return isEnabled;
    },
  };
}
