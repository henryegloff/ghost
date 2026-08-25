// src/core/hoverEffect.js
//
// A small, standalone "floating" animation for any Object3D: a smooth
// vertical bob plus an optional gentle rotational sway. Not player- or
// ghost-specific -- attach it to whatever you want to hover (the player's
// visual pivot, a pickup item, a floating enemy, ...).
//
// The motion itself is driven by sine waves, so it's continuous and
// inherently smooth with no popping between frames. On top of that,
// enabling/disabling the effect eases its amplitude toward 0 or 1 (see
// `fadeSpeed`) instead of snapping the object to/from its resting pose --
// so toggling hover mid-flight doesn't visibly jerk.
//
// IMPORTANT: this module owns the position/rotation of whatever object you
// give it -- each update() call sets the object's position/rotation
// relative to a fixed "base" pose captured at creation time (or via
// setBasePosition/setBaseRotation). Don't also drive that same object's
// transform from somewhere else, or the two will fight. In playerVisual.js
// this is why hover is applied to its own dedicated child pivot rather
// than to the physics-tracked root.
//
// Usage:
//   const hover = createHoverEffect(someObject3D, { amplitude: 0.15 });
//   // once per render frame, with a real elapsed-time delta:
//   hover.update(dt);

import * as THREE from "three";

export function createHoverEffect(object3D, options = {}) {
  const {
    enabled = true,
    amplitude = 0.15, // vertical bob distance, world units
    frequency = 0.6, // bob cycles per second
    verticalAxis = "y", // which local axis bobs -- 'x' | 'y' | 'z'
    sway = 0.0, // rotational tilt amplitude, radians (0 disables sway entirely)
    swayAxis = "z", // which local axis to tilt around
    // Slightly offset from the bob frequency by default so the two don't
    // stay perfectly in phase -- reads as a more organic, less
    // metronomic float.
    swayFrequency = frequency * 0.75,
    // Randomized per instance by default so multiple hovering objects
    // (several ghosts, a cluster of pickups) don't all bob in lockstep.
    // Pass a fixed number if you want them synchronized instead.
    phase = Math.random() * Math.PI * 2,
    // How fast the effect's amplitude eases toward its enabled/disabled
    // target (exponential, per second) -- higher fades in/out faster.
    fadeSpeed = 4,
  } = options;

  let isEnabled = enabled;
  let amplitudeScale = enabled ? 1 : 0; // eased 0..1 multiplier so toggling never pops
  let elapsed = 0;

  const basePosition = object3D.position.clone();
  const baseRotation = object3D.rotation.clone();

  function setEnabled(next) {
    isEnabled = next;
  }

  function setBasePosition(vec3) {
    basePosition.copy(vec3);
  }

  function setBaseRotation(euler) {
    baseRotation.copy(euler);
  }

  // Call once per render frame with a real elapsed-time delta.
  function update(dt) {
    elapsed += dt;

    const targetScale = isEnabled ? 1 : 0;
    // Frame-rate-independent exponential ease toward the target amplitude.
    amplitudeScale += (targetScale - amplitudeScale) * Math.min(1, fadeSpeed * dt);

    // Once fully faded out and settled, skip the (inaudible but not
    // free) trig calls and just rest at the exact base pose.
    if (amplitudeScale < 1e-4 && targetScale === 0) {
      object3D.position.copy(basePosition);
      object3D.rotation.copy(baseRotation);
      return;
    }

    const bob =
      Math.sin(elapsed * frequency * Math.PI * 2 + phase) * amplitude * amplitudeScale;
    object3D.position.copy(basePosition);
    object3D.position[verticalAxis] += bob;

    if (sway !== 0) {
      const tilt =
        Math.sin(elapsed * swayFrequency * Math.PI * 2 + phase) * sway * amplitudeScale;
      object3D.rotation.copy(baseRotation);
      object3D.rotation[swayAxis] += tilt;
    }
  }

  return {
    update,
    setEnabled,
    setBasePosition,
    setBaseRotation,
    get enabled() {
      return isEnabled;
    },
  };
}
