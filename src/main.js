import * as THREE from "three";
import { SparkRenderer, SplatMesh } from "@sparkjsdev/spark";
import { World } from "./world.js";
import { Audio } from "./audio.js";
import { Player } from "./player.js";
import { SceneFX, U, installShading } from "./lighting.js";
import { Entity } from "./entity.js";
import * as STORY from "./story.js";
import * as BENCH from "./bench.js";
import { RENDER, COLOUR_MODES } from "./render-config.js";
import { BOUNDARIES } from "./case/case-data.js";
import { buildEdgeField } from "./case/boundary.js";
import { Camcorder } from "./camcorder.js";
import { Bulb, buildLightVis } from "./bulb.js";
import { toggleFullscreen, sinceLockChange } from "./fullscreen.js";
import { chooseQuality, watchForSlowFrames, bindQualityButtons, QUALITY, gpuName } from "./quality.js";

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const DEBUG = params.has("debug") || params.has("bench");

// ---------------------------------------------------------------------------- renderer
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1) * RENDER.pixelScale);
renderer.setSize(innerWidth, innerHeight);
renderer.setClearColor(0x000000, 1);
$("app").appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.05, 80);
scene.add(camera);
// the handheld camcorder look (H toggles, remembered per browser; ?clean starts without it)
const camcorder = new Camcorder(renderer, camera, 72);
try { if (localStorage.getItem("residue.camcorder") === "off") camcorder.setOn(false); } catch {}
if (params.has("clean")) camcorder.setOn(false);

// colour detail: full spherical harmonics (glossy steel, view-dependent colour); ?sh=1 is a
// lighter developer fallback
const colourMode = params.get("sh") === "1" ? "fast" : "full";
// full scan for dedicated GPUs, a streamed lighter one for integrated GPUs (see quality.js)
const quality = chooseQuality(renderer, params);
const Q = QUALITY[quality];
if (DEBUG) console.log(`quality ${quality} (${gpuName(renderer)})`);
bindQualityButtons(quality);

const spark = new SparkRenderer({
  renderer,
  lodSplatScale: Number(params.get("detail")) || Q.lodSplatScale || COLOUR_MODES[colourMode].lodSplatScale,
  behindFoveate: RENDER.behindFoveate,
  coneFoveate: RENDER.coneFoveate,
  coneFov0: RENDER.coneFov0,
  coneFov: RENDER.coneFov,
  maxStdDev: RENDER.maxStdDev,
  minSortIntervalMs: RENDER.minSortIntervalMs,
  focalAdjustment: Number(params.get("focal")) || RENDER.focalAdjustment,
  // We decide when splats get regenerated (see renderFrame); lighting lives in the vertex shader.
  autoUpdate: false,
});
installShading(spark);
// Into a render target (the camcorder pass) Spark would switch to linear output; the splats are
// meant to blend in sRGB as on screen, so keep its output identical either way.
Object.defineProperty(spark.material.uniforms.encodeLinear, "value", { get: () => false, set() {} });
spark.material.uniforms.rsAlphaCut.value = params.has("alphacut") ? Number(params.get("alphacut")) : RENDER.alphaCut;
// Without foveation detail depends only on where you stand, so pin the orientation the LoD
// system sees: turning your head then never triggers a re-selection.
if (!RENDER.foveate) spark.lodQuatOverride = new THREE.Quaternion();
spark.lodStep = RENDER.lodStep;
scene.add(spark);

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  camcorder.resize();
});

$("credits").innerHTML = STORY.CREDITS;
STORY.INTRO.forEach((t, i) => {
  const p = document.createElement("p");
  p.innerHTML = t;
  p.style.animationDelay = `${0.6 + i * 1.6}s`;
  $("intro").appendChild(p);
});

// ---------------------------------------------------------------------------- loading
const audio = new Audio();
let world, player, fx, entity, sanatorium;

async function load() {
  world = await World.load("assets", STORY.UPPER);
  // where the scan falls apart, block it off (same zones as Undeveloped)
  for (const b of BOUNDARIES) world.block(b);
  world.buildNav();
  world.setMainFrom(STORY.SPAWN);
  if (DEBUG) console.log("nav nodes", world.nav.length);

  // Load the whole LoD tree into memory up front (no streaming): nothing has to be fetched
  // mid-game, so there's no waiting for detail to arrive.
  sanatorium = new SplatMesh({
    url: params.get("scene") ?? (Q.paged ? RENDER.liteScene : params.has("lod") ? RENDER.lodScene : RENDER.scene),
    paged: Q.paged || undefined, // the lite scene streams its level-of-detail chunks as needed
    extSplats: (!Q.paged && params.has("ext")) || undefined, // debug: 32-byte high-precision splat encoding
    onProgress: (e) => {
      if (e.total) $("progress").textContent = `loading scan  ${Math.round((100 * e.loaded) / e.total)}%`;
    },
  });
  // the capture is y-down; flip 180deg about X
  sanatorium.quaternion.set(1, 0, 0, 0);
  sanatorium.maxSh = Math.min(Q.maxSh, COLOUR_MODES[colourMode].maxSh);
  scene.add(sanatorium);

  fx = new SceneFX(sanatorium);
  fx.setEdge(buildEdgeField(world), BOUNDARIES);
  entity = new Entity(scene, world);
  player = new Player(camera, world, audio, renderer.domElement);
  player.handheld = camcorder.on ? 1 : 0;
  setupLevel();

  $("progress").textContent = "loading scan";
  await sanatorium.initialized;
  watchForSlowFrames(quality); // if the full scan is a slideshow here, switch to the lite one
  // Spark builds its LoD structures right after loading, which stalls rendering for a few
  // seconds. Hold the door until frames are coming quickly again.
  $("progress").textContent = "developing the scan";
  await new Promise((resolve) => {
    let good = 0, last = performance.now();
    const t0 = last;
    (function check() {
      const now = performance.now();
      good = now - last < 40 ? good + 1 : 0;
      last = now;
      if (good > 45 || now - t0 > 45000) resolve();
      else requestAnimationFrame(check);
    })();
  });
  $("progress").textContent = "";
  $("start").disabled = false;
  $("start").textContent = "Enter";
  if (params.has("bench")) setupBench();
}

// ---------------------------------------------------------------------------- benchmark API
function setupBench() {
  state.benching = true;
  for (const id of ["title", "hud", "rec", "dot", "grain", "vignette", "fscorner", "pause"]) $(id).style.display = "none";
  entity.active = false;
  const ctx = { renderer, spark, camera, mesh: sanatorium };
  const pose = (x, y, z, yaw, pitch = -0.1) => {
    player.pos.set(x, y, z);
    player.targetY = y;
    player.yaw = yaw;
    player.pitch = pitch;
    player.update(0, {});
    fx.update({ time: 10, camera, lampOn: 1, dt: 0 }); // fixed time: deterministic frames
  };
  window.__benchRender = () => renderFrame();
  window.bench = {
    apply: (cfg) => BENCH.applyConfig(ctx, cfg),
    perf: (cfg, seconds = 10) => BENCH.runBench({ ...ctx, configs: [cfg], seconds, onFrame: (x, y, z, yaw) => pose(x, y, z, yaw) }),
    // capture the fixed views; unlit = raw captured colour (judges detail), lit = the game look
    capture: async (cfg, settleMs, unlit = true, indices = null) => {
      BENCH.applyConfig(ctx, cfg);
      U.unlit.value = unlit ? 1 : 0;
      const shots = await BENCH.captureViews({ renderer, settleMs, indices, place: (v) => pose(...v) });
      U.unlit.value = 0;
      return shots;
    },
    compare: BENCH.compare,
    views: BENCH.VIEWS,
    setBox: (i, e) => fx.setBox(i, e),
    // render one view in the game's lighting (lamp on) and keep it on screen for a screenshot
    async show(cfg, i, settleMs = 5000, unlit = false) {
      BENCH.applyConfig(ctx, cfg);
      U.unlit.value = unlit ? 1 : 0;
      pose(...(Array.isArray(i) ? i : BENCH.VIEWS[i]));
      const t0 = performance.now();
      while (performance.now() - t0 < settleMs) { await new Promise(requestAnimationFrame); window.__benchRender(); }
    },
    // shots <-> base64 (8-bit luminance) for storing references on disk
    encode(shots) {
      const u8 = new Uint8Array(shots.length * shots[0].length);
      shots.forEach((sh, k) => { for (let i = 0; i < sh.length; i++) u8[k * sh.length + i] = Math.round(sh[i] * 255); });
      let bin = "";
      for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
      return btoa(bin);
    },
    async loadRef(kind) {
      const buf = new Uint8Array(await (await fetch(`assets/bench/ref-${kind}.bin`, { cache: "no-store" })).arrayBuffer());
      const n = buf.length / BENCH.VIEWS.length;
      return BENCH.VIEWS.map((_, k) => Float32Array.from(buf.subarray(k * n, (k + 1) * n), (v) => v / 255));
    },
    // full evaluation of a config against the on-disk references.
    // quick: fewer views + shorter settles, for fast iteration (final checks use the full run)
    async evaluate(cfg, seconds = 6, quick = false) {
      const refU = await this.loadRef("unlit"), refL = await this.loadRef("lit");
      const [p] = await this.perf(cfg, quick ? 4 : seconds);
      const views = quick ? [1, 2, 4, 6] : null, turnViews = quick ? [2, 4] : BENCH.TURN_VIEWS;
      const settle = cfg.settleMs ?? (quick ? 3000 : 5000);
      const avg = (q, f) => q.reduce((a, b) => a + f(b), 0) / q.length;
      const cmp = (shots, ref) => shots.map((s, i) => s && BENCH.compare(s, ref[i])).filter(Boolean);
      const qU = cmp(await this.capture(cfg, settle, true, views), refU);
      U.unlit.value = 1;
      const turns = await BENCH.captureTurns({ renderer, indices: turnViews, settleMs: quick ? 2000 : 3000, place: (v) => pose(...v) });
      U.unlit.value = 0;
      const turnSsim = avg(turns.map((t, k) => BENCH.compare(t, refU[turnViews[k]])), (x) => x.ssim);
      const qL = cmp(await this.capture(cfg, settle, false, views), refL);
      const r = {
        ...p,
        ssim: +avg(qU, (x) => x.ssim).toFixed(4), minSsim: +Math.min(...qU.map((x) => x.ssim)).toFixed(4),
        turnSsim: +turnSsim.toFixed(4),
        litSsim: +avg(qL, (x) => x.ssim).toFixed(4), minLitSsim: +Math.min(...qL.map((x) => x.ssim)).toFixed(4),
      };
      console.log("[eval]", JSON.stringify(r));
      return r;
    },
  };
  console.log("[bench] ready");
}
load().catch((e) => {
  console.error(e);
  $("progress").textContent = "failed to load: " + e.message;
});

// ---------------------------------------------------------------------------- level state
const state = {
  started: false,
  paused: true,
  lampOn: true,
  battery: 1,   // the lamp's wound charge
  windT: 0,     // time to the next pull of the winding cord
  windFlash: 0, // the dynamo surges a little with each pull
  winding: false,
  lives: 3,
  scare: 0,
  collected: new Set(),
  developing: -1,
  develop: 0,
  time: 0,
  dread: 0,
  death: 0, // >0 while the caught sequence plays
  ending: 0,
  glitch: 0,
  nextEvent: 8,
  checkpoint: null,
  hint: "",
};

let exposures = [];
let bulb = null;
let exitPoint;

function snap(p) {
  const i = world.nearestNode(new THREE.Vector3(p.x, p.y, p.z));
  if (i < 0) return new THREE.Vector3(p.x, p.y, p.z);
  const n = world.nav[i];
  return new THREE.Vector3(n.x, n.y, n.z);
}

function setupLevel() {
  exposures = STORY.EXPOSURES.map((e) => ({ ...e, p: snap(e.pos).add(new THREE.Vector3(0, 0.05, 0)) }));
  exitPoint = new THREE.Vector3(STORY.EXIT.x, STORY.EXIT.y, STORY.EXIT.z);
  const s = snap(STORY.SPAWN);
  state.checkpoint = { x: s.x, y: s.y, z: s.z, yaw: STORY.SPAWN.yaw };
  player.spawn(s.x, s.y, s.z, STORY.SPAWN.yaw);
  fx.setExposures(exposures.map((e) => e.p));
  fx.setExit(STORY.BREACH);
  fx.setStairLight(STORY.STAIR_LIGHT, buildLightVis(world, STORY.STAIR_LIGHT));
  bulb ??= new Bulb(scene, STORY.STAIR_LIGHT);
  entity.reset();
}

// ---------------------------------------------------------------------------- input
const canvas = renderer.domElement;
function lock() {
  canvas.requestPointerLock?.()?.catch?.(() => {
    if (state.started && !state.ending && !DEBUG) $("pause").classList.remove("hidden");
  });
}
$("start").onclick = () => {
  audio.start();
  audio.setBeacons(exposures.map((e) => e.p));
  audio.buildHum(STORY.STAIR_LIGHT);
  $("title").classList.add("hidden");
  $("hud").style.opacity = 1;
  $("rec").style.opacity = 1;
  state.started = true;
  lock();
};
$("resume").onclick = lock;
canvas.addEventListener("click", () => {
  if (state.frozen) return setFrozen(false);
  if (state.started && !state.ending && $("note").classList.contains("hidden")) lock();
});

// Freeze frame (P): stop the world on the exact current frame and release the mouse without
// the pause menu, so the frame can be screenshotted. P again (or a click) resumes.
let frozenLabelTimer = 0;
function setFrozen(on) {
  if (!state.started || state.ending || on === !!state.frozen) return;
  state.frozen = on;
  $("frozen").hidden = !on;
  $("frozen").style.opacity = 1;
  clearTimeout(frozenLabelTimer);
  if (on) {
    console.log(`[freeze] pos ${player.pos.toArray().map((v) => v.toFixed(2)).join(", ")} yaw ${player.yaw.toFixed(2)} pitch ${player.pitch.toFixed(2)} colour ${colourMode} detail ${spark.lodSplatScale.toFixed(2)}`);
    frozenLabelTimer = setTimeout(() => ($("frozen").style.opacity = 0), 1200); // gone before the screenshot
    document.exitPointerLock?.();
    if (audio.ctx) audio.ctx.suspend();
  } else {
    $("pause").classList.add("hidden");
    lock();
  }
}
document.addEventListener("pointerlockchange", () => {
  const locked = document.pointerLockElement === canvas;
  state.paused = !locked;
  player.enabled = locked;
  if (state.frozen) return; // freeze frame: no pause menu, keep the frame clean
  if (state.started && !state.ending) $("pause").classList.toggle("hidden", locked || !$("note").classList.contains("hidden"));
  // only silence the world for a real pause, not for notes or the ending
  const realPause = !locked && $("note").classList.contains("hidden") && !state.ending;
  if (audio.ctx) realPause ? audio.ctx.suspend() : audio.ctx.resume();
});
document.addEventListener("pointerlockerror", () => {
  if (state.started && !state.ending && !DEBUG) $("pause").classList.remove("hidden");
});
function toggleLamp() {
  if (state.paused || state.death > 0) return;
  if (!state.lampOn && state.battery < 0.02) { audio.click(); flashHint("the lamp has run down · hold R to wind it"); return; }
  state.lampOn = !state.lampOn;
  state.lampToggles = (state.lampToggles ?? 0) + 1;
  audio.click();
}
addEventListener("keydown", (e) => {
  if (e.code === "KeyF" && !e.repeat) toggleLamp();
  if (DEBUG && e.code === "KeyP" && !e.repeat) setFrozen(!state.frozen); // freeze frame, for screenshots
  if (e.code === "Escape" && !e.repeat) escape();
  if (e.code === "KeyM" && !e.repeat) escape(); // M: the menu, without Esc (which browsers also use for fullscreen)
  if (e.code === "KeyH" && !e.repeat && state.started) setCamcorder(!camcorder.on);
  if (DEBUG && e.code === "KeyG") entity.debugGhost = !entity.debugGhost;
});
canvas.addEventListener("mousedown", (e) => { if (e.button === 2) toggleLamp(); });
addEventListener("contextmenu", (e) => e.preventDefault());

$("note").onclick = () => {
  $("note").classList.add("hidden");
  lock();
};
$("again").onclick = () => location.reload();

// Esc / M close what's open: a plate's note, or the pause menu (back to the game); while
// playing they open the pause menu. (In fullscreen the Esc key is kept for the game; holding it leaves fullscreen.)
function escape() {
  if (!state.started || state.ending) return;
  if (!$("note").classList.contains("hidden")) return $("note").click();
  if (document.pointerLockElement === canvas) return document.exitPointerLock();
  if (!$("pause").classList.contains("hidden") && sinceLockChange() > 300) lock();
}

let hintTimer = 0;
function setCamcorder(on) {
  camcorder.setOn(on);
  if (player) player.handheld = on ? 1 : 0;
  try { localStorage.setItem("residue.camcorder", on ? "on" : "off"); } catch {}
  flashHint(on ? "camcorder view" : "clean view");
}
function flashHint(text) {
  state.flashHint = text;
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => (state.flashHint = ""), 1800);
}

// ---------------------------------------------------------------------------- fullscreen
for (const b of document.querySelectorAll(".fsbtn")) b.addEventListener("click", toggleFullscreen);
function syncFullscreenUi() {
  const fs = !!document.fullscreenElement;
  for (const b of document.querySelectorAll(".fsbtn:not(#fscorner)")) b.textContent = fs ? "Exit fullscreen" : "Fullscreen";
  // the corner button only shows on menus, never over gameplay
  $("fscorner").hidden = !state.paused || state.ending > 0 || !!state.frozen;
}
document.addEventListener("fullscreenchange", syncFullscreenUi);
setInterval(syncFullscreenUi, 300);

// ---------------------------------------------------------------------------- gameplay
const tmp = new THREE.Vector3();
const lampDir = new THREE.Vector3();
const LAMP_COS = Math.cos(THREE.MathUtils.degToRad(19));

function showNote(e) {
  $("notetitle").textContent = `${e.room} — ${e.title}`;
  $("notetext").textContent = e.text;
  $("note").classList.remove("hidden");
  document.exitPointerLock?.();
}

const beamDir = new THREE.Vector3();
function inBeam(p, maxDist = 14) {
  const eye = camera.position;
  beamDir.subVectors(p, eye);
  const d = beamDir.length();
  if (d > maxDist) return false;
  beamDir.divideScalar(d);
  if (beamDir.dot(lampDir) < LAMP_COS) return false;
  return world.lineOfSight(eye, p);
}

function roomName(p) {
  let best = "", bd = 1e9;
  for (const e of exposures) {
    const d = e.p.distanceToSquared(p);
    if (d < bd) { bd = d; best = e.room; }
  }
  return best;
}

function ambientEvents(dt) {
  state.nextEvent -= dt;
  if (state.nextEvent > 0) return;
  const tension = state.collected.size / exposures.length;
  state.nextEvent = 9 + Math.random() * (22 - tension * 10);
  const r = Math.random();
  // pick a random spot 6-18m away for spatial sounds
  let spot = null;
  for (let i = 0; i < 20 && !spot; i++) {
    const j = (Math.random() * world.nav.length) | 0;
    if (!world.navMain[j]) continue;
    const n = world.nav[j];
    const d = Math.hypot(n.x - player.pos.x, n.z - player.pos.z);
    if (d > 6 && d < 18) spot = new THREE.Vector3(n.x, n.y + 1.2, n.z);
  }
  if (!spot) return;
  if (r < 0.3) audio.piano(new THREE.Vector3(STORY.PIANO.x, STORY.PIANO.y, STORY.PIANO.z), undefined, 0.2 + Math.random() * 0.15);
  else if (r < 0.55) audio.knock(spot, 2 + ((Math.random() * 3) | 0));
  else if (r < 0.8) audio.creak(spot);
  else state.glitch = 1; // the whole capture briefly loses coherence
}

// one early sighting while the player is still exploring
let glimpsed = false;
function scriptedGlimpse() {
  if (glimpsed || state.collected.size > 0 || state.time < 45 || entity.active) return;
  if (Math.random() > 0.01) return; // spread attempts out
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  if (entity.glimpse(player.pos, camera.position, dir)) glimpsed = true;
}

const warp = { power: 0, pos: new THREE.Vector3(0, -100, 0) };

function caught() {
  state.lives--;
  state.scare = 0.75; // face to face first, then the world comes apart
  entity.scare(camera.position, player.yaw);
  state.lampOn = true; // you see it
  player.pitch = 0.05;
  audio.scare();
  $("flash").style.opacity = 0.35;
  setTimeout(() => ($("flash").style.opacity = 0), 90);
}

function respawn() {
  if (state.lives <= 0) return gameOver();
  const c = state.checkpoint;
  player.spawn(c.x, c.y, c.z, c.yaw);
  entity.reset();
  state.battery = Math.max(state.battery, 0.5);
  state.lampOn = true;
}

function update(dt) {
  const playing = state.started && !state.paused && state.ending === 0;
  if (!playing && state.ending === 0) {
    // keep the scene alive behind the title / pause screens
    if (!state.started) player.update(0, {}); // place the camera at the spawn for the title backdrop
    fx.update({
      time: state.time, camera, lampOn: state.started ? (state.lampOn ? 1 : 0) : 0.6, dt,
      death: state.death > 0 ? 1 - state.death / 3.2 : 0, frozen: true,
    });
    return;
  }
  state.time += dt;

  // --- lamp: a wind-up dynamo lamp. A full winding gives about 30 seconds of light and it never
  // recharges on its own. Holding R winds it back up, one pull of the cord at a time: slow, you
  // can barely walk while doing it, and the ratchet is loud enough for her to hear.
  camera.getWorldDirection(lampDir);
  // winding only works with the lamp off: holding R switches it off, so recharging always
  // means standing in the dark, making noise
  const windHeld = player.enabled && !!player.keys.KeyR && state.death <= 0 && state.scare <= 0;
  if (windHeld && state.lampOn && !state.windHeld) { state.lampOn = false; audio.click(); }
  state.windHeld = windHeld;
  state.winding = windHeld && !state.lampOn;
  state.windT = Math.max(0, state.windT - dt);
  if (state.winding && state.windT <= 0) {
    state.windT = 0.7;
    state.battery = Math.min(1, state.battery + 0.045); // ~16s of winding for a full charge
    state.windFlash = 1;
    audio.windPull();
  }
  state.windFlash = Math.max(0, state.windFlash - dt * 3);
  if (state.lampOn) {
    state.battery = Math.max(0, state.battery - dt / 30);
    if (state.battery <= 0 && state.scare <= 0) { state.lampOn = false; audio.click(); flashHint("the lamp has run down · hold R to wind it"); }
  }
  // it dims (and goes orange) as it runs down, surges with each pull, and flickers when nearly
  // out or when she is close
  let lamp = state.lampOn ? Math.min(1, 0.22 + 0.78 * THREE.MathUtils.smoothstep(state.battery, 0, 0.35) + state.windFlash * 0.25) : 0;
  if (state.lampOn && (state.battery < 0.1 || state.dread > 0.6)) {
    const f = state.battery < 0.1 ? 0.35 : (state.dread - 0.6) * 1.5;
    if (Math.random() < f * 0.25) lamp *= Math.random() * 0.4;
  }

  // --- caught: jump scare, then the death sequence
  state.light = lamp;
  let effects = { shake: 0, roll: 0, slow: state.winding ? 0.35 : 1, fear: Math.max(state.dread, state.winding ? 0.35 : 0) };
  if (state.scare > 0) {
    state.scare -= dt;
    effects.shake = 0.012;
    effects.slow = 0;
    if (state.scare <= 0) { state.death = 3.2; audio.caught(); state.lampOn = false; }
  } else if (state.death > 0) {
    state.death -= dt;
    effects.shake = 0.03;
    effects.slow = 0;
    $("hurt").style.opacity = Math.min(1, state.death);
    if (state.death <= 0) { respawn(); $("hurt").style.opacity = 0; }
  }
  player.update(dt, effects);
  if (state.winding) player.noise = Math.max(player.noise, 1); // she hears the ratchet ~12m away

  // --- exposures: hold the lamp on them to develop
  let target = -1;
  exposures.forEach((e, i) => {
    if (state.collected.has(e.id)) return;
    tmp.copy(e.p).y += 0.4;
    if (lamp > 0.15 && camera.position.distanceTo(tmp) < 6 && inBeam(tmp, 6)) target = i;
  });
  if (target >= 0 && target === state.developing) {
    state.develop += (dt / 2.2) * Math.min(1, lamp * 1.4); // a dim lamp develops slowly
    if (state.develop >= 1) {
      const e = exposures[target];
      state.collected.add(e.id);
      fx.collect(target);
      audio.pickup();
      audio.silenceBeacon(target);
      state.checkpoint = { x: player.pos.x, y: player.pos.y, z: player.pos.z, yaw: player.yaw };
      entity.aggression = state.collected.size / exposures.length;
      state.develop = 0;
      state.developing = -1;
      setTimeout(() => showNote(e), 1700); // let the burst play out first
      if (state.collected.size === 1) entity.awaken();
    }
  } else {
    state.developing = target;
    state.develop = Math.max(0, state.develop - dt);
  }
  $("develop").style.opacity = target >= 0 ? 1 : 0;
  $("devring").style.strokeDashoffset = 125.7 * (1 - state.develop);

  // --- exit
  const allDone = state.collected.size === exposures.length;
  if (allDone && !fx.exitActive) {
    fx.exitActive = true;
    world.carve(STORY.BREACH);
    audio.allPlates(new THREE.Vector3(STORY.BREACH.x, STORY.BREACH.y + 1.2, STORY.BREACH.z));
  }
  if (allDone && Math.hypot(player.pos.x - exitPoint.x, player.pos.z - exitPoint.z) < 1.0) endGame();

  // --- entity
  const ent = entity.update(dt, {
    player: player.pos,
    eye: camera.position,
    camDir: lampDir,
    lampOn: lamp > 0.15,
    lit: lamp > 0.15 && entity.active && inBeam(entity.chest(), 15),
    noise: player.noise,
    paused: state.death > 0,
  });
  if (ent.caught && state.death <= 0 && state.scare <= 0) caught();
  if (ent.stepped) audio.entityStep(entity.shownPos, 0.6 + 0.4 * (ent.dist < 4 ? 1 : 0), ent.stepKind);
  state.dread += (ent.dread - state.dread) * Math.min(1, dt * 2);
  // the world warps around it: build up quickly, but ease back slowly (and in place) when it
  // vanishes, instead of snapping back
  const warpTarget = entity.active ? ent.power : 0;
  if (warpTarget > warp.power) { warp.power += (warpTarget - warp.power) * Math.min(1, dt * 4); warp.pos.copy(entity.pos); }
  else {
    warp.power += (warpTarget - warp.power) * Math.min(1, dt * 1.6);
    if (warpTarget > 0.05) warp.pos.copy(entity.pos);
  }

  ambientEvents(dt);
  scriptedGlimpse();
  state.glitch = Math.max(0, state.glitch - dt * 0.8);

  fx.update({
    time: state.time,
    camera,
    lampOn: lamp,
    battery: state.battery,
    entityPos: warp.power > 0.002 ? warp.pos : null,
    entityBody: entity.mesh.visible ? entity.mesh.position : null,
    entityPower: warp.power,
    dread: state.dread,
    glitch: state.glitch,
    death: state.death > 0 ? 1 - state.death / 3.2 : 0,
    developing: state.developing,
    develop: state.develop,
    player: player.pos,
    dt,
  });

  // seeing it: on screen and in line of sight
  let seen = 0;
  if (entity.active && entity.alpha > 0.3) {
    const toE = tmp.copy(entity.chest()).sub(camera.position);
    const d = toE.length();
    if (toE.divideScalar(d).dot(lampDir) > 0.75 && d < 18 && world.lineOfSight(camera.position, entity.chest())) seen = 1 - d / 18;
  }
  const sprinting = player.vel.length() > 2.5;
  audio.update(dt, camera, {
    entityPos: entity.active ? entity.chest() : null,
    entityVolume: ent.volume,
    dread: state.dread,
    seen,
    exertion: Math.max(sprinting ? 0.55 : 0, (1 - player.stamina) * 0.9),
  });

  // --- HUD
  // lamp: segmented charge, plain-language status, red and pulsing when low
  $("battery").style.width = `${state.battery * 100}%`;
  $("lampbar").classList.toggle("low", state.battery < 0.25);
  $("lampbar").classList.toggle("off", !state.lampOn);
  $("lampstat").textContent = state.winding ? "winding" : state.lampOn ? (state.battery < 0.3 ? "on · dimming" : "on")
    : state.battery < 0.02 ? "run down" : "off";
  // breath: only shown while it matters
  $("stamina").style.width = `${player.stamina * 100}%`;
  $("breathrow").style.opacity = player.stamina < 0.98 ? 1 : 0;
  $("breathstat").textContent = player.winded ? "winded" : "";
  $("count").textContent = `Plates ${state.collected.size} / ${exposures.length}`;
  $("lives").textContent = "●".repeat(Math.max(0, state.lives)) + "○".repeat(Math.max(0, 3 - state.lives));
  const s = Math.floor(state.time);
  const clock = 23 * 60 + Math.floor(s / 20); // a night clock: one in-game minute every 20s
  $("tc").textContent = `${String(Math.floor(clock / 60) % 24).padStart(2, "0")}:${String(clock % 60).padStart(2, "0")}`;
  $("room").textContent = roomName(player.pos);
  if (!state.lampOn) state.darkTime = (state.darkTime ?? 0) + dt;
  if (player.speedS > 0.5) state.walkTime = (state.walkTime ?? 0) + dt;
  const first = lesson(dt);
  let hint = "";
  if (state.flashHint) hint = state.flashHint;
  else if (first) hint = first;
  else if (tip("her", seen > 0)) hint = "she moves in the dark · hold your light on her to burn her away";
  else if (tip("lowlamp", state.lampOn && state.battery < 0.3)) hint = "your lamp is running down · hold R to wind it (it goes dark while you wind)";
  else if (tip("wind", state.winding)) hint = "winding is loud · she can hear it";
  else if (tip("winded", player.winded)) hint = "out of breath · walk until it comes back";
  else if (tip("run", state.walkTime > 10)) hint = "hold Shift to run";
  else if (tip("remind", state.collected.size === 0 && tut.step >= 3 && tut.t > 75)) hint = "the plates glow on the floor in the dark · hold your lamp on one to develop it";
  else if (allDone) hint = "a window by the terrace door has opened · follow the daylight out";
  else if (target >= 0) hint = "hold the light";
  else if (!state.lampOn && state.battery < 0.02 && !state.winding) hint = "hold R to wind the lamp";
  $("prompt").textContent = hint;
  $("prompt").style.opacity = hint ? 0.8 : 0;
}

// first steps: each lesson stays up until you've done it (or a while has passed)
const tut = { step: 0, t: 0 };
function lesson(dt) {
  tut.t += dt;
  const next = () => { tut.step++; tut.t = 0; state.darkTime = 0; };
  switch (tut.step) {
    case 0:
      if (((state.lampToggles ?? 0) >= 2 && tut.t > 3) || tut.t > 14) next();
      return "F turns your lamp on and off";
    case 1:
      if ((state.darkTime ?? 0) > 2.5 || tut.t > 14) next();
      return "the plates glow faintly on the floor · switch your lamp off to spot them";
    case 2:
      if (state.developing >= 0 || state.collected.size > 0 || tut.t > 16) next();
      return "walk up to a glowing plate and hold your lamp on it to develop it";
  }
  return "";
}

// show a tip for a few seconds the first time its condition becomes true
const tipState = {};
function tip(name, cond) {
  const t = tipState[name];
  if (t === undefined) { if (cond) tipState[name] = state.time; return cond; }
  return state.time - t < 5;
}

function gameOver() {
  state.ending = -1; // stops the game loop's play logic
  document.exitPointerLock?.();
  player.enabled = false;
  $("hud").style.opacity = 0;
  $("rec").style.opacity = 0;
  $("gameover").classList.remove("hidden");
}

function endGame() {
  state.ending = 0.0001;
  document.exitPointerLock?.();
  player.enabled = false;
  $("hud").style.opacity = 0;
  $("rec").style.opacity = 0;
  $("endtext").innerHTML = STORY.ENDING.map((t, i) => `<p style="animation-delay:${4 + i * 2.2}s">${t}</p>`).join("");
}

// ---------------------------------------------------------------------------- loop
// The one place a frame is rendered. The game loop and the benchmark (?bench) both call this,
// so any change to the render pipeline is exactly what the benchmark measures.
// Spark only re-generates its splat buffer when we ask. Shading is in the vertex shader and the
// depth sort is radial (rotation-invariant), so turning your head needs no regeneration at all.
// We regenerate when: the camera has moved a few cm, a geometric effect is animating, the
// entity is visible, new LoD results arrived, or as a slow keep-alive.
const regen = { pos: new THREE.Vector3(1e9, 0, 0), quat: new THREE.Quaternion(), mapping: -1, frames: 0, warm: 120 };
function needsRegen() {
  if (!sanatorium?.isInitialized) return true;
  if (regen.warm > 0) return regen.warm--, true; // just after loading, while the LoD settles
  if (sanatorium.mappingVersion !== regen.mapping) return true;
  if (fx?.active) return true;
  // the entity, and a few frames after she vanishes, so her last frame doesn't linger in the buffer
  if (entity?.mesh.visible) regen.entityTail = 8;
  if (regen.entityTail > 0) return regen.entityTail--, true;
  const step = spark.regenStep ?? RENDER.regenStep;
  if (camera.position.distanceToSquared(regen.pos) > step * step) return true;
  if (!spark.lodQuatOverride && Math.abs(camera.quaternion.dot(regen.quat)) < 0.9995) return true; // foveated LoD
  return ++regen.frames > 30;
}
function renderFrame() {
  camera.updateMatrixWorld();
  BENCH.lodAnchor(spark, camera);
  if (needsRegen()) {
    regen.pos.copy(camera.position);
    regen.quat.copy(camera.quaternion);
    regen.mapping = sanatorium?.mappingVersion ?? -1;
    regen.frames = 0;
    spark.update({ scene, camera }); // generation runs synchronously; sorting continues async
  }
  camcorder.render(scene, camera);
}

const clock = new THREE.Clock();
// adaptive detail: nudge the LoD splat budget to hold ~55fps (unless ?detail= was given)
// Calibrates for the first ~20s of play, then locks so detail doesn't visibly shift while
// you play; afterwards it only steps down if frame rate collapses.
const adaptive = { on: !params.has("detail"), acc: 0, frames: 0, played: 0, grow: false, cap: Q.lodCap || COLOUR_MODES[colourMode].lodSplatScale };
function adapt(rawDt) {
  if (!adaptive.on || !state.started || state.paused) return;
  adaptive.played += rawDt;
  if (adaptive.played < 5) return; // ignore the first seconds: LoD is still settling after Enter
  adaptive.acc += rawDt;
  adaptive.frames++;
  if (adaptive.acc < 1.5) return;
  const fps = adaptive.frames / adaptive.acc;
  adaptive.acc = 0;
  adaptive.frames = 0;
  const calibrating = adaptive.played < 25;
  if (fps < (calibrating ? 50 : 38)) {
    spark.lodSplatScale = Math.max(0.3, spark.lodSplatScale * 0.85);
    adaptive.grow = false;
  } else if (calibrating && adaptive.grow && fps > 58.5) {
    spark.lodSplatScale = Math.min(adaptive.cap, spark.lodSplatScale * 1.1);
  }
}
renderer.setAnimationLoop(() => {
  const rawDt = clock.getDelta();
  adapt(rawDt);
  const dt = Math.min(rawDt, 0.05);
  if (state.benching) return; // the benchmark drives rendering itself
  if (state.frozen) return; // freeze frame: the canvas keeps showing the last rendered frame
  if (world && player) {
    if (state.ending < 0) { /* game over screen */ }
    else if (state.ending > 0) {
      state.ending += dt;
      fx.update({ time: state.time += dt, camera, lampOn: 0, ending: Math.min(1, state.ending / 4), dt });
      $("flash").style.opacity = Math.min(1, Math.max(0, (state.ending - 2.5) / 2));
      if (state.ending > 4.5) $("ending").classList.remove("hidden");
    } else update(dt);
  }
  if (bulb && fx) { const lv = bulb.update(dt, renderer.domElement.height); fx.stairLevel = lv; audio.humLevel(lv); }
  camcorder.update(dt, clock.elapsedTime, { light: state.ending ? 1 : state.light ?? 1, fear: state.dread ?? 0, glitch: state.glitch ?? 0 });
  renderFrame();
});

if (DEBUG) {
  window.THREE = THREE;
  window.game = { state, camera, spark, audio, camcorder, get world() { return world; }, get player() { return player; }, get entity() { return entity; }, get fx() { return fx; }, get mesh() { return sanatorium; }, get exposures() { return exposures; }, get exitPoint() { return exitPoint; } };
  window.tp = (x, y, z, yaw, pitch = 0) => { player.spawn(x, y, z, yaw); player.pitch = pitch; };
  window.renderFrame = () => renderFrame();
  window.go = () => { $("start").click(); state.paused = false; player.enabled = true; $("pause").classList.add("hidden"); };
}
