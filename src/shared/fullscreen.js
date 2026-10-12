// Fullscreen that leaves the Escape key to the game. Normally Esc always leaves fullscreen, so
// pressing it to close a menu kicks you out of fullscreen too. With the Keyboard Lock API
// (Chrome, Edge) a short Esc press reaches the page instead, and holding Esc leaves fullscreen
// (the browser says so on entry). Elsewhere it falls back to plain fullscreen.
export async function enterFullscreen() {
  try { await document.documentElement.requestFullscreen({ navigationUI: "hide" }); } catch { return; }
  try { await navigator.keyboard?.lock?.(["Escape"]); } catch {}
}

export function exitFullscreen() {
  try { navigator.keyboard?.unlock?.(); } catch {}
  document.exitFullscreen?.()?.catch?.(() => {});
}

export const toggleFullscreen = () => (document.fullscreenElement ? exitFullscreen() : enterFullscreen());

// label the buttons for what they will do
export function bindFullscreenButtons(selector = ".fsbtn") {
  const sync = () => {
    for (const b of document.querySelectorAll(selector)) {
      if (b.dataset.icon === undefined) b.textContent = document.fullscreenElement ? "Exit fullscreen" : "Fullscreen";
    }
  };
  for (const b of document.querySelectorAll(selector)) b.addEventListener("click", toggleFullscreen);
  document.addEventListener("fullscreenchange", () => {
    if (!document.fullscreenElement) try { navigator.keyboard?.unlock?.(); } catch {}
    sync();
  });
  sync();
}

// time of the last pointer-lock change, so an Esc that the browser already used to release the
// mouse isn't taken a second time as "resume"
let lockChangedAt = 0;
document.addEventListener("pointerlockchange", () => (lockChangedAt = performance.now()));
export const sinceLockChange = () => performance.now() - lockChangedAt;
