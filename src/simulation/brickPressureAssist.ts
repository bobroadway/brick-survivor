import { GAME_CONFIG } from './config';

export interface BrickPressureAssistState {
  timeSinceLastBallPaddleContact: number;
  brickPressureAssistLevels: number;
  trappedBallSpeedBoost: number;
}

export function createBrickPressureAssistState(): BrickPressureAssistState {
  return {
    timeSinceLastBallPaddleContact: 0,
    brickPressureAssistLevels: 0,
    trappedBallSpeedBoost: 0,
  };
}

function moveToward(current: number, target: number, maximumChange: number): number {
  if (current < target) return Math.min(target, current + maximumChange);
  if (current > target) return Math.max(target, current - maximumChange);
  return current;
}

export function advanceBrickPressureAssist(
  state: BrickPressureAssistState,
  activeWorldDeltaSeconds: number,
): void {
  const config = GAME_CONFIG.difficulty;
  const deltaSeconds = Math.max(0, activeWorldDeltaSeconds);
  const target = state.timeSinceLastBallPaddleContact < config.brickPressureAssistGraceSeconds
    ? 0
    : config.brickPressureAssistMaximumLevels;
  const maximumChange = config.brickPressureAssistLevelsPerSecond * deltaSeconds;
  state.brickPressureAssistLevels = moveToward(
    state.brickPressureAssistLevels,
    target,
    maximumChange,
  );
  const targetBallBoost = target === 0 ? 0 : GAME_CONFIG.ball.speedAssistMaximumPercentage;
  state.trappedBallSpeedBoost = moveToward(
    state.trappedBallSpeedBoost,
    targetBallBoost,
    GAME_CONFIG.ball.speedAssistPercentageStep * deltaSeconds,
  );
  state.timeSinceLastBallPaddleContact += deltaSeconds;
}

export function recordBallPaddleContact(state: BrickPressureAssistState): void {
  state.timeSinceLastBallPaddleContact = 0;
}

export function getEffectiveBrickSpeedLevel(
  baseDifficultyLevel: number,
  state: BrickPressureAssistState,
): number {
  return Math.max(
    GAME_CONFIG.progression.startingLevel,
    baseDifficultyLevel - state.brickPressureAssistLevels,
  );
}
