// Facts about the scan itself, shared by both games: its credit line, where its upper floors
// are, and the zones where the capture falls apart. World space, y-up, metres.

// the scan's attribution (CC BY-NC 4.0), shown on both title screens
export const SCENE_CREDIT =
  'Scene: “URBEX: Sanatorium Inside – Part01” by Christoph Schindelar ' +
  '(<a href="https://superspl.at/scene/8429e5e2" target="_blank">superspl.at</a>), ' +
  'licensed <a href="http://creativecommons.org/licenses/by-nc/4.0/" target="_blank">CC BY-NC 4.0</a>. Rendered with Spark (World Labs). ';

// Floors higher than the ground floor only exist in the stairwell / upper rooms. Everywhere
// else, a "floor" up there is the top of a ceiling (the scan has no roof). See World.buildFloors.
export const UPPER_FLOORS = { x0: -3.5, x1: 3.0, z0: 10.5, z1: 27.0, minY: 0.9 };

// Boundary zones: places where the scan falls apart and leads nowhere. Both games block them
// (World.block) and dissolve the splats inside them (at most 8: the shaders hold 8 boxes).
export const BOUNDARIES = [
  { name: "upstairs north corridor", min: [-0.6, 1.9, 9.0], max: [1.9, 5.2, 15.0] },
  { name: "upper stair flight to 2nd floor", min: [-1.6, 2.4, 14.5], max: [-0.35, 5.2, 15.95] },
  { name: "dining back room (north part)", min: [4.0, -1.8, 11.9], max: [6.2, 1.4, 15.9] },
  { name: "dining back room (south part)", min: [4.0, -1.8, 15.9], max: [6.6, 1.4, 23.0] },
  { name: "lounge south-west, missing end wall", min: [0.6, -1.9, 32.0], max: [4.8, 1.3, 34.5] },
  { name: "entrance vestibule south pocket", min: [12.9, -1.9, 31.1], max: [14.6, 1.3, 33.5] },
  { name: "kitchen NE door recess (optional, low priority)", min: [2.05, -1.8, -4.75], max: [3.6, 1.4, -4.0] },
];
