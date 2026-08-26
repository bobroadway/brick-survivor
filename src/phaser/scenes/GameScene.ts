import Phaser from 'phaser';
import { GAME_CONFIG } from '../../simulation/config';
import { resolveFinalBallLoss, updateLifeLostTransition } from '../../simulation/gameFlow';
import { createInitialGameState, type GameState } from '../../simulation/gameState';
import { getBallSpeed, spawnDebugBall, stepSimulation, type SimulationInput } from '../../simulation/simulation';
import {
  createSessionState,
  GamePhase,
  isSimulationRunning,
  launchReadyBall,
  pauseManually,
  resumeManualPause,
  type SessionState,
} from '../../simulation/sessionState';
import { GameInput } from '../input/GameInput';
import { RenderQualityManager } from '../rendering/RenderQualityManager';
import { PauseMenu } from '../ui/PauseMenu';

const BRICK_COLORS = [0x607d9d, 0x657c91, 0x6c738c, 0x756b83] as const;

export class GameScene extends Phaser.Scene {
  private state!: GameState;
  private session!: SessionState;
  private gameInput!: GameInput;
  private renderQuality!: RenderQualityManager;
  private graphics!: Phaser.GameObjects.Graphics;
  private readonly ballVisuals = new Map<number, Phaser.GameObjects.Arc>();
  private debugText?: Phaser.GameObjects.Text;
  private livesText!: Phaser.GameObjects.Text;
  private pauseShade!: Phaser.GameObjects.Rectangle;
  private statusShade!: Phaser.GameObjects.Rectangle;
  private statusText!: Phaser.GameObjects.Text;
  private pauseMenu!: PauseMenu;
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
    );
    if (GAME_CONFIG.debug.enabled) {
      this.debugText = this.renderQuality.addText(52, 46, '', {
        color: '#8491a6', fontFamily: 'Consolas, monospace', fontSize: '14px',
      }).setDepth(10);
    }
    this.livesText = this.renderQuality.addText(52, 68, '', {
      color: '#d4dbe5', fontFamily: 'Consolas, monospace', fontSize: '16px', fontStyle: 'bold',
    }).setDepth(10);
    this.renderQuality.addText(GAME_CONFIG.width - 54, 48, 'TAB — PAUSE', {
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
      resume: () => this.resumeGame(),
      setDisplayMode: (mode) => void this.changeDisplayMode(mode),
      restart: () => this.restartRun(),
      quit: () => void window.desktop?.quit(),
    });
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
    this.applyPhasePresentation();
    this.drawGame();
  }

  update(_time: number, deltaMilliseconds: number): void {
    if (this.session.phase === GamePhase.LifeLost) {
      if (updateLifeLostTransition(
        this.state,
        this.session,
        Math.min(deltaMilliseconds / 1000, GAME_CONFIG.maxFrameSeconds),
      )) {
        this.applyPhasePresentation();
      }
      return;
    }
    if (!isSimulationRunning(this.session)) {
      this.accumulator = 0;
      return;
    }

    this.accumulator += Math.min(deltaMilliseconds / 1000, GAME_CONFIG.maxFrameSeconds);
    const stepCount = Math.floor(this.accumulator / GAME_CONFIG.fixedStepSeconds);
    if (stepCount === 0) return;
    this.gameInput.readSimulationInput(this.simulationInput);
    this.simulationInput.mouseDisplacement /= stepCount;
    while (this.accumulator >= GAME_CONFIG.fixedStepSeconds) {
      const finalBallLost = stepSimulation(this.state, this.simulationInput, GAME_CONFIG.fixedStepSeconds);
      this.accumulator -= GAME_CONFIG.fixedStepSeconds;
      if (finalBallLost) {
        this.handleFinalBallLost();
        break;
      }
    }
    this.drawGame();
    this.updateDebugText();
  }

  private applyPhasePresentation(): void {
    const running = isSimulationRunning(this.session);
    const paused = this.session.phase === GamePhase.Paused;
    this.accumulator = 0;
    if (running) this.gameInput.enterRunning();
    else this.gameInput.enterPaused();
    this.pauseShade.setVisible(paused);
    if (paused) this.pauseMenu.show();
    else this.pauseMenu.hide();
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

  private restartRun(): void {
    this.state = createInitialGameState();
    this.session = createSessionState();
    this.updateLivesText();
    this.applyPhasePresentation();
  }

  private handleShellKey(code: string): void {
    if (code === 'F11') {
      void this.toggleDisplayMode();
      return;
    }
    if (this.session.phase === GamePhase.Ready) {
      if (code === 'Space') {
        launchReadyBall(this.session);
        this.applyPhasePresentation();
      }
      return;
    }
    if (this.session.phase === GamePhase.Running) {
      if (code === 'KeyB') {
        spawnDebugBall(this.state);
        this.drawGame();
      } else if (['Tab', 'Escape', 'Enter', 'NumpadEnter'].includes(code)) {
        this.pauseIfRunning();
      }
      return;
    }
    if (this.session.phase === GamePhase.LifeLost) return;
    if (this.session.phase === GamePhase.GameOver) {
      if (code === 'KeyR') this.restartRun();
      return;
    }
    if (this.pauseMenu.hasConfirmation()) {
      if (code === 'Escape') this.pauseMenu.cancelConfirmation();
      else if (code === 'Enter' || code === 'NumpadEnter') this.pauseMenu.activateFocused();
      else this.navigatePauseMenu(code);
      return;
    }
    if (code === 'Space' || code === 'Tab' || code === 'Escape') this.resumeGame();
    else if (code === 'Enter' || code === 'NumpadEnter') this.pauseMenu.activateFocused();
    else this.navigatePauseMenu(code);
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

    for (const brick of this.state.bricks) {
      graphics.fillStyle(BRICK_COLORS[brick.row % BRICK_COLORS.length]);
      graphics.fillRoundedRect(brick.x, brick.y, brick.width, brick.height, 3);
    }

    const paddle = this.state.paddle;
    graphics.fillStyle(0x78c6d0);
    graphics.fillRoundedRect(paddle.x - paddle.width / 2, paddle.y - paddle.height / 2, paddle.width, paddle.height, 6);
    if (!isSimulationRunning(this.session)) {
      for (const ball of this.state.balls) {
        const historyLength = ball.positionHistory.length;
        for (let index = 0; index < historyLength; index += 1) {
          const point = ball.positionHistory[index];
          const recency = (index + 1) / historyLength;
          graphics.fillStyle(0xf0eee6, 0.05 + recency * 0.25);
          graphics.fillCircle(point.x, point.y, ball.radius * (0.55 + recency * 0.25));
        }
      }
    }
    this.syncBallVisuals();
  }

  private updateDebugText(): void {
    if (!this.debugText) return;
    const fps = Math.round(this.game.loop.actualFps);
    const ballSpeed = this.state.balls[0] ? Math.round(getBallSpeed(this.state.balls[0])) : 0;
    if (fps === this.lastDebugFps && ballSpeed === this.lastDebugBallSpeed) return;
    this.lastDebugFps = fps;
    this.lastDebugBallSpeed = ballSpeed;
    this.debugText.setText(`FPS ${fps}  BALL ${ballSpeed} px/s`);
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
    resolveFinalBallLoss(this.state, this.session);
    this.updateLivesText();
    this.applyPhasePresentation();
  }

  private updateLivesText(): void {
    this.livesText.setText(`LIVES: ${this.state.lives}`);
  }

  private getStatusMessage(): string | null {
    switch (this.session.phase) {
      case GamePhase.Ready: return 'PRESS SPACE';
      case GamePhase.LifeLost: return 'BALL LOST';
      case GamePhase.GameOver: return 'GAME OVER\nPRESS R TO RESTART';
      default: return null;
    }
  }
}
