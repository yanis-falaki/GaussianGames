// Render-config evaluator for RESIDUE. Needs the bench server (tools/bench-server.sh start).
//   node tools/evaluate.mjs configs.json [out.json]
// configs.json: [{ name, lodSplatScale, maxSh, pixelScale, lodRenderScale, maxStdDev, ... }, ...]
// Each config gets GPU time / fps on a fixed camera path at 1920x1080 and SSIM/PSNR against a
// high-budget reference capture of 8 fixed viewpoints.
import fs from "node:fs";
import { execSync } from "node:child_process";
import puppeteer from "puppeteer";

const [, , cfgPath, outPath = "bench-results.json"] = process.argv;
const configs = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
const URL = process.env.BENCH_URL ?? "http://localhost:5182/residue.html?bench";
const REF = JSON.parse(process.env.BENCH_REF ?? '{"name":"reference","lodSplatScale":2,"maxSh":3,"pixelScale":1}');
const SECONDS = Number(process.env.BENCH_SECONDS ?? 8);

const browser = await puppeteer.launch({
  headless: "new",
  protocolTimeout: 0,
  args: ["--use-angle=gl-egl", "--ignore-gpu-blocklist", "--enable-gpu-rasterization", "--no-sandbox",
    "--window-size=1920,1080", "--disable-background-timer-throttling", "--disable-renderer-backgrounding",
    "--js-flags=--max-old-space-size=4096"],
  defaultViewport: { width: 1920, height: 1080 },
});
// Safety: never let a benchmark push the GPU near its limit (8GB card).
const GPU_LIMIT = Number(process.env.BENCH_GPU_LIMIT_MB ?? 7000);
let peakGpu = 0;
const watchdog = setInterval(() => {
  // system RAM: abort before the machine runs out (16GB, no swap; the OOM killer took down the desktop app once)
  try {
    const avail = Number(/MemAvailable:\s+(\d+)/.exec(fs.readFileSync("/proc/meminfo", "utf8"))[1]) / 1024;
    if (avail < 3000) { console.error(`only ${avail.toFixed(0)} MiB RAM available: aborting benchmark`); browser.process()?.kill("SIGKILL"); process.exit(3); }
  } catch {}
  try {
    const mb = Number(execSync("nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits").toString().trim());
    peakGpu = Math.max(peakGpu, mb);
    if (mb > GPU_LIMIT) {
      console.error(`GPU memory ${mb} MiB > ${GPU_LIMIT} MiB: aborting benchmark`);
      browser.process()?.kill("SIGKILL");
      process.exit(2);
    }
  } catch {}
}, 1000);
const page = await browser.newPage();
page.on("console", (m) => { const t = m.text(); if (t.startsWith("[")) console.error("  page:", t); });
page.on("pageerror", (e) => console.error("  PAGE ERROR:", e.message));
await page.goto(URL, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => !!window.bench, { timeout: 0, polling: 1000 });
console.error("bench ready; capturing reference", JSON.stringify(REF));
await page.evaluate(async (ref) => { window.__ref = await window.bench.capture(ref, 3500); }, REF);

const results = [];
for (const cfg of configs) {
  const t0 = Date.now();
  const r = await page.evaluate((c, s) => window.bench.evaluate(c, window.__ref, s), cfg, SECONDS);
  const row = { ...cfg, ...r };
  results.push(row);
  row.peakGpuMB = peakGpu;
  console.error(`${cfg.name.padEnd(34)} gpu ${String(r.gpuMs).padStart(6)}ms p95 ${String(r.gpuP95).padStart(6)}  fps ${String(r.fps).padStart(5)}  ssim ${r.ssim}  min ${r.minSsim}  psnr ${r.psnr}  (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
}
clearInterval(watchdog);
await browser.close();
console.log(JSON.stringify(results, null, 2));
