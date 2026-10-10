// Authoring helper for Undeveloped (needs the bench server, port 5182).
//   node tools/author.mjs shots poses.json outDir   -> screenshot each pose with a pixel grid
//   node tools/author.mjs pick picks.json           -> [{pose, px:[x,y]}] -> 3D points (voxel raycast)
import fs from "node:fs";
import puppeteer from "puppeteer";
const [, , mode, file, outDir = "bench/author"] = process.argv;
const items = JSON.parse(fs.readFileSync(file, "utf8"));
const W = 960, H = 540;
const b = await puppeteer.launch({ headless: "new", protocolTimeout: 0,
  args: ["--use-angle=gl-egl", "--ignore-gpu-blocklist", "--no-sandbox"], defaultViewport: { width: W, height: H } });
const p = await b.newPage();
p.on("pageerror", (e) => console.error("PAGE ERROR:", e.message));
await p.goto("http://localhost:5182/undeveloped.html?debug&author", { waitUntil: "domcontentloaded" });
await p.waitForFunction(() => !!window.dev, { timeout: 0, polling: 500 });
const settle = () => p.evaluate(() => new Promise((r) => setTimeout(r, 1500)));
if (mode === "shots") {
  for (const it of items) {
    await p.evaluate((q) => window.dev.pose(...q), it.pose);
    await settle();
    await p.evaluate((W, H) => {
      let g = document.getElementById("grid");
      if (!g) { g = document.createElement("canvas"); g.id = "grid"; g.width = W; g.height = H;
        g.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:99"; document.body.appendChild(g); }
      const c = g.getContext("2d"); c.clearRect(0, 0, W, H); c.font = "10px monospace";
      for (let x = 0; x <= W; x += 80) { c.strokeStyle = "rgba(255,0,0,.5)"; c.beginPath(); c.moveTo(x, 0); c.lineTo(x, H); c.stroke(); c.fillStyle = "#ff0"; c.fillText(x, x + 2, 10); }
      for (let y = 0; y <= H; y += 60) { c.strokeStyle = "rgba(255,0,0,.5)"; c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); c.fillStyle = "#ff0"; c.fillText(y, 2, y + 10); }
    }, W, H);
    await p.screenshot({ path: `${outDir}/${it.name}.png` });
    console.log("shot", it.name);
  }
} else {
  for (const it of items) {
    await p.evaluate((q) => window.dev.pose(...q), it.pose);
    await settle();
    const pt = await p.evaluate((u, v) => window.dev.pick(u, v), it.px[0] / W, it.px[1] / H);
    console.log(JSON.stringify({ name: it.name, point: pt }));
  }
}
await b.close();
