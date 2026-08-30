export const PLAYER_ASSETS = ["/models/ghost_4.03.glb"];

export const SCENE_ASSETS = {
  sceneOne: ["/models/example_scene_with_lightmap.glb"],
  sceneTwo: [],
  sceneThree: ["/models/crate.glb"],
};

// Every asset across every scene, deduplicated. Not used by main.js's
// default boot sequence (which splits into starting-scene vs background
// phases), but handy if you'd rather just preload everything up front
// instead.
export function getAllSceneAssets() {
  return [...new Set(Object.values(SCENE_ASSETS).flat())];
}
