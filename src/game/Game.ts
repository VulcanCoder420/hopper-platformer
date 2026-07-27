import * as THREE from 'three';
import { CameraFollow } from './CameraFollow';
import { createScene, type SceneBundle } from './SceneSetup';
import { Input } from './Input';
import { COLORS, PLAYER, RENDER } from './config';
import {
  GameState,
  STARTING_LIVES,
  DEATH_OVERLAY_DURATION,
  LEVEL_COMPLETE_DURATION,
  GAME_OVER_DURATION,
} from './GameState';
import { audioManager } from '../audio/AudioManager';
import { clamp } from '../utils/math';
import { Player } from '../player/Player';
import { loadLevel, swapLevel, type LoadedLevel } from '../levels/LevelLoader';
import { disposeSurfaces } from '../levels/surfaces';
import { disposeAllSheets } from '../render/SpriteSheet';
import type { LevelDef } from '../levels/types';
import { level1 } from '../levels/level1';
import { level2 } from '../levels/level2';
import { EnemyManager } from '../enemies/EnemyManager';
import { CoinManager } from '../collectibles/CoinManager';
import { ParticleSystem } from '../fx/Particles';
import { ScreenShake } from '../fx/ScreenShake';
import { Juice } from '../fx/Juice';
import { PostFX } from '../fx/PostFX';
import { HUD } from '../ui/HUD';
import { Menu } from '../ui/Menu';
import { TouchControls } from '../ui/TouchControls';

const MAX_DT = 1 / 30;

/** Goal pole half-width for touch detection. */
const GOAL_HALF_W = 0.55;

/**
 * Main game owner: renderer, scene, camera, loop, levels, player, enemies,
 * collectibles, particles, juice, UI, and game-state machine.
 */
export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly sceneBundle: SceneBundle;
  readonly cameraFollow: CameraFollow;
  readonly input = new Input();
  readonly player: Player;
  readonly enemies = new EnemyManager();
  readonly coins = new CoinManager();
  readonly particles: ParticleSystem;
  readonly screenShake = new ScreenShake();
  readonly juice: Juice;
  readonly postFX: PostFX;
  readonly hud: HUD;
  readonly menu: Menu;
  readonly touch: TouchControls;

  /** Running score (coins, etc.). */
  score = 0;
  /** Remaining lives (starts at STARTING_LIVES). */
  lives = STARTING_LIVES;
  /** High-level flow state. */
  state: GameState = GameState.Menu;

  private readonly container: HTMLElement;
  private readonly clock = new THREE.Clock();
  private running = false;
  private rafId = 0;
  /**
   * Presentation clock for things that animate even behind a pause panel
   * (the flag flutter). Always advances.
   */
  private elapsed = 0;
  /** Accumulated play time while Playing (for HUD / victory). */
  private playTime = 0;
  /**
   * Clock for world animation that must stop when the world stops (coin bob).
   * Advances only on frames where the world is actually being simulated.
   */
  private worldTime = 0;

  private level: LoadedLevel;
  private readonly levels: LevelDef[] = [level1, level2];
  private levelIndex = 0;

  /** Brief invulnerability after a hurt respawn (seconds). */
  private hurtCooldown = 0;

  /** Timed transition after death / level complete / game over. */
  private stateTimer = 0;
  /**
   * Death sub-phase:
   * - 'flash' — brief ouch overlay
   * - 'gameover' — game-over panel (auto → menu or button)
   * - null — not in a death sequence
   */
  private deathPhase: 'flash' | 'gameover' | null = null;

  /** Previous frame shake offsets (peeled off before camera damp). */
  private lastShakeX = 0;
  private lastShakeY = 0;

  /** Lightweight follow adapter for CameraFollow (position-only). */
  private readonly cameraTarget = {
    position: new THREE.Vector3(),
  };

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.code === 'Escape') {
      e.preventDefault();
      this.togglePause();
    }
  };

  constructor(container: HTMLElement) {
    this.container = container;

    // No `antialias` here: everything is composited through PostFX's offscreen
    // targets, which carry their own MSAA — the default framebuffer's samples
    // would be paid for and then never drawn to.
    this.renderer = new THREE.WebGLRenderer({
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = RENDER.toneMappingExposure;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setClearColor(COLORS.skyHorizon, 1);
    container.appendChild(this.renderer.domElement);

    this.sceneBundle = createScene();

    // FX first so level/player draw over particles if needed
    this.particles = new ParticleSystem();
    this.sceneBundle.scene.add(this.particles.object3d);
    this.juice = new Juice(this.particles, this.screenShake);

    // Load level 1 geometry + solids (coins come from CoinManager)
    this.level = loadLevel(level1, this.sceneBundle.scene);

    const spawn = level1.spawn;
    this.player = new Player(spawn.x, spawn.y);
    this.player.setSolids(this.level.solids);
    this.sceneBundle.scene.add(this.player.object3d);

    // Coins
    this.coins.setScene(this.sceneBundle.scene);
    this.coins.setHooks({
      onCollect: (ev) => {
        if (this.state !== GameState.Playing) return;
        this.score += 1;
        this.sfxCoin();
        this.juice.coinCollect(ev.x, ev.y, ev.z);
      },
    });
    this.coins.spawnFromLevel(level1);

    // Enemies
    this.enemies.setScene(this.sceneBundle.scene);
    this.enemies.setSolids(this.level.solids);
    this.enemies.setHooks({
      onStomp: (enemy) => {
        this.sfxStomp();
        this.juice.enemyDeath(enemy.x, enemy.y + enemy.height * 0.45);
      },
      onPlayerHurt: () => this.handlePlayerHurt(),
    });
    this.enemies.spawnFromLevel(level1);

    // Audio + juice hooks
    this.player.onJump = () => {
      if (this.state !== GameState.Playing) return;
      audioManager.play('jump');
      audioManager.ensureGameplayMusic();
      const { x, y } = this.player.position;
      this.juice.jumpDust(x, y);
    };
    this.player.onLand = (impactVy) => {
      if (this.state !== GameState.Playing) return;
      audioManager.play('land');
      const { x, y } = this.player.position;
      this.juice.land(x, y, impactVy);
    };

    const aspect = container.clientWidth / Math.max(container.clientHeight, 1);
    this.cameraFollow = new CameraFollow(aspect);
    this.cameraTarget.position.set(spawn.x, spawn.y + 0.9, 0);
    this.cameraFollow.setTarget(this.cameraTarget);
    this.cameraFollow.setBounds({ ...level1.bounds });

    // Post-processing: bloom + color grade + vignette (subtle, 60fps-friendly)
    this.postFX = new PostFX(
      this.renderer,
      this.sceneBundle.scene,
      this.cameraFollow.camera,
      container.clientWidth,
      container.clientHeight,
      {
        bloomStrength: RENDER.bloomStrength,
        bloomRadius: RENDER.bloomRadius,
        bloomThreshold: RENDER.bloomThreshold,
        bloomSmoothWidth: RENDER.bloomSmoothWidth,
      },
    );

    // UI
    this.hud = new HUD(container);
    this.menu = new Menu(container, {
      onStart: () => this.beginGame(),
      onResume: () => this.resumeFromPause(),
      onRestart: () => this.beginGame(),
      onQuitToMenu: () => this.returnToMenu(),
      onVolumeChange: (v) => {
        audioManager.setMasterVolume(v);
      },
    });
    this.touch = new TouchControls(container, this.input, {
      onPause: () => this.togglePause(),
    });

    this.input.bind();
    audioManager.bindUnlock();
    audioManager.bindVolumeKeys();
    audioManager.loadAll();

    // Mobile: prevent bounce/scroll on the canvas itself
    container.addEventListener(
      'touchmove',
      (e) => {
        if (e.target === this.renderer.domElement || e.target === container) {
          e.preventDefault();
        }
      },
      { passive: false },
    );

    window.addEventListener('resize', this.onResize);
    window.addEventListener('keydown', this.onKeyDown);

    // Start on title menu — physics frozen until Start
    this.enterMenu();
  }

  // --- SFX ---

  sfxCoin(): void {
    audioManager.play('coin');
  }

  sfxStomp(): void {
    audioManager.play('stomp');
  }

  sfxDeath(): void {
    audioManager.play('death');
  }

  sfxFlag(): void {
    audioManager.play('flag');
  }

  get currentLevel(): LevelDef {
    return this.level.def;
  }

  get currentLevelIndex(): number {
    return this.levelIndex;
  }

  get solids() {
    return this.level.solids;
  }

  // --- State machine ---

  private enterMenu(): void {
    this.state = GameState.Menu;
    this.stateTimer = 0;
    this.deathPhase = null;
    this.hud.setVisible(false);
    this.touch.setPlaying(false);
    this.menu.showTitle(audioManager.getMasterVolume());
    audioManager.stopMusic();
  }

  private beginGame(): void {
    this.score = 0;
    this.lives = STARTING_LIVES;
    this.playTime = 0;
    this.levelIndex = 0;
    this.hurtCooldown = 0;
    this.stateTimer = 0;
    this.deathPhase = null;
    this.applyLevel(this.levels[0]!);
    this.state = GameState.Playing;
    this.menu.hide();
    this.hud.setVisible(true);
    this.touch.setPlaying(true);
    this.syncHud();
    audioManager.stopMusic();
    audioManager.ensureGameplayMusic();
  }

  private returnToMenu(): void {
    // Soft reset world to level 1 so menu backdrop looks right
    this.levelIndex = 0;
    this.applyLevel(this.levels[0]!);
    this.score = 0;
    this.lives = STARTING_LIVES;
    this.playTime = 0;
    this.enterMenu();
  }

  private togglePause(): void {
    if (this.state === GameState.Playing) {
      this.state = GameState.Paused;
      this.touch.setPlaying(false);
      this.menu.showPause(audioManager.getMasterVolume());
      this.hud.setVisible(true);
    } else if (this.state === GameState.Paused) {
      this.resumeFromPause();
    }
  }

  private resumeFromPause(): void {
    if (this.state !== GameState.Paused) return;
    this.state = GameState.Playing;
    this.menu.hide();
    this.hud.setVisible(true);
    this.touch.setPlaying(true);
  }

  /**
   * Load a level by index (0 = level1, 1 = level2) or LevelDef.
   * Respawn player at the level spawn point.
   */
  loadLevelByIndex(index: number): void {
    const i = ((index % this.levels.length) + this.levels.length) % this.levels.length;
    this.levelIndex = i;
    this.applyLevel(this.levels[i]!);
  }

  loadLevelDef(def: LevelDef): void {
    const idx = this.levels.findIndex((l) => l.id === def.id);
    if (idx >= 0) this.levelIndex = idx;
    this.applyLevel(def);
  }

  private applyLevel(def: LevelDef): void {
    // Rebuilding the same level tears down and re-uploads every mesh for nothing
    // (Start on the title screen, and Quit→Start, both land here on level 1).
    if (this.level.def.id !== def.id) {
      this.level = swapLevel(this.sceneBundle.scene, this.level, def);
    }
    this.player.setSolids(this.level.solids);
    this.player.setPosition(def.spawn.x, def.spawn.y);
    this.player.controller.resetMotionState(true);
    this.hurtCooldown = 0;
    this.enemies.setSolids(this.level.solids);
    this.enemies.spawnFromLevel(def);
    this.coins.spawnFromLevel(def);
    this.screenShake.reset();
    this.cameraFollow.setBounds({ ...def.bounds });
    this.cameraTarget.position.set(def.spawn.x, def.spawn.y + 0.85, 0);
    this.cameraFollow.setTarget(this.cameraTarget);
    if (this.state === GameState.Playing) {
      audioManager.ensureGameplayMusic();
    }
  }

  /** Respawn at level start (checkpoint/start). Snap camera to avoid lag. */
  private respawnAtStart(): void {
    const def = this.level.def;
    this.player.setPosition(def.spawn.x, def.spawn.y);
    // Clears the jump buffer too — a jump pressed during the death overlay would
    // otherwise fire the instant the player respawns.
    this.player.controller.resetMotionState(true);
    this.hurtCooldown = 1.15;
    this.screenShake.reset();
    this.lastShakeX = 0;
    this.lastShakeY = 0;
    // Re-spawn level enemies so a death doesn't soft-lock empty paths unfairly
    this.enemies.spawnFromLevel(def);
    this.cameraTarget.position.set(def.spawn.x, def.spawn.y + 0.85, 0);
    this.cameraFollow.setTarget(this.cameraTarget);
  }

  /**
   * Side-hit / hazard / fall: enter Dead state, lose a life.
   */
  private handlePlayerHurt(): void {
    if (this.state !== GameState.Playing) return;
    if (this.hurtCooldown > 0) return;
    this.triggerDeath();
  }

  private triggerDeath(): void {
    if (this.state !== GameState.Playing) return;

    this.lives = Math.max(0, this.lives - 1);
    this.sfxDeath();
    const { x, y } = this.player.position;
    this.juice.hurt(x, y + 0.6);
    this.player.visual.playHurt();

    this.player.controller.vx = 0;
    this.player.controller.vy = 0;

    this.state = GameState.Dead;
    this.deathPhase = 'flash';
    this.stateTimer = DEATH_OVERLAY_DURATION;
    this.touch.setPlaying(false);
    this.menu.showDeath(this.lives);
    this.syncHud();
  }

  /** Advance death flash → respawn or game-over panel. */
  private advanceDeathFlash(): void {
    if (this.lives <= 0) {
      this.deathPhase = 'gameover';
      this.stateTimer = GAME_OVER_DURATION;
      this.menu.showGameOver(this.score);
      return;
    }

    this.deathPhase = null;
    this.respawnAtStart();
    this.state = GameState.Playing;
    this.menu.hide();
    this.hud.setVisible(true);
    this.touch.setPlaying(true);
    this.syncHud();
  }

  private triggerLevelComplete(): void {
    if (this.state !== GameState.Playing) return;

    this.state = GameState.LevelComplete;
    this.stateTimer = LEVEL_COMPLETE_DURATION;
    this.player.controller.vx = 0;
    this.player.controller.vy = 0;
    this.touch.setPlaying(false);

    this.sfxFlag();
    // Stop gameplay BGM first so win track always starts cleanly (no restart race)
    audioManager.stopMusic();
    audioManager.playMusic('musicWin', false);

    const def = this.level.def;
    this.menu.showLevelComplete(this.levelIndex + 1, def.name, this.score);
    this.syncHud();
  }

  private finishLevelComplete(): void {
    const next = this.levelIndex + 1;
    if (next >= this.levels.length) {
      // Victory after final level
      this.state = GameState.Win;
      this.stateTimer = 0;
      this.hud.setVisible(false);
      this.touch.setPlaying(false);
      this.menu.showVictory({
        score: this.score,
        lives: this.lives,
        timeSeconds: this.playTime,
        levelsCleared: this.levels.length,
      });
      // The level-complete fanfare is already playing as a one-shot. Just flip it
      // to looping instead of restarting it, which was audibly re-triggering the
      // track two seconds in. Fall back to a fresh play if it already finished
      // (or never started, e.g. autoplay blocked) so Victory is never silent.
      if (
        audioManager.getCurrentMusicId() === 'musicWin' &&
        audioManager.isMusicPlaying()
      ) {
        audioManager.setMusicLoop(true);
      } else {
        audioManager.stopMusic();
        audioManager.playMusic('musicWin', true);
      }
      return;
    }

    this.levelIndex = next;
    this.applyLevel(this.levels[next]!);
    this.state = GameState.Playing;
    this.menu.hide();
    this.hud.setVisible(true);
    this.touch.setPlaying(true);
    audioManager.stopMusic();
    audioManager.ensureGameplayMusic();
    this.syncHud();
  }

  private touchesGoal(): boolean {
    const goal = this.level.def.goal;
    const poleH = goal.height ?? 5.2;
    const px = this.player.controller.x;
    const py = this.player.controller.y;
    const halfW = PLAYER.halfWidth;
    const height = PLAYER.height;

    const goalMinX = goal.x - GOAL_HALF_W;
    const goalMaxX = goal.x + GOAL_HALF_W;
    const goalMinY = goal.y;
    const goalMaxY = goal.y + poleH + 0.4;

    const pMinX = px - halfW;
    const pMaxX = px + halfW;
    const pMinY = py;
    const pMaxY = py + height;

    return (
      pMinX < goalMaxX &&
      pMaxX > goalMinX &&
      pMinY < goalMaxY &&
      pMaxY > goalMinY
    );
  }

  private syncHud(): void {
    this.hud.update({
      score: this.score,
      lives: this.lives,
      levelNumber: this.levelIndex + 1,
      levelName: this.level.def.name,
      timerSeconds: this.playTime,
    });
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.clock.start();
    this.loop();
  }

  stop(): void {
    this.running = false;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
  }

  dispose(): void {
    this.stop();
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('keydown', this.onKeyDown);
    this.input.unbind();
    this.touch.dispose();
    this.menu.dispose();
    this.hud.dispose();
    this.enemies.dispose();
    this.coins.dispose();
    this.particles.dispose();
    this.postFX.dispose();
    this.level.dispose();
    this.player.dispose();
    // Process-wide art caches, deliberately outlived by every level swap.
    disposeSurfaces();
    disposeAllSheets();
    audioManager.unload();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private onResize = (): void => {
    const w = this.container.clientWidth;
    const h = Math.max(this.container.clientHeight, 1);
    this.renderer.setSize(w, h);
    this.cameraFollow.setAspect(w / h);
    this.postFX.setSize(w, h);
  };

  private loop = (): void => {
    if (!this.running) return;
    this.rafId = requestAnimationFrame(this.loop);

    let dt = this.clock.getDelta();
    dt = clamp(dt, 0, MAX_DT);
    this.elapsed += dt;

    this.update(dt);
    this.render();
    this.input.endFrame();
  };

  private update(dt: number): void {
    // Keep volume slider in sync if [ ] keys change master
    if (
      this.state === GameState.Menu ||
      this.state === GameState.Paused
    ) {
      this.menu.syncVolume(audioManager.getMasterVolume());
    }

    // Timed overlays (death / level complete / game over auto-advance)
    if (this.state === GameState.Dead) {
      this.stateTimer -= dt;
      if (this.stateTimer <= 0) {
        if (this.deathPhase === 'flash') {
          this.advanceDeathFlash();
        } else if (this.deathPhase === 'gameover') {
          // Auto-return to menu after hold (buttons also work anytime)
          this.returnToMenu();
        }
      }
      // The death puff must keep playing out across the overlay hold.
      this.updatePresentation(dt, false, true);
      return;
    }

    if (this.state === GameState.LevelComplete) {
      this.stateTimer -= dt;
      if (this.stateTimer <= 0) {
        this.finishLevelComplete();
      }
      this.updatePresentation(dt, false, true);
      return;
    }

    if (this.state === GameState.Menu) {
      // Idle backdrop — coins spin and particles live so the title screen breathes.
      this.updatePresentation(dt, false, true);
      return;
    }

    if (this.state === GameState.Paused || this.state === GameState.Win) {
      // Genuinely frozen: no particle sim, no coin bob. Only the flag flutters,
      // which runs off `elapsed` and is deliberately always alive.
      this.updatePresentation(dt, false, false);
      return;
    }

    // --- Playing ---
    if (this.hurtCooldown > 0) {
      this.hurtCooldown = Math.max(0, this.hurtCooldown - dt);
    }

    this.playTime += dt;
    this.worldTime += dt;
    this.player.update(dt, this.input);

    // Coins are awarded before enemy contact can flip the state: a coin touched
    // on the same frame as a death was consumed with no score and never came back.
    this.coins.update(dt, this.worldTime);
    this.coins.collectOverlapping(this.player);

    this.enemies.update(dt);

    if (this.hurtCooldown <= 0) {
      this.enemies.resolvePlayer(this.player);
    }

    this.particles.update(dt);

    const def = this.level.def;
    const b = def.bounds;

    // Soft horizontal bounds
    if (this.player.controller.x < b.minX) {
      this.player.controller.x = b.minX;
      this.player.controller.vx = 0;
    } else if (this.player.controller.x > b.maxX) {
      this.player.controller.x = b.maxX;
      this.player.controller.vx = 0;
    }

    // Cull enemies that fell off the world (performance + cleanup)
    this.enemies.cullBelow(def.deathY - 2);

    // Death plane → death state
    if (this.player.controller.y < def.deathY) {
      // Snap above plane so we don't re-trigger every frame
      this.player.controller.y = def.deathY + 0.01;
      this.player.controller.vx = 0;
      this.player.controller.vy = 0;
      // triggerDeath owns juice / sfx (avoid double burst)
      this.triggerDeath();
      // animateWorld false on all three exits: coins and particles already
      // stepped once above, and stepping them again here double-speeds them on
      // every transition frame.
      this.updatePresentation(dt, true, false);
      this.syncHud();
      return;
    }

    // Flag / goal touch (only while playing; state guard inside trigger)
    if (this.touchesGoal()) {
      this.triggerLevelComplete();
      this.updatePresentation(dt, true, false);
      this.syncHud();
      return;
    }

    this.updatePresentation(dt, true, false);
    this.syncHud();
  }

  /**
   * Camera, parallax, accent lights, flag flutter.
   *
   * `followPlayer` false skips follow-target updates that depend on live play.
   * `animateWorld` true steps coins and particles here — callers on the Playing
   * path have already stepped them and must pass false.
   */
  private updatePresentation(
    dt: number,
    followPlayer: boolean,
    animateWorld: boolean,
  ): void {
    if (followPlayer) {
      const { x, y } = this.player.position;
      this.cameraTarget.position.set(x, y + 0.85, 0);
      this.cameraFollow.setTargetVelocityX(this.player.velocity.x);
    } else {
      this.cameraFollow.setTargetVelocityX(0);
    }

    this.cameraFollow.camera.position.x -= this.lastShakeX;
    this.cameraFollow.camera.position.y -= this.lastShakeY;
    this.cameraFollow.update(dt);

    this.screenShake.update(dt);
    this.lastShakeX = this.screenShake.offsetX;
    this.lastShakeY = this.screenShake.offsetY;
    this.cameraFollow.camera.position.x += this.lastShakeX;
    this.cameraFollow.camera.position.y += this.lastShakeY;

    // Keep the sky dome centred on the camera so its gradient never drifts, and
    // feed elapsed to the parallax so the cloud bands actually drift.
    this.sceneBundle.updateSky(this.cameraFollow.camera);
    this.level.parallax.update(
      this.cameraFollow.camera.position.x,
      this.elapsed,
    );

    // Flag cloth wave and vegetation wind run off `elapsed`, so they stay alive
    // behind menus and the pause panel.
    this.level.animateGoal(this.elapsed);
    this.level.scenery.update(this.elapsed);

    if (animateWorld) {
      this.worldTime += dt;
      this.coins.update(dt, this.worldTime);
      this.particles.update(dt);
    }

    // Move existing lights only — never recreate
    const { x, y } = this.player.position;
    this.sceneBundle.accent.position.set(x + 1.5, y + 3.5, 2.5);
    this.sceneBundle.sun.position.set(x + 16, 28, 12);
    this.sceneBundle.sun.target.position.set(x + 2, 0, 0);
    this.sceneBundle.sun.target.updateMatrixWorld();
  }

  private render(): void {
    this.postFX.render();
  }
}
