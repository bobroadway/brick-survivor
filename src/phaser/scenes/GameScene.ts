import Phaser from 'phaser';
import { GAME_CONFIG } from '../../simulation/config';
import { createInitialGameState, type GameState } from '../../simulation/gameState';
import { getBallSpeed, stepSimulation } from '../../simulation/simulation';
import {
  createSessionState,
  isSimulationRunning,
  pauseManually,
  toggleManualPause,
  type SessionState,
} from '../../simulation/sessionState';
import { GameInput } from '../input/GameInput';

export class GameScene extends Phaser.Scene {
  private state!: GameState;
  private session!: SessionState;
  private gameInput!: GameInput;
  private graphics!: Phaser.GameObjects.Graphics;
  private debugText?: Phaser.GameObjects.Text;
  private pauseShade!: Phaser.GameObjects.Rectangle;
  private pauseText!: Phaser.GameObjects.Text;
  private accumulator = 0;

  constructor() { super('GameScene'); }

  create(): void {
    this.state = createInitialGameState();
    this.session = createSessionState();
    this.graphics = this.add.graphics();
    this.gameInput = new GameInput(
      this,
      () => this.state.paddle.x,
      () => isSimulationRunning(this.session),
      () => {
        toggleManualPause(this.session);
        this.applyPausePresentation();
      },
      () => this.pauseIfRunning(),
      () => this.pauseIfRunning(),
    );
    if (GAME_CONFIG.debug.enabled) {
      this.debugText = this.add.text(52, 46, '', {
        color: '#8491a6', fontFamily: 'Consolas, monospace', fontSize: '14px',
      });
    }
    this.add.text(GAME_CONFIG.width - 54, 48, 'SPACE — PAUSE', {
      color: '#8491a6', fontFamily: 'Consolas, monospace', fontSize: '14px',
    }).setOrigin(1, 0);
    this.pauseShade = this.add.rectangle(0, 0, GAME_CONFIG.width, GAME_CONFIG.height, 0x080a0f, 0.58)
      .setOrigin(0)
      .setVisible(false);
    this.pauseText = this.add.text(GAME_CONFIG.width / 2, GAME_CONFIG.height / 2, 'PAUSED', {
      color: '#f0eee6', fontFamily: 'Arial, sans-serif', fontSize: '54px', fontStyle: 'bold',
    }).setOrigin(0.5).setVisible(false);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.gameInput.destroy());
    this.applyPausePresentation();
    this.drawGame();
  }

  update(_time: number, deltaMilliseconds: number): void {
    if (!isSimulationRunning(this.session)) {
      this.accumulator = 0;
      return;
    }

    this.accumulator += Math.min(deltaMilliseconds / 1000, GAME_CONFIG.maxFrameSeconds);
    const simulationInput = this.gameInput.readSimulationInput();
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
    this.pauseText.setVisible(paused);
    document.body.classList.toggle('game-paused', paused);
    this.drawGame();
  }

  private pauseIfRunning(): void {
    if (!isSimulationRunning(this.session)) return;
    pauseManually(this.session);
    this.applyPausePresentation();
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
