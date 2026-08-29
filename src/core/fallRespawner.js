// src/core/fallRespawner.js
//
// Watches the current player's vertical position and teleports them back
// to the active scene's spawn point if they fall below a configurable y
// threshold -- catches a player who's slipped through a gap, walked off
// the edge of a platform, or otherwise ended up somewhere unrecoverable.
//
// Not registered with PhysicsWorld's managed-object set the way most
// gameplay objects in this codebase are (LevelSwitcher, MovingPlatform,
// ...): physicsWorld.clear() destroys everything it's tracking on every
// scene switch, and this needs to go on watching continuously ACROSS
// switches without needing the same unmanage()-before-clear() SceneManager
// already does to protect the player itself. Instead, SceneManager owns a
// single instance for its whole lifetime and calls check() once per frame
// from its own update() -- see sceneManager.js.
//
// check() runs once per rendered frame rather than once per fixed physics
// step -- unlike LevelSwitcher's proximity check, exact timing doesn't
// matter here, so frame-level granularity is simpler and plenty precise
// for "did they fall off the world".
//
// Usage:
//   const respawner = new FallRespawner({ fallThreshold: -20 });
//   // once per frame, given the current player and where they should
//   // respawn to:
//   respawner.check(player, spawnPoint);

export class FallRespawner {
  constructor(options = {}) {
    const { fallThreshold = -20 } = options;
    this.fallThreshold = fallThreshold;
  }

  // `player` is whatever SceneManager.player currently is -- every player
  // controller in this codebase (playerController.js,
  // playerControllerExtended.js, flowController.js) returns an object
  // exposing `.body`, so this works with any of them. `spawnPoint` is an
  // [x, y, z]. No-ops if either is missing, so it's safe to call every
  // frame even before a player/scene exists.
  check(player, spawnPoint) {
    if (!player?.body || !spawnPoint) return;

    const pos = player.body.translation();
    if (pos.y >= this.fallThreshold) return;

    const [x, y, z] = spawnPoint;
    player.body.setTranslation({ x, y, z }, true);

    // Zero out momentum too -- otherwise the player reappears at the
    // spawn point still carrying whatever velocity (usually a large
    // downward one, from however far they'd fallen) they had, and either
    // shoots off or falls straight through the floor again immediately.
    player.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    player.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }
}

export function createFallRespawner(options = {}) {
  return new FallRespawner(options);
}
