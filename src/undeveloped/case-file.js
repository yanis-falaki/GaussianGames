// Undeveloped (case file: Haus Lindenhof) — case content. Every clue is a real object in the scan; positions
// were picked with tools/author.mjs (world space, y-up). Fiction: names and events are invented.

export const SPAWN = { x: 10.6, y: -1.5, z: 9.3, yaw: -1.35 };
// Footprints in the dust (trail.js). Each leg runs from a clue (or a point) to the clue it leads
// to, walked by mara | run (Mara running) | man | dog. Every leg is on show from the start, so
// there are always several leads to choose from; each fades once any of `done` (default: its
// `to`) has been documented. `always`: never fades. `lane`: metres to the walker's right
// (default 0.1), so trails sharing a corridor or the stairs sit side by side. Grouped by the
// chapter whose clues they lead to.
export const TRAILS = [
  // the way up: the last stretch of her walk to the upstairs landing, from the start (players
  // miss the stairwell without it). `tail`: only the last metres of the route are marked
  { id: "stairs", always: true, walker: "mara", from: [10.6, -1.5, 9.3], to: [-1.0, 2.25, 18.0], tail: 15, lane: -0.15 },
  // I. Getting in: from the window she climbed through, along her tags, to the kitchen
  { id: "in", chapter: 0, walker: "mara", from: "frame", to: "heart_pink_small" },
  { id: "kitchen", chapter: 0, walker: "mara", from: "heart_pink_small", to: "heart_kitchen", done: ["heart_kitchen", "kettles"] },
  // II. Not alone: her way back to the hall, his boots to where he waited, the dog's paws
  { id: "back", chapter: 1, walker: "mara", from: "kettles", to: "heart_traced" },
  { id: "him", chapter: 1, walker: "man", from: "heart_traced", to: "armchairs" },
  { id: "dog", chapter: 1, walker: "dog", from: "armchairs", to: "bowl", done: ["bowl", "barrel", "notice"] },
  { id: "dogchair", chapter: 1, walker: "dog", from: "bowl", to: "terrace_chair" }, // (optional) his owner's chair
  // III. Where is Mara: what he dropped, her run, her hiding place, and where she went next
  { id: "page", chapter: 2, walker: "man", from: "armchairs", to: "page" },
  { id: "run", chapter: 2, walker: "run", from: "heart_traced", to: "flipped" },
  { id: "up", chapter: 2, walker: "run", from: "flipped", to: "drawer", done: ["drawer", "room31_note"], lane: 0.16 },
  { id: "hide", chapter: 2, walker: "mara", from: "drawer", to: "wardrobe" }, // (optional) where she hid
  { id: "out", chapter: 2, walker: "mara", from: "drawer", to: "notice", lane: 0 },
];

// doorway from the dining hall to the terrace (opened in the collision grid only; see main.js)
export const TERRACE_DOOR = { x: 13.55, y: -1.55, z: 24.3, hx: 0.45, hz: 0.35, h: 2.4 };

// The opening, shown each time a case starts (skippable): three lines over a slow walk
// through the dining hall, ending where you start. path: [x, y (floor), z, yaw, pitch] keys.
export const OPENING = {
  lines: [
    { kicker: "Missing · Mara Lenz, 26", text: "Mara photographs the places everyone else has given up on. She signs every one with a small pink heart." },
    { kicker: "Saturday 3 August · 16:40", text: "She went into Haus Lindenhof alone. At twenty to five her phone went quiet. Five days later her car was still at the gate." },
    { kicker: "Today", text: "The police walked the ground floor and found nothing. You have the afternoon, and a camera. Find what they missed." },
  ],
  path: [[14.2, -1.5, 22.0, 0.25, -0.05], [12.6, -1.5, 16.5, 0.45, -0.12], [11.2, -1.5, 12.0, -0.4, -0.2], [10.6, -1.5, 9.3, -1.35, 0]],
  seconds: 21,
};

export const BRIEF = `
<p><b>Missing:</b> Mara Lenz, 26. Photographer, posts abandoned places as <i>@mara.exposed</i>.</p>
<p><b>Last known:</b> Saturday 3 August, Haus Lindenhof sanatorium. Her phone last connected inside the building at 16:40. Her car was found at the gate five days later.</p>
<p>Mara signs every place she shoots with a small heart. Police walked the ground floor and found nothing.
You have the afternoon. Photograph what matters, read what was left behind, and work out what happened to her.</p>`;

// kind: photo (take a picture of it) | doc (examine with E: a readable document, also photographable)
// r: rough object radius (m); range: max distance to photograph it
// glow: the region whose splats light up when it's framed or photographed (view.js): centre `at`
// (default: pos) and half extents `ext` (m, an ellipsoid), and optionally only the splats that
// stand out by colour from what's around them: key "sat" (paint), "lum" (white paper, a white
// frame) or "warm" (wood on a cool floor), above threshold t
export const CLUES = [
  // --- dining hall
  { id: "frame", label: "Window frame on the floor", room: "Dining hall", pos: [11.8, -1.32, 10.39], r: 0.6, range: 6,
    glow: { at: [12.15, -1.36, 10.05], ext: [0.78, 0.14, 0.5], key: "lum", t: 0.5 },
    note: "A whole window frame, lifted off its hinges and laid down. Not smashed. Someone climbed in here." },
  { id: "armchairs", label: "Armchairs facing the window", room: "Dining hall", pos: [13.0, -0.93, 11.86], r: 0.6, range: 6,
    glow: { at: [12.9, -1.0, 11.2], ext: [0.6, 0.62, 0.95] },
    note: "Two armchairs and a table dragged together, turned toward the open window. The dust on the seats is wiped." },
  { id: "flipped", label: "Overturned table", room: "Dining hall", pos: [15.3, -1.35, 14.91], r: 0.7, range: 7,
    glow: { at: [14.9, -1.02, 14.95], ext: [0.58, 0.42, 0.58], key: "warm", t: 0.08 },
    note: "Knocked over recently. The dust beneath it is darker than the floor around it." },
  { id: "sheet", label: "Dust sheet on the floor", room: "Dining hall", pos: [12.98, -1.4, 13.05], r: 0.6, range: 6,
    glow: { at: [13.4, -1.36, 12.65], ext: [0.55, 0.16, 0.65], key: "lum", t: 0.5 },
    note: "A dust sheet, dragged off something and dropped." },
  { id: "piano", label: "Grand piano", room: "Dining hall", pos: [11.9, -0.63, 6.79], r: 0.9, range: 8,
    glow: { at: [11.85, -0.85, 5.85], ext: [0.8, 0.58, 1.05] },
    note: "Out of tune and covered in dust. Nobody has touched it in years." },
  { id: "extinguisher", label: "Fire extinguisher", room: "Dining hall", pos: [9.96, -1.19, 6.6], r: 0.3, range: 4.5,
    glow: { ext: [0.18, 0.34, 0.18], key: "sat", t: 0.35 },
    note: "Standing loose in the middle of the floor, far from any bracket. Still sealed." },
  { id: "page", kind: "doc", label: "Torn notebook page", room: "Dining hall", pos: [9.66, -1.4, 10.51], r: 0.4, range: 3,
    glow: { ext: [0.26, 0.1, 0.26], key: "lum", t: 0.55 },
    note: "Lying among the scattered old forms, but newer than any of them.",
    doc: `<h2>Torn notebook page</h2><p class="hand blue">Bergklinik — 12 May &nbsp;&#9825;<br/>Glaswerk Süd — 9 June &nbsp;&#9825;<br/>Hotel am See — 21 July &nbsp;&#9825;<br/><b>Lindenhof — Sat 3 Aug</b></p><p class="hand blue">she always goes in through a window.<br/>she always signs the walls.<br/>be there first. wait.</p><p class="small">Blue ballpoint. Every heart is drawn in the same blue.</p>` },
  { id: "heart_pink_small", label: "Small pink heart", room: "Dining hall", pos: [7.3, -0.21, 19.0], r: 0.25, range: 5,
    glow: { ext: [0.3, 0.3, 0.3], key: "sat", t: 0.35 },
    note: "A small heart in bright pink spray paint. The paint is fresh; it smells faintly." },
  { id: "heart_traced", label: "Pink heart traced in blue", room: "Dining hall", pos: [7.09, -0.17, 18.17], r: 0.3, range: 5,
    glow: { ext: [0.3, 0.38, 0.38], key: "sat", t: 0.35 },
    note: "A pink heart, gone over afterwards with a thick blue outline. Two different hands." },
  { id: "hearts_blue", label: "Blue hearts", room: "Dining hall", pos: [6.4, -0.26, 15.1], r: 0.6, range: 5,
    glow: { ext: [0.35, 0.42, 0.75], key: "sat", t: 0.35 },
    note: "Two hearts in blue only. Shakier lines than the pink ones." },
  // --- kitchen
  { id: "heart_kitchen", label: "Pink heart on the steel table", room: "Kitchen", pos: [-1.39, -0.65, -0.18], r: 0.25, range: 4,
    glow: { ext: [0.28, 0.12, 0.28], key: "sat", t: 0.35 },
    note: "The same small pink heart, sprayed on the steel table." },
  { id: "kettles", label: "Steam kettles, lids open", room: "Kitchen", pos: [-0.87, -0.26, 1.41], r: 0.7, range: 5,
    glow: { at: [0.0, -0.55, 1.4], ext: [1.0, 0.55, 0.6] },
    note: "The lids have been lifted recently. There are clean finger marks in the dust on the rims, the kind a photographer leaves setting up a shot." },
  // --- terrace
  { id: "bowl", label: "Dog bowl", room: "Terrace", pos: [15.29, -1.61, 24.7], r: 0.2, range: 3.5,
    glow: { at: [15.33, -1.6, 24.67], ext: [0.2, 0.12, 0.2] },
    note: "A dented dog bowl with a little rainwater in it. Not years old." },
  { id: "terrace_chair", label: "Chair by the wall", room: "Terrace", pos: [15.11, -1.11, 25.74], r: 0.4, range: 4,
    glow: { at: [15.11, -1.15, 25.74], ext: [0.36, 0.5, 0.36], key: "warm", t: 0.08 },
    note: "A cane chair with a flattened cushion. Someone sits here often." },
  { id: "barrel", label: "Rain barrel", room: "Terrace", pos: [13.32, -1.19, 25.09], r: 0.4, range: 4,
    glow: { ext: [0.36, 0.36, 0.36] },
    note: "Half a wine barrel, set under the gutter. Someone collects water here." },
  { id: "notice", kind: "doc", label: "Notice in the window", room: "Terrace", pos: [12.5, -0.18, 24.76], r: 0.25, range: 3,
    glow: { ext: [0.26, 0.26, 0.26], key: "lum", t: 0.55 },
    note: "A sheet of paper taped to the inside of the glass, facing out.",
    doc: `<h2>Notice taped in the window</h2><p class="hand">PLEASE KNOCK.<br/>Somebody lives here.<br/>Caravan behind the hedge.<br/>— Henrik &amp; Bruno<br/><small>(dog is friendly)</small></p>` },
  // --- room 31, upstairs
  { id: "drawer", label: "Drawer on the floor", room: "Room 31", pos: [0.77, 2.39, 25.16], r: 0.35, range: 3.5,
    glow: { ext: [0.32, 0.16, 0.32] },
    note: "Pulled all the way out and set down, not thrown. Something was hidden in it." },
  { id: "room31_note", kind: "doc", label: "Note in the drawer", room: "Room 31", pos: [0.77, 2.45, 25.16], r: 0.3, range: 2.2,
    glow: { ext: [0.22, 0.12, 0.22], key: "lum", t: 0.45 },
    note: "A page torn from a pocket notebook, folded small, tucked under the drawer's lining.",
    doc: `<h2>Folded page, in the drawer</h2><p class="hand">3 Aug, 16:20<br/>There's a man in the dining hall, sitting by the window I came in through. He drew over my heart in blue. I think it's the one from the comments, the one who knows where I'm going before I post.<br/>I'm not going back past him. The man with the dog on the terrace said I can wait at his place until it's safe.<br/>If you're the police: ask for Henrik. Not online. Don't post this. — M.</p>` },
  { id: "pinktable", label: "Pink table", room: "Room 31", pos: [1.25, 3.03, 24.91], r: 0.45, range: 4,
    glow: { at: [1.35, 2.75, 24.85], ext: [0.46, 0.46, 0.46] },
    note: "A round table with a pink top. Fresh hand prints in the dust: someone leaned on it." },
  { id: "wardrobe", label: "Wardrobe", room: "Room 31", pos: [-0.39, 3.44, 24.31], r: 0.7, range: 4,
    glow: { at: [-0.38, 3.15, 23.8], ext: [0.55, 0.95, 0.45] },
    note: "Doors hanging open. Big enough to hide in." },
];

// Deduction notebook. Each chapter: a question at the top, a short intro (the story so far), the
// statements, and what it means once they all hold (`solved`).
// Blanks: {type:"evidence", ask, answer:[clue ids]} or {type:"word", ask, options, answer}.
//   ask: what goes in the blank, shown while it's empty ("photo" and "document" also limit which
//   evidence can be picked); nudge: said when the blank is wrong (for evidence, after the room
//   check: "that photo is from the terrace, not the kitchen"); wrong: {clue id: line} for
//   tempting wrong answers; from (words): the clue that answers it. After a few failed checks
//   the notebook names the clue that matters.
export const CHAPTERS = [
  {
    title: "I. Getting in",
    question: "How did Mara get in, and what was she doing here?",
    intro: "Start where she would have started. Mara never uses doors, and she signs every place she shoots.",
    questions: [
      { text: "She climbed in through a window in the dining hall. What she left behind: {a}", blanks: {
        a: { type: "evidence", ask: "photo", answer: ["frame"], nudge: "Look for what she had to move out of the way to climb in." } } },
      { text: "Her tag is a small heart in {a}. One she left untouched: {b}", blanks: {
        a: { type: "word", ask: "colour", options: ["pink", "blue", "black"], answer: "pink", from: "heart_pink_small", nudge: "Look at a heart nobody has drawn over." },
        b: { type: "evidence", ask: "photo", answer: ["heart_kitchen", "heart_pink_small"], nudge: "One of her hearts, exactly as she sprayed it.",
          wrong: { heart_traced: "Look closer: someone else has drawn over that one.", hearts_blue: "Those aren't her colour." } } } },
      { text: "Then she got to work. In the kitchen she set up a shot of {a}", blanks: {
        a: { type: "evidence", ask: "photo", answer: ["kettles"], nudge: "Something in the kitchen a photographer's hands have touched, arranging it just so." } } },
    ],
    solved: "Mara came in the way she always does, through a window, and signed the wall in pink. In the kitchen she lifted the kettle lids and set up her shot. She had no idea anyone else was in the building.",
  },
  {
    title: "II. Not alone",
    question: "Who else was in the building that Saturday?",
    intro: "Mara thought she had the place to herself. The dust says otherwise: her footprints lead back to the hall, and they aren't the only ones.",
    questions: [
      { text: "Someone lives here, out on the {a}. Proof: {b}", blanks: {
        a: { type: "word", ask: "place", options: ["terrace", "kitchen", "upper floor", "lounge"], answer: "terrace", from: "notice", nudge: "Where do the paw prints lead?" },
        b: { type: "evidence", ask: "photo", answer: ["bowl", "terrace_chair", "barrel", "notice"], nudge: "Something only a person who lives here would leave out." } } },
      { text: "Someone else found her heart and went over it in {a}. Proof: {b}", blanks: {
        a: { type: "word", ask: "colour", options: ["blue", "pink", "black"], answer: "blue", from: "heart_traced", nudge: "Not her colour: the other one on that wall." },
        b: { type: "evidence", ask: "photo", answer: ["heart_traced"], nudge: "Two hands on one heart: hers first, then his.",
          wrong: { hearts_blue: "Those are blue all through. Find the one that was pink first.", heart_pink_small: "That one is still just as she left it.", heart_kitchen: "That one is still just as she left it." } } } },
      { text: "He was waiting for her, watching the window she would climb in by. He sat in {a}", blanks: {
        a: { type: "evidence", ask: "photo", answer: ["armchairs"], nudge: "Follow his boot prints back from the hearts." } } },
    ],
    solved: "Two other people were here that afternoon. A man lives on the terrace with his dog. And someone got here before Mara, sat facing the window she would come in by, and went over her heart in blue while he waited.",
  },
  {
    title: "III. Where is Mara?",
    question: "What happened when she saw him, and where is she now?",
    intro: "She came back from the kitchen and saw her heart painted over in blue. Then she saw him.",
    questions: [
      { text: "The man in blue is {a}. What he dropped proves it: {b}", blanks: {
        a: { type: "word", ask: "who", options: ["the man from the terrace", "a stranger who follows her trips", "a security guard", "another photographer she knew"],
          answer: "a stranger who follows her trips", from: "page", nudge: "Read what he wrote. How did he know where she would be, and when?" },
        b: { type: "evidence", ask: "document", answer: ["page"], nudge: "Something written in blue ballpoint.",
          wrong: { room31_note: "That's in her handwriting, not his.", notice: "That was written by whoever lives on the terrace." } } } },
      { text: "She ran from him, and knocked over {a} on the way.", blanks: {
        a: { type: "evidence", ask: "photo", answer: ["flipped"], nudge: "Her running footprints lead straight past it." } } },
      { text: "She hid upstairs, in {a}, and left a note for whoever came looking: {b}", blanks: {
        a: { type: "word", ask: "place", options: ["Room 31", "the kitchen", "the lounge", "the stairwell"], answer: "Room 31", from: "room31_note", nudge: "Where did her running footprints stop?" },
        b: { type: "evidence", ask: "document", answer: ["room31_note"], nudge: "Something in her own handwriting, hidden where only a careful searcher would look." } } },
      { text: "She is safe. Right now Mara is {a}. Where to find her: {b}", blanks: {
        a: { type: "word", ask: "where", options: ["hiding at the caravan behind the terrace", "still somewhere in the building", "with the man in blue", "back home"],
          answer: "hiding at the caravan behind the terrace", from: "notice", nudge: "Who offered her a place to wait, and where does he live?" },
        b: { type: "evidence", ask: "document", answer: ["notice"], nudge: "Her note says who. Something else says where he lives.",
          wrong: { room31_note: "Her note tells you who took her in, but not where he lives.", page: "That's his list, not hers." } } } },
    ],
    solved: null, // the ending
  },
];

// The ending, once the last chapter holds: what happened next, then a postcard.
export const ENDING = `
<h2>Case closed</h2>
<p>You call it in from the gate. Two officers walk past the hedge behind the terrace and knock on a caravan door.
A dog barks, a man called Henrik opens it, and behind him, wrapped in a blanket, is Mara Lenz.</p>
<p>She hadn't called anyone because the man who followed her knew things she had only told her phone.
Her phone stayed in the building, switched off in a kitchen drawer.</p>
<p>A man is picked up two days later, still driving the routes on her list. His jacket has blue paint on the cuff.</p>`;

export const POSTCARD = `<p class="hand">To whoever came looking properly.<br/>Thank you. &mdash; M.</p>`;
