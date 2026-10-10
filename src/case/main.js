import * as THREE from "three";
import { createView } from "./view.js";
import { CaseAudio } from "./audio.js";
import { CaseMusic } from "./music.js";
import { Motes } from "./motes.js";
import { trailRoute, buildTrail } from "./trail.js";
import { bindFullscreenButtons, sinceLockChange } from "../fullscreen.js";
import { Haze } from "./haze.js";
import { buildEdgeField } from "./boundary.js";
import { World } from "../world.js";
import { Player } from "../player.js";
import * as STORY from "../story.js";
import * as CASE from "./case-data.js";

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const DEBUG = params.has("debug");

const view = createView({
  container: $("app"),
  params,
  onProgress: (e) => { if (e.total) $("progress").textContent = `loading scan ${Math.round((100 * e.loaded) / e.total)}%`; },
});
const { camera, renderer } = view;
const canvas = renderer.domElement;
const audio = new CaseAudio();
const music = new CaseMusic(audio);
music.bindButton($("music"));
const haze = new Haze(view.scene, camera);
let world, player, motes, trail, trailMotes;

$("brief").innerHTML = CASE.BRIEF;
$("credits").innerHTML = STORY.SCENE_CREDIT + "The case, its people and events are fiction.";

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
};

async function load() {
  world = await World.load("assets", STORY.UPPER);
  // the terrace door: its sill isn't bridged by the voxel floors, so open the doorway (collision only)
  world.carve(CASE.TERRACE_DOOR);
  for (const b of CASE.BOUNDARIES) world.block(b);
  view.setBoundaries(CASE.BOUNDARIES);
  world.buildNav();
  world.setMainFrom(CASE.SPAWN);
  view.setEdgeField(buildEdgeField(world));
  // calm investigator: no stamina, a natural walking pace, gentle starts/stops, very little bob
  player = new Player(camera, world, audio, canvas, { stamina: false, walk: 2.1, run: 3.8, accel: 7, decel: 9, bob: 0.35, roll: 0.04 });
  player.spawn(CASE.SPAWN.x, CASE.SPAWN.y, CASE.SPAWN.z, CASE.SPAWN.yaw);
  await view.mesh.initialized;
  motes = new Motes(view.scene, clues);
  // Mara's footprints to the stairs, with a little glinting dust over a few of them
  const route = trailRoute(world, new THREE.Vector3(CASE.SPAWN.x, CASE.SPAWN.y, CASE.SPAWN.z), new THREE.Vector3(...CASE.TRAIL.to), CASE.TRAIL.length);
  if (route) {
    trail = buildTrail(world, route);
    view.scene.add(trail.mesh);
    trailMotes = new Motes(view.scene, trail.prints.filter((_, i) => i % 12 === 5).map((v, i) => ({ id: `trail${i}`, v, r: 0.05 })));
    view.touch(5);
  }
  // let Spark settle before we allow entry
  $("progress").textContent = "developing the scan";
  await new Promise((resolve) => {
    let good = 0, last = performance.now(); const t0 = last;
    (function check() {
      const now = performance.now(); good = now - last < 40 ? good + 1 : 0; last = now;
      if (good > 30 || now - t0 > 30000) resolve(); else requestAnimationFrame(check);
    })();
  });
  $("progress").textContent = "";
  $("start").disabled = false;
  $("start").textContent = "Open the file";
  if (DEBUG) setupDev();
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
  if (e.code === "Tab") { e.preventDefault(); state.ui === "notebook" ? closeUI() : openNotebook(); return; }
  if (e.code === "KeyE" && !e.repeat) { state.ui === "doc" ? closeUI() : !state.ui && !state.paused && examine(); }
  if (DEBUG && e.code === "KeyP" && !e.repeat && !state.ui) setFrozen(!state.frozen); // freeze frame, for screenshots
  // Esc closes what's open (a document, the notebook, the pause menu); while walking it pauses.
  // (In fullscreen the Esc key is kept for the game; holding it leaves fullscreen.)
  // M does the same, without Esc (which browsers also use for leaving fullscreen)
  if ((e.code === "Escape" || e.code === "KeyM") && !e.repeat) {
    if (state.ui) { if (state.ui !== "ending") closeUI(); }
    else if (document.pointerLockElement === canvas) document.exitPointerLock();
    else if (!$("pause").hidden && sinceLockChange() > 300) lock();
  }
});
$("doc").addEventListener("click", closeUI);
$("nb-close").onclick = closeUI;

function closeUI() {
  if (state.ui === "ending") return;
  for (const id of ["doc", "notebook"]) $(id).hidden = true;
  state.ui = null;
  lock();
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
  state.evidence.set(c.id, { id: c.id, label: c.label, room: c.room, kind: c.kind, note: c.note, doc: c.doc, img: img ?? prev?.img ?? null });
  updateHud();
}

function updateHud() {
  const n = state.evidence.size;
  const solved = state.solved.filter(Boolean).length;
  $("hud-progress").textContent = `Evidence ${n} · Chapters solved ${solved} / ${CASE.CHAPTERS.length}`;
}

// ---------------------------------------------------------------------------- notebook
function openNotebook() {
  state.ui = "notebook";
  setRaised(false);
  document.exitPointerLock?.();
  $("notebook").hidden = false;
  $("pause").hidden = true;
  audio.paper();
  renderNotebook();
}

function unlockedChapters() {
  let n = 1;
  while (n < CASE.CHAPTERS.length && state.solved[n - 1]) n++;
  return n;
}

let picker = null;
function renderNotebook() {
  const nUnlocked = unlockedChapters();
  state.chapterTab = Math.min(state.chapterTab, nUnlocked - 1);
  $("nb-tabs").innerHTML = CASE.CHAPTERS.map((ch, i) =>
    `<button class="tab ${i === state.chapterTab ? "on" : ""} ${state.solved[i] ? "done" : ""}" data-tab="${i}" ${i >= nUnlocked ? "disabled" : ""}>${i < nUnlocked ? ch.title : "· · ·"}${state.solved[i] ? " ✓" : ""}</button>`).join("");
  for (const b of $("nb-tabs").querySelectorAll("[data-tab]")) b.onclick = () => { state.chapterTab = +b.dataset.tab; renderNotebook(); };

  const ci = state.chapterTab, ch = CASE.CHAPTERS[ci];
  const solved = state.solved[ci];
  let html = solved ? "" : `<p class="nb-how">Click a blank, then pick a piece of evidence or a word. When every statement in the chapter holds, check it.</p>`;
  ch.questions.forEach((q, qi) => {
    const parts = q.text.split(/(\{\w\})/g).map((part) => {
      const m = /^\{(\w)\}$/.exec(part);
      if (!m) return esc(part);
      const key = m[1], blank = q.blanks[key], val = state.answers[ci][qi][key];
      let label = "&nbsp;?&nbsp;";
      if (val) label = blank.type === "word" ? esc(val) : esc(state.evidence.get(val)?.label ?? val);
      return `<button class="blank ${val ? "filled" : ""} ${blank.type}" data-q="${qi}" data-k="${key}" ${solved ? "disabled" : ""}>${label}</button>`;
    }).join("");
    html += `<div class="q"><span class="qn">${qi + 1}</span><p>${parts}</p></div>`;
  });
  if (solved) html += `<div class="solved">${ch.solved ?? ""}</div>`;
  else html += `<div class="check-row"><button id="nb-check">Check this chapter</button><span id="nb-feedback"></span></div>`;
  $("nb-questions").innerHTML = html;
  for (const b of $("nb-questions").querySelectorAll(".blank")) b.onclick = (e) => openPicker(ci, +b.dataset.q, b.dataset.k, b);
  $("nb-check")?.addEventListener("click", () => checkChapter(ci));

  // evidence grid
  const ev = [...state.evidence.values()];
  $("nb-ev-count").textContent = `(${ev.length})`;
  $("nb-evidence").innerHTML = ev.length
    ? ev.map((e) => `<button class="card ${picker ? "pickable" : ""}" data-id="${e.id}">
        ${e.img ? `<img src="${e.img}" alt="">` : `<div class="docicon">${e.kind === "doc" ? "DOCUMENT" : "NOTE"}</div>`}
        <span>${esc(e.label)}</span><small>${esc(e.room)}</small></button>`).join("")
    : `<p class="empty">Nothing yet. Raise your camera (right mouse button), frame something that matters, and take a photo (left button). Press E to read documents.</p>`;
  for (const b of $("nb-evidence").querySelectorAll(".card")) b.onclick = () => {
    if (picker && picker.type === "evidence") return choose(b.dataset.id);
    showCard(b.dataset.id);
  };
}

function openPicker(ci, qi, key, el) {
  const blank = CASE.CHAPTERS[ci].questions[qi].blanks[key];
  closePicker();
  picker = { ci, qi, key, type: blank.type };
  if (blank.type === "word") {
    const pop = document.createElement("div");
    pop.className = "picker";
    pop.innerHTML = blank.options.map((o) => `<button data-v="${esc(o)}">${esc(o)}</button>`).join("");
    const r = el.getBoundingClientRect();
    pop.style.left = `${r.left}px`; pop.style.top = `${r.bottom + 6}px`;
    document.body.appendChild(pop);
    for (const b of pop.querySelectorAll("button")) b.onclick = () => choose(b.dataset.v);
    picker.pop = pop;
  } else {
    if (!state.evidence.size) { picker = null; return toast("You don't have any evidence yet."); }
    el.classList.add("picking");
    $("nb-evidence").classList.add("picking");
    renderNotebookEvidenceHint();
  }
}
function renderNotebookEvidenceHint() {
  for (const b of $("nb-evidence").querySelectorAll(".card")) b.classList.add("pickable");
  $("nb-ev-count").textContent = "· pick a piece of evidence";
}
function choose(v) {
  const { ci, qi, key } = picker;
  state.answers[ci][qi][key] = v;
  closePicker();
  audio.paper(0.4);
  renderNotebook();
}
function closePicker() {
  picker?.pop?.remove();
  picker = null;
  $("nb-evidence").classList.remove("picking");
}
addEventListener("mousedown", (e) => {
  if (picker?.pop && !picker.pop.contains(e.target) && !e.target.classList.contains("blank")) { closePicker(); }
});

function checkChapter(ci) {
  const ch = CASE.CHAPTERS[ci];
  let correct = 0, total = 0, empty = 0;
  ch.questions.forEach((q, qi) => {
    let ok = true;
    for (const [k, blank] of Object.entries(q.blanks)) {
      const v = state.answers[ci][qi][k];
      if (!v) { empty++; ok = false; continue; }
      if (blank.type === "word" ? v !== blank.answer : !blank.answer.includes(v)) ok = false;
    }
    total++; if (ok) correct++;
  });
  const fb = $("nb-feedback");
  if (empty) { fb.textContent = "Fill in every blank first."; return; }
  if (correct === total) {
    state.solved[ci] = true;
    audio.solve();
    updateHud();
    if (ci === CASE.CHAPTERS.length - 1) return finish();
    state.chapterTab = ci + 1 < unlockedChapters() ? ci : ci;
    renderNotebook();
    toast(`<b>${ch.title}</b> solved. A new chapter is open in the notebook.`, 4000);
  } else {
    audio.wrong();
    fb.textContent = correct === 0 ? "None of these hold up yet." : `${correct} of ${total} statements hold up. Not all of them.`;
  }
}

function showCard(id) {
  const e = state.evidence.get(id);
  if (!e) return;
  if (e.kind === "doc") { $("doc-body").innerHTML = e.doc; }
  else $("doc-body").innerHTML = `${e.img ? `<img class="photo" src="${e.img}">` : ""}<h2>${esc(e.label)}</h2><p>${esc(e.note)}</p><p class="small">${esc(e.room)}</p>`;
  $("doc").hidden = false;
  $("doc").onclick = () => { $("doc").hidden = true; $("doc").onclick = closeUI; };
}

function finish() {
  state.ui = "ending";
  $("notebook").hidden = true;
  const photos = [...state.evidence.values()].filter((e) => e.img).slice(0, 9);
  $("end-body").innerHTML = CASE.ENDING + `<div class="end-photos">${photos.map((p) => `<img src="${p.img}">`).join("")}</div>
    <div class="row"><button onclick="location.reload()">Start over</button></div>`;
  $("ending").hidden = false;
  document.exitPointerLock?.();
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

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
  if (state.frozen) return;
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
    if (trail && !state.sawTrail && trail.prints.some((p) => p.distanceToSquared(player.pos) < 2.2 && Math.abs(p.y - player.pos.y) < 0.6)) {
      state.sawTrail = true;
      toast("Footprints in the dust. Small, recent. They lead to the stairs.", 5000);
    }
    audio.update(dt, camera);
  }
  motes?.update(dt, clock.elapsedTime, renderer.domElement.height);
  trailMotes?.update(dt, clock.elapsedTime, renderer.domElement.height);
  haze.update(clock.elapsedTime);
  view.spark.material.uniforms.cfTime.value = clock.elapsedTime;
  if (player) view.spark.material.uniforms.cfPlayer.value.copy(player.pos);
  view.render();
  if (state.pendingShot) { state.pendingShot = false; capture(); }
});

// ---------------------------------------------------------------------------- dev / authoring
function setupDev() {
  const ray = new THREE.Raycaster();
  window.THREE = THREE;
  window.dev = {
    get world() { return world; }, get player() { return player; }, get motes() { return motes; }, get trail() { return trail; }, camera, view, state, clues,
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
