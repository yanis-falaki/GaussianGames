// Score the render pipeline + settings in the current working tree.
//   node tools/fitness.mjs                 -> evaluates src/shared/render-config.js, prints JSON (+ fitness)
//   node tools/fitness.mjs --cfg '{"lodSplatScale":2}'   -> override settings
//   node tools/fitness.mjs --quick         -> faster, noisier (4 views, short settles): for iterating
//   node tools/fitness.mjs --make-ref      -> capture the reference images (run once, on baseline code)
// Needs a bench server: npx vite --config vite.bench.config.js  (port 5182, or BENCH_URL=...)
// Benchmarks hold a machine-wide GPU lock so runs never overlap (timing + GPU memory safety).
import fs from "node:fs";
import path from "node:path";
import { execSync, spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const LOCK = process.env.GPU_LOCK ?? "/tmp/residue-gpu.lock";
if (!process.env.RESIDUE_LOCKED) {
  const r = spawnSync("flock", [LOCK, process.execPath, ...process.argv.slice(1)], {
    stdio: "inherit", env: { ...process.env, RESIDUE_LOCKED: "1" },
  });
  process.exit(r.status ?? 1);
}

const { default: puppeteer } = await import("puppeteer");
const args = process.argv.slice(2);
const makeRef = args.includes("--make-ref");
const quick = args.includes("--quick");
const perfOnly = args.includes("--perf");
const cfgArg = args.includes("--cfg") ? JSON.parse(args[args.indexOf("--cfg") + 1]) : {};
const URL = process.env.BENCH_URL ?? "http://localhost:5182/residue.html?bench";
const BUDGET_P95 = Number(process.env.BENCH_BUDGET_MS ?? 12.5);
const REF_DIR = process.env.BENCH_REF_DIR ?? path.resolve("public/assets/bench");
const REF_CFG = { name: "reference", lodSplatScale: 2, maxSh: 3, pixelScale: 1, settleMs: 6000 };

const { RENDER } = await import(pathToFileURL(path.resolve("src/shared/render-config.js")).href);
const cfg = { name: "candidate", ...RENDER, ...cfgArg };

const browser = await puppeteer.launch({
  headless: "new", protocolTimeout: 0,
  userDataDir: "/tmp/residue-bench-profile", // persistent HTTP cache: the 850MB scan isn't re-downloaded
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
try {
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.error("PAGE ERROR:", e.message));
  page.on("console", (m) => { const t = m.text(); if (/error|warn/i.test(m.type())) console.error("page:", t.slice(0, 300)); });
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!window.bench, { timeout: 180000, polling: 1000 });

  if (makeRef) {
    fs.mkdirSync(REF_DIR, { recursive: true });
    for (const kind of ["unlit", "lit"]) {
      const b64 = await page.evaluate(async (c, unlit) => window.bench.encode(await window.bench.capture(c, c.settleMs, unlit)), REF_CFG, kind === "unlit");
      fs.writeFileSync(path.join(REF_DIR, `ref-${kind}.bin`), Buffer.from(b64, "base64"));
      console.error(`wrote reference ${kind}`);
    }
  } else {
    if (perfOnly) {
      const [r] = await page.evaluate((c) => window.bench.perf(c, 10), cfg);
      console.log(JSON.stringify({ ...cfg, ...r }, null, 2));
      process.exitCode = 0;
    }
    const r = perfOnly ? null : await page.evaluate((c, q) => window.bench.evaluate(c, 6, q), cfg, quick);
    if (r) {
    const detail = 0.55 * r.ssim + 0.25 * r.minSsim + 0.2 * r.turnSsim;
    const look = Math.max(0, 0.95 - r.litSsim) * 2 + Math.max(0, 0.9 - r.minLitSsim);
    const slow = Math.max(0, r.gpuP95 - BUDGET_P95) * 0.03 + Math.max(0, 58 - r.fps) * 0.01;
    const out = { ...cfg, ...r, fitness: +(detail - look - slow).toFixed(5) };
    console.log(JSON.stringify(out, null, 2));
    }
  }
} finally {
  clearInterval(watchdog);
  await browser.close();
}
