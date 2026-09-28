import { GAME_CONFIG } from './config';
import { getPressureAssistTargetProgress } from './gameplayRules';

export interface BrickPressureAssistState {
  timeSinceLastBallPaddleContact: number;
  brickSpeedAssistProgress: number;
  trappedBallSpeedBoost: number;
}

export function createBrickPressureAssistState(): BrickPressureAssistState {
  return {
    timeSinceLastBallPaddleContact: 0,
    brickSpeedAssistProgress: 0,
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
  const config = GAME_CONFIG.brickSpeed;
  const deltaSeconds = Math.max(0, activeWorldDeltaSeconds);
  const target = getPressureAssistTargetProgress(state.timeSinceLastBallPaddleContact, {
    graceSeconds: config.pressureAssistGraceSeconds,
    maximumProgress: config.pressureAssistMaximumProgress,
    progressPerSecond: config.pressureAssistProgressPerSecond,
  });
  const maximumChange = config.pressureAssistProgressPerSecond * deltaSeconds;
  state.brickSpeedAssistProgress = moveToward(
    state.brickSpeedAssistProgress,
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

export function getEffectiveBrickSpeedProgress(
  baseSpeedProgress: number,
  state: BrickPressureAssistState,
): number {
  return Math.max(0, baseSpeedProgress - state.brickSpeedAssistProgress);
}
