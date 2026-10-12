// Undeveloped: the entry point (undeveloped.html). Builds the view, loads the scan and the
// collision world, lays the footprint trails, wires up the controls and screens, and runs the frame
// loop. Looking and photographing (framed(), examine, photos, evidence) are below; the notebook
// is notebook.js and the case itself (clues, chapters, texts) case-file.js.
import * as THREE from "three";
import { createView } from "./view.js";
import { UndevelopedAudio } from "./audio.js";
import { UndevelopedMusic } from "./music.js";
import { Motes } from "./motes.js";
import { Trails } from "./trail.js";
import { bindFullscreenButtons, sinceLockChange } from "../shared/fullscreen.js";
import { watchForSlowFrames, bindQualityButtons } from "../shared/quality.js";
import { waitForSteadyFrames, showStreaming } from "../shared/splat-scene.js";
import { Haze } from "./haze.js";
import { buildEdgeField } from "../shared/edge-field.js";
import { World } from "../shared/world.js";
import { Player } from "../shared/player.js";
import { SCENE_CREDIT, UPPER_FLOORS, BOUNDARIES } from "../shared/scan.js";
import * as CASE from "./case-file.js";
import { createNotebook } from "./notebook.js";
import { deviceGate } from "../shared/device.js";

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const DEBUG = params.has("debug");

// no WebGL 2, or a phone / tablet: say so first (shared/device.js)
await deviceGate({ theme: "day" });

const view = createView({
  container: $("app"),
  params,
  onProgress: (e) => { if (e.total) $("progress").textContent = `loading scan ${Math.round((100 * e.loaded) / e.total)}%`; },
});
const { camera, renderer } = view;
const canvas = renderer.domElement;
const audio = new UndevelopedAudio();
const music = new UndevelopedMusic(audio);
music.bindButton($("music"));
const haze = new Haze(view.scene, camera);
let world, player, motes, trails;

$("brief").innerHTML = CASE.BRIEF;
$("credits").innerHTML = SCENE_CREDIT + "The case, its people and events are fiction.";

// ---------------------------------------------------------------------------- state
const KEYS = { sat: 1, lum: 2, warm: 3 };
const clues = CASE.CLUES.map((c) => ({ ...c, kind: c.kind ?? "photo", v: new THREE.Vector3(...c.pos),
  // the region that glows when it's framed or photographed (view.js setHighlight)
  hv: new THREE.Vector3(...(c.glow?.at ?? c.pos)), ext: new THREE.Vector3(...(c.glow?.ext ?? [c.r * 1.2, c.r * 1.2, c.r * 1.2])),
  key: c.glow?.key ? [KEYS[c.glow.key], c.glow.t] : null }));
const byId = Object.fromEntries(clues.map((c) => [c.id, c]));
const state = {
  started: false, paused: true, frozen: false, ui: null, // ui: null | "doc" | "notebook" | "ending"
  raised: false, zoom: 0,
  evidence: new Map(), // id -> { id, label, room, img?, kind }
  answers: CASE.CHAPTERS.map((ch) => ch.questions.map(() => ({}))),
  solved: CASE.CHAPTERS.map(() => false),
  pendingShot: false,
  chapterTab: 0,
  idle: 0, sinceCue: 0, // seconds of play without progress / since the last cue (see lostCue)
};

async function load() {
  world = await World.load("assets", UPPER_FLOORS);
  // the terrace door: its sill isn't bridged by the voxel floors, so open the doorway (collision only)
  world.carve(CASE.TERRACE_DOOR);
  for (const b of BOUNDARIES) world.block(b);
  view.setBoundaries(BOUNDARIES);
  world.buildNav();
  world.setMainFrom(CASE.SPAWN);
  view.setEdgeField(buildEdgeField(world));
  // calm investigator: no stamina, a natural walking pace, gentle starts/stops, very little bob
  player = new Player(camera, world, audio, canvas, { stamina: false, walk: 2.1, run: 3.8, accel: 7, decel: 9, bob: 0.35, roll: 0.04 });
  player.spawn(CASE.SPAWN.x, CASE.SPAWN.y, CASE.SPAWN.z, CASE.SPAWN.yaw);
  $("progress").textContent = "loading scan";
  await view.mesh.initialized;
  watchForSlowFrames(view.quality); // if the full scan is a slideshow here, switch to the lite one
  motes = new Motes(view.scene, clues);
  // the footprint trails, leg by leg
  const at = (p) => (typeof p === "string" ? byId[p].v : new THREE.Vector3(...p));
  trails = new Trails({ world, scene: view.scene, defs: CASE.TRAILS, point: at, onRegen: view.touch });
  updateTrails(true);
  updateHud();
  // let Spark settle before we allow entry
  $("progress").textContent = "developing the scan";
  await waitForSteadyFrames(30, 30000);
  view.governor.activate(); // from here resolution and detail follow the frame rate
  $("progress").textContent = "";
  $("start").disabled = false;
  $("start").textContent = "Open the file";
  showStreaming(view.spark, $("progress")); // the rest of the detail keeps streaming in
  if (DEBUG) setupDev();
  if (params.has("bench")) await setupBench();
}
load().catch((e) => { console.error(e); $("progress").textContent = "failed to load: " + e.message; });

// ---------------------------------------------------------------------------- input / screens
// if the browser refuses the mouse (e.g. right after Esc), show the pause screen to click back in
const showPauseIfUnlocked = () => { if (state.started && !state.ui && document.pointerLockElement !== canvas) $("pause").hidden = false; };
const lock = () => canvas.requestPointerLock?.()?.catch?.(showPauseIfUnlocked);
document.addEventListener("pointerlockerror", showPauseIfUnlocked);
$("start").onclick = () => {
  audio.start();
  music.start();
  state.started = true;
  state.t0 = performance.now();
  trails?.release(); // the trails walk themselves in as play begins (or during the opening)
  lock();
  // the opening, over a slow walk through the hall (every time; easy to skip)
  $("title").classList.add("leaving");
  setTimeout(() => { $("title").hidden = true; $("title").classList.remove("leaving"); }, 1400);
  startOpening();
};

// a smooth way in: the file (or the opening) lifts away, the view pulls into focus and develops
function enter() {
  const dev = $("develop-in");
  dev.classList.add("on");
  requestAnimationFrame(() => requestAnimationFrame(() => { dev.classList.add("fade"); }));
  if (!$("title").hidden) $("title").classList.add("leaving");
  setTimeout(() => { $("title").hidden = true; $("title").classList.remove("leaving"); dev.className = ""; }, 3100);
  setTimeout(() => { $("hud").style.opacity = 1; }, 1200);
  setTimeout(() => chapterCard(0), 1800);
  setTimeout(() => toast("Look around. <b>Glinting dust</b> marks things worth a closer look.", 6000), 6800);
}

// ---------------------------------------------------------------------------- the opening
// Three lines over a slow camera move through the dining hall, ending where you start. Shown
// every time; click, Space, Enter or Esc skips it.
const opening = { t: 0, line: -1 };
function startOpening() {
  state.intro = true;
  player.enabled = false;
  const P = CASE.OPENING.path;
  opening.curve = new THREE.CatmullRomCurve3(P.map(([x, y, z]) => new THREE.Vector3(x, y, z)), false, "centripetal");
  opening.t = 0; opening.line = -1;
  $("intro").hidden = false;
  requestAnimationFrame(() => $("intro").classList.add("on"));
}
const smooth = (t) => t * t * (3 - 2 * t);
function updateOpening(dt) {
  const O = CASE.OPENING, P = O.path;
  opening.t = Math.min(1, opening.t + dt / O.seconds);
  const u = smooth(opening.t);
  const p = opening.curve.getPoint(u);
  // yaw / pitch between the keys (the curve's parameter is close enough to the key spacing)
  const f = u * (P.length - 1), i = Math.min(P.length - 2, Math.floor(f)), k = smooth(f - i);
  const yaw = P[i][3] + (P[i + 1][3] - P[i][3]) * k, pitch = P[i][4] + (P[i + 1][4] - P[i][4]) * k;
  camera.position.set(p.x, p.y + 1.62, p.z);
  camera.rotation.set(pitch, yaw, 0, "YXZ");
  // the lines: each holds for a third of the walk, fading in and out
  const n = O.lines.length, line = Math.min(n - 1, Math.floor(opening.t * n * 1.04));
  if (line !== opening.line) {
    opening.line = line;
    const el = $("intro-line");
    el.classList.remove("on");
    setTimeout(() => {
      $("intro-kicker").textContent = O.lines[line].kicker;
      $("intro-text").textContent = O.lines[line].text;
      el.classList.add("on");
    }, line === 0 ? 900 : 700);
  }
  if (opening.t >= 1) endOpening();
}
function endOpening() {
  if (!state.intro) return;
  state.intro = false;
  player.spawn(CASE.SPAWN.x, CASE.SPAWN.y, CASE.SPAWN.z, CASE.SPAWN.yaw);
  player.enabled = document.pointerLockElement === canvas;
  $("intro").classList.remove("on");
  setTimeout(() => ($("intro").hidden = true), 900);
  enter();
}
addEventListener("keydown", (e) => { if (state.intro && ["Space", "Enter", "Escape", "KeyM"].includes(e.code)) { e.preventDefault(); e.stopImmediatePropagation(); endOpening(); } }, true);
addEventListener("mousedown", (e) => { if (state.intro) { e.stopImmediatePropagation(); if (opening.t > 0.02) endOpening(); } }, true);

// ---------------------------------------------------------------------------- chapter cards
// When a chapter opens (and at the start): its title, its question and the story so far, for a
// few seconds. Waits until the notebook is closed.
let cardTimer = 0;
function chapterCard(ci) {
  if (state.ui) { state.pendingCard = ci; return; }
  state.pendingCard = null;
  const ch = CASE.CHAPTERS[ci], el = $("chapter-card");
  el.innerHTML = `<small>${esc(ch.title)}</small><h2>${esc(ch.question)}</h2><p>${esc(ch.intro)}</p>`;
  el.hidden = false;
  requestAnimationFrame(() => el.classList.add("on"));
  clearTimeout(cardTimer);
  cardTimer = setTimeout(() => { el.classList.remove("on"); setTimeout(() => (el.hidden = true), 900); }, 6500);
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
$("resume").onclick = lock;
canvas.addEventListener("click", () => {
  if (state.frozen) return setFrozen(false);
  if (state.started && !state.ui && document.pointerLockElement !== canvas) lock();
});
document.addEventListener("pointerlockchange", () => {
  const locked = document.pointerLockElement === canvas;
  state.paused = !locked;
  player.enabled = locked && !state.intro;
  if (!locked) { state.raised = false; player.keys = {}; }
  if (state.frozen) return;
  $("pause").hidden = locked || !!state.ui || !state.started;
  music.setPaused(!$("pause").hidden);
});
canvas.addEventListener("mousedown", (e) => {
  if (state.paused || state.ui) return;
  if (e.button === 2) setRaised(!state.raised);
  if (e.button === 0 && state.raised) takePhoto();
});
addEventListener("contextmenu", (e) => e.preventDefault());
addEventListener("keydown", (e) => {
  if (!state.started || state.intro) return;
  if (e.code === "Tab") { e.preventDefault(); if (notebook.cardOpen()) notebook.closeCard(); state.ui === "notebook" ? closeUI() : notebook.open(); return; }
  if (e.code === "KeyE" && !e.repeat) { state.ui === "doc" ? closeUI() : !state.ui && !state.paused && examine(); }
  if (DEBUG && e.code === "KeyP" && !e.repeat && !state.ui) setFrozen(!state.frozen); // freeze frame, for screenshots
  // Esc closes what's open (a document, the notebook, the pause menu); while walking it pauses.
  // (In fullscreen the Esc key is kept for the game; holding it leaves fullscreen.)
  // M does the same, without Esc (which browsers also use for leaving fullscreen)
  if ((e.code === "Escape" || e.code === "KeyM") && !e.repeat) {
    if (notebook.cardOpen()) notebook.closeCard();
    else if (state.ui) { if (state.ui !== "ending") closeUI(); }
    else if (document.pointerLockElement === canvas) document.exitPointerLock();
    else if (!$("pause").hidden && sinceLockChange() > 300) lock();
  }
});
$("doc").addEventListener("click", () => (notebook.cardOpen() ? notebook.closeCard() : closeUI())); // a card over the notebook, or a document picked up
$("nb-close").onclick = closeUI;

function closeUI() {
  if (state.ui === "ending") return;
  $("doc").classList.remove("over-notebook");
  notebook.close();
  for (const id of ["doc", "notebook"]) $(id).hidden = true;
  state.ui = null;
  lock();
  if (state.trailsPending) updateTrails();
  if (state.pendingCard != null) setTimeout(() => chapterCard(state.pendingCard), 600);
}

function setRaised(on) {
  state.raised = on;
  $("viewfinder").hidden = !on;
  if (!on) $("vf-target").classList.remove("on");
  document.body.classList.toggle("raised", on);
  $("dot").hidden = on;
  audio.click();
}

let frozenTimer = 0;
function setFrozen(on) {
  if (on === state.frozen) return;
  state.frozen = on;
  $("frozen").hidden = !on;
  $("frozen").style.opacity = 1;
  clearTimeout(frozenTimer);
  if (on) {
    console.log(`[freeze] pos ${player.pos.toArray().map((v) => v.toFixed(2)).join(", ")} yaw ${player.yaw.toFixed(2)} pitch ${player.pitch.toFixed(2)}`);
    frozenTimer = setTimeout(() => ($("frozen").style.opacity = 0), 1200);
    document.exitPointerLock?.();
  } else { $("pause").hidden = true; lock(); }
}

bindFullscreenButtons();
bindQualityButtons(view.quality);

// Gameplay toasts wait while an overlay is up (the notebook, a document, the opening, a chapter
// card, the ending): one showing when it opens is put back in the queue, and the queue plays
// once it closes, dropping anything older than half a minute. The notebook's own messages
// (force) show over it.
let toastTimer = 0, toastShown = null, toastQueue = [];
const overlayOpen = () => !!state.ui || !!state.intro || !$("chapter-card").hidden;
function toast(html, ms = 2600, { force = false } = {}) {
  if (!force && overlayOpen()) return queueToast(html, ms);
  $("toast").innerHTML = html;
  $("toast").style.opacity = 1;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $("toast").style.opacity = 0; toastShown = null; }, ms);
  toastShown = force ? null : { html, end: performance.now() + ms };
}
function queueToast(html, ms) {
  toastQueue = toastQueue.filter((t) => t.html !== html);
  toastQueue.push({ html, ms: Math.max(ms, 3000), at: performance.now() });
  if (toastQueue.length > 3) toastQueue.shift();
}
let overlayWas = false;
function updateToasts() {
  const open = overlayOpen();
  if (open && !overlayWas && toastShown) {
    const left = toastShown.end - performance.now();
    if (left > 1200) queueToast(toastShown.html, left);
    clearTimeout(toastTimer);
    $("toast").style.opacity = 0;
    toastShown = null;
  }
  // pointers to the notebook are moot once it has been opened
  if (state.ui === "notebook") toastQueue = toastQueue.filter((t) => !/<b>Tab<\/b>/.test(t.html));
  if (!open && overlayWas) flushToasts(700);
  overlayWas = open;
}
function flushToasts(delay) {
  setTimeout(() => {
    toastQueue = toastQueue.filter((t) => performance.now() - t.at < 30000);
    if (overlayOpen() || !toastQueue.length) return;
    const t = toastQueue.shift();
    toast(t.html, t.ms);
    if (toastQueue.length) flushToasts(t.ms + 400);
  }, delay);
}

// ---------------------------------------------------------------------------- looking at things
const tmp = new THREE.Vector3(), ndc = new THREE.Vector3(), camDir = new THREE.Vector3();
// clues visible near the centre of view: [{clue, dist, off}]. reach: multiple of each clue's
// photo range to look within
function framed(maxOff = 0.55, reach = 1) {
  camera.updateMatrixWorld();
  camera.getWorldDirection(camDir);
  const out = [];
  for (const c of clues) {
    tmp.subVectors(c.v, camera.position);
    const dist = tmp.length();
    if (dist > (c.range + c.r) * reach || tmp.dot(camDir) <= 0) continue;
    ndc.copy(c.v).project(camera);
    const off = Math.max(Math.abs(ndc.x), Math.abs(ndc.y) * 0.8);
    if (off > maxOff) continue;
    // line of sight to a point just in front of the object's surface
    const p = tmp.copy(c.v).lerp(camera.position, Math.min(0.4, (c.r + 0.15) / dist));
    if (!world.lineOfSight(camera.position, p)) continue;
    out.push({ clue: c, dist, off });
  }
  return out.sort((a, b) => a.off - b.off);
}

function examine() {
  const f = framed(0.22).filter((x) => x.dist < Math.min(x.clue.range, 4));
  if (!f.length) return toast("Nothing here you can make out. Get closer.");
  // documents win over nearby objects (a note lies in a drawer, a notice hangs by a barrel)
  const c = (f.find((x) => x.clue.kind === "doc") ?? f[0]).clue;
  if (c.kind === "doc") {
    $("doc-body").innerHTML = c.doc;
    $("doc-note").textContent = "click or press E to put it back · it's been added to your notebook";
    $("doc").hidden = false;
    state.ui = "doc";
    document.exitPointerLock?.();
    audio.paper();
    addEvidence(c, null);
  } else {
    toast(`<b>${c.label}</b><br>${c.note}`, 5200);
  }
}

// ---------------------------------------------------------------------------- photographs
function takePhoto() {
  state.pendingShot = true; // captured right after the next render, while the frame is fresh
  audio.shutter();
  const s = $("shutter");
  s.style.transition = "none"; s.style.opacity = 1;
  requestAnimationFrame(() => { s.style.transition = "opacity .35s"; s.style.opacity = 0; });
}

const thumb = document.createElement("canvas");
thumb.width = 640; thumb.height = 360;
function capture() {
  const ctx = thumb.getContext("2d");
  const w = canvas.width, h = canvas.height, ar = 16 / 9;
  const sw = Math.min(w, h * ar), sh = sw / ar; // centre crop to 16:9
  ctx.drawImage(canvas, (w - sw) / 2, (h - sh) / 2, sw, sh, 0, 0, thumb.width, thumb.height);
  const hits = framed(0.6).map((x) => x.clue);
  // the viewfinder's bracket stays in the photo, around each clue it caught, in the same style
  // as the live one (corners, gold, a soft shadow), scaled to the print
  const k = thumb.width / (sw * innerWidth / w); // print pixels per screen (CSS) pixel
  const arm = Math.max(10, 13 * k), lw = Math.max(2, 2 * k);
  for (const c of hits) {
    const b = bracketBox(c, w, h, 44 * w / innerWidth);
    const f = thumb.width / sw, x = (b.L - (w - sw) / 2) * f, y = (b.T - (h - sh) / 2) * f, bw = b.w * f, bh = b.h * f;
    ctx.save();
    ctx.strokeStyle = "#ffd36b"; ctx.lineWidth = lw; ctx.lineCap = "square";
    ctx.shadowColor = "rgba(0,0,0,.5)"; ctx.shadowBlur = 2;
    ctx.beginPath();
    for (const [cx, cy, dx, dy] of [[x, y, 1, 1], [x + bw, y, -1, 1], [x, y + bh, 1, -1], [x + bw, y + bh, -1, -1]]) {
      const px = cx + dx * lw / 2, py = cy + dy * lw / 2;
      ctx.moveTo(px, py + dy * arm); ctx.lineTo(px, py); ctx.lineTo(px + dx * arm, py);
    }
    ctx.stroke();
    ctx.restore();
  }
  const img = thumb.toDataURL("image/jpeg", 0.85);
  const fresh = hits.filter((c) => !state.evidence.get(c.id)?.img);
  // what was captured lights up: its own splats glow and a band of light sweeps up them
  hits.slice(0, 3).forEach((c, i) => flashes.push({ clue: c, t: 0, slot: 1 + i, strength: fresh.includes(c) ? 1 : 0.45 }));
  if (fresh.length) {
    for (const c of fresh) addEvidence(c, img);
    const one = fresh[0];
    showPrint(img, fresh.length > 1 ? fresh.map((c) => c.label).join(" · ") : one.label,
      fresh.length > 1 ? "All in your notebook now." : one.note, "Photographed");
    return;
  }
  if (hits.length) return showPrint(img, hits[0].label, "You already have this one in your notebook.", "Already in the notebook", "dim");
  // nothing that counts: say why, gently (too far, or not in the middle of the frame)
  const far = framed(0.6, 2.4).find((x) => x.dist > x.clue.range + x.clue.r && !state.evidence.get(x.clue.id)?.img);
  const edge = !far && framed(0.95).find((x) => !state.evidence.get(x.clue.id)?.img);
  showPrint(img, "Nothing of note", far ? "Something's there, but too far away to make out. Get closer."
    : edge ? "Something at the edge of the frame. Centre it." : "Nothing here tells you anything about Mara.", "", "none");
}

// the print that slides in after each photo: the frame, what it shows, and a line about it
let printTimer = 0;
function showPrint(img, title, line, kicker, mode = "") {
  const el = $("print");
  el.className = mode;
  el.innerHTML = `<img src="${img}" alt=""><div>${kicker ? `<small>${kicker}</small>` : ""}<b>${title}</b><p>${line}</p></div>`;
  el.hidden = false;
  requestAnimationFrame(() => el.classList.add("on"));
  clearTimeout(printTimer);
  printTimer = setTimeout(() => el.classList.remove("on"), mode === "none" ? 3200 : 5200);
}

// the photo highlight (view.js): slots 1-3 flash after the shutter (while aiming, the bracket
// alone shows what's in frame)
const flashes = [];
function updateHighlights(dt) {
  let focus = 0;
  for (let i = flashes.length - 1; i >= 0; i--) {
    const f = flashes[i];
    f.t += dt / 1.9;
    if (f.t >= 1) { view.setHighlight(f.slot, null); flashes.splice(i, 1); continue; }
    view.setHighlight(f.slot, f.clue.hv, f.clue.ext, f.strength, f.t, f.clue.key);
    if (f.strength >= 1) focus = Math.max(focus, Math.min(1, f.t * 12) * (1 - f.t) ** 1.2);
  }
  view.setFocus(focus);
}

function addEvidence(c, img) {
  const prev = state.evidence.get(c.id);
  if (!state.evidence.size) setTimeout(() => toast("Added to your case notebook. Press <b>Tab</b> to open it.", 6000), 1400);
  motes?.settle(c.id); // the dust settles once it's documented
  if (!prev) progress();
  state.evidence.set(c.id, { id: c.id, label: c.label, room: c.room, kind: c.kind, note: c.note, doc: c.doc, img: img ?? prev?.img ?? null });
  updateHud();
  updateTrails();
}

const notebook = createNotebook({ state, audio, toast: (html, ms) => toast(html, ms, { force: true }), setRaised, onSolved: (ci) => { progress(); updateHud(); updateTrails(); if (ci + 1 < CASE.CHAPTERS.length) state.pendingCard = ci + 1; }, onFinish: showEnding });

// ---------------------------------------------------------------------------- the ending
// The light washes out, then the case closes: what happened next, paragraph by paragraph, a
// postcard, and your photographs as a contact sheet.
function showEnding() {
  // one print per photograph (a frame can hold several clues)
  const photos = [];
  for (const e of state.evidence.values()) {
    if (!e.img) continue;
    const same = photos.find((p) => p.img === e.img);
    if (same) same.label += ` · ${e.label}`; else photos.push({ img: e.img, label: e.label });
  }
  const docs = [...state.evidence.values()].filter((e) => e.kind === "doc").length;
  const mins = Math.max(1, Math.round((performance.now() - (state.t0 ?? performance.now())) / 60000));
  $("end-body").innerHTML = CASE.ENDING + `
    <div class="postcard"><span class="heart">&#9829;</span>${CASE.POSTCARD}<small>A week later, a postcard. No stamp, no address. Just a small pink heart.</small></div>
    <h2 class="sheet-title">Her photographs of Haus Lindenhof were never posted. These are yours.</h2>
    <div class="end-photos">${photos.map((p) => `<figure><img src="${p.img}" alt=""><figcaption>${esc(p.label)}</figcaption></figure>`).join("")}</div>
    <p class="small">${photos.length} photograph${photos.length === 1 ? "" : "s"} · ${docs} document${docs === 1 ? "" : "s"} read · about ${mins} minute${mins === 1 ? "" : "s"} in the building</p>
    <div class="row"><button onclick="location.reload()">Walk it again</button><a class="ghostlink" href="./">&larr; all games</a></div>`;
  $("hud").style.opacity = 0;
  $("ending").hidden = false;
  requestAnimationFrame(() => requestAnimationFrame(() => $("ending").classList.add("on")));
}

function updateHud() {
  const n = state.evidence.size;
  const solved = state.solved.filter(Boolean).length;
  $("hud-progress").textContent = `Evidence ${n} · Chapters solved ${solved} / ${CASE.CHAPTERS.length}`;
  const ch = CASE.CHAPTERS[currentChapter()];
  $("hud-chapter").textContent = solved === CASE.CHAPTERS.length ? "" : `${ch.title} · ${ch.question}`;
}

// ---------------------------------------------------------------------------- trails
// the chapter being worked on: the first one not yet confirmed
const currentChapter = () => { const i = state.solved.indexOf(false); return i < 0 ? CASE.CHAPTERS.length - 1 : i; };
const documented = (id) => state.evidence.has(id);

// Every leg is on show from the start (several leads to choose from) and fades once what it
// leads to is documented; the always-on ones (the stairs) never fade. While the notebook or a
// document is open nothing changes; it happens when you're back.
function updateTrails(initial = false) {
  if (!trails) return;
  if (state.ui && !initial) { state.trailsPending = true; return; }
  state.trailsPending = false;
  for (const leg of trails.legs) {
    const d = leg.def;
    const want = d.always ? "always" : (d.done ?? [d.to]).some(documented) ? "faded" : "active";
    trails.set(d.id, want);
  }
}

const progress = () => (state.idle = 0);

// No progress for a while: say roughly where the open trail is, and let its prints catch the
// light for a moment. With no trail open, point at what's missing (by room) or at the notebook.
const LOST_AFTER = 75, CUE_EVERY = 50;
function lostCue() {
  state.sinceCue = 0;
  const near = trails?.nearestActive(player.pos);
  if (near && near.dist > 2.5) {
    const p = near.print, dx = p.x - player.pos.x, dz = p.z - player.pos.z, dy = p.y - player.pos.y;
    const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw);
    const a = Math.atan2(fx * dz - fz * dx, fx * dx + fz * dz) * 180 / Math.PI; // + = to the right
    const where = dy > 1.5 ? "upstairs" : dy < -1.5 ? "downstairs" : Math.abs(a) < 35 ? "ahead of you" : Math.abs(a) > 125 ? "behind you" : a > 0 ? "to your right" : "to your left";
    const whose = { mara: "Her footprints", run: "Her footprints", man: "The boot prints", dog: "The paw prints" }[near.leg.def.walker];
    trails.pulse(5);
    const m = Math.max(3, Math.round(Math.hypot(dx, dz)));
    return toast(Math.abs(dy) > 1.5 ? `${whose} go on ${where}.` : `${whose} are about ${m} m ${where}.`, 5000);
  }
  if (near) { trails.pulse(5); return toast("Look down: the footprints go on from here.", 4500); }
  const ch = CASE.CHAPTERS[currentChapter()];
  const missing = ch.questions.flatMap((q) => Object.values(q.blanks)).filter((b) => b.type === "evidence" && !b.answer.some(documented));
  if (!missing.length) return toast("You may have everything this chapter needs. Open the case notebook: <b>Tab</b>.", 5000);
  const room = byId[missing[0].answer[0]].room;
  toast(`Something in the ${room.toLowerCase().replace(/^room/, "Room")} still needs a closer look.`, 5000);
}

// ---------------------------------------------------------------------------- frame
// the bracket around a clue: its glow region projected to a W x H view (left, top, width,
// height in that view's pixels, at least `min` on a side, kept inside the frame)
function bracketBox(clue, W, H, min) {
  let x0 = 1, y0 = 1, x1 = -1, y1 = -1;
  for (let i = 0; i < 8; i++) {
    corner.set(i & 1 ? 1 : -1, i & 2 ? 1 : -1, i & 4 ? 1 : -1).multiply(clue.ext).multiplyScalar(0.75).add(clue.hv).project(camera);
    x0 = Math.min(x0, corner.x); x1 = Math.max(x1, corner.x); y0 = Math.min(y0, corner.y); y1 = Math.max(y1, corner.y);
  }
  const cl = (v) => Math.max(-0.92, Math.min(0.92, v));
  const L = (cl(x0) + 1) / 2 * W, R = (cl(x1) + 1) / 2 * W;
  const T = (1 - cl(y1)) / 2 * H, B = (1 - cl(y0)) / 2 * H;
  const w = Math.max(min, R - L), h = Math.max(min, B - T);
  return { L: (L + R) / 2 - w / 2, T: (T + B) / 2 - h / 2, w, h };
}

// camera raised: what's in frame, close enough to count. The subject's contour glows faintly
// (updateHighlights) and a bracket closes around it on screen
const corner = new THREE.Vector3();
function updateViewfinder() {
  state.aimed = null;
  if (!state.raised) return;
  const f = framed(0.6);
  const fresh = f.filter((x) => !state.evidence.get(x.clue.id)?.img);
  const subject = (fresh[0] ?? f[0])?.clue ?? null;
  state.aimed = subject;
  $("vf-focus").textContent = fresh.length ? "something worth a photo" : f.length ? "already in your notebook" : "no subject";
  $("viewfinder").classList.toggle("hot", fresh.length > 0);
  const br = $("vf-target");
  if (!subject) { br.classList.remove("on"); return; }
  // the bracket: the subject's region projected to the screen
  const { L, T, w, h } = bracketBox(subject, innerWidth, innerHeight, 44);
  br.style.transform = `translate(${L}px, ${T}px)`;
  br.style.width = `${w}px`; br.style.height = `${h}px`;
  br.classList.add("on");
  br.classList.toggle("known", !fresh.length);
}

let hintT = 0;
function updateHint(dt) {
  hintT -= dt;
  if (hintT > 0) return;
  hintT = 0.15;
  let hint = "";
  if (!state.raised && !overlayOpen()) {
    const near = framed(0.18).filter((x) => x.dist < Math.min(x.clue.range, 4))[0];
    if (near) hint = near.clue.kind === "doc" ? "E — read" : "E — look closer";
    // the first time you're close to something, say how the camera works
    if (near && !state.toldNear) {
      state.toldNear = true;
      toast(near.clue.kind === "doc" ? "Something to read: press <b>E</b>."
        : "Something here. Hold <b>right mouse</b> to raise your camera, <b>left click</b> to take a photo. <b>E</b> looks closer.", 7000);
    }
  }
  $("hint").textContent = hint;
  $("hint").style.opacity = hint ? 1 : 0;
}

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  if (state.frozen || state.benching) return; // (the benchmark drives rendering itself)
  updateToasts();
  if (player && state.started && state.intro) {
    updateOpening(dt);
    audio.update(dt, camera);
  } else if (player && state.started && !params.has("author")) {
    // camera raised: slower, steadier, slight zoom
    state.zoom += ((state.raised ? 1 : 0) - state.zoom) * Math.min(1, dt * 8);
    const fov = 70 - state.zoom * 18;
    if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
    player.lookSensitivity = 0.0022 * (1 - state.zoom * 0.4);
    player.update(dt, { slow: state.raised ? 0.7 : 1 });
    updateViewfinder();
    updateHint(dt);
    updateHighlights(dt);
    // the first time you come across the footprints
    if (trails && !state.sawTrail && trails.activePrints().some((p) => p.distanceToSquared(player.pos) < 2.2 && Math.abs(p.y - player.pos.y) < 0.6)) {
      state.sawTrail = true;
      const stairs = trails.get("stairs")?.prints.some((p) => p.distanceToSquared(player.pos) < 2.2);
      toast(stairs ? "Footprints in the dust, small and fresh. Hers. They lead to the stairs."
        : "Footprints in the dust, small and fresh. Hers. More than one trail: follow any of them.", 5500);
    }
    if (!state.ui && !state.paused) {
      state.idle += dt; state.sinceCue += dt;
      if (state.idle > LOST_AFTER && state.sinceCue > CUE_EVERY) lostCue();
    }
    audio.update(dt, camera);
  }
  if (player) trails?.update(dt, player.pos);
  motes?.update(dt, clock.elapsedTime, renderer.domElement.height);
  haze.update(clock.elapsedTime);
  view.spark.material.uniforms.cfTime.value = clock.elapsedTime;
  if (player) view.spark.material.uniforms.cfPlayer.value.copy(player.pos);
  view.render();
  if (state.pendingShot) { state.pendingShot = false; capture(); }
});

// ---------------------------------------------------------------------------- benchmark (?bench)
// window.bench.walk(): frame pacing on the shared walk through the building (shared/walk-bench.js)
async function setupBench() {
  const { walk, countPageUploads } = await import("../shared/walk-bench.js");
  state.benching = true;
  $("title").hidden = true;
  let regens = 0;
  const update = view.spark.update.bind(view.spark);
  view.spark.update = (a) => (regens++, update(a));
  const t0 = performance.now();
  window.bench = {
    async walk({ seconds = 20, warmup = 3, checkBlack = false } = {}) {
      regens = 0;
      const pages = countPageUploads(view.spark);
      const r = await walk({
        renderer, seconds, warmup, checkBlack, regens: () => regens, governor: view.governor,
        pose(x, y, z, yaw) {
          player.pos.set(x, y, z); player.targetY = y; player.yaw = yaw; player.pitch = -0.1;
          player.update(0, {});
        },
        frame() {
          const t = (performance.now() - t0) / 1000;
          haze.update(t);
          view.spark.material.uniforms.cfTime.value = t;
          view.spark.material.uniforms.cfPlayer.value.copy(player.pos);
          view.render();
        },
        probe: () => ({ splats: view.spark.activeSplats, pixels: canvas.width * canvas.height }),
      });
      return { ...r, regens, pageUploads: pages(), quality: view.quality, ...(view.stats?.() ?? {}) };
    },
  };
  console.log("[bench] ready");
}

// ---------------------------------------------------------------------------- dev / authoring
function setupDev() {
  const ray = new THREE.Raycaster();
  window.THREE = THREE;
  window.dev = {
    get world() { return world; }, get player() { return player; }, get motes() { return motes; }, get trails() { return trails; }, camera, view, state, clues,
    pose(x, y, z, yaw, pitch = 0) {
      player.pos.set(x, y, z); player.targetY = y; player.yaw = yaw; player.pitch = pitch;
      player.update(0, {}); view.touch(3);
    },
    pick(u, v) {
      camera.updateMatrixWorld();
      ray.setFromCamera(new THREE.Vector2(u * 2 - 1, 1 - v * 2), camera);
      const t = world.raycast(ray.ray.origin, ray.ray.direction, 30, 0.02);
      return ray.ray.origin.clone().addScaledVector(ray.ray.direction, t).toArray().map((n) => +n.toFixed(2));
    },
    framed: (o) => framed(o).map((x) => [x.clue.id, +x.dist.toFixed(2), +x.off.toFixed(2)]),
    // aim the camera at a clue from a given spot
    lookAt(id, from) {
      const c = byId[id];
      const [x, y, z] = from;
      const dx = c.v.x - x, dz = c.v.z - z, dy = c.v.y - (y + 1.62);
      this.pose(x, y, z, Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz)));
    },
    shoot() { state.pendingShot = true; },
    // a standing spot on the floor from which clue `id` can be photographed (and read): within
    // reach, in plain sight from eye height, preferring ~`want` metres away
    vantage(id, want) {
      const c = byId[id], eye = new THREE.Vector3();
      want ??= Math.min(c.range * 0.6, c.kind === "doc" ? 1.3 : 2.4);
      let best = null, bd = Infinity;
      world.nav.forEach((n, i) => {
        if (!world.navMain[i]) return;
        const d = Math.hypot(n.x - c.v.x, n.z - c.v.z);
        if (d < 0.5 || d > c.range * 0.85 || Math.abs(n.y - c.v.y) > 2.2) return;
        eye.set(n.x, n.y + 1.62, n.z);
        const p = c.v.clone().lerp(eye, Math.min(0.4, (c.r + 0.15) / eye.distanceTo(c.v)));
        if (!world.lineOfSight(eye, p)) return;
        const score = Math.abs(d - want) + world.navClear(i) * -0.2;
        if (score < bd) { bd = score; best = [n.x, n.y, n.z]; }
      });
      return best;
    },
    // walk up to a clue (teleport), aim, and take a photo (or read it, for a document)
    photograph(id) {
      const from = this.vantage(id);
      if (!from) return null;
      this.lookAt(id, from);
      if (byId[id].kind === "doc") { examine(); return { from, read: state.ui === "doc" }; }
      state.pendingShot = true;
      return { from };
    },
    closeUI, raise: (on = true) => setRaised(on),
    start() { $("start").click(); state.paused = false; player.enabled = true; $("pause").hidden = true; },
  };
  if (params.has("author")) $("title").hidden = true;
  console.log("[dev] ready");
}
