// src/objects/createLevelSwitcher.js
//
// A physics object that requests a scene switch when the player comes
// within range of it. Visually it's a plain cube -- a placeholder look,
// swap in a model or a different primitive as needed -- sitting on top of
// a sphere physics volume. The collider shape and the drawn mesh are
// intentionally independent, the same split used throughout this codebase
// between a physics capsule and whatever gets drawn at its location (see
// playerVisual.js).
//
// The Rapier collider is a sensor: it reports overlaps without a solid
// collision response, so the player and other dynamic bodies pass through
// it rather than bumping into it. It's built as a real sensor collider
// (rather than skipped entirely) so it shows up correctly in Rapier's
// debug wireframe and is available if this is ever upgraded to use
// Rapier's collision-event queue.
//
// DETECTION APPROACH
// physicsWorld.step() doesn't currently set up a Rapier EventQueue, so
// this checks proximity by hand each fixed physics step: it compares its
// own position against physicsWorld.player's rigid body position (see the
// `player` getter/setter added to PhysicsWorld) rather than listening for
// a true sensor-intersection event. That's simple and accurate enough for
// a single sphere trigger; if this grows to many overlapping triggers, an
// EventQueue-based approach would scale better.
//
// SCENE-SWITCH TIMING
// Triggering the switch here does not perform it directly. A scene switch
// tears down physics objects via physicsWorld.clear(), and doing that from
// inside beforePhysicsStep() -- itself called from within
// physicsWorld.step()'s own loop over those same managed objects -- would
// mutate the collection currently being iterated. Instead, `requestSwitch`
// is expected to be SceneManager's deferred requestSwitch() (see
// sceneManager.js), which only records the request; the actual switch
// runs once per rendered frame, outside the physics step loop.
//
// PLACEMENT NOTE
// Since a switch typically relocates the player to the destination
// scene's spawnPoint (see SceneManager's keepPlayer handling), avoid
// placing a switcher at or near that scene's own spawnPoint -- otherwise
// the player would land inside its trigger radius and immediately bounce
// back to the scene they just left. The same goes for other solid
// geometry: a switcher placed inside/behind something solid is physically
// unreachable even though its sensor volume itself doesn't block anyone.
//
// SPIN
// The cube spins slowly by default via rotationEffect.js -- mostly so it
// visually reads as an interactive object rather than level dressing.
// Pass `spin: false` to turn it off, or `spin: { axis, speed, ... }` to
// customize it; see options.spin below and rotationEffect.js for the full
// option list. Accessible afterward as `switcher.spin` (e.g.
// `switcher.spin.setEnabled(false)`) for toggling at runtime.

import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { createRotationEffect } from "../core/rotationEffect.js";

export class LevelSwitcher {
  constructor(scene, physicsWorld, options = {}) {
    const {
      position = [0, 0, 0],
      triggerRadius = 1.0,
      cubeSize = 1.0,
      color = 0x9b5de5,
      requestSwitch, // () => void, called once when the player enters range
      // Continuous rotation applied to the cube -- see rotationEffect.js.
      // `true`/`{}` (default) spins it with rotationEffect's own
      // defaults; `false` turns it off entirely; an options object
      // customizes axis/speed/rampSpeed.
      spin = true,
    } = options;

    if (typeof requestSwitch !== "function") {
      throw new Error("LevelSwitcher: `requestSwitch` callback is required");
    }

    this.scene = scene;
    this.physicsWorld = physicsWorld;
    this.requestSwitch = requestSwitch;
    this.triggerRadius = triggerRadius;
    this._triggered = false;
    this._clock = new THREE.Clock();

    const [x, y, z] = position;

    // Visual: a plain cube, unrelated in shape/size to the sphere
    // collider below it.
    this.mesh = new THREE.Mesh(
      new THREE.BoxGeometry(cubeSize, cubeSize, cubeSize),
      new THREE.MeshStandardMaterial({ color }),
    );
    this.mesh.position.set(x, y, z);
    this.mesh.castShadow = true;
    scene.add(this.mesh);

    const spinOptions = spin === true ? {} : spin === false ? { enabled: false } : spin;
    this.spin = createRotationEffect(this.mesh, spinOptions);

    // Physics: a fixed sensor sphere -- static, and non-solid so nothing
    // ever collides with it, only overlaps it.
    const bodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z);
    this.body = physicsWorld.world.createRigidBody(bodyDesc);

    const colliderDesc = RAPIER.ColliderDesc.ball(triggerRadius).setSensor(true);
    this.collider = physicsWorld.world.createCollider(colliderDesc, this.body);
  }

  // Called by physicsWorld.step() BEFORE each fixed world.step(). See the
  // file header for why this only flags a request rather than switching
  // immediately.
  beforePhysicsStep() {
    if (this._triggered) return;

    const player = this.physicsWorld.player;
    if (!player?.body) return;

    const p = this.body.translation();
    const q = player.body.translation();
    const dx = p.x - q.x;
    const dy = p.y - q.y;
    const dz = p.z - q.z;
    const distSq = dx * dx + dy * dy + dz * dz;

    if (distSq <= this.triggerRadius * this.triggerRadius) {
      this._triggered = true;
      this.requestSwitch();
    }
  }

  // Position is static and set once at construction -- no mesh
  // interpolation needed, unlike createPhysicsObject.js's snap-to-body
  // sync. This exists purely to drive the spin effect, which needs a
  // real elapsed-time delta; PhysicsWorld.updateMeshes() calls update()
  // with no arguments, so a small internal clock (same approach as
  // playerVisual.js's animation/facing/hover update) supplies one.
  update() {
    const dt = this._clock.getDelta();
    this.spin.update(dt);
  }

  destroy() {
    this.scene.remove(this.mesh);
    this.physicsWorld.world.removeRigidBody(this.body);
  }
}

// Thin factory wrapper for drop-in compatibility with code that calls
// createLevelSwitcher(...) instead of `new LevelSwitcher(...)`. Follows
// the explicit-registration convention used by createPhysicsBox.js rather
// than self-registering: the caller is expected to call
// physicsWorld.add(switcher) itself.
export function createLevelSwitcher(scene, physicsWorld, options = {}) {
  return new LevelSwitcher(scene, physicsWorld, options);
}
