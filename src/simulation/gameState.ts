import { GAME_CONFIG } from './config';
import { spawnBallsFromParent } from './ballSpawning';
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
  speedAssistStart: number;
  speedAssistTarget: number;
  speedAssistElapsedSeconds: number;
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
export interface WindEffectState { x: number; y1: number; y2: number; remainingSeconds: number }
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
  windEffects: WindEffectState[];
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
      speedAssistStart: ball.speed,
      speedAssistTarget: ball.speed,
      speedAssistElapsedSeconds: ball.multiballSpeedTransitionDurationSeconds,
    }],
    brickField: createBrickField(),
    lives: GAME_CONFIG.run.startingLives,
    nextBallId: 2,
    progression: createRunProgression(),
    powers,
    projectiles: [],
    fireEffects: [],
    windEffects: [],
    nextProjectileId: 1,
  };
}

export function spawnSplitBalls(state: GameState, parent: BallState, count: number): void {
  spawnBallsFromParent(state, parent, count, getPowerLevel(state.powers, 'PIERCING_BALL'));
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
    speedAssistStart: ball.speed,
    speedAssistTarget: ball.speed,
    speedAssistElapsedSeconds: ball.multiballSpeedTransitionDurationSeconds,
  }];
  state.nextBallId += 1;
}
