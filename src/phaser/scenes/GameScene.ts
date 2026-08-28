import Phaser from 'phaser';
import { GAME_CONFIG } from '../../simulation/config';
import {
  getBrickDangerDepthProgress,
  getDangerVignetteTarget,
  isDangerBrick,
  smoothDangerIntensity,
} from '../../simulation/dangerPresentation';
import { continueLifeLost, resolveFinalBallLoss } from '../../simulation/gameFlow';
import { createInitialGameState, type GameState } from '../../simulation/gameState';
import {
  acquirePower,
  banPowerChoice,
  prepareNextPowerSelection,
  rerollPowerChoices,
  type PowerId,
} from '../../simulation/powers';
import {
  SimulationStepOutcome,
  stepSimulation,
  type SimulationInput,
} from '../../simulation/simulation';
import {
  createSessionState,
  beginLevelUpSlowdown,
  beginLevelUpSpeedup,
  buildToPause,
  enterBuild,
  enterGameOver,
  enterWin,
  enterLevelUp,
  finishLevelUpSpeedup,
  GamePhase,
  isSimulationRunning,
  launchReadyBall,
  leaveBuild,
  pauseManually,
  resumeManualPause,
  type SessionState,
} from '../../simulation/sessionState';
import { GameInput } from '../input/GameInput';
import { RenderQualityManager } from '../rendering/RenderQualityManager';
import { BuildOverlay } from '../ui/BuildOverlay';
import { PauseMenu } from '../ui/PauseMenu';
import { PowerChoiceOverlay } from '../ui/PowerChoiceOverlay';

const PROJECTILE_COLORS = { GUN: 0xe7ecf3, ELECTRIC: 0xffd54f, MISSILE: 0xff8a3d } as const;
const FIRE_EFFECT_COLOR = 0xef5350;
const WIND_EFFECT_COLOR = 0x76a982;
const DANGER_VIGNETTE_TEXTURE_KEY = 'danger-vignette-gradient';
const HUD_LAYOUT = {
  rowCenterY: GAME_CONFIG.height - 30,
  leftPadding: 52,
  xpBarCenterX: GAME_CONFIG.width / 2,
  xpBarWidth: 320,
  xpBarHeight: 8,
  groupGap: 24,
} as const;

export class GameScene extends Phaser.Scene {
  private state!: GameState;
  private session!: SessionState;
  private gameInput!: GameInput;
  private renderQuality!: RenderQualityManager;
  private graphics!: Phaser.GameObjects.Graphics;
  private dangerGraphics!: Phaser.GameObjects.Graphics;
  private dangerVignette!: Phaser.GameObjects.Image;
  private readonly ballVisuals = new Map<number, Phaser.GameObjects.Arc>();
  private readonly levelUpGhosts = new Map<number, Array<{ x: number; y: number }>>();
  private survivalTimerText!: Phaser.GameObjects.Text;
  private livesText!: Phaser.GameObjects.Text;
  private progressionText!: Phaser.GameObjects.Text;
  private xpBarFill!: Phaser.GameObjects.Rectangle;
  private pauseHintText!: Phaser.GameObjects.Text;
  private pauseShade!: Phaser.GameObjects.Rectangle;
  private statusShade!: Phaser.GameObjects.Rectangle;
  private statusText!: Phaser.GameObjects.Text;
  private pauseMenu!: PauseMenu;
  private powerChoiceOverlay!: PowerChoiceOverlay;
  private buildOverlay!: BuildOverlay;
  private removeDisplayModeListener?: () => void;
  private displayMode: DisplayMode = 'WINDOWED';
  private accumulator = 0;
  private dangerVignetteIntensity = 0;
  private dangerEffectElapsedSeconds = 0;
  private readonly simulationInput: SimulationInput = {
    movementAxis: 0,
    mouseDisplacement: 0,
    speedMultiplier: 1,
  };
  private lastDisplayedSurvivalSecond = -1;
  private lastHudLevel = -1;
  private lastHudXp = -1;

  constructor() { super('GameScene'); }

  create(): void {
    this.state = createInitialGameState();
    this.session = createSessionState();
    this.graphics = this.add.graphics().setDepth(0);
    this.dangerVignette = this.createDangerVignette().setDepth(0.5).setAlpha(0);
    this.dangerGraphics = this.add.graphics().setDepth(0.75);
    this.renderQuality = new RenderQualityManager(this);
    this.gameInput = new GameInput(
      this,
      () => isSimulationRunning(this.session),
      (code) => this.handleShellKey(code),
      () => this.pauseIfRunning(),
      () => this.handlePrimaryPointerDown(),
    );
    const xpBarLeft = HUD_LAYOUT.xpBarCenterX - HUD_LAYOUT.xpBarWidth / 2;
    const xpBarRight = HUD_LAYOUT.xpBarCenterX + HUD_LAYOUT.xpBarWidth / 2;
    this.survivalTimerText = this.renderQuality.addText(
      xpBarRight + HUD_LAYOUT.groupGap,
      HUD_LAYOUT.rowCenterY,
      '0:00', {
      color: '#aeb8c8', fontFamily: 'Consolas, monospace', fontSize: '16px', fontStyle: 'bold',
    }).setOrigin(0, 0.5).setDepth(10);
    this.livesText = this.renderQuality.addText(HUD_LAYOUT.leftPadding, HUD_LAYOUT.rowCenterY, '', {
      color: '#d4dbe5', fontFamily: 'Consolas, monospace', fontSize: '16px', fontStyle: 'bold',
    }).setOrigin(0, 0.5).setDepth(10);
    this.progressionText = this.renderQuality.addText(
      xpBarLeft - HUD_LAYOUT.groupGap,
      HUD_LAYOUT.rowCenterY,
      '', {
      color: '#d4dbe5', fontFamily: 'Consolas, monospace', fontSize: '14px', fontStyle: 'bold',
    }).setOrigin(1, 0.5).setDepth(10);
    this.add.rectangle(
      HUD_LAYOUT.xpBarCenterX,
      HUD_LAYOUT.rowCenterY,
      HUD_LAYOUT.xpBarWidth,
      HUD_LAYOUT.xpBarHeight,
      0x273243,
    ).setDepth(10);
    this.xpBarFill = this.add.rectangle(
      xpBarLeft,
      HUD_LAYOUT.rowCenterY,
      HUD_LAYOUT.xpBarWidth,
      HUD_LAYOUT.xpBarHeight,
      0x78c6d0,
    )
      .setOrigin(0, 0.5).setDepth(11);
    this.pauseHintText = this.renderQuality.addText(GAME_CONFIG.width - 54, 690, 'ESC — PAUSE', {
      color: '#8491a6', fontFamily: 'Consolas, monospace', fontSize: '14px',
    }).setOrigin(1, 0).setDepth(10);
    this.pauseShade = this.add.rectangle(0, 0, GAME_CONFIG.width, GAME_CONFIG.height, 0x080a0f, 0.58)
      .setOrigin(0)
      .setDepth(20)
      .setVisible(false);
    this.statusShade = this.add.rectangle(0, 0, GAME_CONFIG.width, GAME_CONFIG.height, 0x080a0f, 0.4)
      .setOrigin(0)
      .setDepth(20)
      .setVisible(false);
    this.statusText = this.renderQuality.addText(GAME_CONFIG.width / 2, GAME_CONFIG.height / 2, '', {
      align: 'center', color: '#f0eee6', fontFamily: 'Arial, sans-serif', fontSize: '40px', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(21).setVisible(false);
    this.pauseMenu = new PauseMenu(this, this.renderQuality, {
      start: () => this.startRun(),
      resume: () => this.resumeGame(),
      setDisplayMode: (mode) => void this.changeDisplayMode(mode),
      restart: () => this.restartRun(),
      quit: () => void window.desktop?.quit(),
    });
    this.powerChoiceOverlay = new PowerChoiceOverlay(
      this, this.renderQuality,
      (id) => this.selectPower(id),
      () => this.rerollPowers(),
      (id) => this.banPower(id),
    );
    this.buildOverlay = new BuildOverlay(this, this.renderQuality);
    if (window.desktop) {
      void window.desktop.getDisplayMode().then((mode) => {
        this.displayMode = mode;
        this.pauseMenu.setDisplayMode(mode);
      });
      this.removeDisplayModeListener = window.desktop.onDisplayModeChanged((mode) => {
        this.displayMode = mode;
        this.pauseMenu.setDisplayMode(mode);
      });
    }
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.gameInput.destroy();
      for (const visual of this.ballVisuals.values()) visual.destroy();
      this.ballVisuals.clear();
      this.renderQuality.destroy();
      this.removeDisplayModeListener?.();
    });
    this.updateLivesText();
    this.updateProgressionHud();
    this.applyPhasePresentation();
    this.drawGame();
    this.updateSurvivalTimerText();
  }

  update(_time: number, deltaMilliseconds: number): void {
    if (!isSimulationRunning(this.session)) {
      this.accumulator = 0;
      return;
    }

    const frameSeconds = Math.min(deltaMilliseconds / 1000, GAME_CONFIG.maxFrameSeconds);
    this.dangerEffectElapsedSeconds += frameSeconds;
    const worldTimeScale = this.getWorldTimeScale();
    this.accumulator += frameSeconds;
    const stepCount = Math.floor(this.accumulator / GAME_CONFIG.fixedStepSeconds);
    if (stepCount === 0) {
      this.advanceLevelUpTransition(frameSeconds);
      this.updateDangerVignette(frameSeconds);
      this.drawGame();
      return;
    }
    this.gameInput.readSimulationInput(this.simulationInput);
    this.simulationInput.mouseDisplacement /= stepCount;
    while (this.accumulator >= GAME_CONFIG.fixedStepSeconds) {
      const outcome = stepSimulation(
        this.state,
        this.simulationInput,
        GAME_CONFIG.fixedStepSeconds,
        GAME_CONFIG.fixedStepSeconds * worldTimeScale,
      );
      this.accumulator -= GAME_CONFIG.fixedStepSeconds;
      if (outcome === SimulationStepOutcome.BrickOverflow) {
        this.clearLevelUpTransitionGhosts();
        enterGameOver(this.session);
        this.applyPhasePresentation();
        break;
      }
      if (outcome === SimulationStepOutcome.Win) {
        this.clearLevelUpTransitionGhosts();
        enterWin(this.session);
        this.applyPhasePresentation();
        break;
      }
      if (outcome === SimulationStepOutcome.FinalBallLost) {
        this.handleFinalBallLost();
        break;
      }
      if (this.session.phase === GamePhase.Running && this.state.powers.pendingSelections > 0) {
        this.beginLevelUpSlowdown();
      }
    }
    this.advanceLevelUpTransition(frameSeconds);
    this.updateDangerVignette(frameSeconds);
    this.drawGame();
    this.updateProgressionHud();
    this.updateSurvivalTimerText();
  }

  private applyPhasePresentation(): void {
    const running = isSimulationRunning(this.session);
    const menuMode = this.getMenuMode();
    this.accumulator = 0;
    if (running) this.gameInput.enterRunning();
    else this.gameInput.enterPaused();
    this.pauseShade.setVisible(menuMode !== null);
    this.pauseHintText.setVisible(running);
    if (menuMode) this.pauseMenu.show(menuMode);
    else this.pauseMenu.hide();
    if (this.session.phase === GamePhase.LevelUp) {
      this.powerChoiceOverlay.show(this.state, true, 1);
    } else if (this.session.phase === GamePhase.LevelUpSlowdown) {
      this.powerChoiceOverlay.show(this.state, false, this.getLevelUpOverlayOpacity());
    } else if (this.session.phase === GamePhase.LevelUpSpeedup) {
      this.powerChoiceOverlay.setPresentation(this.getLevelUpOverlayOpacity(), false);
    } else {
      this.powerChoiceOverlay.hide();
    }
    if (this.session.phase === GamePhase.Build) this.buildOverlay.show(this.state);
    else this.buildOverlay.hide();
    const statusMessage = this.getStatusMessage();
    this.statusShade.setVisible(statusMessage !== null);
    this.statusText.setText(statusMessage ?? '').setVisible(statusMessage !== null);
    document.body.classList.toggle('game-paused', !running);
    this.drawGame();
  }

  private pauseIfRunning(): void {
    if (!isSimulationRunning(this.session)) return;
    pauseManually(this.session);
    this.applyPhasePresentation();
  }

  private resumeGame(): void {
    resumeManualPause(this.session);
    this.applyPhasePresentation();
  }

  private startRun(): void {
    if (this.session.phase !== GamePhase.Ready) return;
    launchReadyBall(this.session);
    this.applyPhasePresentation();
  }

  private restartRun(): void {
    this.clearLevelUpTransitionGhosts();
    this.state = createInitialGameState();
    this.session = createSessionState();
    launchReadyBall(this.session);
    this.updateLivesText();
    this.updateProgressionHud();
    this.applyPhasePresentation();
  }

  private handleShellKey(code: string): void {
    if (code === 'F11') {
      void this.toggleDisplayMode();
      return;
    }
    if (this.session.phase === GamePhase.Ready) {
      if (this.pauseMenu.hasConfirmation()) this.handleConfirmationKey(code);
      else if (code === 'Space') this.startRun();
      else if (code === 'Enter' || code === 'NumpadEnter') this.pauseMenu.activateFocused();
      else this.navigatePauseMenu(code);
      return;
    }
    if (isSimulationRunning(this.session)) {
      if (code === 'Tab') {
        if (this.session.phase === GamePhase.Running) {
          enterBuild(this.session);
          this.applyPhasePresentation();
        }
      } else if (['Escape', 'Enter', 'NumpadEnter'].includes(code)) {
        this.pauseIfRunning();
      }
      return;
    }
    if (this.session.phase === GamePhase.LifeLost) {
      if (code === 'Space') this.continueLifeLostAttempt();
      return;
    }
    if (this.session.phase === GamePhase.LevelUp) {
      if (code === 'Enter' || code === 'NumpadEnter') this.powerChoiceOverlay.activateFocused();
      else if (code === 'KeyR') this.rerollPowers();
      else if (['ArrowLeft', 'ArrowUp', 'KeyA', 'KeyW'].includes(code)) this.powerChoiceOverlay.move(-1);
      else if (['ArrowRight', 'ArrowDown', 'KeyD', 'KeyS'].includes(code)) this.powerChoiceOverlay.move(1);
      return;
    }
    if (this.session.phase === GamePhase.Build) {
      if (code === 'Tab') {
        leaveBuild(this.session);
        this.applyPhasePresentation();
      } else if (code === 'Escape') {
        buildToPause(this.session);
        this.applyPhasePresentation();
      }
      return;
    }
    if (this.pauseMenu.hasConfirmation()) {
      this.handleConfirmationKey(code);
      return;
    }
    if (this.session.phase === GamePhase.GameOver || this.session.phase === GamePhase.Win) {
      if (code === 'Enter' || code === 'NumpadEnter') this.pauseMenu.activateFocused();
      else this.navigatePauseMenu(code);
      return;
    }
    if (code === 'Space' || code === 'Tab') this.resumeGame();
    else if (code === 'Enter' || code === 'NumpadEnter') this.pauseMenu.activateFocused();
    else this.navigatePauseMenu(code);
  }

  private handleConfirmationKey(code: string): void {
    if (code === 'Escape') this.pauseMenu.cancelConfirmation();
    else if (code === 'Enter' || code === 'NumpadEnter') this.pauseMenu.activateFocused();
    else this.navigatePauseMenu(code);
  }

  private handlePrimaryPointerDown(): boolean {
    if (this.session.phase !== GamePhase.LifeLost) return false;
    this.continueLifeLostAttempt();
    return true;
  }

  private selectPower(id: PowerId): void {
    if (this.session.phase !== GamePhase.LevelUp || !acquirePower(this.state, id)) return;
    if (prepareNextPowerSelection(this.state.powers)) {
      this.powerChoiceOverlay.show(this.state);
      return;
    }
    beginLevelUpSpeedup(this.session);
    this.applyPhasePresentation();
  }

  private rerollPowers(): void {
    if (this.session.phase !== GamePhase.LevelUp || !rerollPowerChoices(this.state.powers)) return;
    this.powerChoiceOverlay.show(this.state);
  }

  private banPower(id: PowerId): void {
    if (this.session.phase !== GamePhase.LevelUp || !banPowerChoice(this.state.powers, id)) return;
    if (this.state.powers.currentChoices.some((choice) => choice !== null)) {
      this.powerChoiceOverlay.show(this.state);
      return;
    }
    beginLevelUpSpeedup(this.session);
    this.applyPhasePresentation();
  }

  private continueLifeLostAttempt(): void {
    if (!continueLifeLost(this.state, this.session)) return;
    this.applyPhasePresentation();
  }

  private getMenuMode(): 'START' | 'PAUSE' | 'GAME_OVER' | 'WIN' | null {
    if (this.session.phase === GamePhase.Ready) return 'START';
    if (this.session.phase === GamePhase.Paused) return 'PAUSE';
    if (this.session.phase === GamePhase.GameOver) return 'GAME_OVER';
    if (this.session.phase === GamePhase.Win) return 'WIN';
    return null;
  }

  private navigatePauseMenu(code: string): void {
    if (code === 'ArrowUp' || code === 'KeyW') this.pauseMenu.moveVertical(-1);
    else if (code === 'ArrowDown' || code === 'KeyS') this.pauseMenu.moveVertical(1);
    else if (code === 'ArrowLeft' || code === 'KeyA') this.pauseMenu.moveHorizontal(-1);
    else if (code === 'ArrowRight' || code === 'KeyD') this.pauseMenu.moveHorizontal(1);
  }

  private async toggleDisplayMode(): Promise<void> {
    if (!window.desktop) {
      this.displayMode = this.displayMode === 'WINDOWED' ? 'FULLSCREEN' : 'WINDOWED';
      this.pauseMenu.setDisplayMode(this.displayMode);
      return;
    }
    await this.performDisplayTransition(() => window.desktop!.toggleDisplayMode());
  }

  private async changeDisplayMode(mode: DisplayMode): Promise<void> {
    if (!window.desktop) {
      this.displayMode = mode;
      this.pauseMenu.setDisplayMode(mode);
      return;
    }
    await this.performDisplayTransition(() => window.desktop!.setDisplayMode(mode));
  }

  private async performDisplayTransition(change: () => Promise<DisplayMode>): Promise<void> {
    this.gameInput.beginDisplayTransition();
    try {
      this.displayMode = await change();
      this.pauseMenu.setDisplayMode(this.displayMode);
    } finally {
      this.gameInput.endDisplayTransition();
    }
  }

  private drawGame(): void {
    const graphics = this.graphics.clear();
    this.dangerGraphics.clear();
    const field = GAME_CONFIG.playfield;
    const wall = field.wallThickness;
    graphics.fillStyle(0x39465a);
    graphics.fillRect(field.left - wall, field.top - wall, wall, field.bottom - field.top);
    graphics.fillRect(field.right, field.top - wall, wall, field.bottom - field.top);
    graphics.fillRect(field.left - wall, field.top - wall, field.right - field.left + wall * 2, wall);

    for (const column of this.state.brickField.columns) {
      for (const brick of column) {
        const color = GAME_CONFIG.rendering.brickSpeedClassColors[brick.speedClass];
        graphics.fillStyle(color);
        if (brick.y < field.top) {
          const visibleHeight = brick.y + brick.height - field.top;
          if (visibleHeight > 0) graphics.fillRect(brick.x, field.top, brick.width, visibleHeight);
        } else {
          graphics.fillRoundedRect(brick.x, brick.y, brick.width, brick.height, 3);
        }
      }
    }
    for (const projectile of this.state.projectiles) {
      graphics.lineStyle(3, PROJECTILE_COLORS[projectile.kind], 1);
      const speed = Math.hypot(projectile.velocity.x, projectile.velocity.y);
      const directionX = speed > 0 ? projectile.velocity.x / speed : 0;
      const directionY = speed > 0 ? projectile.velocity.y / speed : -1;
      graphics.lineBetween(
        projectile.x,
        projectile.y,
        projectile.x - directionX * GAME_CONFIG.powers.projectileLength,
        projectile.y - directionY * GAME_CONFIG.powers.projectileLength,
      );
    }
    graphics.lineStyle(4, FIRE_EFFECT_COLOR, 0.75);
    for (const effect of this.state.fireEffects) {
      graphics.lineBetween(effect.x1, effect.y, effect.x2, effect.y);
      for (const y of effect.additionalYs ?? []) graphics.lineBetween(effect.x1, y, effect.x2, y);
    }
    graphics.lineStyle(4, WIND_EFFECT_COLOR, 0.75);
    for (const effect of this.state.windEffects) {
      if (effect.topHalfWidth === undefined) graphics.lineBetween(effect.x, effect.y1, effect.x, effect.y2);
      else {
        graphics.lineBetween(effect.x - effect.topHalfWidth, effect.y1, effect.x + effect.topHalfWidth, effect.y1);
        graphics.lineBetween(effect.x - effect.topHalfWidth, effect.y1, effect.x, effect.y2);
        graphics.lineBetween(effect.x + effect.topHalfWidth, effect.y1, effect.x, effect.y2);
      }
    }
    this.drawDangerBricks(field.top);
    const paddle = this.state.paddle;
    graphics.fillStyle(0x78c6d0);
    graphics.fillRoundedRect(paddle.x - paddle.width / 2, paddle.y - paddle.height / 2, paddle.width, paddle.height, 6);
    if (!isSimulationRunning(this.session) || this.session.phase === GamePhase.LevelUpSlowdown) {
      for (const ball of this.state.balls) {
        const history = ball.positionHistory.slice(-GAME_CONFIG.levelUpTransition.maxVisibleTrajectoryGhosts);
        const historyLength = history.length;
        for (let index = 0; index < historyLength; index += 1) {
          const point = history[index];
          const recency = (index + 1) / historyLength;
          graphics.fillStyle(0xf0eee6, 0.05 + recency * 0.25);
          graphics.fillCircle(point.x, point.y, ball.radius * (0.55 + recency * 0.25));
        }
      }
    }
    if (this.session.phase === GamePhase.LevelUpSpeedup) this.drawContractingLevelUpGhosts(graphics);
    this.syncBallVisuals();
  }

  private drawDangerBrickEffects(
    graphics: Phaser.GameObjects.Graphics,
    brick: GameState['brickField']['columns'][number][number],
    color: number,
  ): void {
    const progress = getBrickDangerDepthProgress(brick);
    const rendering = GAME_CONFIG.rendering;
    const expansion = 1 + rendering.dangerGlowMaximumExpansion * progress;
    const localIntensity = 0.18 + progress * 0.82;
    const glowAlpha = rendering.dangerGlowMaximumAlpha * localIntensity;
    for (let layer = 3; layer >= 1; layer -= 1) {
      const layerExpansion = expansion * layer / 3;
      graphics.fillStyle(color, glowAlpha * (4 - layer) / 6);
      graphics.fillRoundedRect(
        brick.x - layerExpansion,
        brick.y - layerExpansion,
        brick.width + layerExpansion * 2,
        brick.height + layerExpansion * 2,
        4 + layer,
      );
    }

    let phaseSeed = 0;
    for (let index = 0; index < brick.id.length; index += 1) phaseSeed += brick.id.charCodeAt(index);
    const vibration = Math.sin(
      this.dangerEffectElapsedSeconds * Math.PI * 2 * rendering.dangerAberrationVibrationHz
        + phaseSeed * 0.37,
    ) * rendering.dangerAberrationVibrationAmplitude * localIntensity;
    const offset = 0.35 + rendering.dangerAberrationMaximumOffset * progress + vibration;
    const aberrationAlpha = rendering.dangerAberrationMaximumAlpha * localIntensity;
    if (offset <= 0 || aberrationAlpha <= 0) return;
    graphics.fillStyle(0xff6b72, aberrationAlpha);
    graphics.fillRoundedRect(brick.x - offset, brick.y, brick.width, brick.height, 3);
    graphics.fillStyle(0x66d9e8, aberrationAlpha);
    graphics.fillRoundedRect(brick.x + offset, brick.y, brick.width, brick.height, 3);
  }

  private drawDangerBricks(fieldTop: number): void {
    const graphics = this.dangerGraphics;
    for (const column of this.state.brickField.columns) {
      for (const brick of column) {
        if (!isDangerBrick(brick)) continue;
        const color = GAME_CONFIG.rendering.brickSpeedClassColors[brick.speedClass];
        this.drawDangerBrickEffects(graphics, brick, color);
        graphics.fillStyle(color);
        if (brick.y < fieldTop) {
          const visibleHeight = brick.y + brick.height - fieldTop;
          if (visibleHeight > 0) graphics.fillRect(brick.x, fieldTop, brick.width, visibleHeight);
        } else {
          graphics.fillRoundedRect(brick.x, brick.y, brick.width, brick.height, 3);
        }
      }
    }
  }

  private updateDangerVignette(deltaSeconds: number): void {
    const bricks = this.state.brickField.columns.flat();
    const target = getDangerVignetteTarget(bricks);
    this.dangerVignetteIntensity = smoothDangerIntensity(
      this.dangerVignetteIntensity,
      target,
      deltaSeconds,
    );
    this.dangerVignette.setAlpha(
      GAME_CONFIG.rendering.dangerVignetteMaximumAlpha * this.dangerVignetteIntensity,
    );
  }

  private createDangerVignette(): Phaser.GameObjects.Image {
    if (!this.textures.exists(DANGER_VIGNETTE_TEXTURE_KEY)) {
      const texture = this.textures.createCanvas(
        DANGER_VIGNETTE_TEXTURE_KEY,
        GAME_CONFIG.width,
        GAME_CONFIG.height,
      );
      if (!texture) throw new Error('Unable to create danger vignette texture.');
      const context = texture.context;
      const field = GAME_CONFIG.playfield;
      const horizontalFalloff = 210;
      const verticalFalloff = 150;
      const gradients = [
        [context.createLinearGradient(field.left, 0, field.left + horizontalFalloff, 0), field.left, field.top, horizontalFalloff, field.bottom - field.top],
        [context.createLinearGradient(field.right, 0, field.right - horizontalFalloff, 0), field.right - horizontalFalloff, field.top, horizontalFalloff, field.bottom - field.top],
        [context.createLinearGradient(0, field.top, 0, field.top + verticalFalloff), field.left, field.top, field.right - field.left, verticalFalloff],
        [context.createLinearGradient(0, field.bottom, 0, field.bottom - verticalFalloff), field.left, field.bottom - verticalFalloff, field.right - field.left, verticalFalloff],
      ] as const;
      for (const [gradient, x, y, width, height] of gradients) {
        gradient.addColorStop(0, 'rgba(0, 0, 0, 1)');
        gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
        context.fillStyle = gradient;
        context.fillRect(x, y, width, height);
      }
      texture.refresh();
    }
    return this.add.image(0, 0, DANGER_VIGNETTE_TEXTURE_KEY).setOrigin(0);
  }

  private updateSurvivalTimerText(): void {
    const totalSeconds = Math.floor(this.state.survivalTimeSeconds);
    if (totalSeconds === this.lastDisplayedSurvivalSecond) return;
    this.lastDisplayedSurvivalSecond = totalSeconds;
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    this.survivalTimerText.setText(`${minutes}:${seconds.toString().padStart(2, '0')}`);
  }

  private syncBallVisuals(): void {
    for (const visual of this.ballVisuals.values()) visual.setVisible(false);
    for (const ball of this.state.balls) {
      let visual = this.ballVisuals.get(ball.id);
      if (!visual) {
        visual = this.add.circle(ball.x, ball.y, ball.radius, 0xf0eee6).setDepth(1);
        this.ballVisuals.set(ball.id, visual);
      }
      visual.setPosition(ball.x, ball.y).setRadius(ball.radius).setVisible(true);
    }
    for (const [id, visual] of this.ballVisuals) {
      if (visual.visible) continue;
      visual.destroy();
      this.ballVisuals.delete(id);
    }
  }

  private handleFinalBallLost(): void {
    this.clearLevelUpTransitionGhosts();
    resolveFinalBallLoss(this.state, this.session);
    this.updateLivesText();
    this.applyPhasePresentation();
  }

  private updateLivesText(): void {
    this.livesText.setText(`LIVES: ${this.state.lives}`);
  }

  private updateProgressionHud(): void {
    const { level, currentXp, xpRequiredForNextLevel } = this.state.progression;
    if (level === this.lastHudLevel && currentXp === this.lastHudXp) return;
    this.lastHudLevel = level;
    this.lastHudXp = currentXp;
    this.progressionText.setText(`LEVEL ${level}   XP ${currentXp} / ${xpRequiredForNextLevel}`);
    this.xpBarFill.setScale(currentXp / xpRequiredForNextLevel, 1);
  }

  private getStatusMessage(): string | null {
    switch (this.session.phase) {
      case GamePhase.LifeLost: return 'BALL LOST\n\nSPACE OR CLICK TO CONTINUE';
      default: return null;
    }
  }

  private beginLevelUpSlowdown(): void {
    if (!prepareNextPowerSelection(this.state.powers)) return;
    beginLevelUpSlowdown(this.session);
    this.powerChoiceOverlay.show(this.state, false, 0);
    this.levelUpGhosts.clear();
    for (const ball of this.state.balls) {
      ball.positionHistory.length = 0;
      ball.historySampleTimer = 0;
    }
  }

  private getWorldTimeScale(): number {
    const transition = GAME_CONFIG.levelUpTransition;
    if (this.session.phase === GamePhase.LevelUpSlowdown) {
      return Math.max(0, 1 - this.session.phaseTimerSeconds / transition.slowdownDurationSeconds);
    }
    if (this.session.phase === GamePhase.LevelUpSpeedup) {
      return Math.min(1, this.session.phaseTimerSeconds / transition.speedupDurationSeconds);
    }
    return this.session.phase === GamePhase.Running ? 1 : 0;
  }

  private advanceLevelUpTransition(realDeltaSeconds: number): void {
    if (this.session.phase === GamePhase.LevelUpSlowdown) {
      this.session.phaseTimerSeconds += realDeltaSeconds;
      this.powerChoiceOverlay.setPresentation(this.getLevelUpOverlayOpacity(), false);
      if (this.session.phaseTimerSeconds < GAME_CONFIG.levelUpTransition.slowdownDurationSeconds) return;
      this.captureLevelUpTransitionGhosts();
      enterLevelUp(this.session);
      this.applyPhasePresentation();
      return;
    }
    if (this.session.phase !== GamePhase.LevelUpSpeedup) return;
    this.session.phaseTimerSeconds += realDeltaSeconds;
    this.powerChoiceOverlay.setPresentation(this.getLevelUpOverlayOpacity(), false);
    if (this.session.phaseTimerSeconds < GAME_CONFIG.levelUpTransition.speedupDurationSeconds) return;
    finishLevelUpSpeedup(this.session);
    this.clearLevelUpTransitionGhosts();
    this.powerChoiceOverlay.hide();
  }

  private getLevelUpOverlayOpacity(): number {
    const transition = GAME_CONFIG.levelUpTransition;
    if (this.session.phase === GamePhase.LevelUpSlowdown) {
      const progress = Math.min(1, this.session.phaseTimerSeconds / transition.slowdownDurationSeconds);
      return progress ** 6;
    }
    if (this.session.phase === GamePhase.LevelUpSpeedup) {
      const progress = Math.min(1, this.session.phaseTimerSeconds / transition.overlayFadeOutDurationSeconds);
      return (1 - progress) ** 6;
    }
    return this.session.phase === GamePhase.LevelUp ? 1 : 0;
  }

  private captureLevelUpTransitionGhosts(): void {
    this.levelUpGhosts.clear();
    const maximum = GAME_CONFIG.levelUpTransition.maxVisibleTrajectoryGhosts;
    for (const ball of this.state.balls) {
      this.levelUpGhosts.set(ball.id, ball.positionHistory.slice(-maximum).map((point) => ({ ...point })));
    }
  }

  private drawContractingLevelUpGhosts(graphics: Phaser.GameObjects.Graphics): void {
    const progress = Math.min(
      1,
      this.session.phaseTimerSeconds / GAME_CONFIG.levelUpTransition.speedupDurationSeconds,
    );
    for (const ball of this.state.balls) {
      const points = this.levelUpGhosts.get(ball.id) ?? [];
      const visibleCount = Math.ceil(points.length * (1 - progress));
      if (visibleCount === 0) continue;
      const visiblePoints = points.slice(points.length - visibleCount);
      for (let index = 0; index < visiblePoints.length; index += 1) {
        const point = visiblePoints[index];
        const recency = (index + 1) / visiblePoints.length;
        const x = point.x + (ball.x - point.x) * progress;
        const y = point.y + (ball.y - point.y) * progress;
        graphics.fillStyle(0xf0eee6, (0.05 + recency * 0.25) * (1 - progress));
        graphics.fillCircle(x, y, ball.radius * (0.55 + recency * 0.25));
      }
    }
  }

  private clearLevelUpTransitionGhosts(): void {
    this.levelUpGhosts.clear();
  }
}
