import {
  getBrickOccupancyRangeForRules,
  getElectricSpec,
  getFireFootprint,
  getGunSpec,
  getIceSpec,
  getMissileSpec,
  getBrickSpeedProgressForRules,
  getPaddleSizeSpec,
  getPierceSpec,
  getSplitSpec,
  getSpeedRampEndSecondsForRules,
  getWindFootprint,
  resolveBrickDescentSpeedForRules,
  type PowerRuleParameters,
} from '../src/simulation/gameplayRules';
import { GAME_CONFIG } from '../src/simulation/config';
import { getBrickOccupancyRange } from '../src/simulation/brickField';
import { resolveBrickDescentSpeed } from '../src/simulation/difficulty';
import { getBrickSpeedProgress } from '../src/simulation/survivalDifficulty';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const powerRules: PowerRuleParameters = { ...GAME_CONFIG.powers };
const changed: PowerRuleParameters = {
  ...powerRules,
  gunShotsByLevel: [2, 4, 6, 8, 10],
  gunAlternatingPortsLevel: 4,
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

assert(getGunSpec(3, changed).shots === 6 && getGunSpec(3, changed).origins.every((origin) => origin === 'CENTER'),
  'Gun spec did not honor nonstandard canonical inputs');
assert(getGunSpec(4, changed).origins.join(',') === 'LEFT,RIGHT,LEFT,RIGHT,LEFT,RIGHT,LEFT,RIGHT',
  'Gun spec did not honor alternating-port threshold');
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
  startSpeeds: { SLOW: 2, MEDIUM: 4, FAST: 6, RUSH: 8 },
  maxSpeeds: { SLOW: 10, MEDIUM: 14, FAST: 18, RUSH: 22 },
  classWeights: { SLOW: 1, MEDIUM: 1, FAST: 1, RUSH: 1 },
};
assert(resolveBrickDescentSpeedForRules('RUSH', 0.5, speedRules) === 15
  && resolveBrickDescentSpeedForRules('SLOW', 0.5, speedRules) === 6,
  'Nonstandard shared speed interpolation failed');

const densityRules = { startLevel: 2, fullLevel: 6, startMin: 2, startMax: 4, fullMin: 10, fullMax: 12 };
const density = getBrickOccupancyRangeForRules(4, densityRules);
assert(density.minimum === 6 && density.maximum === 8, 'Nonstandard shared density curve failed');

for (const progress of [0, 0.5, 1]) {
  assert(resolveBrickDescentSpeed('FAST', progress) === resolveBrickDescentSpeedForRules('FAST', progress, {
    startSpeeds: { ...GAME_CONFIG.brickSpeed.start },
    maxSpeeds: { ...GAME_CONFIG.brickSpeed.max },
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
const survivalRules = {
  easyEndSeconds: GAME_CONFIG.brickSpeed.easyStartSeconds,
  winSeconds: GAME_CONFIG.survival.winTimeSeconds,
  maxSpeedLeadSeconds: GAME_CONFIG.brickSpeed.maxSpeedLeadSeconds,
};
assert(getBrickSpeedProgress(400) === getBrickSpeedProgressForRules(400, survivalRules),
  'Gameplay speed-progress wrapper drifted from shared rule');
assert(getSpeedRampEndSecondsForRules(survivalRules) === 840, 'Canonical speed-ramp end was not win minus lead');
assert(getSpeedRampEndSecondsForRules({ ...survivalRules, winSeconds: 1200 }) === 1140,
  'Injected win time did not derive its speed-ramp end');
