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
let world, player, motes, trails, trailMotes;

$("brief").innerHTML = CASE.BRIEF;
$("credits").innerHTML = SCENE_CREDIT + "The case, its people and events are fiction.";

// ---------------------------------------------------------------------------- state
const clues = CASE.CLUES.map((c) => ({ ...c, kind: c.kind ?? "photo", v: new THREE.Vector3(...c.pos) }));
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
  // the footprint trails, leg by leg, with a little glinting dust over some of the prints of
  // the legs being followed
  const at = (p) => (typeof p === "string" ? byId[p].v : new THREE.Vector3(...p));
  trails = new Trails({ world, scene: view.scene, defs: CASE.TRAILS.map((d) => ({ ...d, from: at(d.from), to: at(d.to) })), onRegen: view.touch });
  trailMotes = new Motes(view.scene, trails.legs.flatMap((leg) =>
    leg.prints.filter((_, i) => i % 10 === 4).map((v, i) => ({ id: `${leg.def.id}:${i}`, leg: leg.def.id, v, r: 0.05 }))), { per: 26, strength: 0 });
  updateTrails(true);
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
  lock();
  // a smooth way in: the file lifts away, the view pulls into focus and develops
  const dev = $("develop-in");
  dev.classList.add("on");
  requestAnimationFrame(() => requestAnimationFrame(() => { dev.classList.add("fade"); }));
  $("title").classList.add("leaving");
  setTimeout(() => { $("title").hidden = true; $("title").classList.remove("leaving"); dev.className = ""; }, 3100);
  setTimeout(() => { $("hud").style.opacity = 1; }, 1200);
  setTimeout(() => toast("Look around. <b>Glinting dust</b> marks things worth a closer look.", 6000), 2200);
};
$("resume").onclick = lock;
canvas.addEventListener("click", () => {
  if (state.frozen) return setFrozen(false);
  if (state.started && !state.ui && document.pointerLockElement !== canvas) lock();
});
document.addEventListener("pointerlockchange", () => {
  const locked = document.pointerLockElement === canvas;
  state.paused = !locked;
  player.enabled = locked;
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
  if (!state.started) return;
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
  for (const id of ["doc", "notebook"]) $(id).hidden = true;
  state.ui = null;
  lock();
  if (state.trailsPending) updateTrails();
}

function setRaised(on) {
  state.raised = on;
  $("viewfinder").hidden = !on;
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

let toastTimer = 0;
function toast(html, ms = 2600) {
  $("toast").innerHTML = html;
  $("toast").style.opacity = 1;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($("toast").style.opacity = 0), ms);
}

// ---------------------------------------------------------------------------- looking at things
const tmp = new THREE.Vector3(), ndc = new THREE.Vector3(), camDir = new THREE.Vector3();
// clues visible near the centre of view: [{clue, dist, off}]
function framed(maxOff = 0.55) {
  camera.updateMatrixWorld();
  camera.getWorldDirection(camDir);
  const out = [];
  for (const c of clues) {
    tmp.subVectors(c.v, camera.position);
    const dist = tmp.length();
    if (dist > c.range + c.r || tmp.dot(camDir) <= 0) continue;
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
  const img = thumb.toDataURL("image/jpeg", 0.85);
  const hits = framed(0.6).map((x) => x.clue);
  const fresh = hits.filter((c) => !state.evidence.has(c.id) || !state.evidence.get(c.id).img);
  if (!hits.length) return toast("Nothing notable in that shot.");
  if (!fresh.length) return toast("You already have that.");
  for (const c of fresh) addEvidence(c, img);
  toast(`Added to the notebook: <b>${fresh.map((c) => c.label).join(", ")}</b>`, 3200);
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

const notebook = createNotebook({ state, audio, toast, setRaised, onSolved: () => { progress(); updateHud(); updateTrails(); } });

function updateHud() {
  const n = state.evidence.size;
  const solved = state.solved.filter(Boolean).length;
  $("hud-progress").textContent = `Evidence ${n} · Chapters solved ${solved} / ${CASE.CHAPTERS.length}`;
}

// ---------------------------------------------------------------------------- trails
// the chapter being worked on: the first one not yet confirmed
const currentChapter = () => { const i = state.solved.indexOf(false); return i < 0 ? CASE.CHAPTERS.length - 1 : i; };
const documented = (id) => state.evidence.has(id);

// Which legs are showing follows the story: a chapter's legs once it is open (and their `after`
// clue documented), faded once what they lead to is documented or the chapter is confirmed.
// While the notebook or a document is open nothing changes; it happens when you're back.
function updateTrails(initial = false) {
  if (!trails) return;
  if (state.ui && !initial) { state.trailsPending = true; return; }
  state.trailsPending = false;
  const cur = currentChapter(), said = [];
  for (const leg of trails.legs) {
    const d = leg.def;
    let want = "hidden";
    if (d.chapter < cur || state.solved[d.chapter]) want = "faded"; // the story so far
    else if (d.chapter === cur && (!d.after || documented(d.after))) want = (d.done ?? [d.to]).some(documented) ? "faded" : "active";
    const was = leg.state;
    if (trails.set(d.id, want) && was === "hidden" && want === "active" && d.say && !initial) said.push(d.say);
    trailMotes.set((m) => m.leg === d.id, want === "active" ? 1 : 0);
  }
  if (said.length) { progress(); setTimeout(() => toast(said.join("<br>"), 6000), 900); }
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
    return toast(`${whose} go on from about ${Math.max(3, Math.round(Math.hypot(dx, dz)))} m ${where}.`, 5000);
  }
  if (near) { trails.pulse(5); return toast("Look down: the footprints go on from here.", 4500); }
  const ch = CASE.CHAPTERS[currentChapter()];
  const missing = ch.questions.flatMap((q) => Object.values(q.blanks)).filter((b) => b.type === "evidence" && !b.answer.some(documented));
  if (!missing.length) return toast("You may have everything this chapter needs. Open the case notebook: <b>Tab</b>.", 5000);
  const room = byId[missing[0].answer[0]].room;
  toast(`Something in the ${room.toLowerCase().replace(/^room/, "Room")} still needs a closer look.`, 5000);
}

// ---------------------------------------------------------------------------- frame
function updateViewfinder() {
  if (!state.raised) return;
  const f = framed(0.6);
  const fresh = f.filter((x) => !state.evidence.get(x.clue.id)?.img);
  $("vf-focus").textContent = fresh.length ? "something worth a photo" : f.length ? "already photographed" : "no subject";
  $("viewfinder").classList.toggle("hot", fresh.length > 0);
}

let hintT = 0;
function updateHint(dt) {
  hintT -= dt;
  if (hintT > 0) return;
  hintT = 0.15;
  let hint = "";
  if (!state.raised && !state.ui) {
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
  if (player && state.started && !params.has("author")) {
    // camera raised: slower, steadier, slight zoom
    state.zoom += ((state.raised ? 1 : 0) - state.zoom) * Math.min(1, dt * 8);
    const fov = 70 - state.zoom * 18;
    if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
    player.lookSensitivity = 0.0022 * (1 - state.zoom * 0.4);
    player.update(dt, { slow: state.raised ? 0.7 : 1 });
    updateViewfinder();
    updateHint(dt);
    // the first time you come across the footprints
    if (trails && !state.sawTrail && trails.activePrints().some((p) => p.distanceToSquared(player.pos) < 2.2 && Math.abs(p.y - player.pos.y) < 0.6)) {
      state.sawTrail = true;
      toast("Footprints in the dust, small and fresh. Hers: they lead away from the window.", 5500);
    }
    if (!state.ui && !state.paused) {
      state.idle += dt; state.sinceCue += dt;
      if (state.idle > LOST_AFTER && state.sinceCue > CUE_EVERY) lostCue();
    }
    audio.update(dt, camera);
  }
  if (player) trails?.update(dt, player.pos);
  motes?.update(dt, clock.elapsedTime, renderer.domElement.height);
  trailMotes?.update(dt, clock.elapsedTime, renderer.domElement.height);
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
    async walk({ seconds = 20, warmup = 3 } = {}) {
      regens = 0;
      const pages = countPageUploads(view.spark);
      const r = await walk({
        renderer, seconds, warmup, regens: () => regens, governor: view.governor,
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
    start() { $("start").click(); state.paused = false; player.enabled = true; $("pause").hidden = true; },
  };
  if (params.has("author")) $("title").hidden = true;
  console.log("[dev] ready");
}
