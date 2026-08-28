import { GAME_CONFIG } from '../src/simulation/config';
import { applyBrickDamage, isBallKill, type BrickDestruction, type DamageSource } from '../src/simulation/combat';
import type { BrickState } from '../src/simulation/brickField';
import { createInitialGameState, prepareSingleBall } from '../src/simulation/gameState';
import {
  acquirePower,
  banPowerChoice,
  createRunPowerState,
  getEligiblePowerIds,
  getMaxedPowerPairs,
  getPowerDescription,
  prepareNextPowerSelection,
  rerollPowerChoices,
  type PowerId,
} from '../src/simulation/powers';
import {
  rankElectricTargets,
  rankWindTargets,
  selectMissileTarget,
  selectWindTargets,
} from '../src/simulation/powerTargeting';
import { resolveBrickDescentSpeed, type BrickSpeedClass } from '../src/simulation/difficulty';
import { getBallTargetSpeed, stepSimulation } from '../src/simulation/simulation';
import { getPaddleBounceElevationDegrees } from '../src/simulation/paddleBounce';

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
  for (const damageSource of ['GUN', 'ELECTRIC', 'FIRE', 'WIND', 'MISSILE'] as DamageSource[]) {
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

function runSecondaryElectricTargetingScenario(candidates: BrickState[]): string | undefined {
  const state = createInitialGameState();
  state.brickField.columns.forEach((column) => column.splice(0));
  addBrick(state, makeBrick('entry-blocker', 42, 8));
  const primary = makeBrick('primary-origin', 600, 300, 2);
  addBrick(state, primary);
  for (const candidate of candidates) addBrick(state, candidate);
  state.electricProcs.push({
    id: 1,
    primaryTargetIds: new Set([primary.id]),
    secondaryTargetIds: new Set(),
    activeProjectileCount: 1,
  });
  state.nextElectricProcId = 2;
  state.projectiles.push({
    id: state.nextProjectileId++,
    kind: 'ELECTRIC',
    x: primary.x + primary.width / 2,
    y: primary.y + primary.height / 2,
    velocity: { x: 0, y: 0 },
    damage: 1,
    targetBrickId: primary.id,
    electricProcId: 1,
    electricGeneration: 'PRIMARY',
  });
  const ball = state.balls[0];
  ball.x = 1000; ball.y = 600; ball.velocity.x = 0; ball.velocity.y = 0;
  stepSimulation(state, { movementAxis: 0, mouseDisplacement: 0, speedMultiplier: 1 }, 1 / 120, 1 / 120);
  return state.projectiles.find(({ electricGeneration }) => electricGeneration === 'SECONDARY')?.targetBrickId;
}

function testSecondaryElectricUsesSharedScoring(): void {
  const lateralThree = makeBrick('secondary-lateral-three', 600 + 3 * 60, 300);
  const upwardFour = makeBrick('secondary-upward-four', 600, 300 - 4 * 24);
  assert(
    runSecondaryElectricTargetingScenario([upwardFour, lateralThree]) === lateralThree.id,
    'secondary Electric did not prefer three lateral tiles over four same-column upward tiles',
  );

  const slightlyHigher = makeBrick('secondary-higher', 600 + 2 * 60, 276);
  const slightlyLower = makeBrick('secondary-lower', 600 + 2 * 60, 324);
  assert(
    runSecondaryElectricTargetingScenario([slightlyHigher, slightlyLower]) === slightlyLower.id,
    'secondary Electric did not apply the shared lower-target preference',
  );

  const onlyUpward = makeBrick('secondary-only-upward', 600, 252);
  assert(
    runSecondaryElectricTargetingScenario([onlyUpward]) === onlyUpward.id,
    'secondary Electric treated the upward penalty as a hard exclusion',
  );
}

function createElectricProcScenario(level: number) {
  const state = createInitialGameState();
  state.brickField.columns.forEach((column) => column.splice(0));
  addBrick(state, makeBrick('entry-blocker', 42, 8));
  addBrick(state, makeBrick('electric-source', 602, 500));
  for (const [index, x] of [422, 482, 542, 662, 722, 782].entries()) {
    addBrick(state, makeBrick(`primary-${index}`, x, 500, 2));
  }
  state.powers.levels.ELECTRIC_BALL = level;
  const ball = state.balls[0];
  ball.x = 630; ball.y = 535; ball.velocity.x = 0; ball.velocity.y = -240;
  stepSimulation(state, { movementAxis: 0, mouseDisplacement: 0, speedMultiplier: 1 }, 0.05, 0.05);
  ball.x = 1000; ball.y = 600; ball.velocity.x = 0; ball.velocity.y = 0;
  return state;
}

function addElectricSecondaryCandidates(state: ReturnType<typeof createInitialGameState>, count: number): void {
  for (const [index, x] of [422, 482, 542, 662, 722, 782].slice(0, count).entries()) {
    addBrick(state, makeBrick(`secondary-${index}`, x, 404, 10));
  }
}

function advanceElectricScenario(
  state: ReturnType<typeof createInitialGameState>,
  maximumSteps = 240,
  onSecondary?: (targetId: string) => void,
): Set<string> {
  const seenProjectileIds = new Set<number>();
  const secondaryTargets = new Set<string>();
  for (let step = 0; step < maximumSteps; step += 1) {
    for (const projectile of state.projectiles) {
      if (projectile.electricGeneration !== 'SECONDARY' || seenProjectileIds.has(projectile.id)) continue;
      seenProjectileIds.add(projectile.id);
      assert(projectile.targetBrickId, 'secondary Electric projectile has no target');
      secondaryTargets.add(projectile.targetBrickId);
      onSecondary?.(projectile.targetBrickId);
    }
    if (state.electricProcs.length === 0 && !state.projectiles.some(({ kind }) => kind === 'ELECTRIC')) break;
    stepSimulation(state, { movementAxis: 0, mouseDisplacement: 0, speedMultiplier: 1 }, 1 / 120, 1 / 120);
  }
  return secondaryTargets;
}

function testElectricPrimaryProgressionAndChains(): void {
  const expectedPrimaryCounts = [2, 3, 4, 5, 5];
  for (let level = 1; level <= 5; level += 1) {
    const state = createElectricProcScenario(level);
    const primaries = state.projectiles.filter(({ kind }) => kind === 'ELECTRIC');
    const primaryTargetIds = new Set(primaries.map(({ targetBrickId }) => targetBrickId));
    assert(primaries.length === expectedPrimaryCounts[level - 1], `Electric Lv${level} primary count mismatch`);
    assert(new Set(primaries.map(({ targetBrickId }) => targetBrickId)).size === primaries.length, `Electric Lv${level} duplicated a primary target`);
    addElectricSecondaryCandidates(state, 6);
    const secondaryTargets = advanceElectricScenario(state);
    if (level < 5) {
      assert(secondaryTargets.size === 0, `Electric Lv${level} incorrectly chained`);
    } else {
      assert(secondaryTargets.size === 5, `Electric Lv5 did not reserve five unique secondary targets: ${[...secondaryTargets].join(',')}`);
      assert(
        [...secondaryTargets].every((id) => !primaryTargetIds.has(id)),
        'Electric Lv5 selected a primary target as a secondary target',
      );
      assert(state.electricProcs.length === 0, 'completed Electric proc state was not cleaned up');
    }
  }
}

function testElectricLimitedAndDeadSecondaryTargets(): void {
  const limited = createElectricProcScenario(5);
  addElectricSecondaryCandidates(limited, 2);
  const limitedTargets = advanceElectricScenario(limited);
  assert(limitedTargets.size === 3, 'Electric Lv5 relaxed uniqueness when only three non-primary targets existed');

  const interrupted = createElectricProcScenario(5);
  addElectricSecondaryCandidates(interrupted, 6);
  let destroyedTargetId: string | undefined;
  const targetHistory: string[] = [];
  advanceElectricScenario(interrupted, 240, (targetId) => {
    targetHistory.push(targetId);
    if (destroyedTargetId) return;
    destroyedTargetId = targetId;
    const target = interrupted.brickField.columns.flat().find(({ id }) => id === targetId);
    if (target) applyBrickDamage(interrupted, target, target.hp, 'GUN');
  });
  assert(destroyedTargetId !== undefined, 'dead-target Electric scenario never created a secondary');
  assert(targetHistory.filter((id) => id === destroyedTargetId).length === 1, 'dead reserved secondary target was reused');
  assert(new Set(targetHistory).size === targetHistory.length, 'asynchronous secondary reservations duplicated a target');
  assert(targetHistory.length <= 5, 'secondary Electric hits created a tertiary chain');
}

function createDirectionalProcScenario(power: 'FIRE_BALL' | 'WIND_BALL', level: number) {
  const state = createInitialGameState();
  state.brickField.columns.forEach((column) => column.splice(0));
  addBrick(state, makeBrick('entry-blocker', 42, 8));
  addBrick(state, makeBrick('source', 602, 400));
  state.powers.levels[power] = level;
  const ball = state.balls[0];
  ball.x = 630; ball.y = 435; ball.velocity.x = 0; ball.velocity.y = -240;
  return { state, ball };
}

function testFireWidthsAndVisuals(): void {
  const radiusSpaces = [1, 2, 3, 4, 4];
  for (let level = 1; level <= 5; level += 1) {
    const { state } = createDirectionalProcScenario('FIRE_BALL', level);
    for (let space = -9; space <= 9; space += 1) {
      if (space !== 0) addBrick(state, makeBrick(`fire-${space}`, 602 + space * 60, 400));
    }
    stepSimulation(state, { movementAxis: 0, mouseDisplacement: 0, speedMultiplier: 1 }, 0.05, 0.05);
    const survivingSpaces = state.brickField.columns.flat()
      .filter(({ id }) => id.startsWith('fire-'))
      .map(({ id }) => Number(id.slice(5)));
    const radius = radiusSpaces[level - 1];
    for (let space = -9; space <= 9; space += 1) {
      if (space === 0) continue;
      assert(survivingSpaces.includes(space) === (Math.abs(space) > radius), `Fire Lv${level} range mismatch at space ${space}`);
    }
    const effect = state.fireEffects[0];
    assert(effect, `Fire Lv${level} visual missing`);
    const expectedX1 = 630 - radius * 60;
    const expectedX2 = 630 + radius * 60;
    assertNear(effect.x1, expectedX1, `Fire Lv${level} visual left edge`);
    assertNear(effect.x2, expectedX2, `Fire Lv${level} visual right edge`);
  }

  for (const [sourceX, expectedEdge, edgeKey] of [
    [42, GAME_CONFIG.playfield.left, 'x1'],
    [1182, GAME_CONFIG.playfield.right, 'x2'],
  ] as const) {
    const state = createInitialGameState();
    state.brickField.columns.forEach((column) => column.splice(0));
    addBrick(state, makeBrick('entry-blocker', 42, 8));
    addBrick(state, makeBrick('edge-source', sourceX, 400));
    state.powers.levels.FIRE_BALL = 1;
    const ball = state.balls[0];
    ball.x = sourceX + 28; ball.y = 435; ball.velocity.x = 0; ball.velocity.y = -240;
    stepSimulation(state, { movementAxis: 0, mouseDisplacement: 0, speedMultiplier: 1 }, 0.05, 0.05);
    assertNear(state.fireEffects[0][edgeKey], expectedEdge, `Fire visual did not clip at ${edgeKey} boundary`);
  }

  const levelFive = createDirectionalProcScenario('FIRE_BALL', 5).state;
  for (let row = -2; row <= 2; row += 1) {
    for (let column = -5; column <= 5; column += 1) {
      if (row === 0 && column === 0) continue;
      addBrick(levelFive, makeBrick(`fire-grid-${row}-${column}`, 602 + column * 60, 400 + row * 24));
    }
  }
  stepSimulation(levelFive, { movementAxis: 0, mouseDisplacement: 0, speedMultiplier: 1 }, 0.05, 0.05);
  const survivors = new Set(levelFive.brickField.columns.flat().map(({ id }) => id));
  for (let row = -2; row <= 2; row += 1) {
    for (let column = -5; column <= 5; column += 1) {
      if (row === 0 && column === 0) continue;
      const shouldBeHit = Math.abs(row) <= 1 && Math.abs(column) <= 4;
      assert(survivors.has(`fire-grid-${row}-${column}`) !== shouldBeHit, `Fire Lv5 geometry mismatch at ${row},${column}`);
    }
  }
  assert(levelFive.fireEffects[0].additionalYs?.length === 2, 'Fire Lv5 visual did not show three rows');
}

function testWindRangesAndVisuals(): void {
  for (let level = 1; level <= 5; level += 1) {
    const { state } = createDirectionalProcScenario('WIND_BALL', level);
    for (let space = 1; space <= 8; space += 1) {
      addBrick(state, makeBrick(`wind-space-${space}`, 602, 400 - space * 24));
    }
    stepSimulation(state, { movementAxis: 0, mouseDisplacement: 0, speedMultiplier: 1 }, 0.05, 0.05);
    const survivingSpaces = state.brickField.columns.flat()
      .filter(({ id }) => id.startsWith('wind-space-'))
      .map(({ id }) => Number(id.slice('wind-space-'.length)));
    const range = level === 5 ? 7 : GAME_CONFIG.powers.windRangeSpacesByLevel[level - 1];
    for (let space = 1; space <= 8; space += 1) {
      assert(survivingSpaces.includes(space) === (space > range), `Wind Lv${level} range mismatch at space ${space}`);
    }
    const effect = state.windEffects[0];
    assert(effect, `Wind Lv${level} visual missing`);
    assertNear(
      effect.y1,
      effect.y2 - range * 24,
      `Wind Lv${level} visual top`,
    );
  }
  assert(getPowerDescription('FIRE_BALL', 1, false).includes('3-brick-wide'), 'Fire Lv1 description stale');
  assert(getPowerDescription('FIRE_BALL', 4, false).includes('9-brick-wide'), 'Fire Lv4 description stale');
  assert(getPowerDescription('WIND_BALL', 1, false).includes('4 spaces'), 'Wind Lv1 description stale');
  assert(getPowerDescription('ELECTRIC_BALL', 5, false).includes('chaining once'), 'Electric Lv5 description stale');
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
  assert(eligible.join(',') === 'GUN,PIERCING_BALL,SPLITTING_BALL,PADDLE_SIZE,ELECTRIC_BALL,FIRE_BALL,WIND_BALL,HOMING_MISSILE', 'active offer pool mismatch');
  assert(eligible.includes('PADDLE_SIZE'), 'Paddle Size must be offer-eligible');
  const appearances = new Map<PowerId, number>();
  for (let draw = 0; draw < 600; draw += 1) {
    powers.pendingSelections = 1;
    assert(prepareNextPowerSelection(powers), 'offer generation failed');
    for (const id of powers.currentChoices) if (id) appearances.set(id, (appearances.get(id) ?? 0) + 1);
    powers.currentChoices = [];
  }
  for (const id of eligible) assert((appearances.get(id) ?? 0) > 180, `${id} offer frequency unexpectedly low`);

  const state = createInitialGameState();
  for (const id of ['GUN', 'FIRE_BALL', 'ELECTRIC_BALL', 'WIND_BALL', 'HOMING_MISSILE'] as PowerId[]) acquireToMax(state, id);
  assert(state.powers.maxedPowerOrder.join(',') === 'GUN,FIRE_BALL,ELECTRIC_BALL,WIND_BALL,HOMING_MISSILE', 'MAX order mismatch');
  assert(JSON.stringify(getMaxedPowerPairs(state.powers)) === JSON.stringify([['GUN', 'FIRE_BALL'], ['ELECTRIC_BALL', 'WIND_BALL']]), 'MAX pairs mismatch');
  state.powers.currentChoices = ['GUN'];
  assert(!acquirePower(state, 'GUN'), 'MAX power must not reacquire');
  assert(state.powers.maxedPowerOrder.filter((id) => id === 'GUN').length === 1, 'MAX power appended twice');
  assert(createInitialGameState().powers.maxedPowerOrder.length === 0, 'new run did not clear MAX order');
}

function testTargetedBanAndRerollResources(): void {
  const powers = createRunPowerState();
  powers.pendingSelections = 1;
  powers.currentChoices = ['GUN', 'FIRE_BALL', 'WIND_BALL'];
  const initialRerolls = powers.rerollsRemaining;
  assert(banPowerChoice(powers, 'WIND_BALL'), 'targeted ban failed');
  assert(powers.bannedPowerIds.has('WIND_BALL'), 'banned power was not retained');
  assert(powers.bansRemaining === 0, 'ban resource was not consumed exactly once');
  assert(powers.rerollsRemaining === initialRerolls, 'ban consumed a full reroll');
  assert(powers.currentChoices[0] === 'GUN' && powers.currentChoices[1] === 'FIRE_BALL', 'ban regenerated unaffected slots');
  const replacement = powers.currentChoices[2];
  assert(replacement !== null && replacement !== 'WIND_BALL', 'banned power immediately returned');
  assert(!powers.currentChoices.slice(0, 2).includes(replacement), 'targeted replacement duplicated another card');
  assert(powers.pendingSelections === 1, 'ban consumed the level-up reward');
  assert(!getEligiblePowerIds(powers).includes('WIND_BALL'), 'central eligibility retained banned power');
  assert(rerollPowerChoices(powers), 'full reroll was unavailable after ban');
  assert(powers.rerollsRemaining === initialRerolls - 1, 'full reroll resource was not consumed normally');
  assert(!powers.currentChoices.includes('WIND_BALL'), 'banned power returned through full reroll');

  const repeat = createRunPowerState();
  repeat.pendingSelections = 1;
  repeat.currentChoices = ['GUN', 'FIRE_BALL', 'WIND_BALL'];
  assert(banPowerChoice(repeat, 'WIND_BALL'), 'deterministic repeat ban failed');
  assert(repeat.currentChoices[2] === replacement, 'targeted replacement was not deterministic');
}

function testOwnedBanAndNoReplacement(): void {
  const owned = createRunPowerState();
  owned.levels.GUN = 2;
  owned.ownedOrder = ['GUN'];
  owned.pendingSelections = 1;
  owned.currentChoices = ['GUN', 'FIRE_BALL', 'WIND_BALL'];
  assert(banPowerChoice(owned, 'GUN'), 'owned power ban failed');
  assert(owned.levels.GUN === 2 && owned.ownedOrder.includes('GUN'), 'owned power ban removed current power');
  assert(!getEligiblePowerIds(owned).includes('GUN'), 'owned banned power remained upgrade-eligible');
  assert(owned.currentChoices[1] === 'FIRE_BALL' && owned.currentChoices[2] === 'WIND_BALL', 'owned ban changed other slots');

  const capped = createRunPowerState();
  capped.ownedOrder = ['GUN', 'FIRE_BALL', 'WIND_BALL', 'ELECTRIC_BALL', 'PIERCING_BALL'];
  capped.levels = { GUN: 1, FIRE_BALL: 1, WIND_BALL: 1, ELECTRIC_BALL: 5, PIERCING_BALL: 5 };
  capped.maxedPowerOrder = ['ELECTRIC_BALL', 'PIERCING_BALL'];
  capped.pendingSelections = 1;
  capped.currentChoices = ['GUN', 'FIRE_BALL', 'WIND_BALL'];
  assert(banPowerChoice(capped, 'WIND_BALL'), 'no-replacement ban failed');
  assert(
    capped.currentChoices[0] === 'GUN'
      && capped.currentChoices[1] === 'FIRE_BALL'
      && capped.currentChoices[2] === null,
    'unavailable replacement did not leave only its slot empty',
  );
  assert(capped.pendingSelections === 1, 'empty slot discarded a still-selectable reward');
  assert(capped.maxedPowerOrder.join(',') === 'ELECTRIC_BALL,PIERCING_BALL', 'ban changed MAX history');

  const noOptions = createRunPowerState();
  for (const id of getEligiblePowerIds(noOptions)) {
    if (id !== 'WIND_BALL') noOptions.bannedPowerIds.add(id);
  }
  noOptions.pendingSelections = 1;
  noOptions.currentChoices = ['WIND_BALL'];
  assert(banPowerChoice(noOptions, 'WIND_BALL'), 'last-option ban failed');
  assert(noOptions.pendingSelections === 0 && noOptions.currentChoices.length === 0, 'no-eligible reward handling soft-locked');
}

function testBanRunLifetime(): void {
  const state = createInitialGameState();
  state.powers.pendingSelections = 1;
  state.powers.currentChoices = ['GUN', 'FIRE_BALL', 'WIND_BALL'];
  assert(banPowerChoice(state.powers, 'WIND_BALL'), 'run-lifetime ban failed');
  prepareSingleBall(state);
  assert(state.powers.bannedPowerIds.has('WIND_BALL') && state.powers.bansRemaining === 0, 'life replacement cleared ban state');
  state.powers.pendingSelections = 3;
  state.powers.currentChoices = [];
  assert(prepareNextPowerSelection(state.powers), 'queued selection after ban failed');
  assert(!state.powers.currentChoices.includes('WIND_BALL'), 'banned power returned in queued selection');

  const restarted = createInitialGameState();
  assert(restarted.powers.bansRemaining === GAME_CONFIG.powers.startingBans, 'restart did not restore starting bans');
  assert(restarted.powers.bannedPowerIds.size === 0, 'restart retained banned powers');
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
    assert(state.projectiles.some(({ kind }) => kind === 'ELECTRIC'), `pierced kill ${kill + 1} missed Electric`);
    assert(state.fireEffects.length === 1, `pierced kill ${kill + 1} missed Fire`);
    assert(state.windEffects.length === 1, `pierced kill ${kill + 1} missed Wind`);
  }
}

type PierceApproach = 'BOTTOM' | 'TOP' | 'LEFT_UPWARD' | 'LEFT_DOWNWARD' | 'RIGHT';

function runPierceCollision(level: number, hp: number, approach: PierceApproach) {
  const state = createInitialGameState();
  state.brickField.columns.forEach((column) => column.splice(0));
  addBrick(state, makeBrick('entry-blocker', 42, 8));
  addBrick(state, makeBrick('pierce-target', 500, 300, hp));
  state.powers.levels.PIERCING_BALL = level;
  const ball = state.balls[0];
  ball.pierceCharge = level;
  let deltaSeconds = 0.05;
  if (approach === 'BOTTOM') {
    ball.x = 528; ball.y = 335; ball.velocity.x = 0; ball.velocity.y = -240;
  } else if (approach === 'TOP') {
    ball.x = 528; ball.y = 285; ball.velocity.x = 0; ball.velocity.y = 240;
  } else if (approach === 'LEFT_UPWARD' || approach === 'LEFT_DOWNWARD') {
    const horizontalSpeed = 200;
    ball.x = 480; ball.y = approach === 'LEFT_UPWARD' ? 315 : 295;
    ball.velocity.x = horizontalSpeed;
    ball.velocity.y = Math.sqrt(GAME_CONFIG.ball.speed ** 2 - horizontalSpeed ** 2)
      * (approach === 'LEFT_UPWARD' ? -1 : 1);
    deltaSeconds = 0.06;
  } else {
    const horizontalSpeed = 200;
    ball.x = 576; ball.y = 310;
    ball.velocity.x = -horizontalSpeed;
    ball.velocity.y = -Math.sqrt(GAME_CONFIG.ball.speed ** 2 - horizontalSpeed ** 2);
    deltaSeconds = 0.06;
  }
  stepSimulation(state, { movementAxis: 0, mouseDisplacement: 0, speedMultiplier: 1 }, deltaSeconds, deltaSeconds);
  return { state, ball };
}

function testDirectionalPiercePassThrough(): void {
  const bottom = runPierceCollision(1, 1, 'BOTTOM');
  assert(!bottom.state.brickField.columns.flat().some(({ id }) => id === 'pierce-target'), 'bottom Pierce did not destroy 1 HP brick');
  assert(bottom.ball.velocity.y < 0, 'bottom Pierce unexpectedly bounced');
  assert(bottom.ball.pierceCharge === 0, 'bottom Pierce did not consume charge');

  const top = runPierceCollision(1, 1, 'TOP');
  assert(top.ball.velocity.y < 0, 'top Pierce passed through instead of bouncing');
  assert(top.ball.pierceCharge === 1, 'top destructive bounce did not reload Pierce');

  const leftUpward = runPierceCollision(1, 1, 'LEFT_UPWARD');
  assert(leftUpward.ball.velocity.y < 0, 'side test no longer has upward vertical movement');
  assert(leftUpward.ball.velocity.x > 0, 'upward-moving LEFT collision bounced instead of passing through');
  assert(leftUpward.ball.pierceCharge === 0, 'LEFT pass-through did not consume Pierce');

  const right = runPierceCollision(1, 1, 'RIGHT');
  assert(right.ball.velocity.x < 0, 'RIGHT collision bounced instead of passing through');
  assert(right.ball.pierceCharge === 0, 'RIGHT pass-through did not consume Pierce');

  const leftDownward = runPierceCollision(1, 1, 'LEFT_DOWNWARD');
  assert(leftDownward.ball.velocity.y > 0, 'downward side test lost downward movement');
  assert(leftDownward.ball.velocity.x > 0, 'downward-moving side collision bounced instead of passing through');
  assert(leftDownward.ball.pierceCharge === 0, 'downward side pass-through did not consume Pierce');

  const insufficientSide = runPierceCollision(1, 2, 'LEFT_UPWARD');
  assert(insufficientSide.ball.velocity.x < 0, 'insufficient side Pierce passed through');
  assert(insufficientSide.ball.pierceCharge === 1, 'insufficient side Pierce did not reload');

  const insufficientBottom = runPierceCollision(1, 2, 'BOTTOM');
  assert(insufficientBottom.ball.velocity.y > 0, 'insufficient bottom Pierce passed through');
  assert(insufficientBottom.ball.pierceCharge === 1, 'insufficient bottom Pierce did not reload');

  const sufficientBottom = runPierceCollision(2, 2, 'BOTTOM');
  assert(sufficientBottom.ball.velocity.y < 0, 'sufficient bottom Pierce bounced');
  assert(sufficientBottom.ball.pierceCharge === 0, 'sufficient bottom Pierce consumed wrong charge');

  const sufficientTop = runPierceCollision(2, 2, 'TOP');
  assert(sufficientTop.ball.velocity.y < 0, 'sufficient top Pierce passed through instead of bouncing');
  assert(sufficientTop.ball.pierceCharge === 2, 'sufficient top destructive bounce did not reload');

  const highLevelTop = runPierceCollision(5, 1, 'TOP');
  assert(highLevelTop.ball.velocity.y < 0, 'high-level top Pierce passed through');
  assert(highLevelTop.ball.pierceCharge === 5, 'high-level top bounce did not reload');
}

function testDirectionalPierceBallKillProcs(): void {
  for (const approach of ['BOTTOM', 'TOP', 'LEFT_UPWARD'] as PierceApproach[]) {
    const state = createInitialGameState();
    state.brickField.columns.forEach((column) => column.splice(0));
    addBrick(state, makeBrick('entry-blocker', 42, 8));
    addBrick(state, makeBrick('source', 500, 300));
    addBrick(state, makeBrick('electric-target', 680, 300));
    state.powers.levels.PIERCING_BALL = 1;
    state.powers.levels.ELECTRIC_BALL = 1;
    state.powers.levels.FIRE_BALL = 1;
    state.powers.levels.WIND_BALL = 1;
    const ball = state.balls[0];
    ball.pierceCharge = 1;
    let deltaSeconds = 0.05;
    if (approach === 'BOTTOM') {
      ball.x = 528; ball.y = 335; ball.velocity.x = 0; ball.velocity.y = -240;
    } else if (approach === 'TOP') {
      ball.x = 528; ball.y = 285; ball.velocity.x = 0; ball.velocity.y = 240;
    } else {
      ball.x = 480; ball.y = 315; ball.velocity.x = 200;
      ball.velocity.y = -Math.sqrt(GAME_CONFIG.ball.speed ** 2 - 200 ** 2);
      deltaSeconds = 0.06;
    }
    stepSimulation(state, { movementAxis: 0, mouseDisplacement: 0, speedMultiplier: 1 }, deltaSeconds, deltaSeconds);
    assert(state.projectiles.some(({ kind }) => kind === 'ELECTRIC'), `${approach} BALL kill missed Electric proc`);
    assert(state.fireEffects.length === 1, `${approach} BALL kill missed Fire proc`);
    assert(state.windEffects.length === 1, `${approach} BALL kill missed Wind proc`);
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
    const expectedCount = level === 5 ? 7 : level + 3;
    const targets = selectWindTargets(level, destruction, state.brickField.columns.flat());
    assert(targets.length === expectedCount, `Wind Lv${level} target count mismatch`);
    const xpBefore = state.progression.currentXp;
    for (const target of targets) applyBrickDamage(state, target, 1, 'WIND');
    assert(state.progression.currentXp === xpBefore + expectedCount, `Wind Lv${level} XP mismatch`);
    assert(state.projectiles.length === 0 && state.fireEffects.length === 0 && state.windEffects.length === 0, 'WIND damage recursively proc\u2019d powers');
  }

  const source: BrickDestruction = { source: 'BALL', x: 500, y: 400, width: 56, height: 20 };
  const inFourthSpace = makeBrick('space-4', 500, 304);
  const beyondFourthSpace = makeBrick('space-5', 500, 280);
  assert(
    selectWindTargets(1, source, [beyondFourthSpace]).length === 0,
    'Wind Lv1 searched beyond its four-space range',
  );
  assert(
    selectWindTargets(1, source, [inFourthSpace, beyondFourthSpace]).map(({ id }) => id).join(',') === 'space-4',
    'Wind Lv1 must hit a brick in space 4 without reaching space 5',
  );
}

function testWindTornadoGeometry(): void {
  const source: BrickDestruction = { source: 'BALL', x: 602, y: 400, width: 56, height: 20 };
  const candidates: BrickState[] = [];
  for (let row = 1; row <= 8; row += 1) {
    for (let column = -2; column <= 2; column += 1) {
      candidates.push(makeBrick(`tornado-${row}-${column}`, 602 + column * 60, 400 - row * 24));
    }
  }
  const selected = new Set(selectWindTargets(5, source, candidates).map(({ id }) => id));
  for (let row = 1; row <= 8; row += 1) {
    for (let column = -2; column <= 2; column += 1) {
      const expected = row <= 7 && (row <= 3 ? column === 0 : Math.abs(column) <= 1);
      assert(selected.has(`tornado-${row}-${column}`) === expected, `Wind tornado mismatch at ${row},${column}`);
    }
  }
  assert(selected.size === 15, 'Wind tornado did not select exactly 15 occupied geometric cells');
}

function testMultiballTargetSpeeds(): void {
  const expected = [240, 228, 216, 204, 192, 180, 180];
  for (let count = 1; count <= expected.length; count += 1) {
    assertNear(getBallTargetSpeed(count), expected[count - 1], `${count}-ball target speed`);
  }
}

function testSplittingTuningAndAcquisition(): void {
  assert(GAME_CONFIG.powers.splittingCooldownSecondsByLevel.join(',') === '30,25,20,15,10', 'Splitting cooldown progression mismatch');
  assert(getPowerDescription('SPLITTING_BALL', 1, true).includes('30 seconds'), 'Splitting selection text is stale');
  assert(getPowerDescription('SPLITTING_BALL', 3, false).includes('20 seconds'), 'Splitting current text is stale');

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

  state.powers.splitTimerSeconds = 26;
  state.powers.currentChoices = ['SPLITTING_BALL'];
  state.powers.pendingSelections = 1;
  assert(acquirePower(state, 'SPLITTING_BALL'), 'Splitting threshold upgrade failed');
  assert(state.balls.length === 2, 'Splitting threshold upgrade split while selection was frozen');
  stepSimulation(state, { movementAxis: 0, mouseDisplacement: 0, speedMultiplier: 1 }, 1 / 120, 1 / 120);
  assert(Number(state.balls.length) === 3, 'Splitting did not apply elapsed progress on next active step');
  assertNear(state.powers.splitTimerSeconds, 6 + 1 / 120, 'Splitting retained the deterministic cooldown remainder');
}

function testPaddleSizeWidthsAndBounceAngles(): void {
  const expectedEdges = [40, 35, 30, 25, 15];
  const baseHalfWidth = GAME_CONFIG.paddle.width / 2;
  assertNear(getPaddleBounceElevationDegrees(0, 0), 90, 'base center elevation');
  assertNear(getPaddleBounceElevationDegrees(0, baseHalfWidth), 45, 'base edge elevation');
  for (let level = 1; level <= 5; level += 1) {
    const state = createInitialGameState();
    for (let acquired = 1; acquired <= level; acquired += 1) {
      state.powers.currentChoices = ['PADDLE_SIZE'];
      state.powers.pendingSelections = 1;
      assert(acquirePower(state, 'PADDLE_SIZE'), `Paddle Size Lv${acquired} acquisition failed`);
    }
    assertNear(state.paddle.width, GAME_CONFIG.paddle.width * (1 + level * 0.2), `Paddle Size Lv${level} width`);
    assertNear(getPaddleBounceElevationDegrees(level, 0), 90, `Paddle Size Lv${level} center elevation`);
    assertNear(getPaddleBounceElevationDegrees(level, baseHalfWidth), 45, `Paddle Size Lv${level} original edge elevation`);
    const outerOffset = state.paddle.width / 2;
    assertNear(getPaddleBounceElevationDegrees(level, outerOffset), expectedEdges[level - 1], `Paddle Size Lv${level} outer elevation`);
    let previous = 90;
    for (let sample = 0; sample <= 20; sample += 1) {
      const right = getPaddleBounceElevationDegrees(level, outerOffset * sample / 20);
      const left = getPaddleBounceElevationDegrees(level, -outerOffset * sample / 20);
      assertNear(left, right, `Paddle Size Lv${level} symmetry sample ${sample}`);
      assert(right <= previous + 1e-9 && right >= expectedEdges[level - 1] - 1e-9, `Paddle Size Lv${level} non-monotone sample ${sample}`);
      previous = right;
    }
  }
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

function testMissileTargetPriority(): void {
  const tiedNear = makeBrick('tied-near', 500, 400);
  const tiedFar = makeBrick('tied-far', 700, 400);
  const higher = makeBrick('higher', 500, 300);
  assert(selectMissileTarget(520, [higher, tiedFar, tiedNear], new Set())?.id === 'tied-near', 'missile did not choose lowest/nearest brick');
  assert(selectMissileTarget(628, [tiedFar, tiedNear], new Set())?.id === 'tied-far', 'missile ID tie-break was not deterministic');
  assert(selectMissileTarget(520, [tiedNear, higher], new Set(['tied-near']))?.id === 'higher', 'missile selected a reserved target');
}

function collectMissileLaunches(level: number, paddleWidth = 200): Array<{ time: number; x: number }> {
  const state = createInitialGameState();
  state.brickField.columns.forEach((column) => column.splice(0));
  addBrick(state, makeBrick('entry-blocker', 42, 8));
  state.paddle.x = 600;
  state.paddle.width = paddleWidth;
  state.powers.levels.HOMING_MISSILE = level;
  state.powers.missilesRemainingInVolley = level;
  const launches: Array<{ time: number; x: number }> = [];
  let lastId = 0;
  for (let step = 0; step < 240 && launches.length < level; step += 1) {
    stepSimulation(state, { movementAxis: 0, mouseDisplacement: 0, speedMultiplier: 1 }, 1 / 120, 1 / 120);
    for (const projectile of state.projectiles) {
      if (projectile.kind === 'MISSILE' && projectile.id > lastId) {
        launches.push({ time: step / 120, x: projectile.x });
        lastId = projectile.id;
      }
    }
  }
  assertNear(state.powers.missileReloadSeconds, GAME_CONFIG.powers.missileReloadSeconds, `Missile Lv${level} reload`);
  return launches;
}

function testMissileLaunchPositionsAndCadence(): void {
  for (const level of [1, 2, 3, 4, 5]) {
    const launches = collectMissileLaunches(level);
    const expectedOffsets = GAME_CONFIG.powers.missileLaunchOffsets.slice(0, level);
    assert(launches.length === level, `Missile Lv${level} launch count mismatch`);
    launches.forEach((launch, index) => assertNear(launch.x, 600 + 100 * expectedOffsets[index], `Missile Lv${level} launch ${index + 1} mount`));
    const interval = level === 5
      ? GAME_CONFIG.powers.missileLevelFiveLaunchIntervalSeconds
      : GAME_CONFIG.powers.missileLaunchIntervalSeconds;
    for (let index = 1; index < launches.length; index += 1) {
      assert(Math.abs(launches[index].time - launches[index - 1].time - interval) <= GAME_CONFIG.fixedStepSeconds + 1e-9, `Missile Lv${level} cadence mismatch`);
    }
  }
  for (const paddleLevel of [0, 1, 3, 5]) {
    const width = GAME_CONFIG.paddle.width * (1 + paddleLevel * 0.2);
    const launches = collectMissileLaunches(5, width);
    launches.forEach((launch, index) => assertNear(
      launch.x,
      600 + width / 2 * GAME_CONFIG.powers.missileLaunchOffsets[index],
      `Missile ports with Paddle Size Lv${paddleLevel}, launch ${index + 1}`,
    ));
  }
}

function testMissileDeploymentReservationsAndRetargeting(): void {
  const state = createInitialGameState();
  state.brickField.columns.forEach((column) => column.splice(0));
  addBrick(state, makeBrick('lowest-a', 500, 300));
  addBrick(state, makeBrick('next-b', 620, 260));
  addBrick(state, makeBrick('entry-blocker', 42, 8));
  state.powers.levels.HOMING_MISSILE = 2;
  state.powers.missilesRemainingInVolley = 2;
  const input = { movementAxis: 0, mouseDisplacement: 0, speedMultiplier: 1 };
  for (let step = 0; step < 92; step += 1) stepSimulation(state, input, 1 / 120, 1 / 120);
  const missiles = state.projectiles.filter((projectile) => projectile.kind === 'MISSILE');
  assert(missiles.length === 2, 'two-missile deployment did not remain active');
  assert(missiles[0].targetBrickId === 'lowest-a', 'first missile did not reserve lowest brick after deployment');
  assert(missiles[1].targetBrickId === 'next-b', 'second missile duplicated first reservation');

  const first = missiles[0];
  const priorVelocity = { ...first.velocity };
  const targetA = state.brickField.columns.flat().find(({ id }) => id === 'lowest-a');
  assert(targetA, 'missing external destruction target');
  applyBrickDamage(state, targetA, 1, 'GUN');
  stepSimulation(state, input, 1 / 120, 1 / 120);
  assert(first.targetBrickId !== 'lowest-a', 'missile retained a destroyed target');
  const priorAngle = Math.atan2(priorVelocity.y, priorVelocity.x);
  const nextAngle = Math.atan2(first.velocity.y, first.velocity.x);
  assert(Math.abs(nextAngle - priorAngle) <= GAME_CONFIG.powers.missileTurnRateRadiansPerSecond / 120 + 1e-6, 'missile snapped direction while retargeting');
}

function testMissileAcquisitionAndDeployment(): void {
  const state = createInitialGameState();
  state.brickField.columns.forEach((column) => column.splice(0));
  addBrick(state, makeBrick('target', 900, 250));
  addBrick(state, makeBrick('entry-blocker', 42, 8));
  state.powers.currentChoices = ['HOMING_MISSILE'];
  state.powers.pendingSelections = 1;
  assert(acquirePower(state, 'HOMING_MISSILE'), 'initial Homing Missile acquisition failed');
  const input = { movementAxis: 0, mouseDisplacement: 0, speedMultiplier: 1 };
  stepSimulation(state, input, 1 / 120, 1 / 120);
  const missile = state.projectiles.find(({ kind }) => kind === 'MISSILE');
  assert(missile?.missilePhase === 'DEPLOYING', 'first missile did not launch promptly into deployment');
  assertNear(missile.velocity.x, 0, 'deploying missile horizontal velocity');
  assertNear(missile.velocity.y, -GAME_CONFIG.powers.missileDeploymentSpeed, 'deploying missile speed');
  for (let step = 1; step < 41; step += 1) stepSimulation(state, input, 1 / 120, 1 / 120);
  assert(missile.missilePhase === 'DEPLOYING', 'missile guidance engaged before deployment duration');
  stepSimulation(state, input, 1 / 120, 1 / 120);
  const engagedMissile = state.projectiles.find(({ id }) => id === missile.id);
  assert(engagedMissile?.missilePhase === 'HOMING' && engagedMissile.targetBrickId === 'target', 'missile did not acquire after deployment');
  assert(engagedMissile.velocity.x > 0 && engagedMissile.velocity.y < 0, 'missile did not begin a curved turn toward target');
  assert(Math.atan2(engagedMissile.velocity.y, engagedMissile.velocity.x) < 0, 'missile heading became invalid');

  const existingCount = state.projectiles.filter(({ kind }) => kind === 'MISSILE').length;
  const reloadProgress = state.powers.missileReloadSeconds;
  state.powers.currentChoices = ['HOMING_MISSILE'];
  state.powers.pendingSelections = 1;
  assert(acquirePower(state, 'HOMING_MISSILE'), 'Homing Missile upgrade failed');
  assert(state.projectiles.filter(({ kind }) => kind === 'MISSILE').length === existingCount, 'Homing Missile upgrade launched an extra missile');
  assertNear(state.powers.missileReloadSeconds, reloadProgress, 'Homing Missile upgrade reset cycle progress');
}

function testMissileAccidentalImpactAndReservationRelease(): void {
  const state = createInitialGameState();
  state.brickField.columns.forEach((column) => column.splice(0));
  const brickB = makeBrick('b', 500, 380);
  const brickC = makeBrick('c', 500, 200);
  addBrick(state, brickB);
  addBrick(state, brickC);
  state.projectiles.push(
    {
      id: 1, kind: 'MISSILE', x: 700, y: 500, velocity: { x: 0, y: -180 }, damage: 1,
      missilePhase: 'HOMING', homingSpeed: 180, targetBrickId: 'b', deploymentRemainingSeconds: 0,
    },
    {
      id: 2, kind: 'MISSILE', x: 528, y: 410, velocity: { x: 0, y: -720 }, damage: 1,
      missilePhase: 'HOMING', homingSpeed: 720, targetBrickId: 'c', deploymentRemainingSeconds: 0,
    },
  );
  state.nextProjectileId = 3;
  stepSimulation(state, { movementAxis: 0, mouseDisplacement: 0, speedMultiplier: 1 }, 0.05, 0.05);
  assert(!state.projectiles.some(({ id }) => id === 2), 'missile survived accidental non-target impact');
  assert(!state.brickField.columns.flat().some(({ id }) => id === 'b'), 'accidental impact did not damage brick B');
  const survivor = state.projectiles.find(({ id }) => id === 1);
  assert(survivor?.targetBrickId === 'c', 'surviving missile could not claim released target C');
}

function testMissileDamageAndNoTargetExpiry(): void {
  const state = createInitialGameState();
  state.brickField.columns.forEach((column) => column.splice(0));
  state.powers.levels.ELECTRIC_BALL = 5;
  state.powers.levels.FIRE_BALL = 5;
  state.powers.levels.WIND_BALL = 5;
  const victim = makeBrick('victim', 500, 300);
  addBrick(state, victim);
  const xpBefore = state.progression.currentXp;
  const destruction = applyBrickDamage(state, victim, 1, 'MISSILE');
  assert(destruction?.source === 'MISSILE', 'missile damage source was not retained');
  assert(state.progression.currentXp === xpBefore + 1, 'missile kill did not award XP');
  assert(state.projectiles.length === 0 && state.fireEffects.length === 0 && state.windEffects.length === 0, 'missile kill triggered BALL proc powers');

  const reservedBlocker = makeBrick('reserved-blocker', 42, 8);
  addBrick(state, reservedBlocker);
  state.projectiles.push({
    id: 1, kind: 'MISSILE', x: 1000, y: 600, velocity: { x: 0, y: -180 }, damage: 1,
    missilePhase: 'HOMING', homingSpeed: 180, deploymentRemainingSeconds: 0, targetBrickId: reservedBlocker.id,
  }, {
    id: 2, kind: 'MISSILE', x: 600, y: 35, velocity: { x: 0, y: -100 }, damage: 1,
    missilePhase: 'SEARCHING', homingSpeed: 180, deploymentRemainingSeconds: 0,
  });
  stepSimulation(state, { movementAxis: 0, mouseDisplacement: 0, speedMultiplier: 1 }, 0.1, 0.1);
  assert(!state.projectiles.some(({ id }) => id === 2), 'targetless missile did not expire above playfield');
}

testBallKillCategory();
testElectricRanking();
testSecondaryElectricUsesSharedScoring();
testElectricPrimaryProgressionAndChains();
testElectricLimitedAndDeadSecondaryTargets();
testFireWidthsAndVisuals();
testWindRangesAndVisuals();
testWindRanking();
testSpeeds();
testOffersAndMaxPairs();
testTargetedBanAndRerollResources();
testOwnedBanAndNoReplacement();
testBanRunLifetime();
testPiercedBallKillProcs();
testDirectionalPiercePassThrough();
testDirectionalPierceBallKillProcs();
testWindLevelsAndNoRecursion();
testWindTornadoGeometry();
testMultiballTargetSpeeds();
testSplittingTuningAndAcquisition();
testPaddleSizeWidthsAndBounceAngles();
testGunCadence();
testMissileTargetPriority();
testMissileLaunchPositionsAndCadence();
testMissileDeploymentReservationsAndRetargeting();
testMissileAcquisitionAndDeployment();
testMissileAccidentalImpactAndReservationRelease();
testMissileDamageAndNoTargetExpiry();
