import { GAME_CONFIG } from './config';
import { getBrickSpeedProgressForRules, getCanonicalBrickSpeedTimingRuleParameters } from './gameplayRules';

export enum SurvivalPhase {
  EasyStart = 'EASY_START',
  Ramp = 'RAMP',
  Win = 'WIN',
}

export function getSurvivalPhase(survivalTimeSeconds: number): SurvivalPhase {
  const time = Math.max(0, survivalTimeSeconds);
  if (time < GAME_CONFIG.brickSpeed.easyStartSeconds) return SurvivalPhase.EasyStart;
  if (time < GAME_CONFIG.survival.winTimeSeconds) return SurvivalPhase.Ramp;
  return SurvivalPhase.Win;
}

export function getBrickSpeedProgress(survivalTimeSeconds: number): number {
  return getBrickSpeedProgressForRules(survivalTimeSeconds, getCanonicalBrickSpeedTimingRuleParameters());
}
