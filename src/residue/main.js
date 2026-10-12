// RESIDUE: the entry point (residue.html). Builds the view, loads the scan, the collision world
// and the entity, wires up the controls and screens, and runs the game loop. The rules of play
// are update() below; the HUD text is hud.js, the render pipeline view.js, the lighting and
// plate effects lighting.js, and the entity entity.js.
import * as THREE from "three";
import { World } from "../shared/world.js";
import { Player } from "../shared/player.js";
import { BOUNDARIES, UPPER_FLOORS } from "../shared/scan.js";
import { buildEdgeField } from "../shared/edge-field.js";
import { createScanMesh, waitForSteadyFrames } from "../shared/splat-scene.js";
import { toggleFullscreen, sinceLockChange } from "../shared/fullscreen.js";
import { watchForSlowFrames, bindQualityButtons, gpuName } from "../shared/quality.js";
import { createView } from "./view.js";
import { ResidueAudio } from "./audio.js";
import { SceneFX } from "./lighting.js";
import { Entity } from "./entity.js";
import { Bulb, buildLightVis } from "./bulb.js";
import { updateHud } from "./hud.js";
import * as STORY from "./story.js";

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const DEBUG = params.has("debug") || params.has("bench");

// ---------------------------------------------------------------------------- view
const view = createView(params);
const { renderer, scene, camera, camcorder, spark, quality, tier } = view;
if (DEBUG) console.log(`quality ${quality} (${gpuName(renderer)})`);
bindQualityButtons(quality);

$("credits").innerHTML = STORY.CREDITS;
STORY.INTRO.forEach((t, i) => {
  const p = document.createElement("p");
  p.innerHTML = t;
  p.style.animationDelay = `${0.6 + i * 1.6}s`;
  $("intro").appendChild(p);
});

// ---------------------------------------------------------------------------- loading
const audio = new ResidueAudio();
let world, player, fx, entity, sanatorium;

async function load() {
  world = await World.load("assets", UPPER_FLOORS);
  // where the scan falls apart, block it off (same zones as Undeveloped)
  for (const b of BOUNDARIES) world.block(b);
  world.buildNav();
  world.setMainFrom(STORY.SPAWN);
  if (DEBUG) console.log("nav nodes", world.nav.length);

  sanatorium = createScanMesh({
    params, tier,
    extSplats: (!tier.paged && params.has("ext")) || undefined, // developer switch: 32-byte high-precision splat encoding
    onProgress: (e) => {
      if (e.total) $("progress").textContent = `loading scan  ${Math.round((100 * e.loaded) / e.total)}%`;
    },
  });
  sanatorium.maxSh = tier.maxSh;
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
  // Hold the door until Spark has settled and frames are coming quickly again.
  $("progress").textContent = "developing the scan";
  await waitForSteadyFrames(45, 45000);
  $("progress").textContent = "";
  $("start").disabled = false;
  $("start").textContent = "Enter";
  if (params.has("bench")) {
    const { installBenchApi } = await import("./bench.js");
    installBenchApi({ state, renderer, spark, camera, mesh: sanatorium, player, fx, entity, renderFrame });
  }
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
    console.log(`[freeze] pos ${player.pos.toArray().map((v) => v.toFixed(2)).join(", ")} yaw ${player.yaw.toFixed(2)} pitch ${player.pitch.toFixed(2)} detail ${spark.lodSplatScale.toFixed(2)}`);
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

  updateHud(dt, { state, player, exposures, seen, target, allDone });
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
// One frame: advance the game (or the ending), the bulb, the camcorder, then draw.
const renderFrame = () => view.renderFrame(sanatorium, fx, entity);
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const rawDt = clock.getDelta();
  view.adapt(rawDt, state.started && !state.paused);
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
