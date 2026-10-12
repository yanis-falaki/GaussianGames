// Frame pacing of either game on the shared walk through the building (src/shared/walk-bench.js),
// rendered exactly as the game renders it. Prints one JSON line per run.
//   node tools/bench/walk.mjs residue                     the game as a player gets it
//   node tools/bench/walk.mjs undeveloped --params lite   extra URL parameters (here: force lite)
//   --size 1536x864 --dpr 1.25    window size and devicePixelRatio (e.g. a laptop at 125%)
//   --cpu 4                       throttle the main thread 4x (a slow laptop CPU)
//   --seconds 20 --runs 1
//   --black                       count frames that come out entirely black
//   --cfgs file.json              RESIDUE only: walk once per render config in the file (see
//                                 applyConfig in src/residue/bench.js), in one page load
// Needs the bench server (tools/bench/server.sh start). Holds the machine-wide GPU lock, keeps
// its browser profile (and HTTP cache of the scan) on disk, and aborts if RAM or GPU memory runs low.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync, spawnSync } from "node:child_process";

const LOCK = process.env.GPU_LOCK ?? "/tmp/residue-gpu.lock";
if (!process.env.RESIDUE_LOCKED) {
  const r = spawnSync("flock", [LOCK, process.execPath, ...process.argv.slice(1)], {
    stdio: "inherit", env: { ...process.env, RESIDUE_LOCKED: "1" },
  });
  process.exit(r.status ?? 1);
}

const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : d);
const game = args[0] && !args[0].startsWith("--") ? args[0] : "residue";
const [W, H] = opt("size", "1920x1080").split("x").map(Number);
const dpr = Number(opt("dpr", 1));
const cpu = Number(opt("cpu", 1));
const seconds = Number(opt("seconds", 20));
const runs = Number(opt("runs", 1));
const extra = opt("params", "");
const cfgs = opt("cfgs") ? JSON.parse(fs.readFileSync(opt("cfgs"), "utf8")) : [null];
const base = process.env.BENCH_HOST ?? "http://localhost:5182";
const url = `${base}/${game}.html?bench${extra ? "&" + extra : ""}`;
const minFreeMb = Number(process.env.BENCH_MIN_FREE_MB ?? 1800);

const { default: puppeteer } = await import("puppeteer");
const browser = await puppeteer.launch({
  headless: "new", protocolTimeout: 0,
  userDataDir: path.join(os.homedir(), ".cache/gaussian-games-bench"), // on disk: /tmp is RAM here
  args: ["--use-angle=gl-egl", "--ignore-gpu-blocklist", "--no-sandbox", `--window-size=${W},${H}`,
    "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--js-flags=--max-old-space-size=4096"],
  defaultViewport: { width: Math.round(W / dpr), height: Math.round(H / dpr), deviceScaleFactor: dpr },
});
const watchdog = setInterval(() => {
  try {
    const avail = Number(/MemAvailable:\s+(\d+)/.exec(fs.readFileSync("/proc/meminfo", "utf8"))[1]) / 1024;
    if (avail < minFreeMb) { console.error(`only ${avail.toFixed(0)} MiB RAM available: aborting`); browser.process()?.kill("SIGKILL"); process.exit(3); }
  } catch {}
  try {
    const mb = Number(execSync("nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits").toString().trim());
    if (mb > 7400) { console.error(`GPU memory ${mb} MiB: aborting`); browser.process()?.kill("SIGKILL"); process.exit(2); }
  } catch {}
}, 1000);
try {
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.error("PAGE ERROR:", e.message));
  page.on("console", (m) => { if (/error|warn/i.test(m.type()) || (process.env.BENCH_LOG && m.text().includes(process.env.BENCH_LOG))) console.error("page:", m.text().slice(0, 300)); });
  // start from a clean slate: no remembered quality tier or governor level from earlier runs
  await page.evaluateOnNewDocument(() => {
    try {
      if (sessionStorage.getItem("bench-init")) return;
      sessionStorage.setItem("bench-init", "1");
      for (const k of Object.keys(localStorage)) if (k.startsWith("gaussian-games.")) localStorage.removeItem(k);
    } catch {}
  });
  const t0 = Date.now();
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!window.bench?.walk, { timeout: 300000, polling: 500 });
  const loadS = (Date.now() - t0) / 1000;
  if (cpu > 1) {
    const cdp = await page.createCDPSession();
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpu });
  }
  for (const cfg of cfgs) for (let i = 0; i < runs; i++) {
    const r = await page.evaluate((s, c, b) => window.bench.walk({ seconds: s, cfg: c ?? undefined, checkBlack: !!b }), seconds, cfg, args.includes("--black"));
    console.log(JSON.stringify({ game, params: extra, cfg: cfg?.name, size: `${W}x${H}`, dpr, cpu, loadS, ...r }));
  }
} finally {
  clearInterval(watchdog);
  await browser.close();
}
