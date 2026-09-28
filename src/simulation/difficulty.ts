import { GAME_CONFIG } from './config';
import {
  getBrickSpeedRangeForRules,
  getCanonicalBrickSpeedRuleParameters,
  getTargetAverageBrickSpeedForRules,
  resolveBrickDescentSpeedForRules,
  type BrickSpeedClass,
} from './gameplayRules';

export type { BrickSpeedClass } from './gameplayRules';

export function getTargetAverageBrickSpeed(level: number): number {
  return getTargetAverageBrickSpeedForRules(level, getCanonicalBrickSpeedRuleParameters());
}

export function getBrickSpeedRange(level: number): number {
  return getBrickSpeedRangeForRules(level, getCanonicalBrickSpeedRuleParameters());
}

export function resolveBrickDescentSpeed(speedClass: BrickSpeedClass, level: number): number {
  return resolveBrickDescentSpeedForRules(speedClass, level, getCanonicalBrickSpeedRuleParameters());
}

export function getBrickDescentSpeedRange(level: number): { minimum: number; maximum: number } {
  const speeds = GAME_CONFIG.bricks.speedClassDistribution
    .map(({ speedClass }) => resolveBrickDescentSpeed(speedClass, level));
  return { minimum: Math.min(...speeds), maximum: Math.max(...speeds) };
}
