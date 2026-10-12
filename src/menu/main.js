// The game-select menu (index.html): the half you point at widens, and its sound bed (MenuAudio)
// follows. Picking a side plays a sting, fades to black or warm paper, then opens that game.
import { MenuAudio } from "./menu-audio.js";

const STORE_KEY = "gaussian-games.sound"; // the sound switch: "on" | "off"

// ---------------------------------------------------------------------------- the split
// the side you point at (or tab to) widens; leaving the window evens them out again
const split = document.getElementById("split");
const pick = (name) => {
  split.classList.remove("pick-residue", "pick-undeveloped");
  if (name) split.classList.add(`pick-${name}`);
};
for (const side of document.querySelectorAll(".side")) {
  side.addEventListener("pointerenter", () => pick(side.dataset.pick));
  side.addEventListener("focus", () => pick(side.dataset.pick));
}
document.addEventListener("pointerleave", () => pick(null));

// ---------------------------------------------------------------------------- sound
function initSound(split) {
  const AC = window.AudioContext || window.webkitAudioContext;

  let enabled = true;
  try { enabled = localStorage.getItem(STORE_KEY) !== "off"; } catch {}

  let ctx = null, audio = null;
  if (AC) {
    try {
      ctx = new AC();
      audio = new MenuAudio(ctx, { enabled, breathUrl: new URL("assets/audio/breathing.wav", document.baseURI).href });
      if (!enabled) ctx.suspend();
    } catch (e) { console.warn("menu: audio unavailable", e); ctx = audio = null; }
  }
  if (new URLSearchParams(location.search).has("debug")) window.__menuAudio = audio; // console / tests

  // ---- the sound switch, top-right
  let btn = null;
  const audible = () => !!ctx && enabled && ctx.state === "running";
  const label = () => {
    if (!btn) return;
    const on = audible();
    btn.setAttribute("aria-pressed", String(on));
    btn.setAttribute("aria-label", on ? "Sound on (click to mute)" : "Sound off (click to unmute)");
    btn.querySelector("span").textContent = on ? "sound on" : "sound off";
  };
  const resume = () => {
    if (!ctx || !enabled || ctx.state === "running" || ctx.state === "closed") return;
    ctx.resume().then(label, () => {});
  };
  if (ctx) {
    btn = document.createElement("button");
    btn.type = "button";
    btn.className = "sound-toggle";
    btn.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" stroke-linecap="round">' +
      '<path d="M2.5 6h2.5l3.5-3v10l-3.5-3h-2.5z" fill="currentColor" stroke-width="1"/>' +
      '<path class="waves" d="M10.8 5.6a3.2 3.2 0 0 1 0 4.8M12.6 3.8a5.8 5.8 0 0 1 0 8.4"/>' +
      '<path class="mute" d="M11 6l3.6 4M14.6 6L11 10"/></svg><span></span>';
    btn.addEventListener("click", () => {
      if (audible()) {
        enabled = false;
        audio.setEnabled(false);
        setTimeout(() => { if (!enabled && ctx.state === "running") ctx.suspend().then(label); }, 320);
      } else {
        enabled = true;
        audio.setEnabled(true);
        resume();
      }
      try { localStorage.setItem(STORE_KEY, enabled ? "on" : "off"); } catch {}
      label();
    });
    split.appendChild(btn);
    ctx.addEventListener("statechange", label);
    label();
    requestAnimationFrame(() => btn.classList.add("ready"));
  }

  // ---- autoplay: hover isn't a gesture, so start on the first press anywhere (but the switch
  // handles its own presses)
  const onGesture = (e) => {
    if (btn && btn.contains(e.target)) return;
    resume();
  };
  for (const ev of ["pointerdown", "keydown", "touchstart"]) addEventListener(ev, onGesture, { capture: true, passive: true });

  // ---- the beds' clock
  let last = ctx ? ctx.currentTime : 0, hiddenStop = false;
  if (ctx) setInterval(() => {
    const now = ctx.currentTime, dt = Math.min(0.5, now - last);
    last = now;
    if (ctx.state === "running" && dt > 0) audio.tick(dt);
  }, 100);
  document.addEventListener("visibilitychange", () => {
    if (!ctx) return;
    if (document.hidden && ctx.state === "running") { hiddenStop = true; ctx.suspend(); }
    else if (!document.hidden && hiddenStop) { hiddenStop = false; resume(); }
  });

  // ---- hover: the same events as the visual split
  const running = () => ctx && ctx.state === "running";
  const hover = (name, withSound) => { if (audio) try { audio.hover(name, withSound && running()); } catch (e) { console.warn(e); } };
  for (const side of document.querySelectorAll(".side")) {
    side.addEventListener("pointerenter", (e) => hover(side.dataset.pick, e.pointerType !== "touch"));
    side.addEventListener("focus", () => hover(side.dataset.pick, true));
  }
  document.addEventListener("pointerleave", () => hover(null, false));

  // ---- picking a side: a sting, a fade to black or to warm paper, then go. Modified clicks
  // (new tab etc.) are left to the browser; without JS the links just work.
  const veil = document.createElement("div");
  veil.className = "menu-veil";
  document.body.appendChild(veil);
  let leaving = false;
  for (const side of document.querySelectorAll(".side")) {
    side.addEventListener("click", (e) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      if (leaving) return;
      leaving = true;
      const name = side.dataset.pick, href = side.href;
      let wait = 0.55;
      try {
        if (audio && enabled) {
          resume();
          wait = Math.max(wait, audio.exit(name));
        }
      } catch (err) { console.warn(err); }
      veil.className = `menu-veil ${name}`;
      void veil.offsetWidth;
      veil.classList.add("on");
      setTimeout(() => { location.href = href; }, wait * 1000);
    });
  }
  // coming back with the browser's back button can restore this page as it was left
  addEventListener("pageshow", (e) => {
    if (!e.persisted) return;
    leaving = false;
    veil.className = "menu-veil";
    if (audio) { audio.restore(); resume(); }
  });
}

initSound(split);
