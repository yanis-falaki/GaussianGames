// Undeveloped (case file: Haus Lindenhof) — case content. Every clue is a real object in the scan; positions
// were picked with tools/author.mjs (world space, y-up). Fiction: names and events are invented.

export const SPAWN = { x: 10.6, y: -1.5, z: 9.3, yaw: -1.35 };
// Mara's footprints: the last stretch of the walk from the spawn to the upstairs landing
export const TRAIL = { to: [-1.0, 2.25, 18.0], length: 15 };

// doorway from the dining hall to the terrace (opened in the collision grid only; see main.js)
export const TERRACE_DOOR = { x: 13.55, y: -1.55, z: 24.3, hx: 0.45, hz: 0.35, h: 2.4 };

export const BRIEF = `
<p><b>Missing:</b> Mara Lenz, 26. Photographer, posts abandoned places as <i>@mara.exposed</i>.</p>
<p><b>Last known:</b> Saturday 3 August, Haus Lindenhof sanatorium. Her phone last connected inside the building at 16:40. Her car was found at the gate five days later.</p>
<p>Mara signs every place she shoots with a small heart. Police walked the ground floor and found nothing.
You have the afternoon. Photograph what matters, read what was left behind, and work out what happened to her.</p>`;

// kind: photo (take a picture of it) | doc (examine with E: a readable document, also photographable)
// r: rough object radius (m); range: max distance to photograph it
export const CLUES = [
  // --- dining hall
  { id: "frame", label: "Window frame on the floor", room: "Dining hall", pos: [11.8, -1.32, 10.39], r: 0.6, range: 6,
    note: "A whole window frame, lifted off its hinges and laid down. Not smashed. Someone climbed in here." },
  { id: "armchairs", label: "Armchairs facing the window", room: "Dining hall", pos: [13.0, -0.93, 11.86], r: 0.6, range: 6,
    note: "Two armchairs and a table dragged together, turned toward the open window. The dust on the seats is wiped." },
  { id: "flipped", label: "Overturned table", room: "Dining hall", pos: [15.3, -1.35, 14.91], r: 0.7, range: 7,
    note: "Knocked over recently. The dust beneath it is darker than the floor around it." },
  { id: "sheet", label: "Dust sheet on the floor", room: "Dining hall", pos: [12.98, -1.4, 13.05], r: 0.6, range: 6,
    note: "A dust sheet, dragged off something and dropped." },
  { id: "piano", label: "Grand piano", room: "Dining hall", pos: [11.9, -0.63, 6.79], r: 0.9, range: 8,
    note: "Out of tune and covered in dust. Nobody has touched it in years." },
  { id: "extinguisher", label: "Fire extinguisher", room: "Dining hall", pos: [9.96, -1.19, 6.6], r: 0.3, range: 4.5,
    note: "Standing loose in the middle of the floor, far from any bracket. Still sealed." },
  { id: "page", kind: "doc", label: "Torn notebook page", room: "Dining hall", pos: [9.66, -1.4, 10.51], r: 0.4, range: 3,
    note: "Lying among the scattered old forms, but newer than any of them.",
    doc: `<h2>Torn notebook page</h2><p class="hand blue">Bergklinik — 12 May &nbsp;&#9825;<br/>Glaswerk Süd — 9 June &nbsp;&#9825;<br/>Hotel am See — 21 July &nbsp;&#9825;<br/><b>Lindenhof — Sat 3 Aug</b></p><p class="hand blue">she always goes in through a window.<br/>she always signs the walls.<br/>be there first. wait.</p><p class="small">Blue ballpoint. Every heart is drawn in the same blue.</p>` },
  { id: "heart_pink_small", label: "Small pink heart", room: "Dining hall", pos: [7.3, -0.21, 19.0], r: 0.25, range: 5,
    note: "A small heart in bright pink spray paint. The paint is fresh; it smells faintly." },
  { id: "heart_traced", label: "Pink heart traced in blue", room: "Dining hall", pos: [7.09, -0.17, 18.17], r: 0.3, range: 5,
    note: "A pink heart, gone over afterwards with a thick blue outline. Two different hands." },
  { id: "hearts_blue", label: "Blue hearts", room: "Dining hall", pos: [6.4, -0.26, 15.1], r: 0.6, range: 5,
    note: "Two hearts in blue only. Shakier lines than the pink ones." },
  // --- kitchen
  { id: "heart_kitchen", label: "Pink heart on the steel table", room: "Kitchen", pos: [-1.39, -0.65, -0.18], r: 0.25, range: 4,
    note: "The same small pink heart, sprayed on the steel table." },
  { id: "kettles", label: "Steam kettles, lids open", room: "Kitchen", pos: [-0.87, -0.26, 1.41], r: 0.7, range: 5,
    note: "The lids have been lifted recently. There are clean finger marks in the dust on the rims, the kind a photographer leaves setting up a shot." },
  // --- terrace
  { id: "bowl", label: "Dog bowl", room: "Terrace", pos: [15.29, -1.61, 24.7], r: 0.2, range: 3.5,
    note: "A dented dog bowl with a little rainwater in it. Not years old." },
  { id: "terrace_chair", label: "Chair by the wall", room: "Terrace", pos: [15.11, -1.11, 25.74], r: 0.4, range: 4,
    note: "A cane chair with a flattened cushion. Someone sits here often." },
  { id: "barrel", label: "Rain barrel", room: "Terrace", pos: [13.32, -1.19, 25.09], r: 0.4, range: 4,
    note: "Half a wine barrel, set under the gutter. Someone collects water here." },
  { id: "notice", kind: "doc", label: "Notice in the window", room: "Terrace", pos: [12.5, -0.18, 24.76], r: 0.25, range: 3,
    note: "A sheet of paper taped to the inside of the glass, facing out.",
    doc: `<h2>Notice taped in the window</h2><p class="hand">PLEASE KNOCK.<br/>Somebody lives here.<br/>Caravan behind the hedge.<br/>— Henrik &amp; Bruno<br/><small>(dog is friendly)</small></p>` },
  // --- room 31, upstairs
  { id: "drawer", label: "Drawer on the floor", room: "Room 31", pos: [0.77, 2.39, 25.16], r: 0.35, range: 3.5,
    note: "Pulled all the way out and set down, not thrown. Something was hidden in it." },
  { id: "room31_note", kind: "doc", label: "Note in the drawer", room: "Room 31", pos: [0.77, 2.45, 25.16], r: 0.3, range: 2.2,
    note: "A page torn from a pocket notebook, folded small, tucked under the drawer's lining.",
    doc: `<h2>Folded page, in the drawer</h2><p class="hand">3 Aug, 16:20<br/>There's a man in the dining hall, sitting by the window I came in through. He drew over my heart in blue. I think it's the one from the comments, the one who knows where I'm going before I post.<br/>I'm not going back past him. The man with the dog on the terrace said I can wait at his place until it's safe.<br/>If you're the police: ask for Henrik. Not online. Don't post this. — M.</p>` },
  { id: "pinktable", label: "Pink table", room: "Room 31", pos: [1.25, 3.03, 24.91], r: 0.45, range: 4,
    note: "A round table with a pink top. Fresh hand prints in the dust: someone leaned on it." },
  { id: "wardrobe", label: "Wardrobe", room: "Room 31", pos: [-0.39, 3.44, 24.31], r: 0.7, range: 4,
    note: "Doors hanging open. Big enough to hide in." },
];

// Deduction notebook. Blanks: {type:"evidence", answer:[clue ids]} or {type:"word", options, answer}.
export const CHAPTERS = [
  {
    title: "I. Getting in",
    questions: [
      { text: "She got into the building through {a}.", blanks: { a: { type: "evidence", answer: ["frame"] } } },
      { text: "Her tag is a small {a} heart, like {b}.", blanks: {
        a: { type: "word", options: ["pink", "blue", "black"], answer: "pink" },
        b: { type: "evidence", answer: ["heart_kitchen", "heart_pink_small"] } } },
      { text: "Before going deeper, she stopped to photograph {a}.", blanks: { a: { type: "evidence", answer: ["kettles"] } } },
    ],
    solved: "Mara came in the way she always does, through a window. She tagged the walls and set up shots as usual. Nothing was wrong yet.",
  },
  {
    title: "II. Not alone",
    questions: [
      { text: "Somebody has been living on the {a}. Proof: {b}.", blanks: {
        a: { type: "word", options: ["terrace", "lounge", "kitchen", "upper floor"], answer: "terrace" },
        b: { type: "evidence", answer: ["bowl", "terrace_chair", "barrel", "notice"] } } },
      { text: "Someone traced over her tag in {a}: {b}.", blanks: {
        a: { type: "word", options: ["blue", "pink", "black"], answer: "blue" },
        b: { type: "evidence", answer: ["heart_traced"] } } },
      { text: "That person waited in the hall, watching the window from {a}.", blanks: { a: { type: "evidence", answer: ["armchairs"] } } },
    ],
    solved: "Two other people were in the building that day: whoever lives on the terrace, and someone who got there before her and waited.",
  },
  {
    title: "III. Where is Mara?",
    questions: [
      { text: "The man in blue is {a}. He left {b}.", blanks: {
        a: { type: "word", options: ["the man on the terrace", "a stranger who follows her trips", "a security guard", "another photographer she knew"], answer: "a stranger who follows her trips" },
        b: { type: "evidence", answer: ["page"] } } },
      { text: "When she saw him she ran, and knocked over {a}.", blanks: { a: { type: "evidence", answer: ["flipped"] } } },
      { text: "She hid in {a} and left {b}.", blanks: {
        a: { type: "word", options: ["Room 31", "the kitchen", "the lounge", "the stairwell"], answer: "Room 31" },
        b: { type: "evidence", answer: ["room31_note"] } } },
      { text: "Mara is now {a}.", blanks: { a: { type: "word", options: [
        "hiding at the caravan behind the terrace", "still somewhere in the building", "with the man in blue", "back home"], answer: "hiding at the caravan behind the terrace" } } },
    ],
    solved: null, // the ending
  },
];

export const ENDING = `
<h2>Case closed</h2>
<p>You call it in from the gate. Two officers walk past the hedge behind the terrace and knock on a caravan door.
A dog barks, then a man called Henrik opens it, and behind him, wrapped in a blanket, is Mara Lenz.</p>
<p>She hadn't called anyone because the man who followed her knew things she had only told her phone.
Her phone stayed in the building, switched off in a kitchen drawer.</p>
<p>A man is picked up two days later, still driving the routes on her list. His jacket has blue paint on the cuff.</p>
<p class="small">Her photographs of Haus Lindenhof were never posted. These are yours.</p>`;
