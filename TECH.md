# Hopper — Technical Project Brief

**Title:** Hopper (browser 2.5D platformer)  
**Package:** `hopper-platformer` v0.1.0  
**Genre:** Side-scrolling platformer (classic loop: run → jump → coins → stomp enemies → flag)

Original characters, art, and audio — **no Nintendo trademarks, names, or assets**.

---

## Language

| Layer | Technology |
|--------|------------|
| **Primary language** | **TypeScript** (ES modules) |
| **Runtime** | **JavaScript** in the browser (compiled/bundled by Vite) |
| **Markup / style** | HTML + CSS (UI overlays, HUD, touch pads) |
| **Tooling scripts** | Node.js (e.g. `scripts/generate-audio.mjs` for placeholder WAV SFX/BGM) |

There is **no Unity, Godot, Unreal, or Phaser**. The game is a **custom TypeScript game loop** on top of **WebGL**.

---

## Engine / framework / core libraries

Not a full commercial game engine — a **custom engine layer** built with:

| Role | Choice |
|------|--------|
| **3D / WebGL** | **three.js** (`^0.172.0`) — scene, meshes, lights, shadows, camera |
| **Post-processing** | three.js examples: `EffectComposer`, `UnrealBloomPass`, vignette, color correction, `OutputPass` |
| **Audio** | **Howler.js** (`^2.2.4`) — SFX + looping music, master volume, unlock-on-gesture |
| **Build / dev server** | **Vite** (`^6`) + **TypeScript** (`^5.7`) |
| **Physics / collision** | **Custom** AABB + sub-stepping (not Cannon/Ammo/Rapier) |
| **UI** | Custom DOM (menus, HUD, touch controls) |

**One-liner:**

> Hopper is a TypeScript browser platformer rendered with three.js, with Howler audio and a Vite toolchain — no heavy game engine.

---

## Third-party dependencies

### Runtime (`dependencies`)

| Package | Purpose |
|---------|---------|
| `three` | WebGL rendering, materials, shadows, post-FX helpers |
| `howler` | Cross-browser audio (music + SFX) |

### Dev only (`devDependencies`)

| Package | Purpose |
|---------|---------|
| `vite` | Dev server, HMR, production bundle |
| `typescript` | Typecheck (`tsc`) before build |
| `@types/three` | Type definitions for three.js |
| `@types/howler` | Type definitions for Howler |

**Not used:** React, Phaser, Cannon, GSAP, etc. Transitive packages (esbuild, rollup, …) come from Vite/npm and are not game logic.

**Assets:** procedural/placeholder `.wav` files under `public/assets/audio/` (regenerate with `npm run generate-audio`). Art direction is procedural meshes in code.

---

## Build & run

### Requirements

- **Node.js** (modern LTS recommended) and **npm**
- Any modern browser with **WebGL**

### Development

```bash
npm install
npm run dev
```

Default URL: `http://localhost:5173/`

### LAN / smartphone

```bash
npm run dev -- --host
```

Example: `http://192.168.x.x:5173/` (same Wi‑Fi as the host machine).  
On phone: after **Start**, on-screen **◀ ▶ / JUMP / RUN / pause** controls appear.

### Production

```bash
npm run build    # tsc && vite build → dist/
npm run preview  # serve the production build
```

### Extra scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Vite dev server |
| `npm run build` | Typecheck + production bundle |
| `npm run preview` | Preview production build |
| `npm run generate-audio` | Regenerate placeholder WAV SFX/BGM |

---

## Folder structure

```
PlatformerGame/
├── index.html              # Shell, mobile viewport, #app
├── package.json
├── package-lock.json
├── vite.config.ts
├── tsconfig.json
├── README.md               # Player-facing docs
├── TECH.md                 # This file — technical brief
├── scripts/
│   └── generate-audio.mjs  # Procedural WAV generation
├── public/
│   └── assets/
│       └── audio/          # Music + SFX (Howler loads these)
├── dist/                   # Production output (after build)
└── src/
    ├── main.ts             # Boot Game
    ├── audio/              # AudioManager, sound IDs
    ├── collectibles/       # Coins
    ├── enemies/            # Bruiser (ground), Skimmer (flyer)
    ├── fx/                 # Particles, shake, juice, PostFX
    ├── game/               # Loop, input, camera, config, states
    ├── levels/             # Defs, loader, collision, parallax
    ├── player/             # Controller + visual (squash/stretch)
    ├── ui/                 # HUD, menus, touch controls, CSS
    └── utils/              # Math helpers
```

Modular by domain: **player / levels / enemies / audio / fx / ui** under a single `Game` owner.

---

## Notable technical implementation

### 1. Polished platformer feel (custom controller)

- **Coyote time** — short grace after leaving a ledge  
- **Jump buffer** — early jump still counts  
- **Variable jump height** — release cuts upward velocity  
- **Asymmetric gravity** — snappier falls than rises  
- **Accel/decel + air control** — distinct ground vs air  
- **AABB collision** with **sub-stepping** to reduce tunneling at high speed  

### 2. 2.5D presentation in three.js

- Side-scroller camera (perspective, damped follow + velocity look-ahead)  
- Directional + ambient/hemisphere lighting, **real-time shadows** (PCF soft)  
- **Parallax** background layers  
- Stylized procedural characters/platforms (`MeshStandardMaterial`)  

### 3. Cinematic post stack

`EffectComposer` pipeline:

1. Scene render  
2. Subtle **UnrealBloomPass**  
3. Mild **color correction**  
4. **Vignette**  
5. **OutputPass** (tone map / color space)

Tuned for readability and mid-hardware ~60fps — bloom is decorative, not blinding.

### 4. Full audio system (Howler)

- Looping BGM that **does not restart awkwardly** when re-entering the same track  
- SFX: jump, land, coin, stomp, death, flag  
- Master volume (menu slider + `[` / `]` keys)  
- **Unlock on first gesture** (browser autoplay policy)  
- Placeholder WAVs generated by a small Node script  

### 5. Game feel (“juice”)

- Particle bursts (coins, death, jump dust, land impact)  
- Trauma-style **screen shake**  
- Player **squash & stretch** on land/jump  
- Coordinated feedback via a small `Juice` helper  

### 6. Content & game loop

- **Two full levels** — Meadow Run, Ridge Climb  
- Ground **Bruiser** + flying **Skimmer**, stomp-from-above  
- Coins, score, **lives**, death/respawn, flag → level complete → victory  
- State machine: `Menu` → `Playing` → `Paused` → `Dead` → `LevelComplete` → `Win`  

### 7. Mobile-first controls

- On-screen **◀ ▶ / JUMP / RUN / pause**  
- **Multi-touch** (move + jump together) via pointer events  
- Viewport locked against pinch-zoom; safe-area aware layout  
- Same codebase for desktop keyboard + phone touch  

### 8. Clean architecture

- Single `Game` class owns loop, systems, and UI  
- Data-driven levels (`LevelDef` → loader → solids + spawns)  
- Explicit dispose paths for levels, particles, and renderer  

---

## Controls

| Action | Desktop | Touch (phone) |
|--------|---------|----------------|
| Move | **A / D** or **← / →** | **◀ ▶** |
| Jump | **Space** (hold for full height) | **JUMP** |
| Sprint | **Shift** | **RUN** |
| Pause | **Esc** | **❚❚** button |
| Master volume | Menu slider or **[** / **]** | Menu slider |
| Mute (dev) | **M** | — |

---

## Levels

| # | Name | Goal |
|---|------|------|
| 1 | **Meadow Run** | Learn run, jump, stomp, coins. Comfortable gaps (~1–2 min first pass). |
| 2 | **Ridge Climb** | Tighter jumps, pipes, vertical routing, denser threats. Final flag wins the run. |

**Win condition:** touch the goal flag on each level; clear both for the victory summary (score, lives, time).

---

## Copy-paste: release-post blurb

> We shipped **Hopper** — a Mario-inspired (but fully original) platformer that runs in any modern browser.  
> **Stack:** TypeScript · three.js · Howler · Vite  
> **Feel:** coyote jumps, stompable enemies, coins, two levels, juice (shake, particles, bloom)  
> **Play:** desktop keys or phone virtual pads over LAN  
> **Run:** `npm install && npm run dev`

---

## Quick fact sheet

| Question | Answer |
|----------|--------|
| Language | TypeScript → browser JS |
| Engine | Custom + **three.js** (not Unity/Phaser) |
| Main libs | `three`, `howler` |
| Build tool | Vite + `tsc` |
| Run | `npm install && npm run dev` |
| Platforms | Desktop + mobile browsers (WebGL) |
| Levels | 2 playable stages |
| Audio | Howler + generated WAV placeholders |
| Physics | Custom AABB + coyote/buffer jump |
| Post-FX | Bloom, vignette, color correction |
| Mobile | On-screen multi-touch controls |

---

## Related docs

- Player-facing overview and controls: [`README.md`](./README.md)
