// src/objects/createPhysicsGLB.js
//
// Loads a .glb and turns its meshes into Rapier colliders, for geometry
// authored in Blender rather than built out of primitives (compare
// createPhysicsBox.js / createStairs.js, which are code-authored). Covers
// three related use cases with the same underlying loader:
//
//   - loadPhysicsGroundGLB()      -- a single static ground/terrain mesh
//   - loadPhysicsEnvironmentGLB() -- a whole static hand-built level
//   - loadPhysicsPropGLB()        -- a single object, static OR dynamic,
//                                     with an explicit mass when dynamic
//
// COLLISION AUTHORING CONVENTION
// Every mesh in the GLB is rendered. Any mesh whose name matches
// `collisionMeshPattern` (default: ends with "_collision") is treated as a
// physics-only proxy: it's hidden (mesh.visible = false) and used to build
// colliders instead of, or in addition to, the visible geometry. This is
// the standard Blender workflow -- model the pretty version, then
// duplicate + simplify it into a "Rock_collision", "Crate_collision", etc.
// mesh so physics doesn't have to chew on every bevel and detail of the
// visual mesh. It applies equally to a static level and to a single prop:
// name a low-poly proxy mesh with the "_collision" suffix in Blender,
// export both meshes in the same .glb, and this loader picks the proxy up
// automatically.
//
// If NO mesh in the file matches that pattern, every visual mesh is used
// as physics geometry instead. That's the common case for a simple object:
// one mesh, no separate collision proxy needed.
//
// WHY EVERYTHING IS ONE BODY
// Rapier's trimesh/convex-hull colliders take raw vertex/index buffers,
// not a hierarchy -- they have no concept of "this sub-mesh is offset/
// rotated relative to that one" the way THREE's scene graph does. So each
// mesh's full world transform (position, rotation, scale, and any parent
// transforms in the GLB) is baked directly into its vertex data, in the
// coordinate space of the loaded root object. All of those baked colliders
// then attach to a single RigidBody placed at `position`/`rotation`. That
// mirrors how createStairs.js treats "one staircase" as one placeable
// thing even though it's built from many boxes.
//
// STATIC VS DYNAMIC, AND WHY THE COLLIDER TYPE DEFAULT DIFFERS
// Trimesh colliders only make sense on fixed/kinematic bodies -- a dynamic
// trimesh has no well-defined mass properties in Rapier. So `colliderType`
// defaults to "trimesh" for a static (`isDynamic: false`) body, since
// trimesh handles arbitrary complex, non-convex geometry well and static
// geometry never needs valid dynamic mass properties anyway; and defaults
// to "convexHull" for a dynamic body, the only shape Rapier accepts there.
// Passing `colliderType: "trimesh"` together with `isDynamic: true` is
// rejected with a warning and downgraded to convexHull rather than left to
// fail inside Rapier itself.
//
// MASS
// For a dynamic body, `mass` sets the body's TOTAL mass directly via
// Rapier's `RigidBodyDesc.setAdditionalMass()`, with every collider's own
// density set to 0 first. Per Rapier's own docs, a body's total mass is
// (additional mass) + (mass computed from attached colliders' densities);
// zeroing collider density removes that second term entirely, so the
// requested `mass` IS the body's total mass, full stop -- rather than an
// amount added on top of some density-derived value that depends on the
// mesh's volume. Rapier still derives the body's rotational inertia shape
// from the collider geometry, it just scales it to match `mass` rather
// than to whatever density=1 would have implied. `mass` is ignored for
// static bodies -- a fixed body has no meaningful mass.

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
//
// `rootScale` is re-applied to the baked vertices explicitly afterward.
// Without this, scaled props end up with a collider sized to the
// unscaled, as-authored-in-Blender geometry: computing "mesh relative to
// root" via rootObject.matrixWorld's inverse cancels root's own scale out
// of the result along with its position/rotation, since matrixWorld bakes
// all three together. Position and rotation SHOULD cancel out here (the
// body is placed at those separately) -- scale shouldn't, since the
// collider should match whatever size the GLB is actually displayed at.
function bakeMeshToRootSpace(mesh, rootObject, rootScale) {
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
    vertices[i * 3] = v.x * rootScale.x;
    vertices[i * 3 + 1] = v.y * rootScale.y;
    vertices[i * 3 + 2] = v.z * rootScale.z;
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

// Core loader. All three convenience wrappers below just call this with
// different defaults -- use it directly if you want more control.
export async function loadPhysicsGLB(scene, physicsWorld, options = {}) {
  const {
    url,
    position = [0, 0, 0],
    rotation = [0, 0, 0], // radians, XYZ euler order
    scale = 1, // number or [x, y, z]
    isDynamic = false,
    mass = 1, // total mass in kg-equivalent units; ignored when isDynamic is false
    colliderType, // "trimesh" | "convexHull" | "none"; defaults below depend on isDynamic
    collisionMeshPattern = /_collision$/i,
    castShadow = true,
    receiveShadow = true,
    friction = 0.8,
    restitution = 0,
  } = options;

  if (!url) throw new Error("loadPhysicsGLB: `url` is required");

  let resolvedColliderType = colliderType ?? (isDynamic ? "convexHull" : "trimesh");
  if (isDynamic && resolvedColliderType === "trimesh") {
    console.warn(
      "loadPhysicsGLB: colliderType \"trimesh\" isn't valid on a dynamic " +
        "body in Rapier (no well-defined mass/inertia) -- using " +
        "\"convexHull\" instead.",
    );
    resolvedColliderType = "convexHull";
  }

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
  // visible geometry itself for physics (the simple "one mesh" case).
  const physicsMeshes = collisionMeshes.length > 0 ? collisionMeshes : visualMeshes;

  const rotationQuat = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(rotation[0], rotation[1], rotation[2]),
  );

  const bodyDesc = isDynamic
    ? RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(px, py, pz)
        .setRotation(rotationQuat)
        .setAdditionalMass(mass)
    : RAPIER.RigidBodyDesc.fixed().setTranslation(px, py, pz).setRotation(rotationQuat);

  const body = physicsWorld.world.createRigidBody(bodyDesc);

  const colliders = [];
  const rootScale = new THREE.Vector3(sx, sy, sz);

  if (resolvedColliderType !== "none") {
    for (const mesh of physicsMeshes) {
      const { vertices, indices } = bakeMeshToRootSpace(mesh, root, rootScale);

      let colliderDesc;
      if (resolvedColliderType === "convexHull") {
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

      // See the file header's MASS section: zeroing density here means
      // the body's total mass comes entirely from setAdditionalMass(mass)
      // above, not from this collider's own (density x volume).
      if (isDynamic) {
        colliderDesc.setDensity(0);
      }

      colliders.push(physicsWorld.world.createCollider(colliderDesc, body));
    }
  }

  // Static geometry never needs a per-frame update -- the visual root
  // sits at its fixed world transform for good. A dynamic body, however,
  // needs its mesh synced to wherever physics has moved it, each frame --
  // a plain snap-to-transform, the same approach createPhysicsObject.js
  // uses for simple props (no interpolation, fine for something that
  // isn't being closely orbited or tracked).
  function update() {
    if (!isDynamic) return;
    const pos = body.translation();
    const rot = body.rotation();
    root.position.set(pos.x, pos.y, pos.z);
    root.quaternion.set(rot.x, rot.y, rot.z, rot.w);
  }

  function destroy() {
    scene.remove(root);
    physicsWorld.world.removeRigidBody(body); // also drops its colliders
  }

  const result = {
    root,
    body,
    colliders,
    visualMeshes,
    collisionMeshes,
    isDynamic,
    update,
    destroy,
  };

  // Self-registers, same convention as createStairs.js: from the caller's
  // point of view this is one placeable object, not a pile of individual
  // parts to wire up by hand.
  physicsWorld.add(result);

  return result;
}

// Convenience wrapper for the common single-mesh case: a whole GLB treated
// as one static walkable surface. Just loadPhysicsGLB with a name that
// says what it's for at the call site.
export function loadPhysicsGroundGLB(scene, physicsWorld, options = {}) {
  return loadPhysicsGLB(scene, physicsWorld, {
    isDynamic: false,
    colliderType: "trimesh",
    ...options,
  });
}

// Convenience wrapper for a full hand-built level. Functionally identical
// to loadPhysicsGLB -- the "_collision"-suffix convention it honors is
// what actually makes multi-mesh environments practical (simplified
// invisible proxies alongside detailed visual meshes).
export function loadPhysicsEnvironmentGLB(scene, physicsWorld, options = {}) {
  return loadPhysicsGLB(scene, physicsWorld, {
    isDynamic: false,
    colliderType: "trimesh",
    ...options,
  });
}

// Convenience wrapper for a single object built from a GLB -- a crate, a
// rock, a piece of furniture, whatever. Dynamic by default, since that's
// the case this wrapper exists for (a static single object can just use
// loadPhysicsGLB directly, or loadPhysicsEnvironmentGLB); pass
// `isDynamic: false` to use the same call for a static prop instead. See
// the file header's MASS section for how `mass` behaves.
export function loadPhysicsPropGLB(scene, physicsWorld, options = {}) {
  return loadPhysicsGLB(scene, physicsWorld, {
    isDynamic: true,
    ...options,
  });
}
