import { GAME_CONFIG } from './config';
import { getXpRequiredForNextLevel } from './difficulty';

export interface RunProgressionState {
  level: number;
  currentXp: number;
  xpRequiredForNextLevel: number;
}

export interface LevelUpReward {
  newLevel: number;
  ballsGranted: number;
}

export function createRunProgression(): RunProgressionState {
  const level = GAME_CONFIG.progression.startingLevel;
  return { level, currentXp: 0, xpRequiredForNextLevel: getXpRequiredForNextLevel(level) };
}

export function getLevelUpBallGrant(newLevel: number): number {
  return Math.max(0, newLevel - 1);
}

export function awardRunXp(progression: RunProgressionState, xp: number): LevelUpReward[] {
  progression.currentXp += Math.max(0, xp);
  const rewards: LevelUpReward[] = [];
  while (progression.currentXp >= progression.xpRequiredForNextLevel) {
    progression.currentXp -= progression.xpRequiredForNextLevel;
    progression.level += 1;
    progression.xpRequiredForNextLevel = getXpRequiredForNextLevel(progression.level);
    rewards.push({
      newLevel: progression.level,
      ballsGranted: getLevelUpBallGrant(progression.level),
    });
  }
  return rewards;
}
