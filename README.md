# Gaussian Games

Two first-person browser games built on **one Gaussian-splat scan** of an abandoned sanatorium. They use the same 12.5 million splats, in the same building, but one game plays at night and the other in daylight.

**▶ Play in your browser: [gaussiangames.pages.dev](https://gaussiangames.pages.dev)** (desktop or laptop with a keyboard and mouse)

![The menu: the same dining hall at night (RESIDUE) and by day (Undeveloped)](docs/menu.jpg)

| | |
| --- | --- |
| **RESIDUE** · horror · ~20 min | **Undeveloped** · detective · ~30 min |
| ![RESIDUE](docs/residue.jpg) | ![Undeveloped](docs/undeveloped.jpg) |
| It is the last night before demolition. In 1931 a doctor photographed the patients here by lamplight, in exposures so long that only those who held still came out clear. One girl never held still. You go in with a wind-up lamp and a camcorder to find his six plates. | A photographer went into the empty sanatorium and never came out. Walk it in full daylight, photograph the real traces she left behind, and work out where she went. |

## Running it

```bash
npm install
npm run assets -- "URBEX Sanatorium Inside - Part01.zip"   # once, see below
npm run dev
```

Open the printed URL in Chrome, Edge, Firefox or Safari. Wear headphones for RESIDUE. The menu at `/` links to both games, which are also at `/residue.html` and `/undeveloped.html`.

**The scan is not in this repository.** Download *URBEX: Sanatorium Inside – Part01* by Christoph Schindelar from [superspl.at](https://superspl.at/scene/8429e5e2) (CC BY-NC 4.0). `npm run assets` turns the zip into what the games load:
- a cropped, cleaned SPZ of every splat (~215 MB);
- a chunked level-of-detail tree that both games stream;
- a 10 cm collision voxel grid.

It needs Python 3, Rust/cargo (to build Spark's `build-lod`) and about 10 GB of scratch disk.

### Deploying

The hosted build runs on Cloudflare. The site goes to Pages, and the scan goes to an R2 bucket, because it's too big for a Pages file. A small Pages Function (`functions/scan/[name].js`) streams the scan back on the same domain. After a one-time `npx wrangler login`, deploying is one command:

```bash
npm run deploy
```

`tools/deploy.sh` builds the site, uploads the scan only when it has changed, and publishes to the `gaussiangames` Pages project. The `?lod` scene isn't part of the hosted build.

### RESIDUE

| Key | Action |
| --- | --- |
| WASD / Shift / C | walk / run / crouch |
| F or right-click | lamp on / off |
| R (hold) | wind the lamp (only in the dark, and loud) |
| M (or Esc) | menu |

- **Goal:** find the six plates and hold your lamp on each until it develops. They glow faintly on the floor, best seen in the dark.
- **The lamp:** it runs down in about 30 seconds. Winding it back up means standing in the dark, making noise.
- **Her:** something in the building moves only in the dark. Light holds her still, and enough of it burns her away.

Extras:
- `H` turns the camcorder filter on and off (remembered); `?clean` starts without it.
- `?lite` / `?full` force the smaller or the larger splat budget (normally chosen for your GPU).
- `?detail=1.2` fixes the splat budget and `?res=0.8` the render scale, instead of adapting them to your frame rate.
- `?debug` (both games) exposes the game state on `window` and turns on `P` for a freeze frame.

### Undeveloped

| Key | Action |
| --- | --- |
| WASD / Shift | walk / run |
| right mouse | raise / lower the camera |
| left mouse | take a photo |
| E | look closer / read |
| Tab | case notebook |
| M (or Esc) | menu |

- **Real evidence:** every clue is an actual object in the scan (a window frame on the floor, a pink heart traced over in blue, a dog bowl on the terrace), and the photos in your notebook are the frames you took.
- **Deduction:** the notebook poses each chapter as statements with blanks, which you fill with evidence and keywords. A chapter is only confirmed when every statement holds.

## How the splat is used

Everything is derived from the capture itself. There are no meshes and no hand-made collision.

- **Relighting** (`src/residue/lighting.js`): RESIDUE patches Spark's splat vertex shader. Each splat's baked colour is treated as albedo and relit per frame:
  - by a hand lamp (core, ring and spill, which dims and goes orange as it runs down);
  - by a cold moonlight that survives only in the brightest splats (the windows);
  - by a failing bulb in the stairwell, occluded by a line-of-sight volume baked from the voxel grid.

  Shading in the vertex shader means turning your head never regenerates the splat buffer.
- **Collision and navigation** (`tools/assets/voxelize.py`, `src/shared/world.js`): splats are binned into an opacity-weighted 10 cm voxel grid. Floors are solid cells with free headroom above them. From the same grid come the player's walkable surfaces (stairs included), a nav graph with clearance-aware A* for the entity, and the line-of-sight tests.
- **The plates:** patches of the real floor are shown as a glowing photographic negative. Under the lamp they develop into a warm positive with a smeared figure in it.
- **Mara's footprints** (`src/undeveloped/trail.js`): in Undeveloped, splat shoe prints in pale dust are laid along a nav route to the stairwell, on the real floor and steps.
- **The edge of the world** (`src/shared/edge-field.js`): where the capture runs out, splats ripple and dissolve, into black fog at night and into overexposed haze by day, driven by a distance field baked from the nav graph.
- **The entity** (`src/residue/figure.js`, `src/residue/entity.js`):
  - **Body:** about 16,000 procedural Gaussians with a body-part ID packed into each splat's colour bits, posed on the GPU by a Spark dyno modifier.
  - **Movement:** a broken-legged gait, stalking and hunting body language, and sprint charges, shown in stop-motion.
  - **Face:** a head that smears like a long exposure.
  - **The lamp:** it freezes her and burns her away splat by splat.
- **The camcorder** (`src/residue/camcorder.js`): a post pass over the splat render adds barrel distortion, colour fringing, auto-gain noise, lagging auto-exposure, autofocus hunting and interference, together with handheld sway on the camera.
- **Sound:** nearly all of it is procedural WebAudio:
  - HRTF-positioned footsteps;
  - the entity's running steps;
  - a wind-up lamp's ratchet;
  - the bulb's hum;
  - the detuned piano in the dining hall;
  - Undeveloped's gentle score (`src/undeveloped/music.js`): Karplus-Strong harp, pads and bass in slow major-key sections with rests between them.

## Performance

Both games stream the scan the way World Labs' own viewer does (Spark's paged level of detail):
- **Streamed level of detail:** a tree of every original splat plus merged parents, in chunks of 64K splats (`public/assets/lite/`). Spark fetches the chunks it needs and draws a budget of splats chosen by on-screen size, so the room you're in keeps full detail and distant rooms cost little.
- **Foveated detail:** as in World Labs' Marble viewer, full detail in a 100° cone, fading to 0.4 at 140° and 0.2 behind you.
- **Two budgets** (`src/shared/quality.js`): about 5M splats on dedicated GPUs (**quality**), 1.25M on integrated GPUs and phones (**performance**). The title screens' **Graphics** button switches between them, and `?full` / `?lite` force either.
- **Adaptive quality** (`src/shared/governor.js`): resolution, then the splat budget, step down when frames are missed and back up when there is headroom (measured with a GPU timer where the browser has one). The level is remembered per browser. The canvas never renders above CSS resolution, so high-DPI screens don't pay 4× the pixels.
- **Shading in the vertex shader, on-demand regeneration:** lighting changes and turning your head never regenerate the splat buffer; moving does, every 25 cm, and Spark keeps streaming in between.

On an RTX 2070 at 1080p, walking through the building, both games hold 60 fps with a p99 frame time of 16.8 ms. A GPU six times slower (simulated with `?gpux=6`) still holds 60 fps on the performance scene, at a lower resolution.

Benchmarks (all need `tools/bench/server.sh start`):
- `tools/bench/walk.mjs` measures frame pacing on a fixed walk through the building, for either game (fps, p95/p99, hitches, GPU time, splats and pixels drawn).
- `tools/bench/fitness.mjs` scores frame time and image quality against reference captures; `tools/bench/search.mjs` runs an evolutionary search over the settings.

## How the code is organised

```
index.html, residue.html, undeveloped.html   the three pages (menu, and one per game)
src/shared/       what both games use: Spark setup, render settings, quality tiers,
                  collision + nav (world.js), player controller, fullscreen, the scan's facts
src/residue/      RESIDUE      main.js starts it
src/undeveloped/  Undeveloped  main.js starts it
src/menu/         the split-screen menu and its sound
tools/assets/     scan zip -> public/assets (npm run assets)
tools/bench/      headless benchmark and screenshot tools
tools/deploy.sh   npm run deploy
functions/        the Cloudflare Pages Function that streams the scan from R2
```

**Where each game starts.** Each page loads one `main.js`. It builds the view, loads the voxel grid (`World`) and the scan (`createScanMesh`), waits for Spark to settle, then enables the start button.

**How a frame runs.**
1. The game updates its state: player movement, then the game's rules. RESIDUE runs `update()` in `residue/main.js` (lamp, plates, entity, HUD). Undeveloped runs its loop in `undeveloped/main.js` (camera, hints, footprints).
2. Per-frame values go into Spark's patched vertex shader as uniforms: lamp, plates and edge of the world in `residue/lighting.js`, haze and edge in `undeveloped/view.js`. Shading is done there, so turning your head costs nothing.
3. `renderFrame()` (`residue/view.js`) or `render()` (`undeveloped/view.js`) asks Spark to regenerate its splat buffer only when needed: the camera has moved a few cm, an effect is animating, or new LoD data has arrived. Then it draws, and in RESIDUE the camcorder post pass runs on top.

**Modules by game.**
- RESIDUE: `story.js` (text and positions), `hud.js`, `entity.js` + `figure.js` (the entity's AI and procedural body), `lighting.js` (relighting and plate effects), `camcorder.js`, `bulb.js`, `audio.js`, and `bench.js` (loaded only with `?bench`).
- Undeveloped: `case-file.js` (clues, chapters, texts), `notebook.js`, `view.js`, `haze.js`, `motes.js`, `trail.js`, `audio.js`, `music.js`.

See [CONTRIBUTING.md](CONTRIBUTING.md) for running, building assets, developer switches and the tools.

## Credits

- **Scene:** ["URBEX: Sanatorium Inside – Part01"](https://superspl.at/scene/8429e5e2) by Christoph Schindelar, licensed [CC BY-NC 4.0](http://creativecommons.org/licenses/by-nc/4.0/). Because of that licence, this project is **non-commercial**.
- **Renderer:** [Spark](https://sparkjs.dev) by World Labs, on [three.js](https://threejs.org).
- **Sound:** RESIDUE's breathing is ["breathing tired"](https://opengameart.org/content/breathing-tired) by mikeask (CC0). All other sound, including Undeveloped's music, is synthesised.
- **Story:** the stories, people and documents in both games are fiction.

## License

Gaussian Games is licensed under [CC BY 4.0](LICENSE). You can share, adapt and build on it for any purpose, as long as you credit it wherever you distribute or show it:

> Gaussian Games by Yanis Falaki – https://github.com/yanis-falaki/GaussianGames

That covers the code and original content only:
- **The scan** is not included and stays under its own licence, [CC BY-NC 4.0](http://creativecommons.org/licenses/by-nc/4.0/) (Christoph Schindelar). Anything that ships it must credit him and stay non-commercial.
- **The images** in `docs/` and `public/menu/` are renders of the scan, so the same licence applies to them.
- **The breathing sample** in `public/assets/audio/` is CC0.
