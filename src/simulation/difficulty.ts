import {
  getCanonicalBrickSpeedRuleParameters,
  resolveBrickDescentSpeedForRules,
  type BrickSpeedClass,
} from './gameplayRules';

export type { BrickSpeedClass } from './gameplayRules';

export function resolveBrickDescentSpeed(speedClass: BrickSpeedClass, speedProgress: number): number {
  return resolveBrickDescentSpeedForRules(speedClass, speedProgress, getCanonicalBrickSpeedRuleParameters());
}

export function getBrickDescentSpeedRange(speedProgress: number): { minimum: number; maximum: number } {
  const rules = getCanonicalBrickSpeedRuleParameters();
  const speeds = Object.keys(rules.startSpeeds)
    .map((speedClass) => resolveBrickDescentSpeed(speedClass as BrickSpeedClass, speedProgress));
  return { minimum: Math.min(...speeds), maximum: Math.max(...speeds) };
}
