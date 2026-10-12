// Before a game builds anything: can this device play it?
//  - No WebGL 2 (an old browser, or hardware acceleration turned off): a short explanation and a
//    way back to the menu. The games can't run, so nothing else loads.
//  - A touch-only device (phone, tablet): the games are played with a keyboard and mouse, and
//    stream a large scan. Say so, and let the player go back or load anyway.
// Resolves when the game should go ahead.

export function hasWebGL2() {
  try {
    const gl = document.createElement("canvas").getContext("webgl2");
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
    return !!gl;
  } catch { return false; }
}

export const touchOnly = () =>
  matchMedia("(pointer: coarse)").matches && !matchMedia("(any-pointer: fine)").matches;

const CSS = `
.device-gate { position: fixed; inset: 0; z-index: 100; display: flex; align-items: center; justify-content: center;
  padding: 24px; box-sizing: border-box; background: rgba(0,0,0,.92); color: #e9e3d6; font: 15px/1.6 "IBM Plex Mono", ui-monospace, monospace; }
.device-gate .box { max-width: 520px; text-align: center; }
.device-gate h2 { font: 400 30px/1.2 "Cormorant Garamond", Georgia, serif; margin: 0 0 14px; letter-spacing: .02em; }
.device-gate p { margin: 0 0 12px; color: #bdb6a7; }
.device-gate .btns { display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; margin-top: 22px; }
.device-gate a, .device-gate button { font: inherit; font-size: 12px; letter-spacing: .2em; text-transform: uppercase; color: #e9e3d6;
  background: none; border: 1px solid #6d685f; padding: 12px 20px; cursor: pointer; text-decoration: none; margin: 0; }
.device-gate a:hover, .device-gate button:hover { border-color: #e9e3d6; }
.device-gate.day { background: rgba(243,238,226,.97); color: #23201b; font-family: "IBM Plex Sans", system-ui, sans-serif; }
.device-gate.day h2 { font: 600 28px/1.2 "IBM Plex Sans", system-ui, sans-serif; letter-spacing: -.01em; }
.device-gate.day p { color: #4a443a; }
.device-gate.day a, .device-gate.day button { color: #23201b; border-color: #23201b; letter-spacing: .08em; }
`;

function show(theme, html) {
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);
  const el = document.createElement("div");
  el.className = `device-gate ${theme}`;
  el.setAttribute("role", "dialog");
  el.innerHTML = `<div class="box">${html}</div>`;
  document.body.appendChild(el);
  return el;
}

// theme: "night" (RESIDUE) or "day" (Undeveloped)
export function deviceGate({ theme = "night" } = {}) {
  if (!hasWebGL2()) {
    show(theme, `<h2>This browser can't run the games</h2>
      <p>They need WebGL&nbsp;2, which this browser doesn't offer or has turned off.</p>
      <p>Try a recent Chrome, Edge, Firefox or Safari on a desktop or laptop, with hardware acceleration on.</p>
      <div class="btns"><a href="./">Back to the menu</a></div>`);
    return new Promise(() => {}); // nothing else can load
  }
  if (!touchOnly()) return Promise.resolve();
  return new Promise((resolve) => {
    const el = show(theme, `<h2>Best on a desktop or laptop</h2>
      <p>The games are played with a keyboard and mouse, and they stream a large 3D scan.</p>
      <p>Open <b>${location.host}</b> on a computer for the full experience.</p>
      <div class="btns"><a href="./">Back to the menu</a><button type="button">Load anyway</button></div>`);
    el.querySelector("button").addEventListener("click", () => { el.remove(); resolve(); });
  });
}
