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
// A second, similar naming convention exists for shadow-casting: any mesh
// named with the `noCastShadowPattern` suffix (default: ending in
// "_castnoshadow") never casts a shadow, regardless of the general
// castShadow setting -- see castShadow's own comment below for why
// that's needed (a flat floor mesh casting a shadow onto itself) and how
// to use it.
//
// If NO mesh in the file matches that pattern, every visual mesh is used
// as physics geometry instead -- one object serving as both the drawn
// mesh AND the source of its own collider, no separate proxy authored at
// all. That's the common case for a simple object, and where
// `colliderType: "boundingBox"` / `"boundingSphere"` (below) are most
// useful: for something roughly box- or ball-shaped (a crate, a barrel, a
// lantern's glass globe), fitting a single cheap primitive collider to the
// mesh is both simpler to author (export one clean object, nothing extra
// to set up in Blender) and cheaper at runtime than baking its exact
// geometry into a trimesh or convex hull.
//
// COLLIDER TYPES
//   "trimesh"        -- exact geometry, arbitrary shape, static only (see
//                        below). Most accurate, most expensive.
//   "convexHull"      -- a convex approximation of the geometry. Works on
//                        dynamic bodies; still tracks the mesh's actual
//                        shape reasonably closely.
//   "boundingBox"     -- a single box fit to the mesh's bounding box, in
//                        root space. Cheapest complex-shape option; a good
//                        fit for anything roughly crate-/box-shaped.
//   "boundingSphere"  -- a single sphere fit to the mesh's bounding
//                        sphere. Best for round objects; note it uses the
//                        LARGEST bounding dimension as the radius, so it
//                        can be a loose fit on a mesh that isn't
//                        reasonably round (a boundingBox is usually the
//                        better default unless the object really is
//                        ball-shaped).
//   "none"            -- no collider at all.
// boundingBox/boundingSphere both work for either static or dynamic
// bodies with no special-casing (unlike trimesh, see below), and are
// computed straight from the mesh's own geometry -- no separate
// "_collision" proxy needed, on top of not needing one already for the
// no-proxy-authored fallback described above.
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
// thing even though it's built from many boxes. The same root-space
// baking applies to boundingBox/boundingSphere, just operating on the
// mesh's bounding volume instead of its full vertex data.
//
// STATIC VS DYNAMIC, AND WHY THE COLLIDER TYPE DEFAULT DIFFERS
// Trimesh colliders only make sense on fixed/kinematic bodies -- a dynamic
// trimesh has no well-defined mass properties in Rapier. So `colliderType`
// defaults to "trimesh" for a static (`isDynamic: false`) body, since
// trimesh handles arbitrary complex, non-convex geometry well and static
// geometry never needs valid dynamic mass properties anyway; and defaults
// to "convexHull" for a dynamic body, a shape Rapier accepts there.
// Passing `colliderType: "trimesh"` together with `isDynamic: true` is
// rejected with a warning and downgraded to convexHull rather than left to
// fail inside Rapier itself. boundingBox/boundingSphere aren't subject to
// this restriction -- pass either explicitly regardless of isDynamic.
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
//
// PRELOADING
// The actual network fetch + parse happens through assetLoader.js's
// shared cache (preloadGLB()), not a private loader here -- if `url` was
// already preloaded (see main.js's boot sequence and
// scenes/assetManifest.js), this resolves on the same tick instead of
// starting a live fetch. That matters most right at a scene switch: an
// uncached fetch happening mid-switch leaves PhysicsWorld stepping every
// frame against a half-built, unmanaged scene for however long the fetch
// takes, which is a real source of instability, not just a slower load.

import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { preloadGLB } from "../core/assetLoader.js";

// Blender appends ".001", ".002", etc. to an object/mesh name whenever it
// collides with an existing name -- duplicating an object, re-importing,
// merging files, and plenty of ordinary workflows trigger this silently.
// Both naming conventions below (collisionMeshPattern,
// noCastShadowPattern) match against the END of a mesh's name, so
// "Floor_castnoshadow.001" would otherwise fail to match
// "_castnoshadow$" even though it's clearly meant to -- stripping a
// trailing ".NNN" before testing avoids that trap.
function stripDuplicateNameSuffix(name) {
  return name.replace(/\.\d{3}$/, "");
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
  const localToRoot = new THREE.Matrix4().multiplyMatrices(
    rootInverse,
    mesh.matrixWorld,
  );

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

// Fits an axis-aligned box, in root space, to `mesh`'s geometry bounding
// box. Used for colliderType: "boundingBox" -- see the file header's
// COLLIDER TYPES section for when that's the right choice.
//
// geometry.boundingBox is axis-aligned in the MESH's OWN local space, but
// the mesh could be rotated relative to rootObject (an unusual case for a
// simple single-object prop, but not an impossible one) -- so rather than
// assume the box stays axis-aligned after transforming, all 8 corners are
// transformed individually and a fresh axis-aligned box is taken from
// their extremes. That guarantees the result still fully contains the
// mesh; the trade-off is a looser (larger) fit than the mesh's true
// footprint if it IS rotated. For the common case (an un-rotated mesh
// authored directly under the GLB's root) the fit is exact.
//
// Half-extents are clamped to a small minimum -- Rapier expects a cuboid's
// half-extents to be positive, and a perfectly flat mesh (zero thickness
// along some axis, e.g. a plane) would otherwise produce a zero-size
// collider along that axis.
function computeBoxBoundsInRootSpace(mesh, rootObject, rootScale) {
  const geometry = mesh.geometry;
  if (!geometry.boundingBox) geometry.computeBoundingBox();
  const box = geometry.boundingBox;

  rootObject.updateMatrixWorld(true);
  const rootInverse = new THREE.Matrix4().copy(rootObject.matrixWorld).invert();
  const localToRoot = new THREE.Matrix4().multiplyMatrices(
    rootInverse,
    mesh.matrixWorld,
  );

  const corners = [
    new THREE.Vector3(box.min.x, box.min.y, box.min.z),
    new THREE.Vector3(box.min.x, box.min.y, box.max.z),
    new THREE.Vector3(box.min.x, box.max.y, box.min.z),
    new THREE.Vector3(box.min.x, box.max.y, box.max.z),
    new THREE.Vector3(box.max.x, box.min.y, box.min.z),
    new THREE.Vector3(box.max.x, box.min.y, box.max.z),
    new THREE.Vector3(box.max.x, box.max.y, box.min.z),
    new THREE.Vector3(box.max.x, box.max.y, box.max.z),
  ];

  const rootBox = new THREE.Box3();
  for (const corner of corners) {
    corner.applyMatrix4(localToRoot);
    corner.multiply(rootScale); // re-apply scale, same reasoning as bakeMeshToRootSpace
    rootBox.expandByPoint(corner);
  }

  const center = new THREE.Vector3();
  const size = new THREE.Vector3();
  rootBox.getCenter(center);
  rootBox.getSize(size);

  const MIN_HALF_EXTENT = 0.001;
  return {
    center,
    halfExtents: {
      x: Math.max(size.x / 2, MIN_HALF_EXTENT),
      y: Math.max(size.y / 2, MIN_HALF_EXTENT),
      z: Math.max(size.z / 2, MIN_HALF_EXTENT),
    },
  };
}

// Fits a sphere, in root space, to `mesh`'s geometry bounding sphere. Used
// for colliderType: "boundingSphere".
//
// The radius is scaled by the LARGEST component of rootScale rather than
// applying non-uniform scale to the sphere directly -- a non-uniformly
// scaled sphere isn't a sphere anymore, and Rapier's ball collider can't
// represent that anyway. Using the largest axis errs toward "too big"
// rather than letting the collider clip through the visual mesh along
// whichever axis was scaled up.
function computeSphereBoundsInRootSpace(mesh, rootObject, rootScale) {
  const geometry = mesh.geometry;
  if (!geometry.boundingSphere) geometry.computeBoundingSphere();
  const sphere = geometry.boundingSphere;

  rootObject.updateMatrixWorld(true);
  const rootInverse = new THREE.Matrix4().copy(rootObject.matrixWorld).invert();
  const localToRoot = new THREE.Matrix4().multiplyMatrices(
    rootInverse,
    mesh.matrixWorld,
  );

  const center = sphere.center
    .clone()
    .applyMatrix4(localToRoot)
    .multiply(rootScale);
  const maxScale = Math.max(rootScale.x, rootScale.y, rootScale.z);
  const radius = Math.max(sphere.radius * maxScale, 0.001);

  return { center, radius };
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
    colliderType, // "trimesh" | "convexHull" | "boundingBox" | "boundingSphere" | "none"; defaults below depend on isDynamic
    collisionMeshPattern = /_collision$/i,
    // Defaults to isDynamic rather than an unconditional true, matching
    // createPhysicsBox.js's convention. A static, largely-flat object
    // (a ground/floor GLB especially) that casts a shadow ends up
    // self-shadowing: it gets rendered into its own shadow map and then
    // compared against itself when shaded, which shows up as banding or
    // a shadow-camera-frustum-shaped darkening across the whole surface
    // -- not caused by any actual object, just the ground shadowing
    // itself. A moving object (the default player, say) SHOULD cast a
    // shadow onto the ground below it, hence tying this to isDynamic
    // rather than turning it off unconditionally. If you have a static
    // prop that genuinely should cast a shadow (a lantern, a rock --
    // anything that isn't itself the primary flat receiver), pass
    // `castShadow: true` explicitly to override this default.
    //
    // For a single GLB that mixes a flat receiver with geometry that
    // should still cast (a ground-and-walls environment, say -- the
    // walls casting shadows onto the floor is exactly what you want,
    // only the floor casting a shadow onto ITSELF is the problem), name
    // the floor mesh with the `noCastShadowPattern` suffix below in
    // Blender (default: ending in "_noshadow") and export -- that mesh
    // is excluded from shadow-casting regardless of the general
    // castShadow setting, while every other mesh in the file still casts
    // normally. castShadow also accepts a per-mesh predicate function --
    // (mesh) => boolean -- as a code-side alternative if you'd rather not
    // rename meshes, or need logic beyond a name match; the naming
    // convention takes priority where both apply.
    castShadow = isDynamic,
    receiveShadow = true,
    // See the castShadow comment above -- any mesh whose name matches
    // this pattern never casts a shadow, regardless of what castShadow
    // otherwise resolves to for it.
    noCastShadowPattern = /_castnoshadow$/i,
    friction = 0.8,
    restitution = 0,
  } = options;

  if (!url) throw new Error("loadPhysicsGLB: `url` is required");

  // Resolves castShadow/receiveShadow's boolean-or-per-mesh-predicate
  // options against a specific mesh -- see the comments on those options
  // above. castShadow additionally checks noCastShadowPattern first,
  // which always wins over whatever castShadow itself would resolve to.
  const resolveShadowFlag = (flagOrPredicate, mesh) =>
    typeof flagOrPredicate === "function"
      ? flagOrPredicate(mesh)
      : flagOrPredicate;
  // TEMPORARY DIAGNOSTIC -- remove once the castShadow issue is
  // resolved. Logs exactly what this function sees and decides for every
  // mesh, so it's unambiguous whether this code is even running and, if
  // so, why the naming convention isn't matching.
  const resolveCastShadow = (mesh) => {
    const stripped = stripDuplicateNameSuffix(mesh.name);
    const matches = noCastShadowPattern.test(stripped);
    console.log(
      "[createPhysicsGLB] resolveCastShadow:",
      JSON.stringify(mesh.name),
      "-> stripped:",
      JSON.stringify(stripped),
      "-> pattern:",
      noCastShadowPattern,
      "-> matches:",
      matches,
      "-> general castShadow value:",
      castShadow,
    );
    return matches ? false : resolveShadowFlag(castShadow, mesh);
  };

  let resolvedColliderType =
    colliderType ?? (isDynamic ? "convexHull" : "trimesh");
  if (isDynamic && resolvedColliderType === "trimesh") {
    console.warn(
      'loadPhysicsGLB: colliderType "trimesh" isn\'t valid on a dynamic ' +
        "body in Rapier (no well-defined mass/inertia) -- using " +
        '"convexHull" instead.',
    );
    resolvedColliderType = "convexHull";
  }

  // Resolves instantly if this URL was already preloaded (e.g. by
  // main.js's boot sequence) or is already mid-fetch from an earlier
  // call; otherwise starts the fetch now. Either way, `gltf` may be the
  // SAME object another caller is also holding, so it's cloned below
  // before being used as this instance's own root -- see assetLoader.js's
  // header for why that's required.
  const gltf = await preloadGLB(url);
  const root = gltf.scene.clone();

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
    if (collisionMeshPattern.test(stripDuplicateNameSuffix(child.name))) {
      collisionMeshes.push(child);
      child.visible = false;
    } else {
      visualMeshes.push(child);
      child.castShadow = resolveCastShadow(child);
      child.receiveShadow = resolveShadowFlag(receiveShadow, child);
    }
  });

  // No dedicated collision proxies authored -> fall back to using the
  // visible geometry itself for physics (the simple "one mesh" case).
  const physicsMeshes =
    collisionMeshes.length > 0 ? collisionMeshes : visualMeshes;

  const rotationQuat = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(rotation[0], rotation[1], rotation[2]),
  );

  const bodyDesc = isDynamic
    ? RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(px, py, pz)
        .setRotation(rotationQuat)
        .setAdditionalMass(mass)
    : RAPIER.RigidBodyDesc.fixed()
        .setTranslation(px, py, pz)
        .setRotation(rotationQuat);

  const body = physicsWorld.world.createRigidBody(bodyDesc);

  const colliders = [];
  const rootScale = new THREE.Vector3(sx, sy, sz);

  if (resolvedColliderType !== "none") {
    for (const mesh of physicsMeshes) {
      let colliderDesc;

      if (resolvedColliderType === "boundingBox") {
        const { center, halfExtents } = computeBoxBoundsInRootSpace(
          mesh,
          root,
          rootScale,
        );
        colliderDesc = RAPIER.ColliderDesc.cuboid(
          halfExtents.x,
          halfExtents.y,
          halfExtents.z,
        ).setTranslation(center.x, center.y, center.z);
      } else if (resolvedColliderType === "boundingSphere") {
        const { center, radius } = computeSphereBoundsInRootSpace(
          mesh,
          root,
          rootScale,
        );
        colliderDesc = RAPIER.ColliderDesc.ball(radius).setTranslation(
          center.x,
          center.y,
          center.z,
        );
      } else {
        const { vertices, indices } = bakeMeshToRootSpace(
          mesh,
          root,
          rootScale,
        );
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
//
// For a simple, roughly box- or ball-shaped object -- the case this
// wrapper is most often used for -- also consider `colliderType:
// "boundingBox"` or `"boundingSphere"` (see the file header's COLLIDER
// TYPES section): a single object exported from Blender, no separate
// "_collision" proxy authored, with a cheap primitive collider fit to it
// automatically.
export function loadPhysicsPropGLB(scene, physicsWorld, options = {}) {
  return loadPhysicsGLB(scene, physicsWorld, {
    isDynamic: true,
    ...options,
  });
}
