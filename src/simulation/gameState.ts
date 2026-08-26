import { GAME_CONFIG } from './config';

export interface Vector2 { x: number; y: number }
export interface PaddleState extends Vector2 { width: number; height: number }
export interface BallState extends Vector2 {
  velocity: Vector2;
  radius: number;
  active: boolean;
  resetTimer: number;
}
export interface BrickState {
  id: string;
  column: number;
  row: number;
  x: number;
  y: number;
  width: number;
  height: number;
  hp: number;
}
export interface GameState { paddle: PaddleState; ball: BallState; bricks: BrickState[] }

function createTestBricks(): BrickState[] {
  const config = GAME_CONFIG.bricks;
  const bricks: BrickState[] = [];
  for (let row = 0; row < config.rows; row += 1) {
    for (let column = 0; column < config.columns; column += 1) {
      if ((row === 0 && column === 0) || (row === 0 && column === config.columns - 1)) continue;
      bricks.push({
        id: `${column}:${row}`,
        column,
        row,
        x: config.originX + column * config.cellWidth,
        y: config.originY + row * config.cellHeight,
        width: config.brickWidth,
        height: config.brickHeight,
        hp: 1,
      });
    }
  }
  return bricks;
}

export function createInitialGameState(): GameState {
  const { paddle, ball } = GAME_CONFIG;
  const paddleX = GAME_CONFIG.width / 2;
  const horizontalVelocity = ball.speed * ball.initialHorizontalRatio;
  return {
    paddle: { x: paddleX, y: paddle.y, width: paddle.width, height: paddle.height },
    ball: {
      x: paddleX,
      y: paddle.y - paddle.height / 2 - ball.spawnGap,
      velocity: { x: horizontalVelocity, y: -Math.sqrt(ball.speed ** 2 - horizontalVelocity ** 2) },
      radius: ball.radius,
      active: true,
      resetTimer: 0,
    },
    bricks: createTestBricks(),
  };
}
