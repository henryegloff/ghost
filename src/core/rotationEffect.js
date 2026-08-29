// src/core/rotationEffect.js
//
// A small, standalone continuous-rotation animation for any Object3D:
// spins it around a chosen axis at a constant angular speed. Not specific
// to any one object -- attach it to a level switcher's mesh, a pickup, a
// spinning coin, whatever needs a simple idle spin to read as
// interactive.
//
// Shaped after hoverEffect.js (enabled/disabled state that eases rather
// than snaps, an update(dt) called once per render frame, a setEnabled()
// toggle), but with one deliberate difference in how disabling behaves:
//
//   hoverEffect always measures its bob/sway relative to a fixed "base"
//   pose, so fading out returns the object to rest at that exact pose.
//   That's right for a bob -- it's an oscillation around a fixed point.
//
//   A spin has no natural "rest pose" to return to -- it's a rotation
//   that accumulates indefinitely. So disabling this effect doesn't ease
//   back to some base orientation; it eases the RATE of rotation down to
//   zero and then simply stops, freezing the object at whatever
//   orientation it had reached. Re-enabling eases the rate back up from
//   there rather than resuming from a remembered starting pose.
//
// Rotation is applied via Object3D.rotateOnAxis(), which rotates the
// object incrementally about an axis in its own local space and composes
// naturally with whatever orientation it already has -- unlike
// hoverEffect, this needs no captured base pose at all.
//
// Usage:
//   const spin = createRotationEffect(someObject3D, { axis: "y", speed: 1.5 });
//   // once per render frame, with a real elapsed-time delta:
//   spin.update(dt);

import * as THREE from "three";

const NAMED_AXES = {
  x: new THREE.Vector3(1, 0, 0),
  y: new THREE.Vector3(0, 1, 0),
  z: new THREE.Vector3(0, 0, 1),
};

function resolveAxis(axis) {
  const vec =
    typeof axis === "string"
      ? NAMED_AXES[axis]?.clone()
      : Array.isArray(axis)
        ? new THREE.Vector3(...axis)
        : axis?.clone();

  if (!vec) {
    console.warn(
      `createRotationEffect: unrecognized axis "${axis}" -- expected ` +
        `'x' | 'y' | 'z', a [x, y, z] array, or a THREE.Vector3. ` +
        "Falling back to 'y'.",
    );
    return NAMED_AXES.y.clone();
  }
  return vec.normalize();
}

export function createRotationEffect(object3D, options = {}) {
  const {
    enabled = true,
    axis = "y", // 'x' | 'y' | 'z' | THREE.Vector3 | [x, y, z]
    speed = 1.0, // radians per second, at full ramp
    // How fast the effective rotation rate eases toward its
    // enabled/disabled target (exponential, per second) -- higher
    // ramps up/down faster. See the file header for why this eases the
    // RATE rather than easing back to a fixed pose the way hoverEffect
    // does.
    rampSpeed = 4,
  } = options;

  let isEnabled = enabled;
  let rateScale = enabled ? 1 : 0; // eased 0..1 multiplier, mirrors hoverEffect's amplitudeScale
  let axisVec = resolveAxis(axis);
  let currentSpeed = speed;

  function setEnabled(next) {
    isEnabled = next;
  }

  function setAxis(next) {
    axisVec = resolveAxis(next);
  }

  function setSpeed(next) {
    currentSpeed = next;
  }

  // Call once per render frame with a real elapsed-time delta.
  function update(dt) {
    const targetScale = isEnabled ? 1 : 0;
    rateScale += (targetScale - rateScale) * Math.min(1, rampSpeed * dt);

    // Fully stopped and settled -- skip the (inaudible but not free)
    // rotation call entirely, same early-out hoverEffect uses.
    if (rateScale < 1e-4 && targetScale === 0) return;

    object3D.rotateOnAxis(axisVec, currentSpeed * rateScale * dt);
  }

  return {
    update,
    setEnabled,
    setAxis,
    setSpeed,
    get enabled() {
      return isEnabled;
    },
    get speed() {
      return currentSpeed;
    },
  };
}
