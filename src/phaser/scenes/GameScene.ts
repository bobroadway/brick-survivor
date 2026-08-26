import Phaser from 'phaser';
import { GAME_CONFIG } from '../../simulation/config';
import { createInitialGameState, type GameState } from '../../simulation/gameState';
import { getBallSpeed, stepSimulation } from '../../simulation/simulation';
import {
  createSessionState,
  isSimulationRunning,
  pauseManually,
  resumeManualPause,
  type SessionState,
} from '../../simulation/sessionState';
import { GameInput } from '../input/GameInput';
import { PauseMenu } from '../ui/PauseMenu';

export class GameScene extends Phaser.Scene {
  private state!: GameState;
  private session!: SessionState;
  private gameInput!: GameInput;
  private graphics!: Phaser.GameObjects.Graphics;
  private debugText?: Phaser.GameObjects.Text;
  private pauseShade!: Phaser.GameObjects.Rectangle;
  private pauseMenu!: PauseMenu;
  private removeDisplayModeListener?: () => void;
  private displayMode: DisplayMode = 'WINDOWED';
  private accumulator = 0;

  constructor() { super('GameScene'); }

  create(): void {
    this.state = createInitialGameState();
    this.session = createSessionState();
    this.graphics = this.add.graphics();
    this.gameInput = new GameInput(
      this,
      () => isSimulationRunning(this.session),
      (code) => this.handleShellKey(code),
      () => this.pauseIfRunning(),
    );
    if (GAME_CONFIG.debug.enabled) {
      this.debugText = this.add.text(52, 46, '', {
        color: '#8491a6', fontFamily: 'Consolas, monospace', fontSize: '14px',
      });
    }
    this.add.text(GAME_CONFIG.width - 54, 48, 'TAB — PAUSE', {
      color: '#8491a6', fontFamily: 'Consolas, monospace', fontSize: '14px',
    }).setOrigin(1, 0);
    this.pauseShade = this.add.rectangle(0, 0, GAME_CONFIG.width, GAME_CONFIG.height, 0x080a0f, 0.58)
      .setOrigin(0)
      .setVisible(false);
    this.pauseMenu = new PauseMenu(this, {
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
      this.removeDisplayModeListener?.();
    });
    this.applyPausePresentation();
    this.drawGame();
  }

  update(_time: number, deltaMilliseconds: number): void {
    if (!isSimulationRunning(this.session)) {
      this.accumulator = 0;
      return;
    }

    this.accumulator += Math.min(deltaMilliseconds / 1000, GAME_CONFIG.maxFrameSeconds);
    const stepCount = Math.floor(this.accumulator / GAME_CONFIG.fixedStepSeconds);
    if (stepCount === 0) return;
    const frameInput = this.gameInput.readSimulationInput();
    const simulationInput = {
      movementAxis: frameInput.movementAxis,
      mouseDisplacement: frameInput.mouseDisplacement / stepCount,
      speedMultiplier: frameInput.speedMultiplier,
    };
    while (this.accumulator >= GAME_CONFIG.fixedStepSeconds) {
      stepSimulation(this.state, simulationInput, GAME_CONFIG.fixedStepSeconds);
      this.accumulator -= GAME_CONFIG.fixedStepSeconds;
    }
    this.drawGame();
    this.debugText?.setText(
      `FPS ${this.game.loop.actualFps.toFixed(0)}  BALL ${getBallSpeed(this.state.ball).toFixed(0)} px/s`,
    );
  }

  private applyPausePresentation(): void {
    const paused = !isSimulationRunning(this.session);
    this.accumulator = 0;
    if (paused) this.gameInput.enterPaused();
    else this.gameInput.enterRunning();
    this.pauseShade.setVisible(paused);
    if (paused) this.pauseMenu.show();
    else this.pauseMenu.hide();
    document.body.classList.toggle('game-paused', paused);
    this.drawGame();
  }

  private pauseIfRunning(): void {
    if (!isSimulationRunning(this.session)) return;
    pauseManually(this.session);
    this.applyPausePresentation();
  }

  private resumeGame(): void {
    resumeManualPause(this.session);
    this.applyPausePresentation();
  }

  private restartRun(): void {
    this.state = createInitialGameState();
    resumeManualPause(this.session);
    this.applyPausePresentation();
  }

  private handleShellKey(code: string): void {
    if (code === 'F11') {
      void this.toggleDisplayMode();
      return;
    }
    if (isSimulationRunning(this.session)) {
      if (['Tab', 'Escape', 'Enter', 'NumpadEnter'].includes(code)) this.pauseIfRunning();
      return;
    }
    if (this.pauseMenu.hasConfirmation()) {
      if (code === 'Escape') this.pauseMenu.cancelConfirmation();
      else if (code === 'Enter' || code === 'NumpadEnter') this.pauseMenu.activateFocused();
      else this.navigatePauseMenu(code);
      return;
    }
    if (code === 'Tab' || code === 'Escape') this.resumeGame();
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

    const colors = [0x607d9d, 0x657c91, 0x6c738c, 0x756b83];
    for (const brick of this.state.bricks) {
      graphics.fillStyle(colors[brick.row % colors.length]);
      graphics.fillRoundedRect(brick.x, brick.y, brick.width, brick.height, 3);
    }

    const paddle = this.state.paddle;
    graphics.fillStyle(0x78c6d0);
    graphics.fillRoundedRect(paddle.x - paddle.width / 2, paddle.y - paddle.height / 2, paddle.width, paddle.height, 6);
    const ball = this.state.ball;
    if (!isSimulationRunning(this.session)) {
      const historyLength = ball.positionHistory.length;
      for (let index = 0; index < historyLength; index += 1) {
        const point = ball.positionHistory[index];
        const recency = (index + 1) / historyLength;
        graphics.fillStyle(0xf0eee6, 0.05 + recency * 0.25);
        graphics.fillCircle(point.x, point.y, ball.radius * (0.55 + recency * 0.25));
      }
    }
    if (ball.active) {
      graphics.fillStyle(0xf0eee6);
      graphics.fillCircle(ball.x, ball.y, ball.radius);
    }
  }
}
