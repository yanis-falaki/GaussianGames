// Evolutionary search over render settings against the benchmark evaluator.
//   node tools/search.mjs [generations=8] [lambda=3]
// Maximises image quality (SSIM vs a high-budget reference, steady + right-after-turning)
// subject to a GPU frame-time budget. Every evaluation is appended to bench/search-log.jsonl,
// the best config so far is written to bench/best.cfg.json.
import fs from "node:fs";
import { execSync } from "node:child_process";
import puppeteer from "puppeteer";

const GENS = Number(process.argv[2] ?? 8), LAMBDA = Number(process.argv[3] ?? 3);
const BUDGET_P95 = Number(process.env.BENCH_BUDGET_MS ?? 12.5);
const LOG = "bench/search-log.jsonl";
fs.mkdirSync("bench", { recursive: true });

// ---- search space
const SPACE = {
  lodSplatScale: { min: 0.5, max: 3.0, step: 0.25 },
  maxSh: { set: [0, 1] },
  foveate: { set: [false, true] },
  behindFoveate: { min: 0.1, max: 1.0, step: 0.15 },
  coneFoveate: { min: 0.3, max: 1.0, step: 0.1 },
  coneFov0: { min: 60, max: 140, step: 15 },
  coneFov: { min: 100, max: 180, step: 15 },
  lodStep: { set: [0, 0.2, 0.4, 0.8] },
  maxStdDev: { min: 2.0, max: 2.83, step: 0.2 },
  pixelScale: { set: [0.75, 0.85, 1.0] },
  minSortIntervalMs: { set: [0, 16, 33] },
};
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function mutate(cfg) {
  const c = { ...cfg };
  const keys = Object.keys(SPACE).filter((k) => c.foveate || !["behindFoveate", "coneFoveate", "coneFov0", "coneFov"].includes(k));
  const n = 1 + (Math.random() < 0.5 ? 1 : 0);
  for (let i = 0; i < n; i++) {
    const k = keys[(Math.random() * keys.length) | 0];
    const s = SPACE[k];
    if (s.set) c[k] = s.set[(Math.random() * s.set.length) | 0];
    else c[k] = +clamp(c[k] + (Math.random() < 0.5 ? -1 : 1) * s.step * (1 + (Math.random() * 2) | 0), s.min, s.max).toFixed(3);
  }
  if (c.foveate) {
    c.behindFoveate ??= 0.4; c.coneFoveate ??= 0.6; c.coneFov0 ??= 110; c.coneFov ??= 150;
    c.coneFov = Math.max(c.coneFov, c.coneFov0 + 10);
  }
  return c;
}
const key = (c) => JSON.stringify(Object.keys(SPACE).map((k) => c[k]));
function name(c) {
  return `x${c.lodSplatScale} sh${c.maxSh}${c.foveate ? ` fov${c.behindFoveate}/${c.coneFoveate}/${c.coneFov0}-${c.coneFov}` : ""}` +
    ` st${c.lodStep} sd${c.maxStdDev} px${c.pixelScale} so${c.minSortIntervalMs}`;
}
function fitness(r) {
  const q = 0.55 * r.ssim + 0.25 * r.minSsim + 0.2 * r.turnSsim;
  const over = Math.max(0, r.gpuP95 - BUDGET_P95) + Math.max(0, 58 - r.fps) * 0.3;
  return +(q - over * 0.03).toFixed(5);
}

// ---- browser
const browser = await puppeteer.launch({
  headless: "new", protocolTimeout: 0,
  args: ["--use-angle=gl-egl", "--ignore-gpu-blocklist", "--no-sandbox", "--window-size=1920,1080",
    "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--js-flags=--max-old-space-size=4096"],
  defaultViewport: { width: 1920, height: 1080 },
});
const watchdog = setInterval(() => {
  // system RAM: abort before the machine runs out (16GB, no swap; the OOM killer took down the desktop app once)
  try {
    const avail = Number(/MemAvailable:\s+(\d+)/.exec(fs.readFileSync("/proc/meminfo", "utf8"))[1]) / 1024;
    if (avail < 3000) { console.error(`only ${avail.toFixed(0)} MiB RAM available: aborting benchmark`); browser.process()?.kill("SIGKILL"); process.exit(3); }
  } catch {}
  try {
    const mb = Number(execSync("nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits").toString().trim());
    if (mb > 7000) { console.error(`GPU memory ${mb} MiB: aborting`); browser.process()?.kill("SIGKILL"); process.exit(2); }
  } catch {}
}, 1000);
const page = await browser.newPage();
page.on("pageerror", (e) => console.error("PAGE ERROR:", e.message));
await page.goto("http://localhost:5182/residue.html?bench", { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => !!window.bench, { timeout: 0, polling: 1000 });
await page.evaluate(async () => { window.__ref = await window.bench.capture({ name: "ref", lodSplatScale: 2, maxSh: 3, pixelScale: 1 }, 5000); });
console.error("reference captured");

const seen = new Map();
async function evaluate(cfg) {
  const k = key(cfg);
  if (seen.has(k)) return seen.get(k);
  const c = { ...cfg, name: name(cfg), settleMs: 5000 };
  const r = await page.evaluate((c) => window.bench.evaluate(c, window.__ref, 6), c);
  const row = { ...c, ...r, fitness: fitness(r) };
  seen.set(k, row);
  fs.appendFileSync(LOG, JSON.stringify(row) + "\n");
  console.error(`${row.fitness.toFixed(4)}  gpu ${r.gpuMs}/${r.gpuP95}ms fps ${r.fps}  ssim ${r.ssim} min ${r.minSsim} turn ${r.turnSsim}  ${c.name}`);
  return row;
}

const base = { lodSplatScale: 1.5, maxSh: 1, foveate: false, lodStep: 0.4, maxStdDev: 2.83, pixelScale: 1.0, minSortIntervalMs: 0 };
const seeds = [
  base,
  { ...base, foveate: true, behindFoveate: 0.4, coneFoveate: 0.6, coneFov0: 110, coneFov: 150 },
  { ...base, maxSh: 0, lodSplatScale: 2.0 },
];
let pop = [];
for (const s of seeds) pop.push(await evaluate(s));
pop.sort((a, b) => b.fitness - a.fitness);
for (let g = 0; g < GENS; g++) {
  const parents = pop.slice(0, 2);
  for (let i = 0; i < LAMBDA; i++) {
    const p = parents[i % parents.length];
    let child = mutate(p);
    for (let t = 0; t < 10 && seen.has(key(child)); t++) child = mutate(p);
    pop.push(await evaluate(child));
  }
  pop.sort((a, b) => b.fitness - a.fitness);
  pop = pop.slice(0, 4);
  fs.writeFileSync("bench/best.cfg.json", JSON.stringify(pop[0], null, 2));
  console.error(`--- gen ${g + 1}: best ${pop[0].fitness} ${pop[0].name}`);
}
clearInterval(watchdog);
await browser.close();
console.log(JSON.stringify(pop.slice(0, 4), null, 2));
