import { GAME_CONFIG } from './config';

export interface RunProgressionState {
  level: number;
  currentXp: number;
  xpRequiredForNextLevel: number;
}

export interface LevelUpReward {
  newLevel: number;
}

export function getXpRequiredForNextLevel(level: number): number {
  const config = GAME_CONFIG.progression;
  const currentLevel = Math.max(config.startingLevel, Math.floor(level));
  if (currentLevel >= config.xpIncreasePlateauLevel) return config.plateauXpRequirement;

  let requirement = config.initialXpRequirement;
  const decaySpan = config.xpIncreasePlateauLevel - 2;
  for (let incrementLevel = 2; incrementLevel <= currentLevel; incrementLevel += 1) {
    const progress = (config.xpIncreasePlateauLevel - incrementLevel) / decaySpan;
    requirement += Math.round(
      config.initialRequirementIncrease * Math.pow(progress, config.xpIncreaseDecayExponent),
    );
  }
  return requirement;
}

export function createRunProgression(): RunProgressionState {
  const level = GAME_CONFIG.progression.startingLevel;
  return { level, currentXp: 0, xpRequiredForNextLevel: getXpRequiredForNextLevel(level) };
}

export function awardRunXp(progression: RunProgressionState, xp: number): LevelUpReward[] {
  progression.currentXp += Math.max(0, xp);
  const rewards: LevelUpReward[] = [];
  while (progression.currentXp >= progression.xpRequiredForNextLevel) {
    progression.currentXp -= progression.xpRequiredForNextLevel;
    progression.level += 1;
    progression.xpRequiredForNextLevel = getXpRequiredForNextLevel(progression.level);
    rewards.push({ newLevel: progression.level });
  }
  return rewards;
}
