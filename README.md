# Hopper

**A stylish 2.5D browser platformer with tight jumps, juicy feedback, and full audio — playable on desktop and phone.**

Guide **Hopper** across sky-island stages: run, leap, collect coins, stomp **Bruisers** and **Skimmers**, and race the flag. Built in **TypeScript** with **three.js** and **Howler** — original characters and audio, no Nintendo IP.

[![Play Live](https://img.shields.io/badge/Play-Live_Demo-ffb060?style=for-the-badge)](https://YOUR-LIVE-DEMO-URL.example)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![three.js](https://img.shields.io/badge/three.js-000000?style=for-the-badge&logo=threedotjs&logoColor=white)](https://threejs.org/)
[![Vite](https://img.shields.io/badge/Vite-646CFF?style=for-the-badge&logo=vite&logoColor=white)](https://vitejs.dev/)
[![License](https://img.shields.io/badge/License-Open_Source-5eead4?style=for-the-badge)](#license)

---

## Live demo

> **Play in the browser:** [Vercel Deployment](https://hopper-platformer.vercel.app/)  

---

## Screenshots

<!-- Drop real assets under docs/ or assets/ and update the paths below. -->

| Menu / title | Gameplay | Mobile |
| :----------: | :------: | :----: |
| ![Title screen placeholder](docs/screenshots/title.png) | ![Gameplay placeholder](docs/screenshots/gameplay.png) | ![Mobile controls placeholder](docs/screenshots/mobile.png) |

**GIF (gameplay loop):**

![Hopper gameplay GIF placeholder](docs/screenshots/gameplay.gif)

---

## Features

- **Snappy platformer feel** — coyote time, jump buffer, variable jump height, asymmetric gravity
- **20 complete levels** — skill-gated campaign (meadow → sunset → cave → finale), Mario-style pacing without Nintendo IP
- **Crouch** — duck to squeeze through gaps too low to stand in, and jump straight out of a
  crouch. You never stand up into a ceiling: the crouch holds until there is headroom, so
  grabbing a **Bloom** in a tight corridor can't wedge you in the geometry
- **Prize blocks** — hit from below for coins, multi-coin windows, or **Bloom** power-ups; empty/used state after
- **Bloom super form** — grow pickup grants taller form + jump boost; first hit depowers instead of killing
- **Hand-rigged sprite animation** — Hopper is a 23-frame sheet (idle / run / jump / fall / land / hurt)
  generated at runtime from a parametric puppet: real knee bend, counter-swinging arms, and a run cycle
  whose playback rate tracks ground speed
- **Enemies** — ground **Bruisers** (patrol + stomp) and flying **Skimmers**, each with their own
  animated sheet and a stomp-squash death clip
- **Collectibles & score** — spinning coins, lives, level clear → victory summary
- **2.5D visuals** — three.js lighting, alpha-cutout silhouette shadows, extruded ridgeline parallax
  with atmospheric perspective, drifting clouds, soft bloom & vignette, MSAA
- **A world that grows** — low-poly trees, bushes, grass tufts, flowers and rocks, wind-swayed with
  per-instance phase, placed deterministically from the level data
- **Procedural everything** — every texture, sprite and sound is generated in code. No binary art assets.
- **Juice** — particles, screen shake, squash-and-stretch, landing dust, a real cloth wave on the goal flag
- **Full audio** — looping BGM + SFX (jump, land, coin, stomp, death, flag) via Howler
- **Desktop + mobile** — keyboard or multi-touch on-screen pads (move + jump together)
- **Zero-friction toolchain** — `npm install && npm run dev`

---

## Quick start

**Requirements:** Node.js (modern LTS) and a browser with WebGL.

```bash
npm install
npm run dev
```

Open the URL Vite prints (default **http://localhost:5173/**).

### Play on your phone (same Wi‑Fi)

```bash
npm run dev -- --host
```

Then open `http://<your-lan-ip>:5173/` on the phone. After **Start**, virtual **◀ ▶ / JUMP / RUN** controls appear.

### Production build

```bash
npm run build
npm run preview
```

| Script | Description |
|--------|-------------|
| `npm run dev` | Vite dev server + HMR |
| `npm run build` | Typecheck (`tsc`) + production bundle → `dist/` |
| `npm run preview` | Serve the production build |
| `npm run generate-audio` | Regenerate placeholder WAV SFX/BGM |

---

## Controls

| Action | Desktop | Touch |
|--------|---------|--------|
| **Move** | `A` / `D` or `←` / `→` | **◀** **▶** |
| **Crouch** | `S` / `↓` (crawl through low gaps; you can still jump) | **▼** |
| **Jump** | `Space` (hold for full height) | **JUMP** |
| **Sprint** | `Shift` | **RUN** |
| **Pause** | `Esc` | **❚❚** |
| **Volume** | Menu slider or `[` / `]` | Menu slider |

---

## Levels

Twenty stages teach one idea at a time (introduce → practice → expand → test):

| # | Name | Focus |
|---|------|--------|
| 1–7 | Meadow Gate … Cadence Hills | Jump, pipes, prize blocks, multi-path, **Bloom**, cadence |
| 8–12 | Ridge Climb … Momentum Run | Vertical routes, stairs, death gaps, flow |
| 13–17 | Cave Mouth … Pace Break Peak | Theme shift, multi-coin, tall climbs, pace breaks |
| 18–20 | Sunset Gauntlet … Flag Finale | Gauntlets, master fork, capstone |

**Win:** touch each level’s flag pole. Clear all 20 for the victory screen (score, lives, time).

---

## Tech stack

| Layer | Choice |
|-------|--------|
| Language | **TypeScript** |
| Rendering | **three.js** (WebGL, shadows, materials) |
| Post-FX | EffectComposer — Unreal bloom, color grade, vignette |
| Audio | **Howler.js** |
| Tooling | **Vite** + `tsc` |
| Physics | Custom AABB + sub-stepping (no external physics engine) |
| UI | Custom DOM (HUD, menus, touch controls) |

Not Unity, Godot, or Phaser — a lean custom game loop on WebGL.

For a deeper technical write-up (architecture, juice systems, fact sheet), see **[TECH.md](./TECH.md)**.

---

## Project layout

```
src/
  audio/          Howler manager + sound registry
  collectibles/   Coins
  enemies/        Bruiser, Skimmer + their procedural sprite art
  fx/             Particles, shake, juice, post-FX
  game/           Loop, input, camera, config, states, scene/lighting
  levels/         Level defs, loader, collision, parallax, scenery, surface textures
  player/         Controller + animated sprite (rig, clips, squash / stretch)
  render/         Sprite-sheet engine + Canvas2D painting toolkit
  ui/             HUD, menus, touch controls, styles
public/assets/audio/   Music + SFX
```

---

## License

**Open source.**  
No separate license file is committed yet — treat the project as open source for personal and educational use until a formal SPDX license (e.g. MIT) is added.

Original art direction and audio placeholders — **do not use Nintendo names, assets, or trademarks**.

---

<p align="center">
  <strong>Hopper</strong> — jump once, buffer twice, stomp forever.<br/>
  <sub>Built with TypeScript · three.js · Howler · Vite</sub>
</p>
