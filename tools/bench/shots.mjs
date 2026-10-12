// Screenshot RESIDUE's fixed benchmark viewpoints under given render configs, in the game's own
// lighting (needs tools/bench/server.sh start).
//   node tools/bench/shots.mjs configs.json outDir [viewIndices e.g. 1,2,6] [unlit]
import fs from "node:fs";
import { execSync } from "node:child_process";
import puppeteer from "puppeteer";

const [, , cfgPath, outDir = "bench/shots", viewArg = "", unlitArg = ""] = process.argv;
const configs = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
const views = viewArg ? viewArg.split(",").map(Number) : null;
fs.mkdirSync(outDir, { recursive: true });

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
await page.goto(process.env.BENCH_URL ?? "http://localhost:5182/residue.html?bench", { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => !!window.bench, { timeout: 0, polling: 1000 });
for (const cfg of configs) {
  const n = await page.evaluate(() => window.bench.views.length);
  for (let i = 0; i < n; i++) {
    if (views && !views.includes(i)) continue;
    await page.evaluate((c, i, u) => window.bench.show(c, i, 5000, !!u), cfg, i, unlitArg);
    const file = `${outDir}/${cfg.name.replace(/[^a-z0-9.]+/gi, "_")}-v${i}.png`;
    await page.screenshot({ path: file });
    console.error("wrote", file);
  }
}
clearInterval(watchdog);
await browser.close();
