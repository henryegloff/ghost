// src/physics/physicsWorld.js
//
// Refactored from a factory function into a class: this module owns
// long-lived, mutable state (the Rapier world, the scene reference, the
// fixed-timestep accumulator, the set of managed objects, debug-render
// buffers) across many method calls over the object's lifetime -- exactly
// the shape a class is meant for. Truly private bookkeeping (accumulator,
// physics step size, debug buffers, the managed-object set) lives behind
// `_`-prefixed fields (a naming convention, not engine-enforced) so it
// reads as private even though it isn't hard-fenced, matching the
// closure-private behaviour of the original factory. `world`, `scene`,
// `alpha`, and `debugEnabled` stay as read-only getters, same as before.
import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";

export class PhysicsWorld {
  _world = null;
  _scene = null;
  _managedObjects = new Set();

  _physicsStep = 1 / 60;
  _accumulator = 0;
  _alpha = 0;

  _debugEnabled;
  _debugLines = null;
  _debugGeometry = null;
  _initialGravity;

  constructor(options = {}) {
    const { gravity = { x: 0, y: -9.81, z: 0 }, debug = false } = options;
    this._initialGravity = PhysicsWorld._parseGravity(gravity);
    this._debugEnabled = debug;
  }

  // Helper to normalize gravity whether passed as array [x, y, z] or object { x, y, z }
  static _parseGravity(g) {
    return Array.isArray(g) ? { x: g[0], y: g[1], z: g[2] } : g;
  }

  async init(targetScene) {
    await RAPIER.init();
    this._world = new RAPIER.World(this._initialGravity);
    this._scene = targetScene;

    // Setup debug wireframe geometry
    this._debugGeometry = new THREE.BufferGeometry();
    const debugMaterial = new THREE.LineBasicMaterial({ vertexColors: true });
    this._debugLines = new THREE.LineSegments(this._debugGeometry, debugMaterial);

    // Set initial debug visibility based on instantiation option
    this._debugLines.visible = this._debugEnabled;
    this._scene.add(this._debugLines);
  }

  setDebug(enabled) {
    this._debugEnabled = enabled;
    if (this._debugLines) {
      this._debugLines.visible = enabled;
    }
  }

  toggleDebug() {
    this.setDebug(!this._debugEnabled);
  }

  // Helper to change gravity at runtime
  setGravity(newGravity) {
    const g = PhysicsWorld._parseGravity(newGravity);
    if (this._world) {
      this._world.gravity = g;
    }
  }

  add(physicsObject) {
    const hasSyncHook =
      physicsObject.update ||
      physicsObject.updateMesh ||
      physicsObject.beforePhysicsStep ||
      physicsObject.afterPhysicsStep;

    if (!hasSyncHook) {
      console.warn(
        "PhysicsWorld.add(): object has none of update()/updateMesh()/" +
          "beforePhysicsStep()/afterPhysicsStep() -- it will be tracked " +
          "but never synced each frame. Did you forget to implement one " +
          "of these on your physics object?",
        physicsObject,
      );
    }

    this._managedObjects.add(physicsObject);
    return physicsObject;
  }

  remove(physicsObject) {
    if (this._managedObjects.has(physicsObject)) {
      physicsObject.destroy?.();
      this._managedObjects.delete(physicsObject);
    }
  }

  // Advances the simulation using a fixed timestep, accumulating leftover
  // frame time across calls. Any managed object can optionally implement
  // beforePhysicsStep(dt) / afterPhysicsStep() to capture pre/post-step
  // transforms for render interpolation -- see core/playerController.js
  // for the reference implementation.
  //
  // Returns the interpolation alpha (0..1) for the leftover, un-simulated
  // time in this frame -- pass it to updateMeshes() when rendering.
  step(dt) {
    if (!this._world) return this._alpha;

    this._accumulator += Math.min(dt, 0.1);

    while (this._accumulator >= this._physicsStep) {
      for (const obj of this._managedObjects) {
        obj.beforePhysicsStep?.(this._physicsStep);
      }

      this._world.step();

      for (const obj of this._managedObjects) {
        obj.afterPhysicsStep?.();
      }

      this._accumulator -= this._physicsStep;
    }

    this._alpha = this._accumulator / this._physicsStep;

    // Render debug lines if enabled
    if (this._debugEnabled) {
      const { vertices, colors } = this._world.debugRender();
      this._debugGeometry.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
      this._debugGeometry.setAttribute("color", new THREE.BufferAttribute(colors, 4));
    }

    return this._alpha;
  }

  // Syncs visual meshes to their physics bodies. Call once per render frame
  // (not per physics sub-step). Objects that expose updateMesh(alpha) get
  // interpolated between their last two captured physics states (smooth,
  // accurate). Objects that only expose update() are snapped straight to
  // the current transform, which is fine for simple props.
  //
  // The debug flag is forwarded as a second argument so objects can match
  // debug-mode behaviour: Rapier's debug wireframes always draw the exact
  // current physics state, so an interpolated mesh will visibly trail them
  // by up to one physics step. Snapping straight to the current transform
  // while debugging keeps the mesh glued to its collider; interpolation
  // kicks back in once debug is off.
  updateMeshes(alphaOverride) {
    const a = alphaOverride ?? this._alpha;
    for (const obj of this._managedObjects) {
      if (obj.updateMesh) {
        obj.updateMesh(a, this._debugEnabled);
      } else {
        obj.update?.();
      }
    }
  }

  get world() {
    return this._world;
  }

  get scene() {
    return this._scene;
  }

  get alpha() {
    return this._alpha;
  }

  get debugEnabled() {
    return this._debugEnabled;
  }
}

// Thin factory wrapper for drop-in compatibility with code that still
// calls createPhysicsWorld(...) instead of `new PhysicsWorld(...)`.
export function createPhysicsWorld(options = {}) {
  return new PhysicsWorld(options);
}
