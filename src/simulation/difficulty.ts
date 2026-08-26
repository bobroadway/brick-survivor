import { GAME_CONFIG } from './config';

export type BrickSpeedClass = 'SLOW' | 'MEDIUM' | 'FAST' | 'RUSH';

export function getTargetAverageBrickSpeed(level: number): number {
  const normalizedLevel = Math.max(GAME_CONFIG.progression.startingLevel, level);
  return GAME_CONFIG.difficulty.baseAverageBrickSpeed
    + (normalizedLevel - GAME_CONFIG.progression.startingLevel)
      * GAME_CONFIG.difficulty.averageSpeedGrowthPerLevel;
}

export function getBrickSpeedRange(level: number): number {
  const normalizedLevel = Math.max(GAME_CONFIG.progression.startingLevel, level);
  return GAME_CONFIG.difficulty.baseSpeedRange
    + (normalizedLevel - GAME_CONFIG.progression.startingLevel)
      * GAME_CONFIG.difficulty.speedRangeGrowthPerLevel;
}

function getWeightedNormalizedClassPosition(): number {
  let weightedPosition = 0;
  let totalWeight = 0;
  for (const { speedClass, weight } of GAME_CONFIG.bricks.speedClassDistribution) {
    weightedPosition += GAME_CONFIG.difficulty.speedClassRangePositions[speedClass] * weight;
    totalWeight += weight;
  }
  return weightedPosition / totalWeight;
}

export function resolveBrickDescentSpeed(speedClass: BrickSpeedClass, level: number): number {
  const range = getBrickSpeedRange(level);
  const slowSpeed = getTargetAverageBrickSpeed(level) - getWeightedNormalizedClassPosition() * range;
  return slowSpeed + GAME_CONFIG.difficulty.speedClassRangePositions[speedClass] * range;
}

export function getBrickDescentSpeedRange(level: number): { minimum: number; maximum: number } {
  const speeds = GAME_CONFIG.bricks.speedClassDistribution
    .map(({ speedClass }) => resolveBrickDescentSpeed(speedClass, level));
  return { minimum: Math.min(...speeds), maximum: Math.max(...speeds) };
}
