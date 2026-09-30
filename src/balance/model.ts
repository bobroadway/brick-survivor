import { getBrickRowPitch } from '../simulation/brickGeometry';
import { GAME_CONFIG } from '../simulation/config';
import { POWER_DEFINITIONS, type PowerId } from '../simulation/powers';
import {
  canSpeedClassSpawnArmored,
  BRICK_SPEED_CLASSES,
  getBrickOccupancyRangeForRules,
  getElectricSpec,
  getFireFootprint,
  getGunSpec,
  getIceSpec,
  getMissileSpec,
  getPaddleSizeSpec,
  getPierceSpec,
  getBrickSpeedProgressForRules,
  getPressureAssistProgressAfterInactivity,
  getSpeedRampEndSecondsForRules,
  getSplitSpec,
  getWindFootprint,
  resolveBrickDescentSpeedForRules,
  type BrickSpeedClass,
  type DensityRuleParameters,
} from '../simulation/gameplayRules';

export type SpeedClass = BrickSpeedClass;
export type MetricSet = { max: number; median: number; likely: number };

export interface BalanceModelAssumptions {
  averageTravelDistanceFactor: number;
  bestTravelDistance: number;
  contactEfficiency: number;
  continuationDistanceFactor: number;
  paddleRetentionPerWidthIncrease: number;
  pierceMedianEfficiency: number;
  pierceLikelyEfficiency: number;
  iceShatterProbability: number;
  iceRehitProbability: number;
  iceAssumedChainGenerations: number;
  icePressureSeconds: number;
  gunMedianBaseHitRate: number;
  gunLikelyBaseHitRate: number;
  gunMedianDensityHitRate: number;
  gunLikelyDensityHitRate: number;
  missileMedianBaseHitRate: number;
  missileLikelyBaseHitRate: number;
  missileMedianDensityHitRate: number;
  missileLikelyDensityHitRate: number;
  layoutFactorMinimum: number;
  layoutFactorRange: number;
  electricAvailableCells: number;
  trappedBallAssistActive: boolean;
  trappedBallInactivitySeconds: number;
  splitAssumesNoBallLosses: boolean;
  reportingTimelineSeconds: number[];
  monteCarloSeed: number;
  monteCarloSamples: number;
}

export interface BalanceSettings {
  timeSeconds: number;
  playerLevel: number;
  speedTiming: { easyEndSeconds: number; winSeconds: number; maxSpeedLeadSeconds: number };
  board: {
    columns: number; logicalWidth: number; logicalHeight: number; brickWidth: number; brickHeight: number;
    horizontalPitch: number; verticalPitch: number; roofY: number; dangerY: number; lossY: number;
  };
  density: DensityRuleParameters & { override: number | null };
  speed: {
    weights: Record<SpeedClass, number>;
    start: Record<SpeedClass, number>;
    max: Record<SpeedClass, number>;
  };
  armored: { enabled: boolean; chance: number; hp: number; xp: number };
  boss: {
    enabled: boolean; hp: number; lotteryChance: number; speedMultiplier: number; entranceSpeed: number;
    firstLotterySeconds: number; rearmSeconds: number; finalBossLeadSeconds: number;
  };
  ball: { speed: number };
  playerSurvival: {
    maxHp: number; finalBallLostDamage: number; normalBrickLostDamage: number;
    normalBrickPaddleDamage: number; armoredBrickLostDamage: number; armoredBrickPaddleDamage: number;
    bossLostDamage: number; bossContactPlayerDamage: number; bossContactBossDamage: number;
    bossContactCooldownSeconds: number; levelUpHeal: number;
  };
  pressureAssist: { enabled: boolean; graceSeconds: number; maximumProgress: number; progressPerSecond: number };
  assumptions: BalanceModelAssumptions;
  powers: Record<PowerId, number>;
  splitAcquiredAtSeconds: number;
  activeBallCountOverride: number | null;
}

export interface FormationReport {
  frontierSpeed: MetricSet;
  formationsPerSecond: MetricSet;
  generatedBricksPerSecond: MetricSet;
}

export interface PowerReport {
  id: PowerId; name: string; level: number; contribution: MetricSet;
  directDps?: number; throughputMultiplier?: number; frozenBricksPerSecond?: number;
  pressureReductionHpPerSecond?: number; iceCollisionCapacity?: number;
}

export interface BalanceReport {
  density: number;
  classSpeeds: Record<SpeedClass, number>;
  normalizedWeights: Record<SpeedClass, number>;
  weightedAverageSpeed: number;
  formation: FormationReport;
  averageHpPerBrick: number;
  boardHpPerSecond: MetricSet;
  boss: {
    applicable: boolean; guaranteedFinalBossTime: number; guaranteedFinalBossDue: boolean;
    expectedLotteryKills: number; discreteHp: number; amortizedHpPerSecond: number;
    cruiseSpeed: number; rushArrivalSpeed: number;
  };
  activeBallCount: number;
  ballContactsPerSecond: MetricSet;
  elementalProcEventsPerSecond: MetricSet;
  baseBallDps: MetricSet;
  powers: PowerReport[];
  combined: { baseBall: MetricSet; powerContribution: MetricSet; total: MetricSet };
  comparison: { likelyNetPressure: number; maxNetPressure: number };
  ice: { frozenBricksPerSecond: number; pressureReductionHpPerSecond: number };
}

const SPEED_CLASSES = BRICK_SPEED_CLASSES;

export function createGameDefaultBalanceSettings(): BalanceSettings {
  const horizontalPitch = GAME_CONFIG.bricks.brickWidth + GAME_CONFIG.bricks.horizontalGap;
  return {
    timeSeconds: 6 * 60,
    playerLevel: GAME_CONFIG.progression.startingLevel,
    speedTiming: {
      easyEndSeconds: GAME_CONFIG.brickSpeed.easyStartSeconds,
      winSeconds: GAME_CONFIG.survival.winTimeSeconds,
      maxSpeedLeadSeconds: GAME_CONFIG.brickSpeed.maxSpeedLeadSeconds,
    },
    board: {
      columns: GAME_CONFIG.bricks.columns, logicalWidth: GAME_CONFIG.width, logicalHeight: GAME_CONFIG.height,
      brickWidth: GAME_CONFIG.bricks.brickWidth, brickHeight: GAME_CONFIG.bricks.brickHeight,
      horizontalPitch, verticalPitch: getBrickRowPitch(), roofY: GAME_CONFIG.bricks.fieldTopY,
      dangerY: GAME_CONFIG.bricks.dangerLineY, lossY: GAME_CONFIG.playfield.bottom,
    },
    density: {
      startLevel: GAME_CONFIG.bricks.densityStartLevel,
      fullLevel: GAME_CONFIG.bricks.densityFullLevel,
      startMin: GAME_CONFIG.bricks.densityStartMinOccupancy,
      startMax: GAME_CONFIG.bricks.densityStartMaxOccupancy,
      fullMin: GAME_CONFIG.bricks.densityFullMinOccupancy,
      fullMax: GAME_CONFIG.bricks.densityFullMaxOccupancy,
      override: null,
    },
    speed: {
      weights: Object.fromEntries(GAME_CONFIG.bricks.speedClassDistribution.map(({ speedClass, weight }) => [speedClass, weight])) as Record<SpeedClass, number>,
      start: { ...GAME_CONFIG.brickSpeed.start },
      max: { ...GAME_CONFIG.brickSpeed.max },
    },
    armored: { enabled: true, chance: GAME_CONFIG.bricks.armoredEligibleChance, hp: GAME_CONFIG.bricks.armoredHp, xp: GAME_CONFIG.bricks.armoredXp },
    boss: {
      enabled: true, hp: GAME_CONFIG.boss.hp,
      lotteryChance: GAME_CONFIG.boss.killLotteryChance, speedMultiplier: GAME_CONFIG.boss.slowSpeedMultiplier,
      entranceSpeed: GAME_CONFIG.brickSpeed.bossEntranceSpeed,
      firstLotterySeconds: GAME_CONFIG.boss.firstLotterySeconds,
      rearmSeconds: GAME_CONFIG.boss.lotteryRearmSeconds,
      finalBossLeadSeconds: GAME_CONFIG.boss.finalBossLeadSeconds,
    },
    ball: { speed: GAME_CONFIG.ball.speed },
    playerSurvival: {
      maxHp: GAME_CONFIG.player.maxHp,
      finalBallLostDamage: GAME_CONFIG.player.finalBallLostDamage,
      normalBrickLostDamage: GAME_CONFIG.player.normalBrickLostDamage,
      normalBrickPaddleDamage: GAME_CONFIG.player.normalBrickPaddleDamage,
      armoredBrickLostDamage: GAME_CONFIG.player.armoredBrickLostDamage,
      armoredBrickPaddleDamage: GAME_CONFIG.player.armoredBrickPaddleDamage,
      bossLostDamage: GAME_CONFIG.player.bossLostDamage,
      bossContactPlayerDamage: GAME_CONFIG.boss.paddleContactDamage,
      bossContactBossDamage: GAME_CONFIG.boss.paddleContactDamage,
      bossContactCooldownSeconds: GAME_CONFIG.boss.paddleContactCooldownSeconds,
      levelUpHeal: GAME_CONFIG.player.levelUpHeal,
    },
    pressureAssist: {
      enabled: true,
      graceSeconds: GAME_CONFIG.brickSpeed.pressureAssistGraceSeconds,
      maximumProgress: GAME_CONFIG.brickSpeed.pressureAssistMaximumProgress,
      progressPerSecond: GAME_CONFIG.brickSpeed.pressureAssistProgressPerSecond,
    },
    assumptions: {
      averageTravelDistanceFactor: 0.72,
      bestTravelDistance: GAME_CONFIG.bricks.verticalEdgeGap + GAME_CONFIG.bricks.brickHeight,
      contactEfficiency: 0.72,
      continuationDistanceFactor: 0.9,
      paddleRetentionPerWidthIncrease: 0.175,
      pierceMedianEfficiency: 0.72,
      pierceLikelyEfficiency: 0.68,
      iceShatterProbability: 0.68,
      iceRehitProbability: 0.42,
      iceAssumedChainGenerations: 1,
      icePressureSeconds: 5,
      gunMedianBaseHitRate: 0.3,
      gunLikelyBaseHitRate: 0.25,
      gunMedianDensityHitRate: 0.65,
      gunLikelyDensityHitRate: 0.7,
      missileMedianBaseHitRate: 0.72,
      missileLikelyBaseHitRate: 0.68,
      missileMedianDensityHitRate: 0.25,
      missileLikelyDensityHitRate: 0.28,
      layoutFactorMinimum: 0.65,
      layoutFactorRange: 0.7,
      electricAvailableCells: 60,
      trappedBallAssistActive: false,
      trappedBallInactivitySeconds: GAME_CONFIG.brickSpeed.pressureAssistGraceSeconds,
      splitAssumesNoBallLosses: true,
      reportingTimelineSeconds: [60, 120, 240, 360, 480, 600, 720, 840, GAME_CONFIG.survival.winTimeSeconds],
      monteCarloSeed: 0x0ba1aace,
      monteCarloSamples: 5000,
    },
    powers: Object.fromEntries(POWER_DEFINITIONS.map(({ id }) => [id, 0])) as Record<PowerId, number>,
    splitAcquiredAtSeconds: 0,
    activeBallCountOverride: null,
  };
}

export function cloneBalanceSettings(settings: BalanceSettings): BalanceSettings {
  return structuredClone(settings);
}

export function clampBalanceSettings(input: BalanceSettings): BalanceSettings {
  const settings = cloneBalanceSettings(input);
  const finite = (value: number, fallback: number, minimum = 0) => Number.isFinite(value) ? Math.max(minimum, value) : fallback;
  settings.timeSeconds = finite(settings.timeSeconds, 0);
  settings.playerLevel = Math.max(1, Math.round(finite(settings.playerLevel, GAME_CONFIG.progression.startingLevel, 1)));
  settings.board.columns = Math.max(1, Math.round(finite(settings.board.columns, 20, 1)));
  settings.density.startMin = Math.min(settings.board.columns, finite(settings.density.startMin, 0));
  settings.density.startMax = Math.min(settings.board.columns, finite(settings.density.startMax, settings.density.startMin));
  settings.density.fullMin = Math.min(settings.board.columns, finite(settings.density.fullMin, settings.board.columns));
  settings.density.fullMax = Math.min(settings.board.columns, finite(settings.density.fullMax, settings.board.columns));
  if (settings.density.override !== null) settings.density.override = Math.min(settings.board.columns, finite(settings.density.override, 0));
  for (const speedClass of SPEED_CLASSES) {
    settings.speed.weights[speedClass] = finite(settings.speed.weights[speedClass], 0);
    settings.speed.start[speedClass] = finite(settings.speed.start[speedClass], GAME_CONFIG.brickSpeed.start[speedClass]);
    settings.speed.max[speedClass] = finite(settings.speed.max[speedClass], GAME_CONFIG.brickSpeed.max[speedClass]);
  }
  settings.armored.chance = Math.min(1, finite(settings.armored.chance, 0));
  settings.playerSurvival.maxHp = Math.max(1, Math.round(finite(settings.playerSurvival.maxHp, GAME_CONFIG.player.maxHp, 1)));
  settings.playerSurvival.finalBallLostDamage = Math.round(finite(settings.playerSurvival.finalBallLostDamage, GAME_CONFIG.player.finalBallLostDamage));
  settings.playerSurvival.normalBrickLostDamage = Math.round(finite(settings.playerSurvival.normalBrickLostDamage, GAME_CONFIG.player.normalBrickLostDamage));
  settings.playerSurvival.normalBrickPaddleDamage = Math.round(finite(settings.playerSurvival.normalBrickPaddleDamage, GAME_CONFIG.player.normalBrickPaddleDamage));
  settings.playerSurvival.armoredBrickLostDamage = Math.round(finite(settings.playerSurvival.armoredBrickLostDamage, GAME_CONFIG.player.armoredBrickLostDamage));
  settings.playerSurvival.armoredBrickPaddleDamage = Math.round(finite(settings.playerSurvival.armoredBrickPaddleDamage, GAME_CONFIG.player.armoredBrickPaddleDamage));
  settings.playerSurvival.bossLostDamage = Math.round(finite(settings.playerSurvival.bossLostDamage, GAME_CONFIG.player.bossLostDamage));
  settings.playerSurvival.bossContactPlayerDamage = Math.round(finite(settings.playerSurvival.bossContactPlayerDamage, GAME_CONFIG.boss.paddleContactDamage));
  settings.playerSurvival.bossContactBossDamage = Math.round(finite(settings.playerSurvival.bossContactBossDamage, GAME_CONFIG.boss.paddleContactDamage));
  settings.playerSurvival.bossContactCooldownSeconds = finite(settings.playerSurvival.bossContactCooldownSeconds, GAME_CONFIG.boss.paddleContactCooldownSeconds);
  settings.playerSurvival.levelUpHeal = Math.round(finite(settings.playerSurvival.levelUpHeal, GAME_CONFIG.player.levelUpHeal));
  settings.boss.lotteryChance = Math.min(1, finite(settings.boss.lotteryChance, 0));
  settings.boss.firstLotterySeconds = finite(settings.boss.firstLotterySeconds, GAME_CONFIG.boss.firstLotterySeconds);
  settings.boss.rearmSeconds = finite(settings.boss.rearmSeconds, GAME_CONFIG.boss.lotteryRearmSeconds);
  settings.boss.finalBossLeadSeconds = finite(settings.boss.finalBossLeadSeconds, GAME_CONFIG.boss.finalBossLeadSeconds);
  settings.assumptions.monteCarloSamples = Math.max(100, Math.min(50000,
    Math.round(finite(settings.assumptions.monteCarloSamples, 5000, 1))));
  for (const id of Object.keys(settings.powers) as PowerId[]) {
    settings.powers[id] = Math.max(0, Math.min(GAME_CONFIG.powers.maxLevel, Math.round(settings.powers[id] || 0)));
  }
  return settings;
}

export function getNormalizedWeights(settings: BalanceSettings): Record<SpeedClass, number> {
  const total = SPEED_CLASSES.reduce((sum, key) => sum + Math.max(0, settings.speed.weights[key]), 0) || 1;
  return Object.fromEntries(SPEED_CLASSES.map((key) => [key, Math.max(0, settings.speed.weights[key]) / total])) as Record<SpeedClass, number>;
}

export function getModeledBrickSpeedProgress(settings: BalanceSettings, time = settings.timeSeconds): number {
  const base = getBrickSpeedProgressForRules(time, {
    easyEndSeconds: settings.speedTiming.easyEndSeconds,
    winSeconds: settings.speedTiming.winSeconds,
    maxSpeedLeadSeconds: settings.speedTiming.maxSpeedLeadSeconds,
  });
  if (!settings.pressureAssist.enabled || !settings.assumptions.trappedBallAssistActive) return base;
  const assist = getPressureAssistProgressAfterInactivity(
    settings.assumptions.trappedBallInactivitySeconds,
    settings.pressureAssist,
  );
  return Math.max(0, base - assist);
}

export function getDerivedDensity(settings: BalanceSettings): number {
  if (settings.density.override !== null) return Math.max(0, Math.min(settings.board.columns, settings.density.override));
  const range = getBrickOccupancyRangeForRules(settings.playerLevel, settings.density);
  return (range.minimum + range.maximum) / 2;
}

export function getClassSpeeds(settings: BalanceSettings, time = settings.timeSeconds): Record<SpeedClass, number> {
  const progress = getModeledBrickSpeedProgress(settings, time);
  const rules = {
    startSpeeds: settings.speed.start,
    maxSpeeds: settings.speed.max,
    classWeights: settings.speed.weights,
  };
  return Object.fromEntries(SPEED_CLASSES.map((key) => [key,
    Math.max(0, resolveBrickDescentSpeedForRules(key, progress, rules))])) as Record<SpeedClass, number>;
}

export function getWeightedAverageSpeed(speeds: Record<SpeedClass, number>, weights: Record<SpeedClass, number>): number {
  return SPEED_CLASSES.reduce((sum, key) => sum + speeds[key] * weights[key], 0);
}

export function getExpectedHpPerBrick(settings: BalanceSettings, weights = getNormalizedWeights(settings)): number {
  if (!settings.armored.enabled) return 1;
  const eligibleProbability = SPEED_CLASSES.filter(canSpeedClassSpawnArmored)
    .reduce((sum, speedClass) => sum + weights[speedClass], 0);
  return 1 + eligibleProbability * settings.armored.chance * Math.max(0, settings.armored.hp - 1);
}

class DeterministicRng {
  constructor(private state: number) { this.state >>>= 0; }
  next(): number { this.state = (Math.imul(this.state, 1664525) + 1013904223) >>> 0; return this.state / 0x100000000; }
}

function percentile(values: number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))];
}

function mean(values: number[]): number { return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length); }

function sampleSpeedClass(rng: DeterministicRng, weights: Record<SpeedClass, number>): SpeedClass {
  let roll = rng.next();
  for (const speedClass of SPEED_CLASSES) { roll -= weights[speedClass]; if (roll <= 0) return speedClass; }
  return 'RUSH';
}

export function estimateFormation(settings: BalanceSettings, density: number, speeds: Record<SpeedClass, number>, seedOffset = 0): FormationReport {
  const weights = getNormalizedWeights(settings);
  const rng = new DeterministicRng((settings.assumptions.monteCarloSeed + seedOffset) >>> 0);
  const frontierSamples: number[] = [];
  const integerDensity = Math.max(1, Math.round(density));
  for (let sample = 0; sample < settings.assumptions.monteCarloSamples; sample += 1) {
    let frontier = Number.POSITIVE_INFINITY;
    for (let brick = 0; brick < integerDensity; brick += 1) frontier = Math.min(frontier, speeds[sampleSpeedClass(rng, weights)]);
    frontierSamples.push(Number.isFinite(frontier) ? frontier : 0);
  }
  const maxFrontier = Math.max(...SPEED_CLASSES.map((key) => speeds[key]));
  const frontierSpeed = { max: maxFrontier, median: percentile(frontierSamples, 0.5), likely: mean(frontierSamples) };
  const toFormations = (speed: number) => speed / Math.max(1e-6, settings.board.verticalPitch);
  const formationsPerSecond = {
    max: toFormations(frontierSpeed.max), median: toFormations(frontierSpeed.median), likely: toFormations(frontierSpeed.likely),
  };
  return {
    frontierSpeed, formationsPerSecond,
    generatedBricksPerSecond: {
      max: formationsPerSecond.max * Math.max(density, settings.density.fullMax),
      median: formationsPerSecond.median * density,
      likely: formationsPerSecond.likely * density,
    },
  };
}

export function getGunMaxDps(level: number): number {
  const spec = getGunSpec(level);
  if (spec.bulletsPerVolley <= 0) return 0;
  return spec.bulletsPerVolley * spec.projectileDamage
    / (spec.reloadSeconds + (spec.volleyPairs - 1) * spec.shotIntervalSeconds);
}

export function getMissileMaxDps(level: number): number {
  const spec = getMissileSpec(level);
  if (spec.missileCount <= 0) return 0;
  return spec.missileCount * spec.damage
    / (spec.reloadSeconds + (spec.missileCount - 1) * spec.launchIntervalSeconds);
}

export function getSplitBallCount(settings: BalanceSettings): number {
  if (settings.activeBallCountOverride !== null) return Math.max(1, Math.round(settings.activeBallCountOverride));
  const level = settings.powers.SPLITTING_BALL;
  if (level <= 0 || settings.timeSeconds < settings.splitAcquiredAtSeconds) return 1;
  const elapsed = settings.timeSeconds - settings.splitAcquiredAtSeconds;
  const spec = getSplitSpec(level);
  const initialAdded = spec.immediateActivationOnAcquire ? spec.ballsAddedPerActivation : 0;
  return 1 + initialAdded + Math.floor(elapsed / spec.cooldownSeconds) * spec.ballsAddedPerActivation;
}

export function getMultiballSpeedMultiplier(ballCount: number): number {
  return 1 - Math.min(GAME_CONFIG.ball.speedAssistMaximumPercentage,
    Math.max(0, ballCount - 1) * GAME_CONFIG.ball.speedAssistPercentageStep);
}

export function getFireMaximumTargets(level: number): number {
  return getFireFootprint(level).length;
}

export function getWindMaximumTargets(level: number): number {
  return getWindFootprint(level).length;
}

export function getElectricMaximumTargets(level: number): number {
  const spec = getElectricSpec(level);
  let generations = spec.primaryTargets;
  let generationSize = spec.primaryTargets;
  for (let depth = 0; depth < spec.generationDepth; depth += 1) {
    generationSize *= spec.secondaryTargetsPerPrimary;
    generations += generationSize;
  }
  return generations;
}

function sampleOccupiedTargets(rng: DeterministicRng, cells: number, occupancy: number): number {
  let occupied = 0;
  for (let cell = 0; cell < cells; cell += 1) if (rng.next() < occupancy) occupied += 1;
  return occupied;
}

function triple(samples: number[], maximum: number): MetricSet {
  return { max: maximum, median: percentile(samples, 0.5), likely: mean(samples) };
}

function add(left: MetricSet, right: MetricSet): MetricSet {
  return { max: left.max + right.max, median: left.median + right.median, likely: left.likely + right.likely };
}

function subtract(left: MetricSet, right: MetricSet): MetricSet {
  return { max: left.max - right.max, median: left.median - right.median, likely: left.likely - right.likely };
}

interface BuildResult { total: MetricSet; base: MetricSet; procRate: MetricSet; contacts: MetricSet; iceFrozenRate: number; icePressure: number }

function calculateBuild(settings: BalanceSettings, density: number, seedOffset: number): BuildResult {
  const occupancy = Math.max(0, Math.min(1, density / settings.board.columns));
  const balls = getSplitBallCount(settings);
  const trappedBoost = settings.pressureAssist.enabled && settings.assumptions.trappedBallAssistActive
    ? Math.min(GAME_CONFIG.ball.speedAssistMaximumPercentage,
      Math.max(0, settings.assumptions.trappedBallInactivitySeconds - settings.pressureAssist.graceSeconds)
        * GAME_CONFIG.ball.speedAssistPercentageStep)
    : 0;
  const speedMultiplier = getMultiballSpeedMultiplier(balls) + trappedBoost;
  const paddleLevel = settings.powers.PADDLE_SIZE;
  const paddleSpec = getPaddleSizeSpec(paddleLevel);
  const retention = 1 + (paddleSpec.widthMultiplier - 1) * settings.assumptions.paddleRetentionPerWidthIncrease;
  const averageTravelDistance = (settings.board.lossY - settings.board.roofY)
    * settings.assumptions.averageTravelDistanceFactor;
  const maxContactsOne = settings.ball.speed / Math.max(settings.assumptions.bestTravelDistance, settings.board.brickHeight);
  const likelyContactsOne = settings.ball.speed / Math.max(averageTravelDistance, settings.board.verticalPitch)
    * settings.assumptions.contactEfficiency * (0.25 + occupancy * 0.75);
  const contactSamples: number[] = [];
  const rng = new DeterministicRng((settings.assumptions.monteCarloSeed + seedOffset) >>> 0);
  for (let sample = 0; sample < settings.assumptions.monteCarloSamples; sample += 1) {
    const layoutFactor = settings.assumptions.layoutFactorMinimum
      + rng.next() * settings.assumptions.layoutFactorRange;
    contactSamples.push(likelyContactsOne * balls * speedMultiplier * retention * layoutFactor);
  }
  const contacts = {
    max: maxContactsOne * balls * speedMultiplier,
    median: percentile(contactSamples, 0.5), likely: mean(contactSamples),
  };
  const base = { ...contacts };
  const pierceCapacity = getPierceSpec(settings.powers.PIERCING_BALL).capacity;
  const armorCost = 1 + (getExpectedHpPerBrick(settings) - 1);
  const continuationDistance = settings.board.horizontalPitch * settings.assumptions.continuationDistanceFactor;
  const continuation = Math.min(1, occupancy * averageTravelDistance / Math.max(1, continuationDistance));
  const pierce = {
    max: contacts.max * pierceCapacity / armorCost,
    median: contacts.median * pierceCapacity * continuation * settings.assumptions.pierceMedianEfficiency / armorCost,
    likely: contacts.likely * pierceCapacity * continuation * settings.assumptions.pierceLikelyEfficiency / armorCost,
  };
  let directBall = add(base, pierce);
  const armoredBlock = settings.armored.enabled
    ? SPEED_CLASSES.filter(canSpeedClassSpawnArmored)
      .reduce((sum, key) => sum + getNormalizedWeights(settings)[key], 0) * settings.armored.chance : 0;
  const iceLevel = settings.powers.ICE_BALL;
  const freezeRate = iceLevel > 0 ? contacts.likely * (1 - armoredBlock) * Math.min(1, occupancy * 1.2) : 0;
  const iceSpec = getIceSpec(iceLevel);
  const shatterTargetsMax = iceSpec.normalShatterFootprint.length
    * (iceSpec.chainEnabled ? 1 + settings.assumptions.iceAssumedChainGenerations : 1);
  const iceSamples: number[] = [];
  for (let sample = 0; sample < settings.assumptions.monteCarloSamples; sample += 1) {
    const footprintSize = iceSpec.normalShatterFootprint.length;
    const neighbors = sampleOccupiedTargets(rng, footprintSize, occupancy);
    const chain = iceSpec.chainEnabled
      ? sampleOccupiedTargets(rng, footprintSize, occupancy * settings.assumptions.iceRehitProbability) : 0;
    iceSamples.push((neighbors + chain) * settings.assumptions.iceShatterProbability);
  }
  const iceDamagePerFreeze = iceLevel > 0 ? triple(iceSamples, shatterTargetsMax) : { max: 0, median: 0, likely: 0 };
  const iceDps = {
    max: contacts.max * iceDamagePerFreeze.max,
    median: freezeRate * iceDamagePerFreeze.median,
    likely: freezeRate * iceDamagePerFreeze.likely,
  };
  directBall = add(directBall, iceDps);
  const killRate = {
    max: directBall.max,
    median: directBall.median / Math.max(1, getExpectedHpPerBrick(settings)),
    likely: directBall.likely / Math.max(1, getExpectedHpPerBrick(settings)),
  };
  const directShatterProc = freezeRate * settings.assumptions.iceRehitProbability;
  const procRate = {
    max: killRate.max + (iceLevel > 0 ? contacts.max * 2 : 0),
    median: killRate.median + freezeRate + directShatterProc,
    likely: killRate.likely + freezeRate + directShatterProc,
  };

  const gunMax = getGunMaxDps(settings.powers.GUN);
  const missileMax = getMissileMaxDps(settings.powers.HOMING_MISSILE);
  const gun = { max: gunMax,
    median: gunMax * (settings.assumptions.gunMedianBaseHitRate + settings.assumptions.gunMedianDensityHitRate * occupancy),
    likely: gunMax * (settings.assumptions.gunLikelyBaseHitRate + settings.assumptions.gunLikelyDensityHitRate * occupancy) };
  const missile = { max: missileMax,
    median: missileMax * (settings.assumptions.missileMedianBaseHitRate + settings.assumptions.missileMedianDensityHitRate * occupancy),
    likely: missileMax * (settings.assumptions.missileLikelyBaseHitRate + settings.assumptions.missileLikelyDensityHitRate * occupancy) };

  const elemental = (level: number, maxTargets: number, availableCells: number, offset: number): MetricSet => {
    if (level <= 0) return { max: 0, median: 0, likely: 0 };
    const samples: number[] = [];
    const localRng = new DeterministicRng((settings.assumptions.monteCarloSeed + seedOffset + offset) >>> 0);
    for (let sample = 0; sample < settings.assumptions.monteCarloSamples; sample += 1) {
      samples.push(Math.min(maxTargets, sampleOccupiedTargets(localRng, availableCells, occupancy)));
    }
    return {
      max: procRate.max * maxTargets,
      median: procRate.median * percentile(samples, 0.5),
      likely: procRate.likely * mean(samples),
    };
  };
  const electricLevel = settings.powers.ELECTRIC_BALL;
  const electric = elemental(electricLevel, getElectricMaximumTargets(electricLevel), settings.assumptions.electricAvailableCells, 101);
  const fireLevel = settings.powers.FIRE_BALL;
  const fire = elemental(fireLevel, getFireMaximumTargets(fireLevel), getFireMaximumTargets(fireLevel), 211);
  const windLevel = settings.powers.WIND_BALL;
  const wind = elemental(windLevel, getWindMaximumTargets(windLevel), getWindMaximumTargets(windLevel), 307);
  const total = [gun, missile, directBall, electric, fire, wind].reduce(add, { max: 0, median: 0, likely: 0 });
  return {
    total, base, procRate, contacts,
    iceFrozenRate: freezeRate,
    icePressure: freezeRate * settings.assumptions.icePressureSeconds,
  };
}

export interface CalculateBalanceOptions {
  includePowerReports?: boolean;
}

export function calculateBalance(
  rawSettings: BalanceSettings,
  options: CalculateBalanceOptions = {},
): BalanceReport {
  const settings = clampBalanceSettings(rawSettings);
  const density = getDerivedDensity(settings);
  const normalizedWeights = getNormalizedWeights(settings);
  const classSpeeds = getClassSpeeds(settings);
  const weightedAverageSpeed = getWeightedAverageSpeed(classSpeeds, normalizedWeights);
  const formation = estimateFormation(settings, density, classSpeeds);
  const averageHpPerBrick = getExpectedHpPerBrick(settings, normalizedWeights);
  const maximumCandidates = SPEED_CLASSES.map((speedClass) => {
    const eligible = canSpeedClassSpawnArmored(speedClass);
    const hp = settings.armored.enabled && eligible ? settings.armored.hp : 1;
    return classSpeeds[speedClass] / settings.board.verticalPitch * Math.max(settings.density.fullMax, density) * hp;
  });
  const boardHpPerSecond = {
    max: Math.max(...maximumCandidates),
    median: formation.generatedBricksPerSecond.median * averageHpPerBrick,
    likely: formation.generatedBricksPerSecond.likely * averageHpPerBrick,
  };
  const build = calculateBuild(settings, density, 0);
  const baseSettings = cloneBalanceSettings(settings);
  for (const id of Object.keys(baseSettings.powers) as PowerId[]) baseSettings.powers[id] = 0;
  baseSettings.activeBallCountOverride = 1;
  const baseline = calculateBuild(baseSettings, density, 0);
  const powerReports: PowerReport[] = (options.includePowerReports ?? true) ? POWER_DEFINITIONS.map(({ id, name }) => {
    const without = cloneBalanceSettings(settings);
    without.powers[id] = 0;
    if (id === 'SPLITTING_BALL') without.activeBallCountOverride = 1;
    const withoutResult = calculateBuild(without, density, 0);
    const report: PowerReport = { id, name, level: settings.powers[id], contribution: subtract(build.total, withoutResult.total) };
    if (id === 'PADDLE_SIZE') {
      report.directDps = 0;
      report.throughputMultiplier = 1 + (getPaddleSizeSpec(settings.powers[id]).widthMultiplier - 1)
        * settings.assumptions.paddleRetentionPerWidthIncrease;
    }
    if (id === 'ICE_BALL') {
      report.frozenBricksPerSecond = build.iceFrozenRate;
      report.pressureReductionHpPerSecond = build.icePressure;
      report.iceCollisionCapacity = getIceSpec(settings.powers[id]).collisionCapacity;
    }
    return report;
  }) : [];
  const survivalRules = {
    easyEndSeconds: settings.speedTiming.easyEndSeconds,
    winSeconds: settings.speedTiming.winSeconds,
    maxSpeedLeadSeconds: settings.speedTiming.maxSpeedLeadSeconds,
  };
  const guaranteedFinalBossTime = settings.speedTiming.winSeconds - settings.boss.finalBossLeadSeconds;
  const expectedLotteryKills = settings.boss.lotteryChance > 0 ? 1 / settings.boss.lotteryChance : Number.POSITIVE_INFINITY;
  const bossApplicable = settings.boss.enabled && settings.timeSeconds >= settings.boss.firstLotterySeconds;
  const bossDiscreteHp = bossApplicable ? settings.boss.hp : 0;
  const bossCruiseSpeed = classSpeeds.SLOW * settings.boss.speedMultiplier;
  const rushArrivalSpeed = settings.boss.entranceSpeed;
  const combinedPower = subtract(build.total, baseline.base);
  return {
    density, classSpeeds, normalizedWeights, weightedAverageSpeed, formation, averageHpPerBrick, boardHpPerSecond,
    boss: {
      applicable: bossApplicable,
      guaranteedFinalBossTime,
      guaranteedFinalBossDue: settings.boss.enabled && settings.timeSeconds >= guaranteedFinalBossTime,
      expectedLotteryKills, discreteHp: bossDiscreteHp,
      amortizedHpPerSecond: bossDiscreteHp / Math.max(1, expectedLotteryKills / Math.max(0.01, build.total.likely)),
      cruiseSpeed: bossCruiseSpeed,
      rushArrivalSpeed,
    },
    activeBallCount: getSplitBallCount(settings),
    ballContactsPerSecond: build.contacts,
    elementalProcEventsPerSecond: build.procRate,
    baseBallDps: baseline.base,
    powers: powerReports,
    combined: { baseBall: baseline.base, powerContribution: combinedPower, total: build.total },
    comparison: {
      likelyNetPressure: boardHpPerSecond.likely - build.total.likely,
      maxNetPressure: boardHpPerSecond.max - build.total.max,
    },
    ice: { frozenBricksPerSecond: build.iceFrozenRate, pressureReductionHpPerSecond: build.icePressure },
  };
}
