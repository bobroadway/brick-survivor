import { GAME_CONFIG } from './config';
import { createBrickField, type BrickFieldState } from './brickField';
import { createRunProgression, type RunProgressionState } from './progression';
import { createRunPowerState, getPowerLevel, type RunPowerState } from './powers';

export interface Vector2 { x: number; y: number }
export interface PaddleState extends Vector2 { width: number; height: number }
export interface BallState extends Vector2 {
  id: number;
  velocity: Vector2;
  positionHistory: Vector2[];
  historySampleTimer: number;
  radius: number;
  pierceCharge: number;
}
export type ProjectileKind = 'GUN' | 'ELECTRIC';
export interface ProjectileState extends Vector2 {
  id: number;
  kind: ProjectileKind;
  velocity: Vector2;
  damage: number;
  targetBrickId?: string;
}
export interface FireEffectState { x1: number; x2: number; y: number; remainingSeconds: number }
export interface GameState {
  paddle: PaddleState;
  balls: BallState[];
  brickField: BrickFieldState;
  lives: number;
  nextBallId: number;
  progression: RunProgressionState;
  powers: RunPowerState;
  projectiles: ProjectileState[];
  fireEffects: FireEffectState[];
  nextProjectileId: number;
}

export function createInitialGameState(): GameState {
  const { paddle, ball } = GAME_CONFIG;
  const paddleX = GAME_CONFIG.width / 2;
  const horizontalVelocity = ball.speed * ball.initialHorizontalRatio;
  const powers = createRunPowerState();
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
      pierceCharge: 0,
    }],
    brickField: createBrickField(),
    lives: GAME_CONFIG.run.startingLives,
    nextBallId: 2,
    progression: createRunProgression(),
    powers,
    projectiles: [],
    fireEffects: [],
    nextProjectileId: 1,
  };
}

export function spawnSplitBalls(state: GameState, parent: BallState, count: number): void {
  const { ball } = GAME_CONFIG;
  const pierceCharge = getPowerLevel(state.powers, 'PIERCING_BALL');
  for (let index = 0; index < count; index += 1) {
    const sequence = state.nextBallId;
    const fraction = (sequence * 0.6180339887498949) % 1;
    const magnitude = ball.minHorizontalRatio
      + fraction * (ball.maxHorizontalRatio - ball.minHorizontalRatio);
    const horizontalRatio = sequence % 2 === 0 ? magnitude : -magnitude;
    const horizontalVelocity = ball.speed * horizontalRatio;
    state.balls.push({
      id: sequence,
      x: parent.x,
      y: parent.y,
      velocity: {
        x: horizontalVelocity,
        y: -Math.sqrt(ball.speed ** 2 - horizontalVelocity ** 2),
      },
      positionHistory: [],
      historySampleTimer: 0,
      radius: ball.radius,
      pierceCharge,
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
    pierceCharge: getPowerLevel(state.powers, 'PIERCING_BALL'),
  }];
  state.nextBallId += 1;
}
