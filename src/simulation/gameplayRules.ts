import { GAME_CONFIG } from './config';

export type BrickSpeedClass = 'SLOW' | 'MEDIUM' | 'FAST' | 'RUSH';
export const BRICK_SPEED_CLASSES: readonly BrickSpeedClass[] = ['SLOW', 'MEDIUM', 'FAST', 'RUSH'];

export interface BrickSpeedRuleParameters {
  startingLevel: number;
  baseAverage: number;
  averageGrowthPerLevel: number;
  baseRange: number;
  rangeGrowthPerLevel: number;
  classPositions: Record<BrickSpeedClass, number>;
  classWeights: Record<BrickSpeedClass, number>;
}

export interface SurvivalRuleParameters {
  easyEndSeconds: number;
  rampEndSeconds: number;
  winSeconds: number;
  rampStartLevel: number;
  rampEndLevel: number;
}

export interface DensityRuleParameters {
  startLevel: number;
  fullLevel: number;
  startMin: number;
  startMax: number;
  fullMin: number;
  fullMax: number;
}

export interface OccupancyRange { minimum: number; maximum: number }
export interface RelativeCell { column: number; row: number }
export interface PressureAssistRuleParameters { graceSeconds: number; maximumLevels: number; levelsPerSecond: number }
export interface PowerRuleParameters {
  maxLevel: number;
  gunVolleysByLevel: readonly number[];
  gunProjectilesPerVolley: number;
  gunShotIntervalSeconds: number;
  gunReloadSeconds: number;
  gunProjectileDamage: number;
  projectileSpeed: number;
  piercingCapacityByLevel: readonly number[];
  splittingCooldownSecondsByLevel: readonly number[];
  splittingBallsAddedPerActivation: number;
  splittingImmediateActivationOnAcquire: boolean;
  electricPrimaryTargetsByLevel: readonly number[];
  electricRadiusInBrickPitches: number;
  electricSecondaryEnabledAtLevel: number;
  electricSecondaryTargetsPerPrimary: number;
  electricGenerationDepth: number;
  electricTargetsMustBeUnique: boolean;
  fireHorizontalRadiusSpacesByLevel: readonly number[];
  fireExtraRowsAtMaxLevel: number;
  windRangeSpacesByLevel: readonly number[];
  windMaximumLevelNearRows: number;
  windMaximumLevelFarRows: number;
  windMaximumLevelNearHalfWidthColumns: number;
  windMaximumLevelFarHalfWidthColumns: number;
  missileCountByLevel: readonly number[];
  missileLaunchIntervalSeconds: number;
  missileLevelFiveLaunchIntervalSeconds: number;
  missileReloadSeconds: number;
  missileDamage: number;
  missileDeploymentDurationSeconds: number;
  missileDeploymentSpeed: number;
  missileHomingInitialSpeed: number;
  missileHomingMaximumSpeed: number;
  missileHomingAcceleration: number;
  missileTurnRateRadiansPerSecond: number;
  missileCollisionRadius: number;
  missileVerticalTieTolerance: number;
  paddleWidthIncreasePerLevel: number;
  paddleBaseCenterElevationDegrees: number;
  paddleBaseEdgeElevationDegrees: number;
  paddleOuterEdgeElevationDegreesByLevel: readonly number[];
  iceCollisionCapacityByLevel: readonly number[];
  iceDirectShatterSafetyMaximumSeconds: number;
}
export interface PressureAssistRuleParameters { graceSeconds: number; maximumLevels: number; levelsPerSecond: number }

export function getCanonicalBrickSpeedRuleParameters(): BrickSpeedRuleParameters {
  return {
    startingLevel: GAME_CONFIG.progression.startingLevel,
    baseAverage: GAME_CONFIG.difficulty.baseAverageBrickSpeed,
    averageGrowthPerLevel: GAME_CONFIG.difficulty.averageSpeedGrowthPerLevel,
    baseRange: GAME_CONFIG.difficulty.baseSpeedRange,
    rangeGrowthPerLevel: GAME_CONFIG.difficulty.speedRangeGrowthPerLevel,
    classPositions: { ...GAME_CONFIG.difficulty.speedClassRangePositions },
    classWeights: Object.fromEntries(GAME_CONFIG.bricks.speedClassDistribution
      .map(({ speedClass, weight }) => [speedClass, weight])) as Record<BrickSpeedClass, number>,
  };
}

export function getCanonicalSurvivalRuleParameters(): SurvivalRuleParameters {
  return {
    easyEndSeconds: GAME_CONFIG.survival.easyStartDurationSeconds,
    rampEndSeconds: GAME_CONFIG.survival.rampEndSeconds,
    winSeconds: GAME_CONFIG.survival.winTimeSeconds,
    rampStartLevel: GAME_CONFIG.survival.rampStartDifficultyLevel,
    rampEndLevel: GAME_CONFIG.survival.rampEndDifficultyLevel,
  };
}

export function getCanonicalDensityRuleParameters(): DensityRuleParameters {
  return {
    startLevel: GAME_CONFIG.bricks.densityStartLevel,
    fullLevel: GAME_CONFIG.bricks.densityFullLevel,
    startMin: GAME_CONFIG.bricks.densityStartMinOccupancy,
    startMax: GAME_CONFIG.bricks.densityStartMaxOccupancy,
    fullMin: GAME_CONFIG.bricks.densityFullMinOccupancy,
    fullMax: GAME_CONFIG.bricks.densityFullMaxOccupancy,
  };
}

export function getVirtualDifficultyLevelForRules(timeSeconds: number, rules: SurvivalRuleParameters): number {
  const progress = Math.max(0, Math.min(1,
    (timeSeconds - rules.easyEndSeconds) / Math.max(1e-6, rules.rampEndSeconds - rules.easyEndSeconds)));
  return rules.rampStartLevel + (rules.rampEndLevel - rules.rampStartLevel) * progress;
}

export function getTargetAverageBrickSpeedForRules(level: number, rules: BrickSpeedRuleParameters): number {
  const normalizedLevel = Math.max(rules.startingLevel, level);
  return rules.baseAverage + (normalizedLevel - rules.startingLevel) * rules.averageGrowthPerLevel;
}

export function getBrickSpeedRangeForRules(level: number, rules: BrickSpeedRuleParameters): number {
  const normalizedLevel = Math.max(rules.startingLevel, level);
  return rules.baseRange + (normalizedLevel - rules.startingLevel) * rules.rangeGrowthPerLevel;
}

export function resolveBrickDescentSpeedForRules(
  speedClass: BrickSpeedClass,
  level: number,
  rules: BrickSpeedRuleParameters,
): number {
  const totalWeight = Object.values(rules.classWeights).reduce((sum, weight) => sum + weight, 0) || 1;
  const weightedPosition = (Object.keys(rules.classWeights) as BrickSpeedClass[])
    .reduce((sum, key) => sum + rules.classPositions[key] * rules.classWeights[key], 0) / totalWeight;
  const range = getBrickSpeedRangeForRules(level, rules);
  const slow = getTargetAverageBrickSpeedForRules(level, rules) - weightedPosition * range;
  return slow + rules.classPositions[speedClass] * range;
}

export function getBrickOccupancyRangeForRules(level: number, rules: DensityRuleParameters): OccupancyRange {
  const progress = Math.max(0, Math.min(1,
    (level - rules.startLevel) / Math.max(1e-6, rules.fullLevel - rules.startLevel)));
  return {
    minimum: Math.round(rules.startMin + (rules.fullMin - rules.startMin) * progress),
    maximum: Math.round(rules.startMax + (rules.fullMax - rules.startMax) * progress),
  };
}

export function canSpeedClassSpawnArmored(speedClass: BrickSpeedClass): boolean {
  return speedClass === 'SLOW' || speedClass === 'MEDIUM';
}

export function getPressureAssistLevelAfterInactivity(
  inactivitySeconds: number,
  rules: PressureAssistRuleParameters,
): number {
  return Math.min(rules.maximumLevels,
    Math.max(0, inactivitySeconds - rules.graceSeconds) * rules.levelsPerSecond);
}

export function getPressureAssistTargetLevel(
  inactivitySeconds: number,
  rules: PressureAssistRuleParameters,
): number {
  return inactivitySeconds < rules.graceSeconds ? 0 : rules.maximumLevels;
}

function levelIndex(level: number, maxLevel: number): number {
  return Math.max(0, Math.min(maxLevel, Math.floor(level)) - 1);
}

export function getGunSpec(level: number, powers: PowerRuleParameters = GAME_CONFIG.powers) {
  return {
    volleys: level <= 0 ? 0 : powers.gunVolleysByLevel[levelIndex(level, powers.maxLevel)] ?? 0,
    projectilesPerVolley: powers.gunProjectilesPerVolley,
    shotIntervalSeconds: powers.gunShotIntervalSeconds,
    reloadSeconds: powers.gunReloadSeconds,
    projectileDamage: powers.gunProjectileDamage,
    projectileSpeed: powers.projectileSpeed,
  };
}

export function getPierceSpec(level: number, powers: PowerRuleParameters = GAME_CONFIG.powers) {
  return { capacity: level <= 0 ? 0 : powers.piercingCapacityByLevel[levelIndex(level, powers.maxLevel)] ?? 0 };
}

export function getSplitSpec(level: number, powers: PowerRuleParameters = GAME_CONFIG.powers) {
  return {
    cooldownSeconds: level <= 0 ? Number.POSITIVE_INFINITY : powers.splittingCooldownSecondsByLevel[levelIndex(level, powers.maxLevel)],
    ballsAddedPerActivation: powers.splittingBallsAddedPerActivation,
    immediateActivationOnAcquire: powers.splittingImmediateActivationOnAcquire,
  };
}

export function getElectricSpec(level: number, powers: PowerRuleParameters = GAME_CONFIG.powers) {
  const primaryTargets = level <= 0 ? 0 : powers.electricPrimaryTargetsByLevel[levelIndex(level, powers.maxLevel)] ?? 0;
  const secondaryEnabled = level >= powers.electricSecondaryEnabledAtLevel;
  return {
    primaryTargets,
    radiusInBrickPitches: powers.electricRadiusInBrickPitches,
    secondaryEnabled,
    secondaryTargetsPerPrimary: secondaryEnabled ? powers.electricSecondaryTargetsPerPrimary : 0,
    generationDepth: secondaryEnabled ? powers.electricGenerationDepth : 0,
    targetsMustBeUnique: powers.electricTargetsMustBeUnique,
  };
}

export function getFireSpec(level: number, powers: PowerRuleParameters = GAME_CONFIG.powers) {
  return {
    horizontalRadiusSpaces: level <= 0 ? 0 : powers.fireHorizontalRadiusSpacesByLevel[levelIndex(level, powers.maxLevel)] ?? 0,
    extraRows: level >= powers.maxLevel ? powers.fireExtraRowsAtMaxLevel : 0,
  };
}

export function getFireFootprint(level: number, originWidthColumns = 1, powers: PowerRuleParameters = GAME_CONFIG.powers): RelativeCell[] {
  const spec = getFireSpec(level, powers);
  const cells: RelativeCell[] = [];
  for (let row = -spec.extraRows; row <= spec.extraRows; row += 1) {
    for (let column = -spec.horizontalRadiusSpaces;
      column < originWidthColumns + spec.horizontalRadiusSpaces; column += 1) {
      if (row === 0 && column >= 0 && column < originWidthColumns) continue;
      cells.push({ column, row });
    }
  }
  return cells;
}

export function getWindSpec(level: number, powers: PowerRuleParameters = GAME_CONFIG.powers) {
  return {
    ordinaryRangeSpaces: level <= 0 ? 0 : powers.windRangeSpacesByLevel[levelIndex(level, powers.maxLevel)] ?? 0,
    widening: level >= powers.maxLevel,
    nearRows: powers.windMaximumLevelNearRows,
    farRows: powers.windMaximumLevelFarRows,
    nearHalfWidthColumns: powers.windMaximumLevelNearHalfWidthColumns,
    farHalfWidthColumns: powers.windMaximumLevelFarHalfWidthColumns,
  };
}

export function getWindFootprint(level: number, powers: PowerRuleParameters = GAME_CONFIG.powers): RelativeCell[] {
  const spec = getWindSpec(level, powers);
  const cells: RelativeCell[] = [];
  const rows = spec.widening ? spec.farRows : spec.ordinaryRangeSpaces;
  for (let distance = 1; distance <= rows; distance += 1) {
    const halfWidth = !spec.widening ? 0
      : distance <= spec.nearRows ? spec.nearHalfWidthColumns : spec.farHalfWidthColumns;
    for (let column = -halfWidth; column <= halfWidth; column += 1) cells.push({ column, row: -distance });
  }
  return cells;
}

export function getMissileSpec(level: number, powers: PowerRuleParameters = GAME_CONFIG.powers) {
  return {
    missileCount: level <= 0 ? 0 : powers.missileCountByLevel[levelIndex(level, powers.maxLevel)] ?? 0,
    launchIntervalSeconds: level >= powers.maxLevel
      ? powers.missileLevelFiveLaunchIntervalSeconds : powers.missileLaunchIntervalSeconds,
    reloadSeconds: powers.missileReloadSeconds,
    damage: powers.missileDamage,
    deploymentDurationSeconds: powers.missileDeploymentDurationSeconds,
    deploymentSpeed: powers.missileDeploymentSpeed,
    homingInitialSpeed: powers.missileHomingInitialSpeed,
    homingMaximumSpeed: powers.missileHomingMaximumSpeed,
    homingAcceleration: powers.missileHomingAcceleration,
    turnRateRadiansPerSecond: powers.missileTurnRateRadiansPerSecond,
    collisionRadius: powers.missileCollisionRadius,
    verticalTieTolerance: powers.missileVerticalTieTolerance,
    excludesBossTargets: true,
  };
}

export function getPaddleSizeSpec(level: number, powers: PowerRuleParameters = GAME_CONFIG.powers) {
  const clamped = Math.max(0, Math.min(powers.maxLevel, Math.floor(level)));
  return {
    widthMultiplier: 1 + clamped * powers.paddleWidthIncreasePerLevel,
    centerElevationDegrees: powers.paddleBaseCenterElevationDegrees,
    baseEdgeElevationDegrees: powers.paddleBaseEdgeElevationDegrees,
    extendedWingMinimumElevationDegrees: clamped > 0
      ? powers.paddleOuterEdgeElevationDegreesByLevel[clamped - 1]
      : powers.paddleBaseEdgeElevationDegrees,
  };
}

export function getIceSpec(level: number, powers: PowerRuleParameters = GAME_CONFIG.powers) {
  return {
    collisionCapacity: level <= 0 ? 0 : powers.iceCollisionCapacityByLevel[levelIndex(level, powers.maxLevel)] ?? 0,
    normalShatterFootprint: getRectangularRingFootprint(1, 1),
    bossShatterFootprint: getRectangularRingFootprint(2, 2),
    chainEnabled: level >= powers.maxLevel,
    directShatterSafetyMaximumSeconds: powers.iceDirectShatterSafetyMaximumSeconds,
    armoredFreezeExcluded: true,
    pendingFreezeUsesEntryCorridor: true,
  };
}

function getRectangularRingFootprint(horizontalRadius: number, verticalRadius: number): RelativeCell[] {
  const cells: RelativeCell[] = [];
  for (let row = -verticalRadius; row <= verticalRadius; row += 1) {
    for (let column = -horizontalRadius; column <= horizontalRadius; column += 1) {
      if (column !== 0 || row !== 0) cells.push({ column, row });
    }
  }
  return cells;
}
