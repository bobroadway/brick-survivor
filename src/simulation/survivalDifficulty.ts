import { GAME_CONFIG } from './config';
import { getCanonicalSurvivalRuleParameters, getVirtualDifficultyLevelForRules } from './gameplayRules';

export enum SurvivalPhase {
  EasyStart = 'EASY_START',
  Ramp = 'RAMP',
  Enrage = 'ENRAGE',
  Win = 'WIN',
}

export function getSurvivalPhase(survivalTimeSeconds: number): SurvivalPhase {
  const time = Math.max(0, survivalTimeSeconds);
  if (time < GAME_CONFIG.survival.easyStartDurationSeconds) return SurvivalPhase.EasyStart;
  if (time < GAME_CONFIG.survival.rampEndSeconds) return SurvivalPhase.Ramp;
  if (time < GAME_CONFIG.survival.winTimeSeconds) return SurvivalPhase.Enrage;
  return SurvivalPhase.Win;
}

export function getVirtualDifficultyLevel(survivalTimeSeconds: number): number {
  return getVirtualDifficultyLevelForRules(survivalTimeSeconds, getCanonicalSurvivalRuleParameters());
}

export function getBrickDensityDifficultyLevel(survivalTimeSeconds: number): number {
  const phase = getSurvivalPhase(survivalTimeSeconds);
  return phase === SurvivalPhase.Enrage || phase === SurvivalPhase.Win
    ? GAME_CONFIG.bricks.densityFullLevel
    : getVirtualDifficultyLevel(survivalTimeSeconds);
}
