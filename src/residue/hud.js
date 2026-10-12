// RESIDUE's on-screen text: the lamp / breath / plates HUD, the camcorder's REC clock and room
// name, and the one-line prompt (first-steps lessons, one-off tips, contextual hints).
const $ = (id) => document.getElementById(id);

// called every frame of play. `seen`: how squarely she is in view (0..1); `target`: index of the
// plate in the beam (-1 if none); `allDone`: all six plates developed
export function updateHud(dt, { state, player, exposures, seen, target, allDone }) {
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
  $("room").textContent = roomName(exposures, player.pos);

  // the prompt: what the player should learn or notice next
  if (!state.lampOn) state.darkTime = (state.darkTime ?? 0) + dt;
  if (player.speedS > 0.5) state.walkTime = (state.walkTime ?? 0) + dt;
  const first = lesson(dt, state);
  let hint = "";
  if (state.flashHint) hint = state.flashHint;
  else if (first) hint = first;
  else if (tip(state, "her", seen > 0)) hint = "she moves in the dark · hold your light on her to burn her away";
  else if (tip(state, "lowlamp", state.lampOn && state.battery < 0.3)) hint = "your lamp is running down · hold R to wind it (it goes dark while you wind)";
  else if (tip(state, "wind", state.winding)) hint = "winding is loud · she can hear it";
  else if (tip(state, "winded", player.winded)) hint = "out of breath · walk until it comes back";
  else if (tip(state, "run", state.walkTime > 10)) hint = "hold Shift to run";
  else if (tip(state, "remind", state.collected.size === 0 && tut.step >= 3 && tut.t > 75)) hint = "the plates glow on the floor in the dark · hold your lamp on one to develop it";
  else if (allDone) hint = "a window by the terrace door has opened · follow the daylight out";
  else if (target >= 0) hint = "hold the light";
  else if (!state.lampOn && state.battery < 0.02 && !state.winding) hint = "hold R to wind the lamp";
  $("prompt").textContent = hint;
  $("prompt").style.opacity = hint ? 0.8 : 0;
}

// the camcorder's room label: the room of the nearest plate
function roomName(exposures, p) {
  let best = "", bd = 1e9;
  for (const e of exposures) {
    const d = e.p.distanceToSquared(p);
    if (d < bd) { bd = d; best = e.room; }
  }
  return best;
}

// first steps: each lesson stays up until you've done it (or a while has passed)
const tut = { step: 0, t: 0 };
function lesson(dt, state) {
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
function tip(state, name, cond) {
  const t = tipState[name];
  if (t === undefined) { if (cond) tipState[name] = state.time; return cond; }
  return state.time - t < 5;
}
