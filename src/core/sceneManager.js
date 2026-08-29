// src/core/sceneManager.js
//
// Coordinates switching between scenes: building a fresh THREE.Scene,
// clearing the previous scene's physics content, handing the new scene to
// a scene-builder function, and re-pointing the player at the result.
//
// A single PhysicsWorld (and therefore a single Rapier World) is kept
// alive for the application's entire lifetime. Re-initializing Rapier on
// every scene change isn't necessary -- only the managed-object set and
// the active THREE.Scene reference need to change between scenes, which
// is what PhysicsWorld.clear() / setScene() exist for.
//
// SCENE BUILDER CONTRACT
// A scene builder is any function with the signature
//   (scene, physicsWorld, api) => { spawnPoint?, destroy? }
// or an async version of the same, returning a Promise of that shape --
// loadScene() awaits the result either way. It populates `scene` and
// registers whatever it creates with `physicsWorld` (directly via
// physicsWorld.add(), or indirectly through self-registering helpers such
// as createStairs()). Anything registered with physicsWorld is torn down
// automatically by physicsWorld.clear() on the next scene switch and does
// not need to be included in the returned destroy(). destroy() only needs
// to cover plain scene-graph content that
// physicsWorld never tracked -- lights, grids, skyboxes, and similar.
// `spawnPoint` (an [x, y, z], optional) tells SceneManager where to place
// the player in the new scene.
//
// The third argument, `api`, is { requestSwitch, ...builderArgs }:
//   - api.requestSwitch is SceneManager's own requestSwitch(), bound and
//     ready to call -- pass it straight to anything inside the scene that
//     needs to trigger a switch on its own schedule, such as a
//     LevelSwitcher reacting to the player entering a trigger volume.
//   - ...builderArgs is whatever was passed in loadScene()'s
//     `builderArgs` option, spread directly into `api`. This is how two
//     scenes can reference each other (e.g. each pointing a LevelSwitcher
//     at the other) without importing one another: the caller (or a small
//     wiring module) supplies each scene with the other scene's builder
//     function as a builderArg, rather than the scene files knowing about
//     each other directly.
//
// DEFERRED SWITCHING
// requestSwitch(sceneBuilder, options) does not switch scenes immediately
// -- it only records the request. A scene switch tears down physics
// objects via physicsWorld.clear(), and doing that while
// physicsWorld.step() is mid-iteration over those same objects (e.g. from
// inside a LevelSwitcher's beforePhysicsStep()) would corrupt that
// iteration. update() performs any pending request instead, and is meant
// to be called once per rendered frame, after physicsWorld.step() /
// updateMeshes() have both returned for that frame -- see main.js's
// animate() loop.
//
// PLAYER LIFECYCLE
// The player can either be carried across a scene switch or replaced:
//   - keepPlayer: true reuses the existing player's camera, controls, and
//     physics body, relocating it to the new scene's spawn point. Used
//     for transitions where the player's identity persists (e.g. walking
//     between rooms of the same level). Internally this pulls the player
//     out of PhysicsWorld's managed set (via unmanage()) before clearing
//     the outgoing scene, since clear() would otherwise destroy the
//     player's rigid body along with everything else -- then re-adds it
//     once the new scene exists.
//   - Omitting keepPlayer (or passing a createPlayer callback with it
//     false) destroys the current player and builds a new one via
//     createPlayer(scene, physicsWorld, spawnPoint). Used where the
//     player shouldn't persist (e.g. a menu screen, or a level restart).
//
// physicsWorld.player is kept pointed at whichever player is currently
// active, so objects that need to react to the player (again, a
// LevelSwitcher's proximity check) can read it without being individually
// wired to a specific player instance.
//
// FALL RESPAWN
// SceneManager also owns a FallRespawner (see fallRespawner.js) and calls
// its check() once per frame from update(), teleporting the player back
// to the current scene's spawnPoint if they've fallen below
// `fallThreshold`. It lives here rather than as a physicsWorld-managed
// object because it needs to keep watching across every scene switch
// without needing the unmanage()-before-clear() treatment the player
// itself gets -- SceneManager already persists for the app's whole
// lifetime and already tracks both the player and the current spawn
// point, so it's the natural owner.

import * as THREE from "three";
import { FallRespawner } from "./fallRespawner.js";

export class SceneManager {
  constructor(physicsWorld, options = {}) {
    const { fallThreshold = -20 } = options;
    this.physicsWorld = physicsWorld;
    this.scene = null;
    this.player = null;
    this.spawnPoint = null;
    this.fallRespawner = new FallRespawner({ fallThreshold });
    this._sceneDestroy = null;
    this._pendingSwitch = null;
    this._switching = false;
  }

  // Switches to a new scene built by `sceneBuilder`. Returns
  // { scene, player, ...whatever else the builder returned }.
  async loadScene(
    sceneBuilder,
    { createPlayer, keepPlayer = false, builderArgs = {} } = {},
  ) {
    // If the player is being carried over, pull it out of PhysicsWorld's
    // managed set BEFORE clear() runs below -- clear() unconditionally
    // destroys everything it's tracking, including the player's rigid
    // body, regardless of keepPlayer's intent. Without this, the
    // "kept" player's body would already be freed by the time the
    // keepPlayer branch further down tries to reposition it.
    if (keepPlayer && this.player) {
      this.physicsWorld.unmanage(this.player);
    }

    // Remove whatever the outgoing scene added that physicsWorld doesn't
    // track (lights, grids, ...) before the physics-managed content goes.
    this._sceneDestroy?.();

    // Destroys every remaining physics-managed object from the outgoing
    // scene and resets the fixed-timestep accumulator. The player was
    // already excluded above if it's being kept.
    this.physicsWorld.clear();

    if (!keepPlayer && this.player) {
      this.player.destroy?.();
      this.player = null;
    }

    const newScene = new THREE.Scene();
    this.physicsWorld.setScene(newScene);

    // Awaited so a scene builder can itself be async (e.g. one that
    // awaits loadPhysicsPropGLB() while setting up) -- `await` on a
    // plain (non-Promise) return value just resolves it immediately, so
    // synchronous scene builders work exactly as before. Note this means
    // the switch blocks on the builder's work finishing, including any
    // GLB fetch/parse it awaits -- fine for a straightforward example,
    // but see loadPhysicsGLB's own comments if a scene's load time ever
    // becomes noticeable and background-loading ahead of the switch
    // becomes worth doing.
    const result =
      (await sceneBuilder(newScene, this.physicsWorld, {
        requestSwitch: this.requestSwitch.bind(this),
        ...builderArgs,
      })) ?? {};
    this._sceneDestroy = result.destroy ?? null;
    const spawnPoint = result.spawnPoint ?? [0, 0, 0];
    this.spawnPoint = spawnPoint;

    if (keepPlayer && this.player) {
      const [x, y, z] = spawnPoint;
      this.player.body.setTranslation({ x, y, z }, true);
      // Object3D.add() re-parents automatically, dropping the mesh from
      // whatever scene it belonged to before.
      newScene.add(this.player.mesh);
      // Re-register with the new scene's managed set -- unmanage() above
      // only protected it from clear(), it still needs beforePhysicsStep/
      // afterPhysicsStep/updateMesh calls going forward.
      this.physicsWorld.add(this.player);
    } else if (createPlayer) {
      this.player = createPlayer(newScene, this.physicsWorld, spawnPoint);
      this.physicsWorld.add(this.player);
    }

    this.physicsWorld.player = this.player;
    this.scene = newScene;
    return { scene: newScene, player: this.player, ...result };
  }

  // Records a scene-switch request for update() to perform on the next
  // call, rather than switching immediately. See the file header
  // ("DEFERRED SWITCHING") for why. A request made while another is
  // already pending replaces it.
  requestSwitch(sceneBuilder, options = {}) {
    this._pendingSwitch = { sceneBuilder, options };
  }

  // Call once per rendered frame, after physicsWorld.step() and
  // updateMeshes() have both returned. Checks whether the player has
  // fallen below the respawn threshold and, separately, performs any
  // switch requested via requestSwitch() since the last call. Safe to
  // call every frame even when nothing is pending.
  update() {
    this.fallRespawner.check(this.player, this.spawnPoint);

    if (this._switching || !this._pendingSwitch) return;
    const { sceneBuilder, options } = this._pendingSwitch;
    this._pendingSwitch = null;
    this._switching = true;
    this.loadScene(sceneBuilder, options).finally(() => {
      this._switching = false;
    });
  }

  // Full teardown -- destroys the current scene's non-physics content, the
  // player (if any), and clears the physics world. Does not touch the
  // Rapier World itself; PhysicsWorld owns that.
  destroy() {
    this._sceneDestroy?.();
    this.player?.destroy?.();
    this.physicsWorld.clear();
    this.physicsWorld.player = null;
    this.scene = null;
    this.player = null;
    this.spawnPoint = null;
    this._sceneDestroy = null;
    this._pendingSwitch = null;
  }
}

export function createSceneManager(physicsWorld, options = {}) {
  return new SceneManager(physicsWorld, options);
}
