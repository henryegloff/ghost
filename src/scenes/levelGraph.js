// src/scenes/levelGraph.js
//
// Defines every scene and which one each scene's own level switcher leads
// to. This is the one place in the codebase that knows about all three
// scenes -- individual scene files (exampleScene.js, exampleSceneTwo.js,
// exampleSceneThree.js) each import only this module, never each other,
// so adding, removing, or reordering scenes means editing this file
// alone.
//
// This replaces an earlier two-scene approach where each scene simply
// passed itself back as the other's target -- that works for a mutual
// pair, but breaks down once there are three or more scenes: scene two
// needs to lead to scene three specifically, not bounce back to whichever
// scene sent the player there. A shared, id-keyed table is what scales to
// an arbitrary number of scenes and arbitrary (not just back-and-forth)
// routing between them.
//
// Scenes are identified by short string ids rather than by importing each
// other's builder functions directly -- that's what keeps this a single
// shared lookup instead of a web of scene-to-scene imports. Each scene
// file receives its own id as a builder arg (see main.js and each scene's
// own default for it) and uses getNextSceneId()/getSceneBuilder() from
// here to find out where its own switcher should lead.
import { createScene } from "./exampleScene.js";
import { createSceneTwo } from "./exampleSceneTwo.js";
import { createSceneThree } from "./exampleSceneThree.js";

// Every scene's builder function, keyed by id.
export const SCENES = {
  sceneOne: createScene,
  sceneTwo: createSceneTwo,
  sceneThree: createSceneThree,
};

// Which scene each scene's own level switcher leads to. A simple loop
// here (one -> two -> three -> one), but nothing requires it to stay a
// loop -- point two scenes at the same destination, leave a scene out
// entirely (no switcher), or wire up branches; this table is the only
// thing that would need to change to do any of that.
export const NEXT_SCENE = {
  sceneOne: "sceneTwo",
  sceneTwo: "sceneThree",
  sceneThree: "sceneOne",
};

export function getSceneBuilder(id) {
  const builder = SCENES[id];
  if (!builder) {
    throw new Error(
      `levelGraph: unknown scene id "${id}" (expected one of ${Object.keys(SCENES).join(", ")})`,
    );
  }
  return builder;
}

export function getNextSceneId(id) {
  const nextId = NEXT_SCENE[id];
  if (!nextId) {
    throw new Error(`levelGraph: no NEXT_SCENE entry for scene id "${id}"`);
  }
  return nextId;
}
