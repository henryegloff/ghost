// src/core/assetLoader.js
//
// A shared, cached GLTF preloader. Fetching and parsing a .glb is the
// expensive part of loading it (network round-trip + geometry/material
// parsing on the main thread) -- this caches that work per URL, so:
//
//   - Calling preloadGLB(url) for the same URL twice (from two different
//     scenes, or a scene and main.js's own preloading) only fetches once;
//     the second caller gets the same in-flight/already-resolved promise.
//   - createPhysicsGLB.js and playerVisual.js both route their model
//     loading through this cache instead of creating their own
//     independent GLTFLoader.load() calls. Once an asset has been
//     preloaded, using it (placing it in a scene, spawning the player)
//     resolves instantly instead of kicking off a live network fetch at
//     that moment -- which matters specifically at a scene-switch
//     boundary. See sceneManager.js and main.js's boot sequence for why a
//     slow/uncached fetch happening mid-switch is a real problem, not
//     just a performance nicety: PhysicsWorld.step() keeps running every
//     frame for however long that fetch takes, with the scene left in a
//     half-built, unmanaged state for an unbounded stretch.
//
// Each preload resolves to the raw loaded GLTF object (as GLTFLoader
// returns it). Callers that want to actually PLACE the model in a scene
// (rather than just warm the cache) must clone `.scene` before
// parenting/repositioning it, since the cached object is the same shared
// instance every caller gets back -- reusing it directly across two
// simultaneous placements would have them fight over one transform. Use
// gltf.scene.clone() for ordinary static meshes; for a skinned/animated
// model, use three's SkeletonUtils.clone() instead, since a plain clone
// doesn't correctly rebind skinned-mesh bone references to a cloned
// skeleton (see playerVisual.js, which does have an animated model).
//
// PROGRESS
// Progress is tracked by ITEM COUNT (assets settled / assets requested),
// not bytes -- simpler and more robust than summing Content-Length-
// dependent byte progress across several different-sized files, and
// plenty precise for a loading bar over a handful of assets. Subscribe
// with onProgress(callback); it's called with { loaded, total } both when
// a new preload is requested (total goes up immediately) and whenever one
// settles (loaded goes up) -- including on failure, so one broken URL
// doesn't stall the bar forever.

import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

const gltfLoader = new GLTFLoader();

// url -> Promise<GLTF>
const cache = new Map();

let totalRequested = 0;
let totalSettled = 0;
const progressListeners = new Set();

function emitProgress() {
  const snapshot = { loaded: totalSettled, total: totalRequested };
  for (const listener of progressListeners) listener(snapshot);
}

// Starts (or returns the existing) load for `url`. Safe to call more than
// once for the same URL -- later calls just return the same promise
// rather than re-fetching.
export function preloadGLB(url) {
  if (cache.has(url)) return cache.get(url);

  totalRequested += 1;
  emitProgress(); // reflects the new total immediately, even before it settles

  const promise = new Promise((resolve, reject) => {
    gltfLoader.load(
      url,
      (gltf) => resolve(gltf),
      undefined, // onProgress -- per-file byte progress isn't used, see file header
      (error) => reject(error),
    );
  });

  // Track settlement for progress regardless of success/failure. Attached
  // as a separate .then() (not affecting what `promise` itself resolves/
  // rejects to) so this bookkeeping never changes what a caller awaiting
  // the cached promise actually receives.
  promise.then(
    () => {
      totalSettled += 1;
      emitProgress();
    },
    () => {
      totalSettled += 1;
      emitProgress();
    },
  );

  cache.set(url, promise);
  return promise;
}

// Preloads several URLs at once, resolving once all have settled (success
// or failure) rather than failing fast -- one broken asset shouldn't
// block every other one in the batch from finishing. Returns an array of
// { url, status: "fulfilled" | "rejected", gltf?, error? }, in the same
// order as `urls`.
export async function preloadAll(urls) {
  const results = await Promise.allSettled(urls.map((url) => preloadGLB(url)));
  return results.map((result, i) => ({
    url: urls[i],
    status: result.status,
    gltf: result.status === "fulfilled" ? result.value : undefined,
    error: result.status === "rejected" ? result.reason : undefined,
  }));
}

// Synchronously returns the cached promise for `url` if a preload has
// already been started for it (in flight or already settled), or
// undefined if nothing has requested it yet.
export function getCachedGLB(url) {
  return cache.get(url);
}

// Subscribe to progress updates. Returns an unsubscribe function.
export function onProgress(listener) {
  progressListeners.add(listener);
  return () => progressListeners.delete(listener);
}

export function getProgress() {
  return { loaded: totalSettled, total: totalRequested };
}
