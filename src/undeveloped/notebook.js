// Undeveloped's case notebook (Tab): the chapters as statements with blanks, filled with
// evidence and keywords and checked chapter by chapter; the evidence grid with your photos and
// documents; and the ending once the last chapter holds. Content comes from case-file.js.
import * as CASE from "./case-file.js";

const $ = (id) => document.getElementById(id);

export function createNotebook({ state, audio, toast, setRaised, onSolved }) {
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
    let html = solved ? "" : `<p class="nb-how">Click a blank, then pick a piece of evidence or a word. When every statement in the chapter holds, check it. Click any piece of evidence to look at it again.</p>`;
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
    $("nb-ev-count").textContent = ev.length ? `(${ev.length}) · click one to look at it again` : "(0)";
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
      onSolved();
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
    $("doc-note").textContent = "click or press Esc to go back to your notebook";
    $("doc").classList.add("over-notebook");
    $("doc").hidden = false;
  }
  // back from a card opened in the notebook
  function closeCard() {
    $("doc").hidden = true;
    $("doc").classList.remove("over-notebook");
  }
  const cardOpen = () => state.ui === "notebook" && !$("doc").hidden;

  function finish() {
    state.ui = "ending";
    $("notebook").hidden = true;
    const photos = [...state.evidence.values()].filter((e) => e.img).slice(0, 9);
    $("end-body").innerHTML = CASE.ENDING + `<div class="end-photos">${photos.map((p) => `<img src="${p.img}">`).join("")}</div>
      <div class="row"><button onclick="location.reload()">Start over</button></div>`;
    $("ending").hidden = false;
    document.exitPointerLock?.();
  }

  return { open: openNotebook, cardOpen, closeCard, showCard };
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
