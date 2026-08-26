import { GAME_CONFIG } from '../src/simulation/config';
import { applyBrickDamage, isBallKill, type BrickDestruction, type DamageSource } from '../src/simulation/combat';
import type { BrickState } from '../src/simulation/brickField';
import { createInitialGameState } from '../src/simulation/gameState';
import {
  acquirePower,
  createRunPowerState,
  getEligiblePowerIds,
  getMaxedPowerPairs,
  getPowerDescription,
  prepareNextPowerSelection,
  type PowerId,
} from '../src/simulation/powers';
import { rankElectricTargets, rankWindTargets, selectWindTargets } from '../src/simulation/powerTargeting';
import { resolveBrickDescentSpeed, type BrickSpeedClass } from '../src/simulation/difficulty';
import { getMultiballTargetSpeed, stepSimulation } from '../src/simulation/simulation';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertNear(actual: number, expected: number, message: string): void {
  assert(Math.abs(actual - expected) < 1e-6, `${message}: expected ${expected}, received ${actual}`);
}

function makeBrick(id: string, x: number, y: number, hp = 1): BrickState {
  return { id, rowId: 1, column: 0, x, y, width: 56, height: 20, speedClass: 'SLOW', hp, xpValue: 1, kind: 'NORMAL' };
}

function addBrick(state: ReturnType<typeof createInitialGameState>, brick: BrickState): void {
  const column = Math.max(0, Math.min(state.brickField.columns.length - 1, Math.round((brick.x - 42) / 60)));
  brick.column = column;
  state.brickField.columns[column].push(brick);
  state.brickField.columns[column].sort((left, right) => left.y - right.y);
}

function testBallKillCategory(): void {
  const source: BrickDestruction = { source: 'BALL', x: 0, y: 0, width: 56, height: 20 };
  assert(isBallKill(source), 'BALL destruction must qualify');
  for (const damageSource of ['GUN', 'ELECTRIC', 'FIRE', 'WIND'] as DamageSource[]) {
    assert(!isBallKill({ ...source, source: damageSource }), `${damageSource} must not qualify`);
  }
}

function testElectricRanking(): void {
  const source: BrickDestruction = { source: 'BALL', x: 600, y: 300, width: 56, height: 20 };
  const lateralThree = makeBrick('lateral-three', 600 + 3 * 60, 300);
  const upwardFour = makeBrick('upward-four', 600, 300 - 4 * 24);
  assert(rankElectricTargets(source, [upwardFour, lateralThree])[0].brick.id === 'lateral-three', '3 lateral must beat 4 upward');

  const nearUpper = makeBrick('near-upper', 600 + 2 * 60, 276);
  const nearLower = makeBrick('near-lower', 600 + 2 * 60, 324);
  assert(rankElectricTargets(source, [nearUpper, nearLower])[0].brick.id === 'near-lower', 'lower close-score target must win');

  const upwardTwo = makeBrick('upward-two', 600, 252);
  const lateralThreeAgain = makeBrick('lateral-three-again', 780, 300);
  assert(rankElectricTargets(source, [upwardTwo, lateralThreeAgain])[0].brick.id === 'lateral-three-again', 'same-column upward penalty must favor lateral');
  assert(rankElectricTargets(source, [upwardTwo])[0].brick.id === 'upward-two', 'same-column upward target must remain valid');
}

function testWindRanking(): void {
  const source: BrickDestruction = { source: 'BALL', x: 300, y: 300, width: 56, height: 20 };
  const nearest = makeBrick('nearest', 305, 250);
  const farther = makeBrick('farther', 290, 150);
  const below = makeBrick('below', 300, 350);
  const outsideLane = makeBrick('outside', 360, 250);
  const ranked = rankWindTargets(source, [farther, below, outsideLane, nearest]);
  assert(ranked.map(({ id }) => id).join(',') === 'nearest,farther', 'Wind must rank only overlapping targets nearest-above first');
}

function testSpeeds(): void {
  const expected: Record<number, Record<BrickSpeedClass, number>> = {
    1: { SLOW: 3, MEDIUM: 4, FAST: 5, RUSH: 6 },
    5: { SLOW: 6.6, MEDIUM: 8.2666666667, FAST: 9.9333333333, RUSH: 11.6 },
    10: { SLOW: 11.1, MEDIUM: 13.6, FAST: 16.1, RUSH: 18.6 },
    15: { SLOW: 15.6, MEDIUM: 18.9333333333, FAST: 22.2666666667, RUSH: 25.6 },
  };
  for (const [levelText, speeds] of Object.entries(expected)) {
    const level = Number(levelText);
    let weighted = 0;
    let totalWeight = 0;
    for (const entry of GAME_CONFIG.bricks.speedClassDistribution) {
      assertNear(resolveBrickDescentSpeed(entry.speedClass, level), speeds[entry.speedClass], `L${level} ${entry.speedClass}`);
      weighted += resolveBrickDescentSpeed(entry.speedClass, level) * entry.weight;
      totalWeight += entry.weight;
    }
    assertNear(weighted / totalWeight, 3.6 + level - 1, `L${level} weighted average`);
  }
}

function acquireToMax(state: ReturnType<typeof createInitialGameState>, id: PowerId): void {
  for (let level = 1; level <= 5; level += 1) {
    state.powers.currentChoices = [id];
    state.powers.pendingSelections = 1;
    assert(acquirePower(state, id), `failed to acquire ${id} Lv${level}`);
  }
}

function testOffersAndMaxPairs(): void {
  const powers = createRunPowerState();
  const eligible = getEligiblePowerIds(powers);
  assert(eligible.join(',') === 'GUN,PIERCING_BALL,SPLITTING_BALL,ELECTRIC_BALL,FIRE_BALL,WIND_BALL', 'active offer pool mismatch');
  assert(!eligible.includes('PADDLE_SIZE'), 'Paddle Size must be disabled');
  const appearances = new Map<PowerId, number>();
  for (let draw = 0; draw < 600; draw += 1) {
    powers.pendingSelections = 1;
    assert(prepareNextPowerSelection(powers), 'offer generation failed');
    for (const id of powers.currentChoices) appearances.set(id, (appearances.get(id) ?? 0) + 1);
    powers.currentChoices = [];
  }
  for (const id of eligible) assert((appearances.get(id) ?? 0) > 250, `${id} offer frequency unexpectedly low`);

  const state = createInitialGameState();
  for (const id of ['GUN', 'FIRE_BALL', 'ELECTRIC_BALL', 'WIND_BALL'] as PowerId[]) acquireToMax(state, id);
  assert(state.powers.maxedPowerOrder.join(',') === 'GUN,FIRE_BALL,ELECTRIC_BALL,WIND_BALL', 'MAX order mismatch');
  assert(JSON.stringify(getMaxedPowerPairs(state.powers)) === JSON.stringify([['GUN', 'FIRE_BALL'], ['ELECTRIC_BALL', 'WIND_BALL']]), 'MAX pairs mismatch');
  state.powers.currentChoices = ['GUN'];
  assert(!acquirePower(state, 'GUN'), 'MAX power must not reacquire');
  assert(state.powers.maxedPowerOrder.filter((id) => id === 'GUN').length === 1, 'MAX power appended twice');
  assert(createInitialGameState().powers.maxedPowerOrder.length === 0, 'new run did not clear MAX order');
}

function testPiercedBallKillProcs(): void {
  const state = createInitialGameState();
  state.brickField.columns.forEach((column) => column.splice(0));
  state.powers.levels.PIERCING_BALL = 5;
  state.powers.levels.ELECTRIC_BALL = 1;
  state.powers.levels.FIRE_BALL = 1;
  state.powers.levels.WIND_BALL = 1;
  const ball = state.balls[0];
  ball.pierceCharge = 5;
  for (let kill = 0; kill < 5; kill += 1) {
    state.brickField.columns.forEach((column) => column.splice(0));
    state.projectiles.length = 0;
    state.fireEffects.length = 0;
    state.windEffects.length = 0;
    addBrick(state, makeBrick(`entry-blocker-${kill}`, 42, 8));
    addBrick(state, makeBrick(`source-${kill}`, 500, 300));
    addBrick(state, makeBrick(`electric-${kill}`, 680, 300));
    addBrick(state, makeBrick(`wind-${kill}`, 500, 260));
    ball.x = 520; ball.y = 280; ball.velocity.x = 0; ball.velocity.y = 240;
    stepSimulation(state, { movementAxis: 0, mouseDisplacement: 0, speedMultiplier: 1 }, 0.05, 0.05);
    assert(state.projectiles.length === 1, `pierced kill ${kill + 1} missed Electric`);
    assert(state.fireEffects.length === 1, `pierced kill ${kill + 1} missed Fire`);
    assert(state.windEffects.length === 1, `pierced kill ${kill + 1} missed Wind`);
  }
}

function testWindLevelsAndNoRecursion(): void {
  for (let level = 1; level <= 5; level += 1) {
    const state = createInitialGameState();
    state.brickField.columns.forEach((column) => column.splice(0));
    state.powers.levels.WIND_BALL = level;
    const source = makeBrick('source', 500, 400);
    addBrick(state, source);
    for (let space = 1; space <= 7; space += 1) addBrick(state, makeBrick(`above-${space}`, 500, 400 - space * 24));
    addBrick(state, makeBrick('below', 500, 450));
    const destruction = applyBrickDamage(state, source, 1, 'BALL');
    assert(isBallKill(destruction), 'test source was not a BALL kill');
    const expectedCount = level === 5 ? 7 : level + 1;
    const targets = selectWindTargets(level, destruction, state.brickField.columns.flat());
    assert(targets.length === expectedCount, `Wind Lv${level} target count mismatch`);
    const xpBefore = state.progression.currentXp;
    for (const target of targets) applyBrickDamage(state, target, 1, 'WIND');
    assert(state.progression.currentXp === xpBefore + expectedCount, `Wind Lv${level} XP mismatch`);
    assert(state.projectiles.length === 0 && state.fireEffects.length === 0 && state.windEffects.length === 0, 'WIND damage recursively proc\u2019d powers');
  }

  const source: BrickDestruction = { source: 'BALL', x: 500, y: 400, width: 56, height: 20 };
  const inSecondSpace = makeBrick('space-2', 500, 352);
  const beyondSecondSpace = makeBrick('space-3', 500, 328);
  assert(
    selectWindTargets(1, source, [beyondSecondSpace]).length === 0,
    'Wind Lv1 searched beyond its two-space range to fill a target quota',
  );
  assert(
    selectWindTargets(1, source, [inSecondSpace, beyondSecondSpace]).map(({ id }) => id).join(',') === 'space-2',
    'Wind Lv1 must hit a brick in space 2 without reaching space 3',
  );
}

function testMultiballTargetSpeeds(): void {
  const expected = [240, 228, 216, 204, 192, 180, 180];
  for (let count = 1; count <= expected.length; count += 1) {
    assertNear(getMultiballTargetSpeed(count), expected[count - 1], `${count}-ball target speed`);
  }
}

function testSplittingTuningAndAcquisition(): void {
  assert(GAME_CONFIG.powers.splittingIntervalSeconds === 15, 'Splitting interval must be 15 seconds');
  assert(getPowerDescription('SPLITTING_BALL', 1, true).includes('15 seconds'), 'Splitting selection text is stale');
  assert(getPowerDescription('SPLITTING_BALL', 3, false).includes('15 seconds'), 'Splitting current text is stale');

  const state = createInitialGameState();
  state.powers.currentChoices = ['SPLITTING_BALL'];
  state.powers.pendingSelections = 1;
  assert(acquirePower(state, 'SPLITTING_BALL'), 'initial Splitting acquisition failed');
  assert(state.balls.length === 2, 'initial Splitting acquisition did not split immediately');
  state.powers.splitTimerSeconds = 7.5;
  state.powers.currentChoices = ['SPLITTING_BALL'];
  state.powers.pendingSelections = 1;
  assert(acquirePower(state, 'SPLITTING_BALL'), 'Splitting upgrade failed');
  assert(state.balls.length === 2, 'Splitting upgrade incorrectly caused an immediate split');
  assertNear(state.powers.splitTimerSeconds, 7.5, 'Splitting upgrade timer progress');
}

function testGunCadence(): void {
  const state = createInitialGameState();
  state.brickField.columns.forEach((column) => column.splice(0));
  addBrick(state, makeBrick('entry-blocker', 42, 8));
  state.powers.levels.GUN = 5;
  state.powers.gunVolleysRemaining = 5;
  const input = { movementAxis: 0, mouseDisplacement: 0, speedMultiplier: 1 };
  const volleyTimes: number[] = [];
  let priorProjectileCount = 0;
  for (let step = 0; step < 120; step += 1) {
    stepSimulation(state, input, 1 / 120, 1 / 120);
    if (state.projectiles.length > priorProjectileCount) {
      volleyTimes.push(step / 120);
      priorProjectileCount = state.projectiles.length;
    }
    if (state.powers.gunReloadSeconds > 0) break;
  }
  assert(state.projectiles.length === 10, 'Gun Lv5 did not fire ten bullets');
  assert(volleyTimes.length === 5, 'Gun Lv5 did not fire five volleys');
  for (let index = 1; index < volleyTimes.length; index += 1) {
    assert(
      Math.abs(volleyTimes[index] - volleyTimes[index - 1] - 0.1) <= GAME_CONFIG.fixedStepSeconds + 1e-9,
      `Gun volley interval ${index} exceeded fixed-step tolerance`,
    );
  }
  assertNear(state.powers.gunReloadSeconds, 4, 'Gun reload duration');
}

testBallKillCategory();
testElectricRanking();
testWindRanking();
testSpeeds();
testOffersAndMaxPairs();
testPiercedBallKillProcs();
testWindLevelsAndNoRecursion();
testMultiballTargetSpeeds();
testSplittingTuningAndAcquisition();
testGunCadence();
