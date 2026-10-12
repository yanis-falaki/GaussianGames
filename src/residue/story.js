// RESIDUE's story: the spawn, the six plates and their notes, the way out, the intro and ending.
// Positions are world-space (y-up) hints; they're snapped to the
// nearest walkable splat floor at runtime.
import { SCENE_CREDIT } from "../shared/scan.js";

export const SPAWN = { x: -2.6, y: -1.5, z: -2.4, yaw: Math.PI * 0.9 };

// the end: a lounge window onto the terrace comes apart and becomes a doorway
export const EXIT = { x: 15.2, y: -1.7, z: 25.0 };
export const BREACH = { x: 13.55, y: -1.55, z: 24.75, hx: 0.5, hz: 0.75, h: 2.6 };

export const PIANO = { x: 12.3, y: -0.6, z: 5.2 };

// a bare bulb still burning in a ceiling corner by the stairs (the way up to the landing)
export const STAIR_LIGHT = { x: 0.7, y: 1.28, z: 17.7, ceil: 1.42 };

export const INTRO = [
  "In 1931 Dr. Albrecht Weil photographed the patients of Haus Lindenhof by lamplight, in exposures so long that only those who held perfectly still came out clear.",
  "One girl, Marie, patient no. 31, never held still. On every plate she is a smear. After the last session she was never seen again.",
  "Marie was your grandmother’s sister. The building comes down tomorrow. Tonight you go in with a wind-up lamp and a camcorder to find the six places where his plates were taken.",
  "<b>Keep your light on what you want to keep. In the dark, things move.</b>",
];

export const EXPOSURES = [
  {
    id: "kitchen",
    room: "Kitchen",
    pos: { x: 0.2, y: -1.5, z: 3.2 },
    title: "Plate I · the kitchen staff, 3 March 1931",
    text: "Four cooks by the steam kettles, forty seconds under the magnesium lamp, every face sharp. In the doorway behind them, at the height of a child, a pale smear. Weil has written on the sleeve: “No. 31 again. She was not in the room.”",
  },
  {
    id: "hall",
    room: "Dining hall",
    pos: { x: 8.2, y: -1.5, z: 11.5 },
    title: "Plate II · supper, the dining hall",
    text: "Sixty patients at the long tables, all of them still for the lamp. One chair is a blur. Weil’s notebook: “She tells me she can only move in the dark. Under the lamp she feels pinned, like a moth to a card. She asks me to stop. I think the treatment is working.”",
  },
  {
    id: "hallfar",
    room: "Dining hall, east windows",
    pos: { x: 14.6, y: -1.5, z: 19.5 },
    title: "A letter, tucked behind Plate III",
    text: "“Dear Marie, Mother says you are getting better and that the doctor is very kind. Hold still for him, so he can finish his pictures and let you come home. I have kept your bed by the window. Your sister, Hanne.” Your grandmother was nine when she wrote this.",
  },
  {
    id: "lounge",
    room: "Lounge",
    pos: { x: 6.0, y: -1.5, z: 28.5 },
    title: "Plate IV · the lounge, empty",
    text: "An empty room, a nine-minute exposure. She is in it anyway, crossing from the sofas to the door. Weil: “She appears on plates of rooms where no one stood. She is in the building when no one is. I will lengthen the exposures until she holds.”",
  },
  {
    id: "stairs",
    room: "Upper landing",
    pos: { x: -1.2, y: 2.2, z: 15.8 },
    title: "Night nurse’s report, folded into Plate V",
    text: "“14 March. No. 31 missing after the doctor’s final session. Her door locked from outside. The doctor refuses to show anyone the plate. Footprints in the dust on the stair, going up. None coming down. I have asked to be moved to the day shift.”",
  },
  {
    id: "bedroom",
    room: "Room 31",
    pos: { x: 0.2, y: 2.2, z: 23.8 },
    title: "Plate VI · Room 31, and the words scratched beside the bed",
    text: "The last plate is nearly white: a room, a bed, a window, and something exposed so long it has no edges left. Scratched into the plaster by the bed, in a child’s capitals: “IF YOU CAME FOR ME, I CAN ONLY MOVE IN THE DARK. DON’T HOLD THE LIGHT ON ME. TAKE ME OUT BY THE TERRACE. THAT DOOR WAS ALWAYS LOCKED.”",
  },
];

export const ENDING = [
  "The window gives way to cold air and a real night. Behind you, something follows you to the edge of the light, and stops at the sill.",
  "In the morning the machines arrive. Weeks later you develop the photograph you took of the terrace.",
  "Two figures in the doorway, holding hands. Neither of them held still.",
];

export const CREDITS = SCENE_CREDIT +
  "Breathing: \u201cbreathing tired\u201d by mikeask (CC0, opengameart.org). The story, its people and the 1931 events are fiction.";
