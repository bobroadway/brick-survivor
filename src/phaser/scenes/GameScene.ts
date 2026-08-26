import Phaser from 'phaser';
import { GAME_CONFIG } from '../../simulation/config';
import { createInitialGameState, type GameState } from '../../simulation/gameState';
import { getBallSpeed, stepSimulation } from '../../simulation/simulation';

export class GameScene extends Phaser.Scene {
  private state!: GameState;
  private graphics!: Phaser.GameObjects.Graphics;
  private debugText?: Phaser.GameObjects.Text;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private aKey!: Phaser.Input.Keyboard.Key;
  private dKey!: Phaser.Input.Keyboard.Key;
  private accumulator = 0;

  constructor() { super('GameScene'); }

  create(): void {
    this.state = createInitialGameState();
    this.graphics = this.add.graphics();
    if (!this.input.keyboard) throw new Error('Keyboard input is unavailable');
    this.cursors = this.input.keyboard.createCursorKeys();
    this.aKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A);
    this.dKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D);
    if (GAME_CONFIG.debug.enabled) {
      this.debugText = this.add.text(52, 46, '', {
        color: '#8491a6', fontFamily: 'Consolas, monospace', fontSize: '14px',
      });
    }
    this.drawGame();
  }

  update(_time: number, deltaMilliseconds: number): void {
    const leftHeld = this.cursors.left.isDown || this.aKey.isDown;
    const rightHeld = this.cursors.right.isDown || this.dKey.isDown;
    const horizontal: -1 | 0 | 1 = leftHeld === rightHeld ? 0 : leftHeld ? -1 : 1;
    this.accumulator += Math.min(deltaMilliseconds / 1000, GAME_CONFIG.maxFrameSeconds);
    while (this.accumulator >= GAME_CONFIG.fixedStepSeconds) {
      stepSimulation(this.state, { horizontal }, GAME_CONFIG.fixedStepSeconds);
      this.accumulator -= GAME_CONFIG.fixedStepSeconds;
    }
    this.drawGame();
    this.debugText?.setText(
      `FPS ${this.game.loop.actualFps.toFixed(0)}  BALL ${getBallSpeed(this.state.ball).toFixed(0)} px/s`,
    );
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
    if (ball.active) {
      graphics.fillStyle(0xf0eee6);
      graphics.fillCircle(ball.x, ball.y, ball.radius);
    }
  }
}
