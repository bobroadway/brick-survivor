import { GAME_CONFIG } from './config';

export type BrickSpeedClass = 'SLOW' | 'MEDIUM' | 'FAST' | 'RUSH';
export const BRICK_SPEED_CLASSES: readonly BrickSpeedClass[] = ['SLOW', 'MEDIUM', 'FAST', 'RUSH'];

export interface BrickSpeedRuleParameters {
  startSpeeds: Record<BrickSpeedClass, number>;
  maxSpeeds: Record<BrickSpeedClass, number>;
  classWeights: Record<BrickSpeedClass, number>;
}

export interface BrickSpeedTimingRuleParameters {
  easyEndSeconds: number;
  winSeconds: number;
  maxSpeedLeadSeconds: number;
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
export interface PressureAssistRuleParameters { graceSeconds: number; maximumProgress: number; progressPerSecond: number }
export interface PowerRuleParameters {
  maxLevel: number;
  gunVolleyPairsByLevel: readonly number[];
  gunReloadSecondsByLevel: readonly number[];
  gunShotIntervalSeconds: number;
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
export function getCanonicalBrickSpeedRuleParameters(): BrickSpeedRuleParameters {
  return {
    startSpeeds: { ...GAME_CONFIG.brickSpeed.start },
    maxSpeeds: { ...GAME_CONFIG.brickSpeed.max },
    classWeights: Object.fromEntries(GAME_CONFIG.bricks.speedClassDistribution
      .map(({ speedClass, weight }) => [speedClass, weight])) as Record<BrickSpeedClass, number>,
  };
}

export function getCanonicalBrickSpeedTimingRuleParameters(): BrickSpeedTimingRuleParameters {
  return {
    easyEndSeconds: GAME_CONFIG.brickSpeed.easyStartSeconds,
    winSeconds: GAME_CONFIG.survival.winTimeSeconds,
    maxSpeedLeadSeconds: GAME_CONFIG.brickSpeed.maxSpeedLeadSeconds,
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

export function getBrickSpeedProgressForRules(timeSeconds: number, rules: BrickSpeedTimingRuleParameters): number {
  const speedRampEndSeconds = getSpeedRampEndSecondsForRules(rules);
  return Math.max(0, Math.min(1,
    (timeSeconds - rules.easyEndSeconds) / Math.max(1e-6, speedRampEndSeconds - rules.easyEndSeconds)));
}

export function getSpeedRampEndSecondsForRules(rules: BrickSpeedTimingRuleParameters): number {
  return Math.max(rules.easyEndSeconds, rules.winSeconds - rules.maxSpeedLeadSeconds);
}

export function resolveBrickDescentSpeedForRules(
  speedClass: BrickSpeedClass,
  progress: number,
  rules: BrickSpeedRuleParameters,
): number {
  const clampedProgress = Math.max(0, Math.min(1, progress));
  return rules.startSpeeds[speedClass]
    + (rules.maxSpeeds[speedClass] - rules.startSpeeds[speedClass]) * clampedProgress;
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

export function getPressureAssistProgressAfterInactivity(
  inactivitySeconds: number,
  rules: PressureAssistRuleParameters,
): number {
  return Math.min(rules.maximumProgress,
    Math.max(0, inactivitySeconds - rules.graceSeconds) * rules.progressPerSecond);
}

export function getPressureAssistTargetProgress(
  inactivitySeconds: number,
  rules: PressureAssistRuleParameters,
): number {
  return inactivitySeconds < rules.graceSeconds ? 0 : rules.maximumProgress;
}

function levelIndex(level: number, maxLevel: number): number {
  return Math.max(0, Math.min(maxLevel, Math.floor(level)) - 1);
}

export function getGunSpec(level: number, powers: PowerRuleParameters = GAME_CONFIG.powers) {
  const index = levelIndex(level, powers.maxLevel);
  const volleyPairs = level <= 0 ? 0 : powers.gunVolleyPairsByLevel[index] ?? 0;
  return {
    volleyPairs,
    bulletsPerVolley: volleyPairs * 2,
    shotIntervalSeconds: powers.gunShotIntervalSeconds,
    reloadSeconds: level <= 0 ? 0 : powers.gunReloadSecondsByLevel[index] ?? 0,
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
