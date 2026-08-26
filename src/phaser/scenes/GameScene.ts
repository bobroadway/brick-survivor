import Phaser from 'phaser';
import { getActiveBrickCount } from '../../simulation/brickField';
import { GAME_CONFIG } from '../../simulation/config';
import { getBrickDescentSpeedRange } from '../../simulation/difficulty';
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
  getBallSpeed,
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

export class GameScene extends Phaser.Scene {
  private state!: GameState;
  private session!: SessionState;
  private gameInput!: GameInput;
  private renderQuality!: RenderQualityManager;
  private graphics!: Phaser.GameObjects.Graphics;
  private readonly ballVisuals = new Map<number, Phaser.GameObjects.Arc>();
  private readonly levelUpGhosts = new Map<number, Array<{ x: number; y: number }>>();
  private debugText?: Phaser.GameObjects.Text;
  private livesText!: Phaser.GameObjects.Text;
  private levelText!: Phaser.GameObjects.Text;
  private xpText!: Phaser.GameObjects.Text;
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
  private readonly simulationInput: SimulationInput = {
    movementAxis: 0,
    mouseDisplacement: 0,
    speedMultiplier: 1,
  };
  private lastDebugFps = -1;
  private lastDebugBallSpeed = -1;
  private lastDebugBrickCount = -1;
  private lastDebugLevel = -1;
  private lastHudLevel = -1;
  private lastHudXp = -1;

  constructor() { super('GameScene'); }

  create(): void {
    this.state = createInitialGameState();
    this.session = createSessionState();
    this.graphics = this.add.graphics().setDepth(0);
    this.renderQuality = new RenderQualityManager(this);
    this.gameInput = new GameInput(
      this,
      () => isSimulationRunning(this.session),
      (code) => this.handleShellKey(code),
      () => this.pauseIfRunning(),
      () => this.handlePrimaryPointerDown(),
    );
    if (GAME_CONFIG.debug.enabled) {
      this.debugText = this.renderQuality.addText(470, 680, '', {
        color: '#8491a6', fontFamily: 'Consolas, monospace', fontSize: '14px',
      }).setDepth(10);
    }
    this.livesText = this.renderQuality.addText(52, 690, '', {
      color: '#d4dbe5', fontFamily: 'Consolas, monospace', fontSize: '16px', fontStyle: 'bold',
    }).setDepth(10);
    this.levelText = this.renderQuality.addText(155, 690, '', {
      color: '#d4dbe5', fontFamily: 'Consolas, monospace', fontSize: '14px', fontStyle: 'bold',
    }).setDepth(10);
    this.xpText = this.renderQuality.addText(245, 690, '', {
      color: '#aeb8c8', fontFamily: 'Consolas, monospace', fontSize: '14px',
    }).setDepth(10);
    this.add.rectangle(365, 702, 92, 6, 0x273243).setOrigin(0, 0.5).setDepth(10);
    this.xpBarFill = this.add.rectangle(365, 702, 92, 6, 0x78c6d0)
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
    this.updateDebugText();
  }

  update(_time: number, deltaMilliseconds: number): void {
    if (!isSimulationRunning(this.session)) {
      this.accumulator = 0;
      return;
    }

    const frameSeconds = Math.min(deltaMilliseconds / 1000, GAME_CONFIG.maxFrameSeconds);
    const worldTimeScale = this.getWorldTimeScale();
    this.accumulator += frameSeconds;
    const stepCount = Math.floor(this.accumulator / GAME_CONFIG.fixedStepSeconds);
    if (stepCount === 0) {
      this.advanceLevelUpTransition(frameSeconds);
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
      if (outcome === SimulationStepOutcome.FinalBallLost) {
        this.handleFinalBallLost();
        break;
      }
      if (this.session.phase === GamePhase.Running && this.state.powers.pendingSelections > 0) {
        this.beginLevelUpSlowdown();
      }
    }
    this.advanceLevelUpTransition(frameSeconds);
    this.drawGame();
    this.updateProgressionHud();
    this.updateDebugText();
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
    if (this.session.phase === GamePhase.GameOver) {
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

  private getMenuMode(): 'START' | 'PAUSE' | 'GAME_OVER' | null {
    if (this.session.phase === GamePhase.Ready) return 'START';
    if (this.session.phase === GamePhase.Paused) return 'PAUSE';
    if (this.session.phase === GamePhase.GameOver) return 'GAME_OVER';
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
    const field = GAME_CONFIG.playfield;
    const wall = field.wallThickness;
    graphics.fillStyle(0x39465a);
    graphics.fillRect(field.left - wall, field.top - wall, wall, field.bottom - field.top);
    graphics.fillRect(field.right, field.top - wall, wall, field.bottom - field.top);
    graphics.fillRect(field.left - wall, field.top - wall, field.right - field.left + wall * 2, wall);

    for (const column of this.state.brickField.columns) {
      for (const brick of column) {
        graphics.fillStyle(GAME_CONFIG.rendering.brickSpeedClassColors[brick.speedClass]);
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
    for (const effect of this.state.fireEffects) graphics.lineBetween(effect.x1, effect.y, effect.x2, effect.y);
    graphics.lineStyle(4, WIND_EFFECT_COLOR, 0.75);
    for (const effect of this.state.windEffects) graphics.lineBetween(effect.x, effect.y1, effect.x, effect.y2);
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

  private updateDebugText(): void {
    if (!this.debugText) return;
    const fps = Math.round(this.game.loop.actualFps);
    const ballSpeed = this.state.balls[0] ? Math.round(getBallSpeed(this.state.balls[0])) : 0;
    const brickCount = getActiveBrickCount(this.state.brickField);
    if (
      fps === this.lastDebugFps
      && ballSpeed === this.lastDebugBallSpeed
      && brickCount === this.lastDebugBrickCount
      && this.state.progression.level === this.lastDebugLevel
    ) return;
    this.lastDebugFps = fps;
    this.lastDebugBallSpeed = ballSpeed;
    this.lastDebugBrickCount = brickCount;
    this.lastDebugLevel = this.state.progression.level;
    const speedRange = getBrickDescentSpeedRange(this.state.progression.level);
    this.debugText.setText(
      `FPS ${fps}  BALL ${ballSpeed} px/s\n`
      + `BRICKS ${brickCount}  SPEEDS ${speedRange.minimum}–${speedRange.maximum}`,
    );
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
    this.levelText.setText(`LEVEL ${level}`);
    this.xpText.setText(`XP ${currentXp} / ${xpRequiredForNextLevel}`);
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
