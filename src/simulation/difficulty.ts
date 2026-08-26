import { GAME_CONFIG } from './config';

export type BrickSpeedClass = 'SLOW' | 'MEDIUM' | 'FAST' | 'RUSH';

export function resolveBrickDescentSpeed(speedClass: BrickSpeedClass, level: number): number {
  const milestones = GAME_CONFIG.difficulty.brickSpeedMilestones;
  const requestedLevel = Math.max(level, milestones[0].level);
  const finalMilestone = milestones[milestones.length - 1];
  if (requestedLevel >= finalMilestone.level) return finalMilestone.speeds[speedClass];

  for (let index = 1; index < milestones.length; index += 1) {
    const upper = milestones[index];
    if (requestedLevel > upper.level) continue;
    const lower = milestones[index - 1];
    const progress = (requestedLevel - lower.level) / (upper.level - lower.level);
    return lower.speeds[speedClass]
      + (upper.speeds[speedClass] - lower.speeds[speedClass]) * progress;
  }
  return finalMilestone.speeds[speedClass];
}

export function getWeightedAverageBrickSpeed(level: number): number {
  const distribution = GAME_CONFIG.bricks.speedClassDistribution;
  let weightedSpeed = 0;
  let totalWeight = 0;
  for (const { speedClass, weight } of distribution) {
    weightedSpeed += resolveBrickDescentSpeed(speedClass, level) * weight;
    totalWeight += weight;
  }
  return weightedSpeed / totalWeight;
}

export function getDifficultyFactor(level: number): number {
  return getWeightedAverageBrickSpeed(level)
    / getWeightedAverageBrickSpeed(GAME_CONFIG.progression.startingLevel);
}

export function getRowSpawnInterval(level: number): number {
  return GAME_CONFIG.bricks.baseRowSpawnIntervalSeconds / getDifficultyFactor(level);
}

export function getXpRequiredForNextLevel(level: number): number {
  return Math.max(1, Math.round(GAME_CONFIG.progression.baseXpToNextLevel * getDifficultyFactor(level)));
}

export function getBrickDescentSpeedRange(level: number): { minimum: number; maximum: number } {
  const speeds = GAME_CONFIG.bricks.speedClassDistribution
    .map(({ speedClass }) => resolveBrickDescentSpeed(speedClass, level));
  return { minimum: Math.min(...speeds), maximum: Math.max(...speeds) };
}
