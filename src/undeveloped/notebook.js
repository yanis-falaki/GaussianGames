// Undeveloped's case notebook (Tab): each chapter as a question, a line of the story so far, and
// statements with blanks, filled with evidence and keywords and checked chapter by chapter; the
// evidence grid with your photos and documents; and the ending once the last chapter holds.
// A wrong check marks which statements hold and nudges on the ones that don't, without giving the
// answer away; after a few failed checks it names the clue that matters. Content: case-file.js.
import * as CASE from "./case-file.js";

const $ = (id) => document.getElementById(id);
const CLUE = Object.fromEntries(CASE.CLUES.map((c) => [c.id, c]));
const HINT_AFTER = 3; // failed checks of a chapter before the notebook names the clues
const AT = { "Dining hall": "in the dining hall", Kitchen: "in the kitchen", Terrace: "on the terrace", "Room 31": "in Room 31" };
const at = (room) => AT[room] ?? `in the ${room.toLowerCase()}`;

export function createNotebook({ state, audio, toast, setRaised, onSolved, onFinish }) {
  state.fails = CASE.CHAPTERS.map(() => 0);
  state.marks = CASE.CHAPTERS.map((ch) => ch.questions.map(() => null)); // per statement: null | { ok, say }

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

  // does a piece of evidence fit what a blank asks for?
  const fits = (blank, e) => blank.ask === "document" ? e.kind === "doc" : blank.ask === "photo" ? e.kind !== "doc" : true;

  let picker = null;
  function renderNotebook() {
    const nUnlocked = unlockedChapters();
    state.chapterTab = Math.min(state.chapterTab, nUnlocked - 1);
    $("nb-tabs").innerHTML = CASE.CHAPTERS.map((ch, i) =>
      `<button class="tab ${i === state.chapterTab ? "on" : ""} ${state.solved[i] ? "done" : ""}" data-tab="${i}" ${i >= nUnlocked ? "disabled" : ""}>${i < nUnlocked ? ch.title : "· · ·"}${state.solved[i] ? " ✓" : ""}</button>`).join("");
    for (const b of $("nb-tabs").querySelectorAll("[data-tab]")) b.onclick = () => { closePicker(); state.chapterTab = +b.dataset.tab; renderNotebook(); };

    const ci = state.chapterTab, ch = CASE.CHAPTERS[ci];
    const solved = state.solved[ci];
    let html = `<div class="nb-head"><p class="nb-question">${esc(ch.question)}</p><p class="nb-intro">${esc(ch.intro)}</p></div>`;
    if (!solved && ci === 0) html += `<p class="nb-how">Click a blank to fill it: <span class="blank evidence demo">photo</span> and <span class="blank evidence demo">document</span> take one of your pieces of evidence, the others a word. When every statement holds, check the chapter.</p>`;
    ch.questions.forEach((q, qi) => {
      const parts = q.text.split(/(\{\w\})/g).map((part) => {
        const m = /^\{(\w)\}$/.exec(part);
        if (!m) return esc(part);
        const key = m[1], blank = q.blanks[key], val = state.answers[ci][qi][key];
        let label = `<span class="ask">${esc(blank.ask)}</span>`;
        if (val && blank.type === "word") label = esc(val);
        else if (val) {
          const e = state.evidence.get(val);
          label = `${e?.img ? `<img src="${e.img}" alt="">` : `<i class="docmark"></i>`}${esc(e?.label ?? val)}`;
        }
        const picking = picker && picker.ci === ci && picker.qi === qi && picker.key === key ? "picking" : "";
        return `<button class="blank ${val ? "filled" : ""} ${blank.type} ${picking}" data-q="${qi}" data-k="${key}" ${solved ? "disabled" : ""}>${label}</button>`;
      }).join("");
      const mark = solved ? { ok: true } : state.marks[ci][qi];
      html += `<div class="q ${mark?.ok ? "ok" : mark ? "bad" : ""}"><span class="qn">${mark?.ok ? "✓" : qi + 1}</span><div><p>${parts}</p>${mark && !mark.ok && mark.say ? `<p class="nudge">${mark.say}</p>` : ""}</div></div>`;
    });
    if (solved) {
      if (ch.solved) html += `<div class="solved">${ch.solved}</div>`;
      if (ci + 1 < CASE.CHAPTERS.length && ci + 1 < nUnlocked) html += `<div class="check-row"><button id="nb-next">Turn the page: ${esc(CASE.CHAPTERS[ci + 1].title)} &rarr;</button></div>`;
    } else html += `<div class="check-row"><button id="nb-check">Check this chapter</button><span id="nb-feedback">${state.feedback?.[ci] ?? ""}</span></div>`;
    $("nb-questions").innerHTML = html;
    for (const b of $("nb-questions").querySelectorAll("button.blank")) b.onclick = () => openPicker(ci, +b.dataset.q, b.dataset.k, b);
    $("nb-check")?.addEventListener("click", () => checkChapter(ci));
    $("nb-next")?.addEventListener("click", () => { state.chapterTab = ci + 1; audio.paper(); renderNotebook(); });
    renderEvidence();
  }

  // the evidence grid; while a photo / document blank is being filled, the pieces that fit it
  function renderEvidence() {
    const ev = [...state.evidence.values()];
    const blank = picker?.type === "evidence" ? picker.blank : null;
    $("nb-ev-count").textContent = blank ? `· pick a ${blank.ask} for the blank` : ev.length ? `(${ev.length}) · click one to look at it again` : "(0)";
    $("nb-evidence").classList.toggle("picking", !!blank);
    $("nb-evidence").innerHTML = ev.length
      ? ev.map((e) => `<button class="card ${blank ? (fits(blank, e) ? "pickable" : "unfit") : ""}" data-id="${e.id}">
          ${e.img ? `<img src="${e.img}" alt="">` : `<div class="docicon">DOCUMENT</div>`}
          <span>${esc(e.label)}</span><small>${esc(e.room)}${e.kind === "doc" ? " · document" : ""}</small></button>`).join("")
      : `<p class="empty">Nothing yet. Raise your camera (right mouse button), frame something that matters, and take a photo (left button). Press E to read documents.</p>`;
    for (const b of $("nb-evidence").querySelectorAll(".card")) b.onclick = () => {
      if (blank) {
        const e = state.evidence.get(b.dataset.id);
        if (!fits(blank, e)) return toast(blank.ask === "document" ? "That blank needs a document: something written." : "That blank needs a photo, not a document.");
        return choose(b.dataset.id);
      }
      showCard(b.dataset.id);
    };
  }

  function openPicker(ci, qi, key, el) {
    const blank = CASE.CHAPTERS[ci].questions[qi].blanks[key];
    const again = picker && picker.ci === ci && picker.qi === qi && picker.key === key;
    closePicker();
    if (again) return renderNotebook();
    picker = { ci, qi, key, type: blank.type, blank };
    if (blank.type === "word") {
      const pop = document.createElement("div");
      pop.className = "picker";
      pop.innerHTML = `<small>${esc(blank.ask)}</small>` + blank.options.map((o) => `<button data-v="${esc(o)}">${esc(o)}</button>`).join("");
      const r = el.getBoundingClientRect();
      pop.style.left = `${Math.min(r.left, innerWidth - 300)}px`; pop.style.top = `${r.bottom + 6}px`;
      document.body.appendChild(pop);
      for (const b of pop.querySelectorAll("button")) b.onclick = () => choose(b.dataset.v);
      picker.pop = pop;
    } else {
      if (![...state.evidence.values()].some((e) => fits(blank, e))) {
        picker = null;
        return toast(blank.ask === "document" ? "You haven't read any documents yet. Press <b>E</b> to read one." : "You don't have any photos yet.");
      }
      renderNotebook();
    }
  }
  function choose(v) {
    const { ci, qi, key } = picker;
    state.answers[ci][qi][key] = v;
    state.marks[ci][qi] = null; // changed: no longer known to hold or not
    closePicker();
    audio.paper(0.4);
    renderNotebook();
  }
  function closePicker() {
    picker?.pop?.remove();
    picker = null;
  }
  addEventListener("mousedown", (e) => {
    if (picker?.pop && !picker.pop.contains(e.target) && !e.target.closest?.(".blank")) closePicker();
  });

  // what to say about a wrong blank: a tempting wrong answer's own line, else the wrong room,
  // else the blank's nudge; after a few failed checks, the clue that matters
  function nudge(blank, v, fails) {
    let say = blank.nudge ?? "";
    if (blank.type === "evidence") {
      const e = CLUE[v], rooms = blank.answer.map((id) => CLUE[id].room);
      if (blank.wrong?.[v]) say = blank.wrong[v];
      else if (e && !rooms.includes(e.room)) say = `That ${e.kind === "doc" ? "document" : "photo"} is from ${at(e.room).replace(/^(in|on) /, "")}, but this happened ${at(rooms[0])}.`;
    }
    if (fails >= HINT_AFTER) {
      const id = blank.type === "evidence" ? (blank.answer.find((a) => state.evidence.has(a)) ?? blank.answer[0]) : blank.from;
      const c = CLUE[id];
      if (c) {
        const have = state.evidence.has(id);
        say += ` <b>Hint:</b> ${blank.type === "word" ? `the ${c.label.toLowerCase()} ${at(c.room)} has the answer.` : `look again at the ${c.label.toLowerCase()}, ${at(c.room)}.`}`;
        if (!have) say += ` You haven't ${c.kind === "doc" ? "read" : "photographed"} it yet.`;
      }
    }
    return say;
  }

  function checkChapter(ci) {
    const ch = CASE.CHAPTERS[ci];
    state.feedback ||= [];
    const res = ch.questions.map((q, qi) => {
      let ok = true, empty = false, first = null;
      for (const [k, blank] of Object.entries(q.blanks)) {
        const v = state.answers[ci][qi][k];
        if (!v) { empty = true; ok = false; continue; }
        if (blank.type === "word" ? v !== blank.answer : !blank.answer.includes(v)) { ok = false; first ??= [blank, v]; }
      }
      return { ok, empty, first };
    });
    if (res.some((r) => r.empty)) { state.feedback[ci] = "Fill in every blank first."; return renderNotebook(); }
    if (res.every((r) => r.ok)) {
      state.solved[ci] = true;
      state.feedback[ci] = "";
      audio.solve();
      onSolved(ci);
      if (ci === CASE.CHAPTERS.length - 1) return finish();
      renderNotebook();
      toast(`<b>${ch.title}</b> holds. A new chapter is open in the notebook.`, 4000);
      return;
    }
    audio.wrong();
    const fails = ++state.fails[ci];
    res.forEach((r, qi) => (state.marks[ci][qi] = r.ok ? { ok: true } : { ok: false, say: r.first ? nudge(r.first[0], r.first[1], fails) : "" }));
    const good = res.filter((r) => r.ok).length;
    state.feedback[ci] = good ? `${good} of ${res.length} statements hold (marked ✓). Look again at the others.` : "None of these hold up yet.";
    renderNotebook();
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
    closePicker();
    state.ui = "ending";
    $("notebook").hidden = true;
    document.exitPointerLock?.();
    onFinish();
  }

  return { open: openNotebook, cardOpen, closeCard, showCard, close: closePicker };
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
