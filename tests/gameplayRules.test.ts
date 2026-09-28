import {
  getBrickOccupancyRangeForRules,
  getElectricSpec,
  getFireFootprint,
  getGunSpec,
  getIceSpec,
  getMissileSpec,
  getPaddleSizeSpec,
  getPierceSpec,
  getSplitSpec,
  getVirtualDifficultyLevelForRules,
  getWindFootprint,
  resolveBrickDescentSpeedForRules,
  type PowerRuleParameters,
} from '../src/simulation/gameplayRules';
import { GAME_CONFIG } from '../src/simulation/config';
import { getBrickOccupancyRange } from '../src/simulation/brickField';
import { resolveBrickDescentSpeed } from '../src/simulation/difficulty';
import { getVirtualDifficultyLevel } from '../src/simulation/survivalDifficulty';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const powerRules: PowerRuleParameters = { ...GAME_CONFIG.powers };
const changed: PowerRuleParameters = {
  ...powerRules,
  gunProjectilesPerVolley: 3,
  gunVolleysByLevel: [2, 4, 6, 8, 10],
  piercingCapacityByLevel: [2, 4, 6, 8, 10],
  splittingCooldownSecondsByLevel: [11, 12, 13, 14, 15],
  splittingBallsAddedPerActivation: 2,
  electricSecondaryTargetsPerPrimary: 2,
  fireHorizontalRadiusSpacesByLevel: [2, 2, 2, 2, 5],
  fireExtraRowsAtMaxLevel: 2,
  windMaximumLevelFarRows: 8,
  windMaximumLevelFarHalfWidthColumns: 2,
  missileCountByLevel: [2, 3, 4, 5, 6],
  paddleWidthIncreasePerLevel: 0.3,
  iceCollisionCapacityByLevel: [3, 4, 5, 6, 7],
};

assert(getGunSpec(3, changed).projectilesPerVolley === 3 && getGunSpec(3, changed).volleys === 6,
  'Gun spec did not honor nonstandard canonical inputs');
assert(getPierceSpec(3, changed).capacity === 6, 'Pierce spec did not honor nonstandard capacity');
assert(getSplitSpec(2, changed).cooldownSeconds === 12 && getSplitSpec(2, changed).ballsAddedPerActivation === 2,
  'Split spec did not honor nonstandard cadence');
assert(getElectricSpec(5, changed).secondaryTargetsPerPrimary === 2,
  'Electric spec did not honor nonstandard secondary count');
assert(getFireFootprint(5, 1, changed).length === 54,
  'Fire footprint did not honor nonstandard radius/row geometry');
assert(getWindFootprint(5, changed).length > getWindFootprint(5, powerRules).length,
  'Wind footprint did not honor nonstandard tornado geometry');
assert(getMissileSpec(5, changed).missileCount === 6, 'Missile spec did not honor nonstandard volley size');
assert(getPaddleSizeSpec(2, changed).widthMultiplier === 1.6,
  'Paddle spec did not honor nonstandard width growth');
assert(getIceSpec(3, changed).collisionCapacity === 5, 'Ice spec did not honor nonstandard capacity');

const speedRules = {
  startingLevel: 2,
  baseAverage: 10,
  averageGrowthPerLevel: 2,
  baseRange: 4,
  rangeGrowthPerLevel: 1,
  classPositions: { SLOW: 0, MEDIUM: 0.25, FAST: 0.75, RUSH: 1 },
  classWeights: { SLOW: 1, MEDIUM: 1, FAST: 1, RUSH: 1 },
};
assert(resolveBrickDescentSpeedForRules('RUSH', 4, speedRules)
  > resolveBrickDescentSpeedForRules('SLOW', 4, speedRules), 'Nonstandard shared speed curve failed');

const densityRules = { startLevel: 2, fullLevel: 6, startMin: 2, startMax: 4, fullMin: 10, fullMax: 12 };
const density = getBrickOccupancyRangeForRules(4, densityRules);
assert(density.minimum === 6 && density.maximum === 8, 'Nonstandard shared density curve failed');

for (const level of [1, 5, 12]) {
  assert(resolveBrickDescentSpeed('FAST', level) === resolveBrickDescentSpeedForRules('FAST', level, {
    startingLevel: GAME_CONFIG.progression.startingLevel,
    baseAverage: GAME_CONFIG.difficulty.baseAverageBrickSpeed,
    averageGrowthPerLevel: GAME_CONFIG.difficulty.averageSpeedGrowthPerLevel,
    baseRange: GAME_CONFIG.difficulty.baseSpeedRange,
    rangeGrowthPerLevel: GAME_CONFIG.difficulty.speedRangeGrowthPerLevel,
    classPositions: { ...GAME_CONFIG.difficulty.speedClassRangePositions },
    classWeights: Object.fromEntries(GAME_CONFIG.bricks.speedClassDistribution.map(({ speedClass, weight }) => [speedClass, weight])) as typeof speedRules.classWeights,
  }), 'Gameplay speed wrapper drifted from shared rule');
}
assert(JSON.stringify(getBrickOccupancyRange(8)) === JSON.stringify(getBrickOccupancyRangeForRules(8, {
  startLevel: GAME_CONFIG.bricks.densityStartLevel,
  fullLevel: GAME_CONFIG.bricks.densityFullLevel,
  startMin: GAME_CONFIG.bricks.densityStartMinOccupancy,
  startMax: GAME_CONFIG.bricks.densityStartMaxOccupancy,
  fullMin: GAME_CONFIG.bricks.densityFullMinOccupancy,
  fullMax: GAME_CONFIG.bricks.densityFullMaxOccupancy,
})), 'Gameplay density wrapper drifted from shared rule');
assert(getVirtualDifficultyLevel(400) === getVirtualDifficultyLevelForRules(400, {
  easyEndSeconds: GAME_CONFIG.survival.easyStartDurationSeconds,
  rampEndSeconds: GAME_CONFIG.survival.rampEndSeconds,
  winSeconds: GAME_CONFIG.survival.winTimeSeconds,
  rampStartLevel: GAME_CONFIG.survival.rampStartDifficultyLevel,
  rampEndLevel: GAME_CONFIG.survival.rampEndDifficultyLevel,
}), 'Gameplay survival wrapper drifted from shared rule');
