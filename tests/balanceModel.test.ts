import {
  calculateBalance,
  cloneBalanceSettings,
  createGameDefaultBalanceSettings,
  getDerivedDensity,
  getElectricMaximumTargets,
  getExpectedHpPerBrick,
  getFireMaximumTargets,
  getGunMaxDps,
  getMissileMaxDps,
  getModeledBrickSpeedProgress,
  getMultiballSpeedMultiplier,
  getSplitBallCount,
  getWeightedAverageSpeed,
  getWindMaximumTargets,
} from '../src/balance/model';
import { GAME_CONFIG } from '../src/simulation/config';
import {
  getBrickOccupancyRangeForRules,
  getBrickSpeedProgressForRules,
  getMissileSpec,
  getSpeedRampEndSecondsForRules,
} from '../src/simulation/gameplayRules';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function near(actual: number, expected: number, message: string, tolerance = 1e-8): void {
  assert(Math.abs(actual - expected) <= tolerance, `${message}: expected ${expected}, received ${actual}`);
}

const defaults = createGameDefaultBalanceSettings();
defaults.assumptions.monteCarloSamples = 700;
assert(defaults.ball.speed === GAME_CONFIG.ball.speed, 'Ball speed default drifted from game config');
assert(defaults.board.columns === GAME_CONFIG.bricks.columns, 'Column default drifted from game config');
assert(defaults.board.verticalPitch === GAME_CONFIG.bricks.brickHeight + GAME_CONFIG.bricks.verticalEdgeGap,
  'Vertical pitch default drifted from game geometry');
assert(defaults.boss.hp === 25 && defaults.armored.hp === 2, 'Boss/Armor defaults drifted');
assert(Object.values(defaults.powers).every((level) => level === 0), 'Power defaults were not all zero');

const early = cloneBalanceSettings(defaults); early.timeSeconds = 0;
const middle = cloneBalanceSettings(defaults); middle.timeSeconds = 6 * 60;
const late = cloneBalanceSettings(defaults); late.timeSeconds = 12 * 60;
for (const timestamp of [60, 5 * 60, 10 * 60, 14 * 60]) {
  const snapshot = cloneBalanceSettings(defaults); snapshot.timeSeconds = timestamp;
  near(getDerivedDensity(snapshot), getDerivedDensity(defaults), `Time ${timestamp}s changed density`);
}
const middleProgress = getBrickSpeedProgressForRules(middle.timeSeconds, {
  easyEndSeconds: middle.speedTiming.easyEndSeconds,
  winSeconds: middle.speedTiming.winSeconds,
  maxSpeedLeadSeconds: middle.speedTiming.maxSpeedLeadSeconds,
});
const defaultRange = getBrickOccupancyRangeForRules(middle.playerLevel, middle.density);
near(getDerivedDensity(middle), (defaultRange.minimum + defaultRange.maximum) / 2,
  'Balance density was not the expectation of the canonical legal range');
const earlyReport = calculateBalance(early);
const lateReport = calculateBalance(late);
assert(lateReport.weightedAverageSpeed > earlyReport.weightedAverageSpeed, 'Time-driven speed did not rise');
assert(middleProgress > 0 && middleProgress < 1, 'Middle timestamp did not advance speed progress');
const speedSamples = [0, 30, 5 * 60, 10 * 60, 14 * 60, 15 * 60]
  .map((timeSeconds) => {
    const snapshot = cloneBalanceSettings(defaults); snapshot.timeSeconds = timeSeconds;
    return calculateBalance(snapshot).weightedAverageSpeed;
  });
for (let index = 1; index < speedSamples.length; index += 1) {
  assert(speedSamples[index] >= speedSamples[index - 1], 'Time-driven speed curve was not monotonic');
}
near(speedSamples[0], speedSamples[1], 'Easy-start speed was not held through 0:30');

const lowLevel = cloneBalanceSettings(middle); lowLevel.playerLevel = lowLevel.density.startLevel;
const midPlayerLevel = cloneBalanceSettings(middle);
midPlayerLevel.playerLevel = (midPlayerLevel.density.startLevel + midPlayerLevel.density.fullLevel) / 2;
const fullLevel = cloneBalanceSettings(middle); fullLevel.playerLevel = fullLevel.density.fullLevel;
const aboveFullLevel = cloneBalanceSettings(middle); aboveFullLevel.playerLevel = aboveFullLevel.density.fullLevel + 10;
assert(getDerivedDensity(lowLevel) < getDerivedDensity(midPlayerLevel), 'Player level did not increase density');
assert(getDerivedDensity(midPlayerLevel) < getDerivedDensity(fullLevel), 'Density did not reach full occupancy by level');
near(getDerivedDensity(fullLevel), 20, 'Full density level');
near(getDerivedDensity(aboveFullLevel), 20, 'Above-full density level');
const level25 = cloneBalanceSettings(middle); level25.playerLevel = 25;
assert(getDerivedDensity(level25) < 20, 'Level 25 reached full density too early');
assert(defaults.density.fullLevel === 26, 'Balance Lab did not inherit density full level 26');
near(calculateBalance(lowLevel).weightedAverageSpeed, calculateBalance(aboveFullLevel).weightedAverageSpeed,
  'Player level changed speed at fixed time');

const beforeTwelve = cloneBalanceSettings(lowLevel); beforeTwelve.timeSeconds = 12 * 60 - 0.001;
const afterTwelve = cloneBalanceSettings(lowLevel); afterTwelve.timeSeconds = 12 * 60 + 0.001;
near(getDerivedDensity(beforeTwelve), getDerivedDensity(afterTwelve), '12:00 caused a density jump');
assert(calculateBalance(afterTwelve).weightedAverageSpeed > calculateBalance(beforeTwelve).weightedAverageSpeed,
  'Speed did not continue smoothly through 12:00');

const earlyHighLevel = cloneBalanceSettings(defaults); earlyHighLevel.timeSeconds = 60; earlyHighLevel.playerLevel = 30;
const lateLowLevel = cloneBalanceSettings(defaults); lateLowLevel.timeSeconds = 14 * 60; lateLowLevel.playerLevel = 1;
assert(getDerivedDensity(earlyHighLevel) > getDerivedDensity(lateLowLevel), 'Early high-level density was not higher');
assert(calculateBalance(earlyHighLevel).weightedAverageSpeed < calculateBalance(lateLowLevel).weightedAverageSpeed,
  'Late low-level speed was not higher');
near(getWeightedAverageSpeed({ SLOW: 1, MEDIUM: 2, FAST: 3, RUSH: 4 }, { SLOW: .25, MEDIUM: .25, FAST: .25, RUSH: .25 }), 2.5,
  'Weighted speed average');

const noArmor = cloneBalanceSettings(defaults); noArmor.armored.chance = 0;
const allArmor = cloneBalanceSettings(defaults); allArmor.armored.chance = 1;
assert(getExpectedHpPerBrick(allArmor) > getExpectedHpPerBrick(noArmor), 'Armor did not increase expected HP');
assert(calculateBalance(allArmor).boardHpPerSecond.likely > calculateBalance(noArmor).boardHpPerSecond.likely,
  'Armor did not increase incoming board HP/s');

assert(earlyReport.formation.frontierSpeed.likely <= earlyReport.weightedAverageSpeed,
  'Formation frontier ignored slowest-row probability');
assert(earlyReport.boardHpPerSecond.likely > 0, 'Board HP/s was not positive');
assert(earlyReport.ballContactsPerSecond.max > earlyReport.ballContactsPerSecond.likely,
  'Maximum Ball contact rate was not a ceiling');

assert(getGunMaxDps(5) >= getGunMaxDps(4) && getGunMaxDps(1) > 0, 'Gun cadence math was non-monotonic');
near(getGunMaxDps(1), 1 / GAME_CONFIG.powers.gunReloadSeconds, 'Gun Lv1 cadence');
near(getMissileMaxDps(1), 1 / GAME_CONFIG.powers.missileReloadSeconds, 'Missile Lv1 cadence');
for (let level = 1; level <= GAME_CONFIG.powers.maxLevel; level += 1) {
  assert(getMissileSpec(level).reloadSeconds === 12, `Missile Lv${level} did not use canonical 12-second reload`);
}
assert(getMissileMaxDps(5) >= getMissileMaxDps(4), 'Missile cadence math was non-monotonic');
assert(getElectricMaximumTargets(5) === 10, 'Electric Lv5 maximum target count');
assert(getFireMaximumTargets(5) === 26, 'Fire Lv5 footprint maximum');
assert(getWindMaximumTargets(5) === 15, 'Wind Lv5 footprint maximum');

const split = cloneBalanceSettings(defaults);
split.powers.SPLITTING_BALL = 3; split.splitAcquiredAtSeconds = 60; split.timeSeconds = 160;
assert(getSplitBallCount(split) === 7, 'Split accumulated Ball count was incorrect');
split.timeSeconds += 100;
assert(getSplitBallCount(split) >= 7, 'More Split active time reduced Ball count');
near(getMultiballSpeedMultiplier(1), 1, 'Single Ball speed multiplier');
near(getMultiballSpeedMultiplier(20), .75, 'Multiball slowdown cap');

const zeroReport = calculateBalance(defaults);
near(zeroReport.combined.total.likely, zeroReport.baseBallDps.likely, 'All-zero build did not contain only Base Ball');
assert(zeroReport.elementalProcEventsPerSecond.likely >= 0, 'Shared elemental proc rate was invalid');

const elementalLow = cloneBalanceSettings(defaults);
elementalLow.density.override = 4; elementalLow.powers.ELECTRIC_BALL = 5; elementalLow.powers.FIRE_BALL = 5; elementalLow.powers.WIND_BALL = 5;
const elementalHigh = cloneBalanceSettings(elementalLow); elementalHigh.density.override = 18;
const lowElementReport = calculateBalance(elementalLow);
const highElementReport = calculateBalance(elementalHigh);
for (const id of ['ELECTRIC_BALL', 'FIRE_BALL', 'WIND_BALL'] as const) {
  const lowPower = lowElementReport.powers.find((power) => power.id === id)!;
  const highPower = highElementReport.powers.find((power) => power.id === id)!;
  assert(highPower.contribution.likely >= lowPower.contribution.likely, `${id} fell as density increased`);
}

const faster = cloneBalanceSettings(defaults);
for (const speedClass of Object.keys(faster.speed.max) as Array<keyof typeof faster.speed.max>) {
  faster.speed.start[speedClass] *= 1.5;
  faster.speed.max[speedClass] *= 1.5;
}
assert(calculateBalance(faster).boardHpPerSecond.likely >= calculateBalance(defaults).boardHpPerSecond.likely,
  'Higher brick speed reduced incoming HP/s');

const assisted = cloneBalanceSettings(defaults);
assisted.assumptions.trappedBallAssistActive = true;
assisted.assumptions.trappedBallInactivitySeconds = assisted.pressureAssist.graceSeconds + 3;
assert(getModeledBrickSpeedProgress(assisted) < getModeledBrickSpeedProgress(defaults),
  'Explicit trapped-ball assumption did not apply canonical pressure assistance');

const slowerBoss = cloneBalanceSettings(defaults);
slowerBoss.boss.speedMultiplier *= 0.5;
assert(calculateBalance(slowerBoss).boss.cruiseSpeed < calculateBalance(defaults).boss.cruiseSpeed,
  'Boss speed multiplier input did not affect the Boss report');
const defaultSurvivalRules = {
  easyEndSeconds: defaults.speedTiming.easyEndSeconds,
  winSeconds: defaults.speedTiming.winSeconds,
  maxSpeedLeadSeconds: defaults.speedTiming.maxSpeedLeadSeconds,
};
near(getSpeedRampEndSecondsForRules(defaultSurvivalRules), 840, 'Balance speed-ramp end');
const finalBossReport = cloneBalanceSettings(defaults); finalBossReport.timeSeconds = 840;
assert(calculateBalance(finalBossReport).boss.guaranteedFinalBossDue,
  'Balance report did not represent the guaranteed final Boss separately');

const deterministicA = calculateBalance(defaults);
const deterministicB = calculateBalance(cloneBalanceSettings(defaults));
assert(JSON.stringify(deterministicA) === JSON.stringify(deterministicB), 'Monte Carlo output was not deterministic');
const reset = createGameDefaultBalanceSettings();
assert(reset.timeSeconds === 360 && reset.playerLevel === GAME_CONFIG.progression.startingLevel
  && reset.powers.GUN === 0 && reset.density.override === null,
  'Reset defaults were not restored');
assert(JSON.stringify(reset.speed.start) === JSON.stringify({ SLOW: 2, MEDIUM: 3, FAST: 4, RUSH: 5 }),
  'Reset did not restore canonical starting class speeds');
assert(JSON.stringify(reset.speed.max) === JSON.stringify({ SLOW: 12, MEDIUM: 14, FAST: 17, RUSH: 21 }),
  'Reset did not restore canonical maximum class speeds');
assert(reset.boss.entranceSpeed === 27, 'Reset did not restore canonical Boss entrance speed');
