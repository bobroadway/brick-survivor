import { GAME_CONFIG } from './config';

export interface Vector2 { x: number; y: number }
export interface PaddleState extends Vector2 { width: number; height: number }
export interface BallState extends Vector2 {
  id: number;
  velocity: Vector2;
  positionHistory: Vector2[];
  historySampleTimer: number;
  radius: number;
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
export interface GameState {
  paddle: PaddleState;
  balls: BallState[];
  bricks: BrickState[];
  lives: number;
  nextBallId: number;
}

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
        x: config.originX + column * (config.brickWidth + config.horizontalGap),
        y: config.originY + row * (config.brickHeight + config.verticalGap),
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
    balls: [{
      id: 1,
      x: paddleX,
      y: paddle.y - paddle.height / 2 - ball.spawnGap,
      velocity: { x: horizontalVelocity, y: -Math.sqrt(ball.speed ** 2 - horizontalVelocity ** 2) },
      positionHistory: [],
      historySampleTimer: 0,
      radius: ball.radius,
    }],
    bricks: createTestBricks(),
    lives: GAME_CONFIG.run.startingLives,
    nextBallId: 2,
  };
}

export function prepareSingleBall(state: GameState): void {
  const { paddle, ball } = GAME_CONFIG;
  state.paddle.x = GAME_CONFIG.width / 2;
  const horizontalVelocity = ball.speed * ball.initialHorizontalRatio;
  state.balls = [{
    id: state.nextBallId,
    x: state.paddle.x,
    y: paddle.y - paddle.height / 2 - ball.spawnGap,
    velocity: {
      x: horizontalVelocity,
      y: -Math.sqrt(ball.speed ** 2 - horizontalVelocity ** 2),
    },
    positionHistory: [],
    historySampleTimer: 0,
    radius: ball.radius,
  }];
  state.nextBallId += 1;
}
