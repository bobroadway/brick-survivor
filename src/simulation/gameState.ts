import { GAME_CONFIG } from './config';
import { getPierceSpec } from './gameplayRules';
import { spawnBallsFromParent } from './ballSpawning';
import {
  createBrickPressureAssistState,
  recordBallPaddleContact,
  type BrickPressureAssistState,
} from './brickPressureAssist';
import { createBrickField, type BrickFieldState, type BrickState } from './brickField';
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
export type ProjectileKind = 'GUN' | 'ELECTRIC' | 'MISSILE';
export interface ProjectileState extends Vector2 {
  id: number;
  kind: ProjectileKind;
  velocity: Vector2;
  damage: number;
  targetBrickId?: string;
  missilePhase?: 'DEPLOYING' | 'SEARCHING' | 'HOMING';
  deploymentRemainingSeconds?: number;
  homingSpeed?: number;
  electricProcId?: number;
  electricGeneration?: 'PRIMARY' | 'SECONDARY';
  electricGenerationDepth?: number;
  electricFlightProgress?: number;
  electricInitialDistance?: number;
  electricVisualAmplitude?: number;
}
export interface ElectricProcState {
  id: number;
  primaryTargetIds: Set<string>;
  secondaryTargetIds: Set<string>;
  excludedTargetIds?: Set<string>;
  activeProjectileCount: number;
}
export interface FireEffectState { x1: number; x2: number; y: number; additionalYs?: number[]; remainingSeconds: number }
export interface WindEffectState { x: number; y1: number; y2: number; topHalfWidth?: number; remainingSeconds: number }
export interface IceShatterEffectState { x: number; y: number; width?: number; height?: number; remainingSeconds: number }
export interface BossDeathEffectState {
  x: number; y: number; width: number; height: number;
  displayHp: number; displayHpStepTimerSeconds: number; frozen: boolean; remainingSeconds: number;
}
export interface FallingBrickEffectState {
  id: string; x: number; y: number; width: number; height: number;
  velocityY: number; speedClass: BrickState['speedClass']; kind: BrickState['kind'];
  hp: number; armored?: boolean; iceState?: BrickState['iceState']; isFinalBoss?: boolean;
}
export interface BossDirectorState {
  lotteryGeneratorState: number;
  bossQueued: boolean;
  bossPreGapGenerated: boolean;
  bossPreGapRowId?: number;
  queuedStartColumn?: number;
  activeNormalBossId?: string;
  ordinaryLotteryCooldownUntilSeconds: number;
  finalBossTriggered: boolean;
  finalBossStartColumn?: number;
}
export interface GameState {
  paddle: PaddleState;
  balls: BallState[];
  brickField: BrickFieldState;
  playerHp: number;
  playerMaxHp: number;
  playerDamageEventId: number;
  nextBallId: number;
  progression: RunProgressionState;
  powers: RunPowerState;
  projectiles: ProjectileState[];
  fireEffects: FireEffectState[];
  windEffects: WindEffectState[];
  iceShatterEffects: IceShatterEffectState[];
  bossDeathEffects: BossDeathEffectState[];
  fallingBrickEffects: FallingBrickEffectState[];
  bossDirector: BossDirectorState;
  nextProjectileId: number;
  electricProcs: ElectricProcState[];
  nextElectricProcId: number;
  brickPressureAssist: BrickPressureAssistState;
  survivalTimeSeconds: number;
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
    playerHp: GAME_CONFIG.player.maxHp,
    playerMaxHp: GAME_CONFIG.player.maxHp,
    playerDamageEventId: 0,
    nextBallId: 2,
    progression: createRunProgression(),
    powers,
    projectiles: [],
    fireEffects: [],
    windEffects: [],
    iceShatterEffects: [],
    bossDeathEffects: [],
    fallingBrickEffects: [],
    bossDirector: {
      lotteryGeneratorState: GAME_CONFIG.boss.lotterySeed >>> 0,
      bossQueued: false,
      bossPreGapGenerated: false,
      ordinaryLotteryCooldownUntilSeconds: GAME_CONFIG.boss.firstLotterySeconds,
      finalBossTriggered: false,
    },
    nextProjectileId: 1,
    electricProcs: [],
    nextElectricProcId: 1,
    brickPressureAssist: createBrickPressureAssistState(),
    survivalTimeSeconds: 0,
  };
}

export function spawnSplitBalls(state: GameState, parent: BallState, count: number): void {
  spawnBallsFromParent(state, parent, count, getPierceSpec(getPowerLevel(state.powers, 'PIERCING_BALL')).capacity);
}

export function prepareSingleBall(state: GameState): void {
  const { paddle, ball } = GAME_CONFIG;
  const minimumX = GAME_CONFIG.playfield.left + state.paddle.width / 2;
  const maximumX = GAME_CONFIG.playfield.right - state.paddle.width / 2;
  state.paddle.x = Math.max(minimumX, Math.min(maximumX, state.paddle.x));
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
    pierceCharge: getPierceSpec(getPowerLevel(state.powers, 'PIERCING_BALL')).capacity,
    speedAssistStart: ball.speed,
    speedAssistTarget: ball.speed,
    speedAssistElapsedSeconds: ball.multiballSpeedTransitionDurationSeconds,
  }];
  state.nextBallId += 1;
  recordBallPaddleContact(state.brickPressureAssist);
}
