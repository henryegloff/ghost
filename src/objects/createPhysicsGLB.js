// src/objects/createPhysicsGLB.js
//
// Loads a .glb and turns its meshes into static Rapier colliders, for level
// geometry authored in Blender rather than built out of primitives (compare
// createPhysicsBox.js / createStairs.js, which are code-authored). Covers
// two related use cases with the same underlying loader:
//
//   - loadPhysicsGroundGLB()      -- a single ground/terrain mesh
//   - loadPhysicsEnvironmentGLB() -- a whole hand-built level, many meshes
//
// COLLISION AUTHORING CONVENTION
// Every mesh in the GLB is rendered. Any mesh whose name matches
// `collisionMeshPattern` (default: ends with "_collision") is treated as a
// physics-only proxy: it's hidden (mesh.visible = false) and used to build
// colliders instead of, or in addition to, the visible geometry. This is
// the standard Blender workflow for hand-built environments -- model the
// pretty version, then duplicate + simplify it into a "Rock_collision",
// "Wall_collision", etc. mesh so physics doesn't have to chew on every
// bevel and detail of the visual mesh.
//
// If NO mesh in the file matches that pattern, every visual mesh is used
// as physics geometry instead. That's the common case for a simple ground
// GLB: one mesh, no separate collision proxy needed.
//
// WHY TRIMESH, AND WHY EVERYTHING IS ONE FIXED BODY
// Rapier's trimesh collider takes raw vertex/index buffers, not a
// hierarchy -- it has no concept of "this sub-mesh is offset/rotated
// relative to that one" the way THREE's scene graph does. So each mesh's
// full world transform (position, rotation, scale, and any parent
// transforms in the GLB) is baked directly into its vertex data, in the
// coordinate space of the loaded root object. All of those baked colliders
// then attach to a single fixed RigidBody placed at `position`/`rotation`.
// That's the right structure for static level geometry (it never moves)
// and mirrors how createStairs.js treats "one staircase" as one placeable
// thing even though it's built from many boxes.
//
// Trimesh colliders only make sense on fixed/kinematic bodies (a dynamic
// trimesh has no well-defined mass properties in Rapier) -- fine here
// since ground/environment geometry is static by definition. If you need a
// GLB-shaped object that *moves* or gets picked up, use `colliderType:
// "convexHull"` instead, which approximates each mesh with a convex shape
// that dynamic bodies can use validly.

import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

const gltfLoader = new GLTFLoader();

function loadGLTF(url) {
  return new Promise((resolve, reject) => {
    gltfLoader.load(url, resolve, undefined, reject);
  });
}

// Bakes `mesh`'s full world transform into fresh vertex/index buffers, in
// the local coordinate space of `rootObject` -- i.e. what you'd get if you
// applied every parent transform between `mesh` and `rootObject`, but NOT
// rootObject's own transform (that part is applied separately, to the
// RigidBody itself, so the collider data stays reusable regardless of
// where the caller places the whole GLB in the world).
function bakeMeshToRootSpace(mesh, rootObject) {
  const geometry = mesh.geometry;
  const posAttr = geometry.attributes.position;

  rootObject.updateMatrixWorld(true);
  const rootInverse = new THREE.Matrix4().copy(rootObject.matrixWorld).invert();
  const localToRoot = new THREE.Matrix4().multiplyMatrices(rootInverse, mesh.matrixWorld);

  const vertexCount = posAttr.count;
  const vertices = new Float32Array(vertexCount * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < vertexCount; i++) {
    v.fromBufferAttribute(posAttr, i).applyMatrix4(localToRoot);
    vertices[i * 3] = v.x;
    vertices[i * 3 + 1] = v.y;
    vertices[i * 3 + 2] = v.z;
  }

  let indices;
  if (geometry.index) {
    indices = Uint32Array.from(geometry.index.array);
  } else {
    // Non-indexed geometry -- every 3 consecutive vertices is a triangle,
    // so a trivial 0..N index buffer is equivalent.
    indices = new Uint32Array(vertexCount);
    for (let i = 0; i < vertexCount; i++) indices[i] = i;
  }

  return { vertices, indices };
}

// Core loader. Both convenience wrappers below just call this with
// different defaults -- use it directly if you want more control.
export async function loadPhysicsGLB(scene, physicsWorld, options = {}) {
  const {
    url,
    position = [0, 0, 0],
    rotation = [0, 0, 0], // radians, XYZ euler order
    scale = 1, // number or [x, y, z]
    colliderType = "trimesh", // "trimesh" | "convexHull" | "none"
    collisionMeshPattern = /_collision$/i,
    castShadow = true,
    receiveShadow = true,
    friction = 0.8,
    restitution = 0,
  } = options;

  if (!url) throw new Error("loadPhysicsGLB: `url` is required");

  const gltf = await loadGLTF(url);
  const root = gltf.scene;

  const [px, py, pz] = position;
  root.position.set(px, py, pz);
  root.rotation.set(rotation[0], rotation[1], rotation[2]);
  const [sx, sy, sz] = Array.isArray(scale) ? scale : [scale, scale, scale];
  root.scale.set(sx, sy, sz);
  root.updateMatrixWorld(true);

  scene.add(root);

  // Split meshes into physics-only proxies vs rendered visual meshes,
  // per the naming convention described in the file header.
  const collisionMeshes = [];
  const visualMeshes = [];

  root.traverse((child) => {
    if (!child.isMesh) return;
    if (collisionMeshPattern.test(child.name)) {
      collisionMeshes.push(child);
      child.visible = false;
    } else {
      visualMeshes.push(child);
      child.castShadow = castShadow;
      child.receiveShadow = receiveShadow;
    }
  });

  // No dedicated collision proxies authored -> fall back to using the
  // visible geometry itself for physics (the simple "one ground mesh"
  // case).
  const physicsMeshes = collisionMeshes.length > 0 ? collisionMeshes : visualMeshes;

  const bodyDesc = RAPIER.RigidBodyDesc.fixed()
    .setTranslation(px, py, pz)
    .setRotation(
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rotation[0], rotation[1], rotation[2])),
    );
  const body = physicsWorld.world.createRigidBody(bodyDesc);

  const colliders = [];

  if (colliderType !== "none") {
    for (const mesh of physicsMeshes) {
      const { vertices, indices } = bakeMeshToRootSpace(mesh, root);

      let colliderDesc;
      if (colliderType === "convexHull") {
        colliderDesc = RAPIER.ColliderDesc.convexHull(vertices);
        if (!colliderDesc) {
          console.warn(
            `loadPhysicsGLB: convexHull generation failed for mesh "${mesh.name || "(unnamed)"}" -- skipping it.`,
          );
          continue;
        }
      } else {
        colliderDesc = RAPIER.ColliderDesc.trimesh(vertices, indices);
      }

      colliderDesc.setFriction(friction).setRestitution(restitution);
      colliders.push(physicsWorld.world.createCollider(colliderDesc, body));
    }
  }

  // Static geometry never needs a per-frame update -- the visual root sits
  // at its fixed world transform for good. This no-op just keeps
  // physicsWorld.add() from warning about a missing sync hook.
  function update() {}

  function destroy() {
    scene.remove(root);
    physicsWorld.world.removeRigidBody(body); // also drops its colliders
  }

  const result = { root, body, colliders, visualMeshes, collisionMeshes, update, destroy };

  // Self-registers, same convention as createStairs.js: from the caller's
  // point of view this is one placeable piece of level geometry, not a
  // pile of individual parts to wire up by hand.
  physicsWorld.add(result);

  return result;
}

// Convenience wrapper for the common single-mesh case: a whole GLB treated
// as one static walkable surface. Just loadPhysicsGLB with a name that
// says what it's for at the call site.
export function loadPhysicsGroundGLB(scene, physicsWorld, options = {}) {
  return loadPhysicsGLB(scene, physicsWorld, { colliderType: "trimesh", ...options });
}

// Convenience wrapper for a full hand-built level. Functionally identical
// to loadPhysicsGLB -- the "_collision"-suffix convention it honors is
// what actually makes multi-mesh environments practical (simplified
// invisible proxies alongside detailed visual meshes).
export function loadPhysicsEnvironmentGLB(scene, physicsWorld, options = {}) {
  return loadPhysicsGLB(scene, physicsWorld, { colliderType: "trimesh", ...options });
}
