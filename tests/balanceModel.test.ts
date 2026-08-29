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
  getMultiballSpeedMultiplier,
  getSplitBallCount,
  getWeightedAverageSpeed,
  getWindMaximumTargets,
} from '../src/balance/model';
import { GAME_CONFIG } from '../src/simulation/config';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function near(actual: number, expected: number, message: string, tolerance = 1e-8): void {
  assert(Math.abs(actual - expected) <= tolerance, `${message}: expected ${expected}, received ${actual}`);
}

const defaults = createGameDefaultBalanceSettings();
defaults.monteCarlo.samples = 700;
assert(defaults.ball.speed === GAME_CONFIG.ball.speed, 'Ball speed default drifted from game config');
assert(defaults.board.columns === GAME_CONFIG.bricks.columns, 'Column default drifted from game config');
assert(defaults.board.verticalPitch === GAME_CONFIG.bricks.brickHeight + GAME_CONFIG.bricks.verticalEdgeGap,
  'Vertical pitch default drifted from game geometry');
assert(defaults.boss.hp === 25 && defaults.armored.hp === 2, 'Boss/Armor defaults drifted');
assert(Object.values(defaults.powers).every((level) => level === 0), 'Power defaults were not all zero');

const early = cloneBalanceSettings(defaults); early.timeSeconds = 0;
const middle = cloneBalanceSettings(defaults); middle.timeSeconds = 6 * 60;
const late = cloneBalanceSettings(defaults); late.timeSeconds = 12 * 60;
assert(getDerivedDensity(early) < getDerivedDensity(middle), 'Time-driven density did not rise during ramp');
assert(getDerivedDensity(middle) < getDerivedDensity(late), 'Time-driven density did not reach enrage');
const earlyReport = calculateBalance(early);
const lateReport = calculateBalance(late);
assert(lateReport.weightedAverageSpeed > earlyReport.weightedAverageSpeed, 'Time-driven speed did not rise');
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
near(getGunMaxDps(1), 2 / GAME_CONFIG.powers.gunReloadSeconds, 'Gun Lv1 cadence');
near(getMissileMaxDps(1), 1 / GAME_CONFIG.powers.missileReloadSeconds, 'Missile Lv1 cadence');
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

const faster = cloneBalanceSettings(defaults); faster.speed.averageOverride = calculateBalance(defaults).weightedAverageSpeed * 1.5;
assert(calculateBalance(faster).boardHpPerSecond.likely >= calculateBalance(defaults).boardHpPerSecond.likely,
  'Higher brick speed reduced incoming HP/s');

const deterministicA = calculateBalance(defaults);
const deterministicB = calculateBalance(cloneBalanceSettings(defaults));
assert(JSON.stringify(deterministicA) === JSON.stringify(deterministicB), 'Monte Carlo output was not deterministic');
const reset = createGameDefaultBalanceSettings();
assert(reset.timeSeconds === 360 && reset.powers.GUN === 0 && reset.density.override === null,
  'Reset defaults were not restored');
