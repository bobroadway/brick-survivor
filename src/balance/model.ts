import { getBrickRowPitch } from '../simulation/brickGeometry';
import { GAME_CONFIG } from '../simulation/config';
import { POWER_DEFINITIONS, type PowerId } from '../simulation/powers';

export type SpeedClass = 'SLOW' | 'MEDIUM' | 'FAST' | 'RUSH';
export type MetricSet = { max: number; median: number; likely: number };

export interface BalanceSettings {
  timeSeconds: number;
  difficulty: { easyEndSeconds: number; enrageStartSeconds: number; winSeconds: number; rampStartLevel: number; rampEndLevel: number };
  board: {
    columns: number; logicalWidth: number; logicalHeight: number; brickWidth: number; brickHeight: number;
    horizontalPitch: number; verticalPitch: number; roofY: number; dangerY: number; lossY: number;
  };
  density: { startMin: number; startMax: number; rampEnd: number; enrage: number; override: number | null };
  speed: {
    weights: Record<SpeedClass, number>; positions: Record<SpeedClass, number>;
    baseAverage: number; averageGrowthPerLevel: number; baseRange: number; rangeGrowthPerLevel: number;
    averageOverride: number | null;
  };
  armored: { enabled: boolean; chance: number; hp: number; xp: number };
  boss: { enabled: boolean; hp: number; checkpoints: number[]; lotteryChance: number; speedMultiplier: number };
  ball: {
    speed: number; averageTravelDistance: number; bestTravelDistance: number; contactEfficiency: number;
    continuationDistance: number; paddleRetentionPerLevel: number; iceShatterProbability: number;
    iceRehitProbability: number; icePressureSeconds: number;
  };
  powers: Record<PowerId, number>;
  splitAcquiredAtSeconds: number;
  activeBallCountOverride: number | null;
  monteCarlo: { seed: number; samples: number };
}

export interface FormationReport {
  frontierSpeed: MetricSet;
  formationsPerSecond: MetricSet;
  generatedBricksPerSecond: MetricSet;
}

export interface PowerReport {
  id: PowerId; name: string; level: number; contribution: MetricSet;
  directDps?: number; throughputMultiplier?: number; frozenBricksPerSecond?: number; pressureReductionHpPerSecond?: number;
}

export interface BalanceReport {
  density: number;
  classSpeeds: Record<SpeedClass, number>;
  normalizedWeights: Record<SpeedClass, number>;
  weightedAverageSpeed: number;
  formation: FormationReport;
  averageHpPerBrick: number;
  boardHpPerSecond: MetricSet;
  boss: { applicable: boolean; checkpoint?: number; expectedLotteryKills: number; discreteHp: number; amortizedHpPerSecond: number };
  activeBallCount: number;
  ballContactsPerSecond: MetricSet;
  elementalProcEventsPerSecond: MetricSet;
  baseBallDps: MetricSet;
  powers: PowerReport[];
  combined: { baseBall: MetricSet; powerContribution: MetricSet; total: MetricSet };
  comparison: { likelyNetPressure: number; maxNetPressure: number };
  ice: { frozenBricksPerSecond: number; pressureReductionHpPerSecond: number };
}

const SPEED_CLASSES: SpeedClass[] = ['SLOW', 'MEDIUM', 'FAST', 'RUSH'];

export function createGameDefaultBalanceSettings(): BalanceSettings {
  const horizontalPitch = GAME_CONFIG.bricks.brickWidth + GAME_CONFIG.bricks.horizontalGap;
  return {
    timeSeconds: 6 * 60,
    difficulty: {
      easyEndSeconds: GAME_CONFIG.survival.easyStartDurationSeconds,
      enrageStartSeconds: GAME_CONFIG.survival.rampEndSeconds,
      winSeconds: GAME_CONFIG.survival.winTimeSeconds,
      rampStartLevel: GAME_CONFIG.survival.rampStartDifficultyLevel,
      rampEndLevel: GAME_CONFIG.survival.rampEndDifficultyLevel,
    },
    board: {
      columns: GAME_CONFIG.bricks.columns, logicalWidth: GAME_CONFIG.width, logicalHeight: GAME_CONFIG.height,
      brickWidth: GAME_CONFIG.bricks.brickWidth, brickHeight: GAME_CONFIG.bricks.brickHeight,
      horizontalPitch, verticalPitch: getBrickRowPitch(), roofY: GAME_CONFIG.bricks.fieldTopY,
      dangerY: GAME_CONFIG.bricks.dangerLineY, lossY: GAME_CONFIG.playfield.bottom,
    },
    density: {
      startMin: GAME_CONFIG.bricks.densityStartMinOccupancy,
      startMax: GAME_CONFIG.bricks.densityStartMaxOccupancy,
      rampEnd: GAME_CONFIG.bricks.densityFullMinOccupancy,
      enrage: GAME_CONFIG.survival.enrageDensityMax,
      override: null,
    },
    speed: {
      weights: Object.fromEntries(GAME_CONFIG.bricks.speedClassDistribution.map(({ speedClass, weight }) => [speedClass, weight])) as Record<SpeedClass, number>,
      positions: { ...GAME_CONFIG.difficulty.speedClassRangePositions },
      baseAverage: GAME_CONFIG.difficulty.baseAverageBrickSpeed,
      averageGrowthPerLevel: GAME_CONFIG.difficulty.averageSpeedGrowthPerLevel,
      baseRange: GAME_CONFIG.difficulty.baseSpeedRange,
      rangeGrowthPerLevel: GAME_CONFIG.difficulty.speedRangeGrowthPerLevel,
      averageOverride: null,
    },
    armored: { enabled: true, chance: GAME_CONFIG.bricks.armoredEligibleChance, hp: GAME_CONFIG.bricks.armoredHp, xp: GAME_CONFIG.bricks.armoredXp },
    boss: {
      enabled: true, hp: GAME_CONFIG.boss.hp, checkpoints: [...GAME_CONFIG.boss.checkpointSeconds],
      lotteryChance: GAME_CONFIG.boss.killLotteryChance, speedMultiplier: GAME_CONFIG.boss.slowSpeedMultiplier,
    },
    ball: {
      speed: GAME_CONFIG.ball.speed,
      averageTravelDistance: (GAME_CONFIG.playfield.bottom - GAME_CONFIG.playfield.top) * 0.72,
      bestTravelDistance: GAME_CONFIG.bricks.verticalEdgeGap + GAME_CONFIG.bricks.brickHeight,
      contactEfficiency: 0.72,
      continuationDistance: horizontalPitch * 0.9,
      paddleRetentionPerLevel: 0.035,
      iceShatterProbability: 0.68,
      iceRehitProbability: 0.42,
      icePressureSeconds: 5,
    },
    powers: Object.fromEntries(POWER_DEFINITIONS.map(({ id }) => [id, 0])) as Record<PowerId, number>,
    splitAcquiredAtSeconds: 0,
    activeBallCountOverride: null,
    monteCarlo: { seed: 0x0ba1aace, samples: 5000 },
  };
}

export function cloneBalanceSettings(settings: BalanceSettings): BalanceSettings {
  return structuredClone(settings);
}

export function clampBalanceSettings(input: BalanceSettings): BalanceSettings {
  const settings = cloneBalanceSettings(input);
  const finite = (value: number, fallback: number, minimum = 0) => Number.isFinite(value) ? Math.max(minimum, value) : fallback;
  settings.timeSeconds = finite(settings.timeSeconds, 0);
  settings.board.columns = Math.max(1, Math.round(finite(settings.board.columns, 20, 1)));
  settings.density.startMin = Math.min(settings.board.columns, finite(settings.density.startMin, 0));
  settings.density.startMax = Math.min(settings.board.columns, finite(settings.density.startMax, settings.density.startMin));
  settings.density.rampEnd = Math.min(settings.board.columns, finite(settings.density.rampEnd, settings.board.columns));
  settings.density.enrage = Math.min(settings.board.columns, finite(settings.density.enrage, settings.board.columns));
  if (settings.density.override !== null) settings.density.override = Math.min(settings.board.columns, finite(settings.density.override, 0));
  if (settings.speed.averageOverride !== null) settings.speed.averageOverride = finite(settings.speed.averageOverride, settings.speed.baseAverage);
  for (const speedClass of SPEED_CLASSES) settings.speed.weights[speedClass] = finite(settings.speed.weights[speedClass], 0);
  settings.armored.chance = Math.min(1, finite(settings.armored.chance, 0));
  settings.boss.lotteryChance = Math.min(1, finite(settings.boss.lotteryChance, 0));
  settings.monteCarlo.samples = Math.max(100, Math.min(50000, Math.round(finite(settings.monteCarlo.samples, 5000, 1))));
  for (const id of Object.keys(settings.powers) as PowerId[]) settings.powers[id] = Math.max(0, Math.min(5, Math.round(settings.powers[id] || 0)));
  return settings;
}

export function getNormalizedWeights(settings: BalanceSettings): Record<SpeedClass, number> {
  const total = SPEED_CLASSES.reduce((sum, key) => sum + Math.max(0, settings.speed.weights[key]), 0) || 1;
  return Object.fromEntries(SPEED_CLASSES.map((key) => [key, Math.max(0, settings.speed.weights[key]) / total])) as Record<SpeedClass, number>;
}

export function getVirtualDifficultyLevel(settings: BalanceSettings, time = settings.timeSeconds): number {
  const duration = Math.max(1e-6, settings.difficulty.enrageStartSeconds - settings.difficulty.easyEndSeconds);
  const progress = Math.max(0, Math.min(1, (time - settings.difficulty.easyEndSeconds) / duration));
  return settings.difficulty.rampStartLevel
    + (settings.difficulty.rampEndLevel - settings.difficulty.rampStartLevel) * progress;
}

export function getDerivedDensity(settings: BalanceSettings, time = settings.timeSeconds): number {
  if (settings.density.override !== null) return Math.max(0, Math.min(settings.board.columns, settings.density.override));
  if (time >= settings.difficulty.enrageStartSeconds) return settings.density.enrage;
  const progress = Math.max(0, Math.min(1,
    (time - settings.difficulty.easyEndSeconds)
      / Math.max(1e-6, settings.difficulty.enrageStartSeconds - settings.difficulty.easyEndSeconds)));
  const startAverage = (settings.density.startMin + settings.density.startMax) / 2;
  return startAverage + (settings.density.rampEnd - startAverage) * progress;
}

export function getClassSpeeds(settings: BalanceSettings, time = settings.timeSeconds): Record<SpeedClass, number> {
  const level = getVirtualDifficultyLevel(settings, time);
  const weights = getNormalizedWeights(settings);
  const weightedPosition = SPEED_CLASSES.reduce((sum, key) => sum + settings.speed.positions[key] * weights[key], 0);
  const range = settings.speed.baseRange + (level - settings.difficulty.rampStartLevel) * settings.speed.rangeGrowthPerLevel;
  const average = settings.speed.averageOverride
    ?? settings.speed.baseAverage + (level - settings.difficulty.rampStartLevel) * settings.speed.averageGrowthPerLevel;
  const slow = average - weightedPosition * range;
  return Object.fromEntries(SPEED_CLASSES.map((key) => [key, Math.max(0, slow + settings.speed.positions[key] * range)])) as Record<SpeedClass, number>;
}

export function getWeightedAverageSpeed(speeds: Record<SpeedClass, number>, weights: Record<SpeedClass, number>): number {
  return SPEED_CLASSES.reduce((sum, key) => sum + speeds[key] * weights[key], 0);
}

export function getExpectedHpPerBrick(settings: BalanceSettings, weights = getNormalizedWeights(settings)): number {
  if (!settings.armored.enabled) return 1;
  const eligibleProbability = weights.SLOW + weights.MEDIUM;
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
  const rng = new DeterministicRng((settings.monteCarlo.seed + seedOffset) >>> 0);
  const frontierSamples: number[] = [];
  const integerDensity = Math.max(1, Math.round(density));
  for (let sample = 0; sample < settings.monteCarlo.samples; sample += 1) {
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
      max: formationsPerSecond.max * Math.max(density, settings.density.enrage),
      median: formationsPerSecond.median * density,
      likely: formationsPerSecond.likely * density,
    },
  };
}

export function getGunMaxDps(level: number): number {
  if (level <= 0) return 0;
  return level * 2 / (GAME_CONFIG.powers.gunReloadSeconds + (level - 1) * GAME_CONFIG.powers.gunShotIntervalSeconds);
}

export function getMissileMaxDps(level: number): number {
  if (level <= 0) return 0;
  const interval = level === GAME_CONFIG.powers.maxLevel
    ? GAME_CONFIG.powers.missileLevelFiveLaunchIntervalSeconds : GAME_CONFIG.powers.missileLaunchIntervalSeconds;
  return level / (GAME_CONFIG.powers.missileReloadSeconds + (level - 1) * interval);
}

export function getSplitBallCount(settings: BalanceSettings): number {
  if (settings.activeBallCountOverride !== null) return Math.max(1, Math.round(settings.activeBallCountOverride));
  const level = settings.powers.SPLITTING_BALL;
  if (level <= 0 || settings.timeSeconds < settings.splitAcquiredAtSeconds) return 1;
  const elapsed = settings.timeSeconds - settings.splitAcquiredAtSeconds;
  const cooldown = GAME_CONFIG.powers.splittingCooldownSecondsByLevel[level - 1];
  return 2 + Math.floor(elapsed / cooldown);
}

export function getMultiballSpeedMultiplier(ballCount: number): number {
  return 1 - Math.min(GAME_CONFIG.ball.speedAssistMaximumPercentage,
    Math.max(0, ballCount - 1) * GAME_CONFIG.ball.speedAssistPercentageStep);
}

export function getFireMaximumTargets(level: number): number {
  if (level <= 0) return 0;
  if (level === 5) return 9 * 3 - 1;
  return GAME_CONFIG.powers.fireHorizontalRadiusSpacesByLevel[level - 1] * 2;
}

export function getWindMaximumTargets(level: number): number {
  if (level <= 0) return 0;
  return level === 5 ? 15 : (GAME_CONFIG.powers.windRangeSpacesByLevel[level - 1] ?? 0);
}

export function getElectricMaximumTargets(level: number): number {
  if (level <= 0) return 0;
  const primary = GAME_CONFIG.powers.electricPrimaryTargetsByLevel[level - 1];
  return level === 5 ? primary * 2 : primary;
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
  const speedMultiplier = getMultiballSpeedMultiplier(balls);
  const paddleLevel = settings.powers.PADDLE_SIZE;
  const retention = 1 + paddleLevel * settings.ball.paddleRetentionPerLevel;
  const maxContactsOne = settings.ball.speed / Math.max(settings.ball.bestTravelDistance, settings.board.brickHeight);
  const likelyContactsOne = settings.ball.speed / Math.max(settings.ball.averageTravelDistance, settings.board.verticalPitch)
    * settings.ball.contactEfficiency * (0.25 + occupancy * 0.75);
  const contactSamples: number[] = [];
  const rng = new DeterministicRng((settings.monteCarlo.seed + seedOffset) >>> 0);
  for (let sample = 0; sample < settings.monteCarlo.samples; sample += 1) {
    const layoutFactor = 0.65 + rng.next() * 0.7;
    contactSamples.push(likelyContactsOne * balls * speedMultiplier * retention * layoutFactor);
  }
  const contacts = {
    max: maxContactsOne * balls * speedMultiplier,
    median: percentile(contactSamples, 0.5), likely: mean(contactSamples),
  };
  const base = { ...contacts };
  const pierceLevel = settings.powers.PIERCING_BALL;
  const armorCost = 1 + (getExpectedHpPerBrick(settings) - 1);
  const continuation = Math.min(1, occupancy * settings.ball.averageTravelDistance / Math.max(1, settings.ball.continuationDistance));
  const pierce = {
    max: contacts.max * pierceLevel / armorCost,
    median: contacts.median * pierceLevel * continuation * 0.72 / armorCost,
    likely: contacts.likely * pierceLevel * continuation * 0.68 / armorCost,
  };
  let directBall = add(base, pierce);
  const armoredBlock = settings.armored.enabled
    ? (getNormalizedWeights(settings).SLOW + getNormalizedWeights(settings).MEDIUM) * settings.armored.chance : 0;
  const iceLevel = settings.powers.ICE_BALL;
  const freezeRate = iceLevel > 0 ? contacts.likely * (1 - armoredBlock) * Math.min(1, occupancy * 1.2) : 0;
  const shatterTargetsMax = iceLevel === 5 ? 16 : 8;
  const iceSamples: number[] = [];
  for (let sample = 0; sample < settings.monteCarlo.samples; sample += 1) {
    const neighbors = sampleOccupiedTargets(rng, 8, occupancy);
    const chain = iceLevel === 5 ? sampleOccupiedTargets(rng, 8, occupancy * settings.ball.iceRehitProbability) : 0;
    iceSamples.push((neighbors + chain) * settings.ball.iceShatterProbability);
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
  const directShatterProc = freezeRate * settings.ball.iceRehitProbability;
  const procRate = {
    max: killRate.max + (iceLevel > 0 ? contacts.max * 2 : 0),
    median: killRate.median + freezeRate + directShatterProc,
    likely: killRate.likely + freezeRate + directShatterProc,
  };

  const gunMax = getGunMaxDps(settings.powers.GUN);
  const missileMax = getMissileMaxDps(settings.powers.HOMING_MISSILE);
  const gun = { max: gunMax, median: gunMax * (0.3 + 0.65 * occupancy), likely: gunMax * (0.25 + 0.7 * occupancy) };
  const missile = { max: missileMax, median: missileMax * (0.72 + 0.25 * occupancy), likely: missileMax * (0.68 + 0.28 * occupancy) };

  const elemental = (level: number, maxTargets: number, availableCells: number, offset: number): MetricSet => {
    if (level <= 0) return { max: 0, median: 0, likely: 0 };
    const samples: number[] = [];
    const localRng = new DeterministicRng((settings.monteCarlo.seed + seedOffset + offset) >>> 0);
    for (let sample = 0; sample < settings.monteCarlo.samples; sample += 1) {
      samples.push(Math.min(maxTargets, sampleOccupiedTargets(localRng, availableCells, occupancy)));
    }
    return {
      max: procRate.max * maxTargets,
      median: procRate.median * percentile(samples, 0.5),
      likely: procRate.likely * mean(samples),
    };
  };
  const electricLevel = settings.powers.ELECTRIC_BALL;
  const electric = elemental(electricLevel, getElectricMaximumTargets(electricLevel), 60, 101);
  const fireLevel = settings.powers.FIRE_BALL;
  const fire = elemental(fireLevel, getFireMaximumTargets(fireLevel), getFireMaximumTargets(fireLevel), 211);
  const windLevel = settings.powers.WIND_BALL;
  const wind = elemental(windLevel, getWindMaximumTargets(windLevel), getWindMaximumTargets(windLevel), 307);
  const total = [gun, missile, directBall, electric, fire, wind].reduce(add, { max: 0, median: 0, likely: 0 });
  return {
    total, base, procRate, contacts,
    iceFrozenRate: freezeRate,
    icePressure: freezeRate * settings.ball.icePressureSeconds,
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
    const eligible = speedClass === 'SLOW' || speedClass === 'MEDIUM';
    const hp = settings.armored.enabled && eligible ? settings.armored.hp : 1;
    return classSpeeds[speedClass] / settings.board.verticalPitch * Math.max(settings.density.enrage, density) * hp;
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
    if (id === 'PADDLE_SIZE') { report.directDps = 0; report.throughputMultiplier = 1 + settings.powers[id] * settings.ball.paddleRetentionPerLevel; }
    if (id === 'ICE_BALL') { report.frozenBricksPerSecond = build.iceFrozenRate; report.pressureReductionHpPerSecond = build.icePressure; }
    return report;
  }) : [];
  const applicableCheckpoint = [...settings.boss.checkpoints].reverse().find((checkpoint) => settings.timeSeconds >= checkpoint);
  const expectedLotteryKills = settings.boss.lotteryChance > 0 ? 1 / settings.boss.lotteryChance : Number.POSITIVE_INFINITY;
  const bossDiscreteHp = settings.boss.enabled && applicableCheckpoint !== undefined ? settings.boss.hp : 0;
  const combinedPower = subtract(build.total, baseline.base);
  return {
    density, classSpeeds, normalizedWeights, weightedAverageSpeed, formation, averageHpPerBrick, boardHpPerSecond,
    boss: {
      applicable: applicableCheckpoint !== undefined && settings.boss.enabled,
      checkpoint: applicableCheckpoint, expectedLotteryKills, discreteHp: bossDiscreteHp,
      amortizedHpPerSecond: bossDiscreteHp / Math.max(1, expectedLotteryKills / Math.max(0.01, build.total.likely)),
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
