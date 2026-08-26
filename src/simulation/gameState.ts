import { GAME_CONFIG } from './config';
import { createBrickField, type BrickFieldState } from './brickField';
import { createRunProgression, type RunProgressionState } from './progression';

export interface Vector2 { x: number; y: number }
export interface PaddleState extends Vector2 { width: number; height: number }
export interface BallState extends Vector2 {
  id: number;
  velocity: Vector2;
  positionHistory: Vector2[];
  historySampleTimer: number;
  radius: number;
}
export interface GameState {
  paddle: PaddleState;
  balls: BallState[];
  brickField: BrickFieldState;
  lives: number;
  nextBallId: number;
  progression: RunProgressionState;
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
    brickField: createBrickField(),
    lives: GAME_CONFIG.run.startingLives,
    nextBallId: 2,
    progression: createRunProgression(),
  };
}

export function spawnLevelUpBalls(state: GameState, count: number): void {
  const { ball, paddle } = GAME_CONFIG;
  const spawnY = paddle.y - paddle.height / 2 - ball.spawnGap;
  for (let index = 0; index < count; index += 1) {
    const sequence = state.nextBallId;
    const fraction = (sequence * 0.6180339887498949) % 1;
    const magnitude = ball.minHorizontalRatio
      + fraction * (ball.maxHorizontalRatio - ball.minHorizontalRatio);
    const horizontalRatio = sequence % 2 === 0 ? magnitude : -magnitude;
    const horizontalVelocity = ball.speed * horizontalRatio;
    state.balls.push({
      id: sequence,
      x: state.paddle.x,
      y: spawnY,
      velocity: {
        x: horizontalVelocity,
        y: -Math.sqrt(ball.speed ** 2 - horizontalVelocity ** 2),
      },
      positionHistory: [],
      historySampleTimer: 0,
      radius: ball.radius,
    });
    state.nextBallId += 1;
  }
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
