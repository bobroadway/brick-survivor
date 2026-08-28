import {
  advanceBrickField,
  getBrickSpawnY,
  getEarliestStationaryBrickY,
  type BrickState,
} from '../src/simulation/brickField';
import { GAME_CONFIG } from '../src/simulation/config';
import type { DamageSource } from '../src/simulation/combat';
import { applyRoutedBrickDamage } from '../src/simulation/destructionRouting';
import { createInitialGameState, type GameState } from '../src/simulation/gameState';
import {
  advanceFrozenBrickSafety,
  commitPendingFreeze,
  freezeBrick,
  handleFrozenBrickContact,
  isFrozenBrick,
  isPendingFreezeBrick,
  shatterFrozenBrick,
} from '../src/simulation/iceBall';
import { isDangerBrick } from '../src/simulation/dangerPresentation';
import {
  acquirePower,
  banPowerChoice,
  createRunPowerState,
  getEligiblePowerIds,
  rerollPowerChoices,
} from '../src/simulation/powers';
import { stepSimulation } from '../src/simulation/simulation';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function makeBrick(id: string, column: number, y: number, hp = 1): BrickState {
  return {
    id, rowId: 1, column,
    x: 40 + column * (GAME_CONFIG.bricks.brickWidth + GAME_CONFIG.bricks.horizontalGap),
    y, width: GAME_CONFIG.bricks.brickWidth, height: GAME_CONFIG.bricks.brickHeight,
    speedClass: 'SLOW', hp, xpValue: 1, kind: 'NORMAL',
  };
}

function emptyState(): GameState {
  const state = createInitialGameState();
  state.brickField.columns = Array.from({ length: GAME_CONFIG.bricks.columns }, () => []);
  state.projectiles = [];
  state.fireEffects = [];
  state.windEffects = [];
  state.iceShatterEffects = [];
  return state;
}

function addBrick(state: GameState, brick: BrickState): void {
  state.brickField.columns[brick.column].push(brick);
  state.brickField.columns[brick.column].sort((left, right) => left.y - right.y);
}

function hasBrick(state: GameState, id: string): boolean {
  return state.brickField.columns.some((column) => column.some((brick) => brick.id === id));
}

const neutralInput = { movementAxis: 0, mouseDisplacement: 0, speedMultiplier: 1 };

function runEmergingIceHit(face: 'TOP' | 'BOTTOM' | 'LEFT' | 'RIGHT', pierceLevel = 1): GameState {
  const state = emptyState();
  state.powers.levels.ICE_BALL = 1;
  state.powers.levels.ELECTRIC_BALL = 1;
  state.powers.levels.FIRE_BALL = 1;
  state.powers.levels.WIND_BALL = 1;
  state.powers.levels.PIERCING_BALL = pierceLevel;
  const brick = makeBrick('emerging-target', 8, getBrickSpawnY() + 10);
  addBrick(state, brick);
  const ball = state.balls[0];
  ball.pierceCharge = pierceLevel;
  const centerX = brick.x + brick.width / 2;
  const centerY = brick.y + brick.height / 2;
  if (face === 'TOP') Object.assign(ball, { x: centerX, y: brick.y - ball.radius - 1, velocity: { x: 0, y: 240 } });
  if (face === 'BOTTOM') Object.assign(ball, { x: centerX, y: brick.y + brick.height + ball.radius + 1, velocity: { x: 0, y: -240 } });
  if (face === 'LEFT') Object.assign(ball, { x: brick.x - ball.radius - 1, y: centerY, velocity: { x: 240, y: 0 } });
  if (face === 'RIGHT') Object.assign(ball, { x: brick.x + brick.width + ball.radius + 1, y: centerY, velocity: { x: -240, y: 0 } });
  stepSimulation(state, neutralInput, 1 / 120);
  return state;
}

function runIceElectricFreeze(
  face: 'TOP' | 'BOTTOM' | 'LEFT' | 'RIGHT',
  emerging: boolean,
  electricLevel = 1,
  addSecondBall = false,
  allElementals = false,
): GameState {
  const state = emptyState();
  state.powers.levels.ICE_BALL = 1;
  state.powers.levels.PIERCING_BALL = 1;
  state.powers.levels.ELECTRIC_BALL = electricLevel;
  if (allElementals) {
    state.powers.levels.FIRE_BALL = 1;
    state.powers.levels.WIND_BALL = 1;
  }
  const y = emerging ? getBrickSpawnY() + 10 : 300;
  const source = makeBrick('electric-freeze-origin', 8, y);
  addBrick(state, source);
  for (const [index, column] of [5, 6, 7, 9, 10, 11, 12].entries()) {
    addBrick(state, makeBrick(`electric-freeze-target-${index}`, column, emerging ? 56 : 300));
  }
  const ball = state.balls[0];
  ball.pierceCharge = 1;
  const centerX = source.x + source.width / 2;
  const centerY = source.y + source.height / 2;
  if (face === 'TOP') Object.assign(ball, { x: centerX, y: source.y - ball.radius - 1, velocity: { x: 0, y: 240 } });
  if (face === 'BOTTOM') Object.assign(ball, { x: centerX, y: source.y + source.height + ball.radius + 1, velocity: { x: 0, y: -240 } });
  if (face === 'LEFT') Object.assign(ball, { x: source.x - ball.radius - 1, y: centerY, velocity: { x: 240, y: 0 } });
  if (face === 'RIGHT') Object.assign(ball, { x: source.x + source.width + ball.radius + 1, y: centerY, velocity: { x: -240, y: 0 } });
  if (addSecondBall) {
    state.balls.push({
      ...ball,
      id: state.nextBallId++,
      velocity: { ...ball.velocity },
      positionHistory: [],
    });
  }
  stepSimulation(state, neutralInput, 1 / 120);
  return state;
}

assert(getEligiblePowerIds(emptyState().powers).includes('ICE_BALL'), 'Ice Ball is absent from the offer pool');

{
  const state = runIceElectricFreeze('BOTTOM', false, 1, false, true);
  const origin = state.brickField.columns.flat().find(({ id }) => id === 'electric-freeze-origin');
  assert(origin && isFrozenBrick(origin), 'safe Ice/Electric origin did not remain frozen and alive');
  assert(state.nextProjectileId === 3, 'Ice freeze did not trigger Electric Lv1 primary count');
  assert(state.progression.currentXp === 2, 'initial freeze XP did not come exclusively from Fire secondary kills');
  assert(state.fireEffects.length === 1 && state.windEffects.length === 1, 'Ice freeze did not trigger Fire and Wind');
  assert(hasBrick(state, origin.id), 'initial elemental proc damaged its frozen origin');
}

for (const face of ['BOTTOM', 'LEFT', 'RIGHT', 'TOP'] as const) {
  const state = runIceElectricFreeze(face, true);
  const origin = state.brickField.columns.flat().find(({ id }) => id === 'electric-freeze-origin');
  assert(origin && isPendingFreezeBrick(origin), `${face} Ice/Electric emerging origin was not pending`);
  assert(state.projectiles.filter(({ kind }) => kind === 'ELECTRIC').length === 2, `${face} pending freeze missed or duplicated Electric proc`);
  const ball = state.balls[0];
  if (face === 'BOTTOM') assert(ball.velocity.y < 0, 'BOTTOM Ice/Pierce/Electric hit bounced');
  if (face === 'LEFT') assert(ball.velocity.x > 0, 'LEFT Ice/Pierce/Electric hit bounced');
  if (face === 'RIGHT') assert(ball.velocity.x < 0, 'RIGHT Ice/Pierce/Electric hit bounced');
  if (face === 'TOP') assert(ball.velocity.y < 0, 'TOP Ice/Pierce/Electric hit passed through');
  assert(ball.pierceCharge === (face === 'TOP' ? 1 : 0), `${face} Electric integration changed Pierce charge`);
}

{
  const state = runIceElectricFreeze('BOTTOM', true, 1, false, true);
  const origin = state.brickField.columns.flat().find(({ id }) => id === 'electric-freeze-origin');
  assert(origin && isPendingFreezeBrick(origin), 'all-element pending proc origin did not remain pending');
  assert(state.nextProjectileId === 3, 'pending freeze did not trigger Electric');
  assert(state.fireEffects.length === 1 && state.windEffects.length === 1, 'pending freeze did not trigger Fire/Wind');
  assert(hasBrick(state, origin.id), 'pending elemental proc damaged its origin');
}

{
  const state = runIceElectricFreeze('LEFT', true, 1, true);
  assert(state.projectiles.filter(({ kind }) => kind === 'ELECTRIC').length === 2, 'multiball freeze transition emitted duplicate Electric volleys');
  for (let step = 0; step < 40; step += 1) stepSimulation(state, neutralInput, 1 / 120);
  assert(state.nextProjectileId === 3, 'pending overlap/re-entry emitted another freeze Electric proc');
}

{
  const state = runIceElectricFreeze('BOTTOM', false, 5);
  const origin = state.brickField.columns.flat().find(({ id }) => id === 'electric-freeze-origin');
  const primary = state.projectiles.filter(({ kind, electricGeneration }) => kind === 'ELECTRIC' && electricGeneration === 'PRIMARY');
  assert(origin && isFrozenBrick(origin), 'Ice/Electric Lv5 origin did not freeze');
  assert(primary.length === 5, 'Ice freeze did not trigger five Electric Lv5 primaries');
  assert(new Set(primary.map(({ targetBrickId }) => targetBrickId)).size === 5, 'Ice-triggered Electric Lv5 duplicated a primary target');
  assert(primary.every(({ targetBrickId }) => targetBrickId !== origin.id), 'Ice-triggered Electric Lv5 targeted its origin');
  assert(state.electricProcs.length === 1 && state.electricProcs[0].activeProjectileCount === 5, 'Ice-triggered Electric Lv5 did not use normal chain tracking');
  const secondaryTargets = new Set<string>();
  Object.assign(state.balls[0], { x: 1000, y: 600, velocity: { x: 0, y: 0 } });
  for (let step = 0; step < 240; step += 1) {
    for (const projectile of state.projectiles) {
      if (projectile.electricGeneration === 'SECONDARY' && projectile.targetBrickId) {
        secondaryTargets.add(projectile.targetBrickId);
      }
    }
    if (!state.projectiles.some(({ kind }) => kind === 'ELECTRIC')) break;
    stepSimulation(state, neutralInput, 1 / 120);
  }
  assert(!secondaryTargets.has(origin.id), 'Electric Lv5 secondary chain targeted its living Ice origin');
  assert(hasBrick(state, origin.id), 'Electric Lv5 chain damaged its living Ice origin');
}

{
  const state = runIceElectricFreeze('BOTTOM', false, 1, false, true);
  const origin = state.brickField.columns.flat().find(({ id }) => id === 'electric-freeze-origin');
  assert(origin && isFrozenBrick(origin), 'already-frozen Electric regression setup failed');
  state.projectiles.length = 0;
  state.fireEffects.length = 0;
  state.windEffects.length = 0;
  advanceFrozenBrickSafety(state, GAME_CONFIG.powers.iceDirectShatterSafetyMaximumSeconds);
  const projectileIdAfterFreezeProc = state.nextProjectileId;
  const ball = state.balls[0];
  Object.assign(ball, {
    x: origin.x + origin.width / 2,
    y: origin.y + origin.height + ball.radius + 1,
    velocity: { x: 0, y: -240 },
  });
  stepSimulation(state, neutralInput, 1 / 120);
  assert(!hasBrick(state, origin.id), 'armed frozen brick did not retain normal direct-shatter behavior');
  assert(state.nextProjectileId === projectileIdAfterFreezeProc + 2, 'direct Ball shatter did not trigger one Electric proc set');
  assert(state.fireEffects.length === 1 && state.windEffects.length === 1, 'direct Ball shatter did not trigger Fire/Wind');
}
{
  const powers = createRunPowerState();
  powers.currentChoices = ['ICE_BALL', 'GUN', 'FIRE_BALL'];
  powers.pendingSelections = 1;
  const rerolls = powers.rerollsRemaining;
  assert(banPowerChoice(powers, 'ICE_BALL'), 'Ice Ball could not be targeted by Ban');
  assert(powers.bannedPowerIds.has('ICE_BALL') && powers.rerollsRemaining === rerolls, 'Ice Ban resource handling changed');
  assert(!powers.currentChoices.includes('ICE_BALL'), 'targeted Ice Ban did not replace its slot');
  assert(rerollPowerChoices(powers), 'offer containing banned Ice could not reroll');
  assert(!powers.currentChoices.includes('ICE_BALL'), 'banned Ice returned through Reroll');
}

assert(
  getEarliestStationaryBrickY() === getBrickSpawnY() + GAME_CONFIG.bricks.brickHeight + GAME_CONFIG.bricks.verticalEdgeGap,
  'safe-freeze Y is not derived from authoritative spawn geometry',
);

for (const face of ['BOTTOM', 'LEFT', 'RIGHT', 'TOP'] as const) {
  const state = runEmergingIceHit(face);
  const brick = state.brickField.columns.flat().find(({ id }) => id === 'emerging-target');
  assert(brick && isPendingFreezeBrick(brick), `${face} emerging Ice hit did not enter PENDING_FREEZE`);
  assert(!isFrozenBrick(brick) && brick.iceCollisionKills === undefined, `${face} pending brick started frozen mechanics`);
  assert(brick.y > getBrickSpawnY() + 10, `${face} pending brick stopped descending`);
  const ball = state.balls[0];
  if (face === 'BOTTOM') assert(ball.velocity.y < 0, 'BOTTOM emerging Ice/Pierce hit bounced');
  if (face === 'LEFT') assert(ball.velocity.x > 0, 'LEFT emerging Ice/Pierce hit bounced');
  if (face === 'RIGHT') assert(ball.velocity.x < 0, 'RIGHT emerging Ice/Pierce hit bounced');
  if (face === 'TOP') assert(ball.velocity.y < 0, 'TOP emerging Ice/Pierce hit passed through');
  assert(ball.pierceCharge === (face === 'TOP' ? 1 : 0), `${face} emerging Ice/Pierce charge semantics changed`);
}

{
  const state = runEmergingIceHit('LEFT');
  const brick = state.brickField.columns.flat().find(({ id }) => id === 'emerging-target');
  assert(brick && isPendingFreezeBrick(brick), 'pending traversal setup failed');
  const ball = state.balls[0];
  for (let step = 0; step < 40 && brick.icePendingFreezeContactActive; step += 1) {
    const directionBefore = Math.sign(ball.velocity.x);
    stepSimulation(state, neutralInput, 1 / 120);
    assert(Math.sign(ball.velocity.x) === directionBefore, 'same pending-freeze Pierce traversal bounced on duplicate overlap');
    assert(hasBrick(state, brick.id) && isPendingFreezeBrick(brick), 'same pending contact shattered or recommitted the brick');
  }
  assert(!brick.icePendingFreezeContactActive, 'pending creation contact did not clear after Ball exit');
}

{
  const state = emptyState();
  state.powers.levels.ICE_BALL = 5;
  const pending = makeBrick('entry-deadlock-regression', 8, getBrickSpawnY());
  assert(freezeBrick(pending, state.balls[0].id) && isPendingFreezeBrick(pending), 'unsafe emerging brick froze immediately');
  addBrick(state, pending);
  const nextRowBefore = state.brickField.nextRowId;
  advanceBrickField(state.brickField, 20, 1, 1, {
    onFrozenBrickContact: (contact) => handleFrozenBrickContact(state, contact),
    onPendingFreezeReady: (brick) => commitPendingFreeze(brick),
  });
  assert(isFrozenBrick(pending), 'pending brick did not commit at safe entry Y');
  assert(pending.y === getEarliestStationaryBrickY(), 'pending brick overshot or teleported at freeze commit');
  assert(state.brickField.nextRowId === nextRowBefore + 1, 'formation did not spawn once pending brick froze safely');
}

{
  const state = emptyState();
  state.powers.levels.ICE_BALL = 5;
  const pendingBricks: BrickState[] = [];
  for (let column = 0; column < GAME_CONFIG.bricks.columns; column += 1) {
    const pending = makeBrick(`all-column-pending-${column}`, column, getBrickSpawnY());
    freezeBrick(pending, state.balls[0].id);
    addBrick(state, pending);
    pendingBricks.push(pending);
  }
  const spawnedRowId = state.brickField.nextRowId;
  const callbacks = {
    onFrozenBrickContact: (contact: Parameters<typeof handleFrozenBrickContact>[1]) => handleFrozenBrickContact(state, contact),
    onPendingFreezeReady: (brick: BrickState) => commitPendingFreeze(brick),
  };
  advanceBrickField(state.brickField, 20, 1, 1, callbacks);
  assert(pendingBricks.every(isFrozenBrick), 'one or more all-column pending bricks failed to commit safely');
  assert(state.brickField.columns.flat().some(({ rowId }) => rowId === spawnedRowId), 'all-column pending state deadlocked formation spawning');
  advanceBrickField(state.brickField, 1 / 120, 1, 1, callbacks);
  assert(
    !state.brickField.columns.flat().some(({ rowId }) => rowId === spawnedRowId),
    'spawned all-column formation did not immediately contact the safe frozen row',
  );
  assert(
    pendingBricks.some(({ iceCollisionKills }) => iceCollisionKills === 1),
    'all-column incoming contacts did not increment frozen collision capacity',
  );
}

{
  const state = emptyState();
  state.powers.levels.ICE_BALL = 1;
  state.powers.levels.ELECTRIC_BALL = 1;
  state.powers.levels.FIRE_BALL = 1;
  state.powers.levels.WIND_BALL = 1;
  const frozen = makeBrick('safe-contact-frozen', 8, getEarliestStationaryBrickY());
  freezeBrick(frozen);
  addBrick(state, frozen);
  const incoming = makeBrick('safe-contact-incoming', 8, getBrickSpawnY());
  addBrick(state, incoming);
  advanceBrickField(state.brickField, 1 / 120, 1, 1, (contact) => handleFrozenBrickContact(state, contact));
  assert(!hasBrick(state, incoming.id), 'next formation brick did not contact frozen blocker on first downward attempt');
  assert(!hasBrick(state, frozen.id), 'Ice Lv1 frozen blocker did not terminally shatter on immediate contact');
  assert(state.nextProjectileId === 1 && state.fireEffects.length === 0 && state.windEffects.length === 0, 'terminal incoming-brick shatter triggered Ball elementals');
}

for (const kind of ['GUN', 'MISSILE'] as const) {
  const state = emptyState();
  state.powers.levels.ICE_BALL = 1;
  const pending = makeBrick(`pending-${kind}`, 8, getBrickSpawnY() + 10);
  pending.hp = 2;
  freezeBrick(pending, state.balls[0].id);
  addBrick(state, pending);
  state.projectiles.push(kind === 'GUN'
    ? { id: 1, kind, x: pending.x + pending.width / 2, y: pending.y + pending.height + 1, velocity: { x: 0, y: -720 }, damage: 1 }
    : {
      id: 1, kind, x: pending.x + pending.width / 2, y: pending.y + pending.height / 2,
      velocity: { x: 0, y: 0 }, damage: 1, missilePhase: 'DEPLOYING', deploymentRemainingSeconds: 1,
    });
  stepSimulation(state, neutralInput, 1 / 120);
  assert(hasBrick(state, pending.id) && pending.hp === 1, `${kind} did not apply ordinary damage to PENDING_FREEZE`);
  assert(isPendingFreezeBrick(pending) && state.iceShatterEffects.length === 0, `${kind} invoked frozen shatter while pending`);
}

for (const source of ['ELECTRIC', 'FIRE', 'WIND'] as DamageSource[]) {
  const state = emptyState();
  const pending = makeBrick(`pending-${source}`, 8, getBrickSpawnY() + 10);
  freezeBrick(pending, state.balls[0].id);
  addBrick(state, pending);
  assert(applyRoutedBrickDamage(state, pending, 1, source).destruction, `${source} did not destroy a pending brick normally`);
  assert(!hasBrick(state, pending.id), `${source} left a destroyed pending brick active`);
  assert(state.iceShatterEffects.length === 0, `${source} destruction incorrectly emitted an Ice shatter`);
}

for (const source of ['ELECTRIC', 'FIRE', 'WIND'] as DamageSource[]) {
  const state = emptyState();
  state.powers.levels.ICE_BALL = 1;
  state.powers.levels.ELECTRIC_BALL = 1;
  state.powers.levels.FIRE_BALL = 1;
  state.powers.levels.WIND_BALL = 1;
  const frozen = makeBrick(`routed-frozen-${source}`, 8, 300);
  const neighbor = makeBrick(`routed-neighbor-${source}`, 9, 300);
  freezeBrick(frozen);
  addBrick(state, frozen);
  addBrick(state, neighbor);
  const result = applyRoutedBrickDamage(state, frozen, 1, source);
  assert(result.frozenShattered && !result.destruction, `${source} lethal damage bypassed frozen shatter routing`);
  assert(!hasBrick(state, frozen.id) && !hasBrick(state, neighbor.id), `${source} frozen shatter missed its center or 3x3 neighbor`);
  assert(state.iceShatterEffects.length === 1, `${source} frozen destruction missed the Ice visual`);
  assert(state.progression.currentXp === 2, `${source} frozen shatter double-counted or missed XP`);
  assert(state.nextProjectileId === 1 && state.fireEffects.length === 0 && state.windEffects.length === 0, `${source} frozen shatter triggered Ball elementals`);
}

{
  const state = emptyState();
  state.powers.levels.ICE_BALL = 1;
  const armoredFrozen = makeBrick('future-armored-frozen', 8, 300, 2);
  freezeBrick(armoredFrozen);
  addBrick(state, armoredFrozen);
  const result = applyRoutedBrickDamage(state, armoredFrozen, 1, 'ELECTRIC');
  assert(!result.frozenShattered && !result.destruction, 'nonlethal elemental damage shattered a higher-HP frozen brick');
  assert(hasBrick(state, armoredFrozen.id) && armoredFrozen.hp === 1, 'nonlethal routed damage did not preserve frozen HP semantics');
  assert(state.iceShatterEffects.length === 0, 'nonlethal frozen damage emitted a shatter visual');
}

{
  const state = emptyState();
  state.powers.levels.ICE_BALL = 1;
  const a = makeBrick('overlapping-routed-a', 8, 300);
  const b = makeBrick('overlapping-routed-b', 9, 300);
  freezeBrick(a);
  freezeBrick(b);
  addBrick(state, a);
  addBrick(state, b);
  applyRoutedBrickDamage(state, a, 1, 'FIRE');
  applyRoutedBrickDamage(state, b, 1, 'FIRE');
  assert(state.iceShatterEffects.length === 1, 'overlapping routed frozen deaths shattered one brick twice');
  assert(state.progression.currentXp === 2, 'overlapping routed frozen deaths double-awarded XP');
}
{
  const state = emptyState();
  const frozen = makeBrick('stationary-frozen', 5, 500);
  const moving = makeBrick('enrage-moving', 6, 300);
  freezeBrick(frozen);
  addBrick(state, frozen);
  addBrick(state, moving);
  advanceBrickField(state.brickField, 1, 20, 20);
  assert(frozen.y === 500, 'frozen brick moved under high difficulty');
  assert(moving.y > 300, 'non-frozen brick stopped moving under high difficulty');
  assert(isDangerBrick(frozen), 'danger presentation ignored a frozen danger brick');
}
{
  const state = emptyState();
  state.powers.pendingSelections = 5;
  for (let level = 1; level <= 5; level += 1) {
    state.powers.currentChoices = ['ICE_BALL'];
    assert(acquirePower(state, 'ICE_BALL'), `failed to acquire Ice Ball Lv${level}`);
  }
  assert(state.powers.maxedPowerOrder.includes('ICE_BALL'), 'Ice Ball MAX order was not recorded');
}

for (let level = 1; level <= 5; level += 1) {
  const state = emptyState();
  state.powers.levels.ICE_BALL = level;
  const frozen = makeBrick(`frozen-${level}`, 5, 300);
  freezeBrick(frozen);
  addBrick(state, frozen);
  for (let collision = 1; collision <= level; collision += 1) {
    const incoming = makeBrick(`incoming-${level}-${collision}`, 5, 276);
    addBrick(state, incoming);
    advanceBrickField(state.brickField, 0, 1, 1, (contact) => handleFrozenBrickContact(state, contact));
    assert(!hasBrick(state, incoming.id), `Lv${level} incoming collision ${collision} survived`);
    assert(hasBrick(state, frozen.id) === (collision < level), `Lv${level} shattered at the wrong capacity`);
  }
}

{
  const state = emptyState();
  state.powers.levels.ICE_BALL = 2;
  const frozen = makeBrick('upgrade-frozen', 5, 300);
  freezeBrick(frozen);
  addBrick(state, frozen);
  const collide = (id: string): void => {
    addBrick(state, makeBrick(id, 5, 276));
    advanceBrickField(state.brickField, 0, 1, 1, (contact) => handleFrozenBrickContact(state, contact));
  };
  collide('upgrade-incoming-1');
  assert(hasBrick(state, frozen.id), 'Lv2 frozen brick did not survive its first collision');
  state.powers.levels.ICE_BALL = 3;
  collide('upgrade-incoming-2');
  assert(hasBrick(state, frozen.id), 'existing frozen brick ignored the upgraded capacity');
  collide('upgrade-incoming-3');
  assert(!hasBrick(state, frozen.id), 'upgraded frozen brick did not shatter at 3 collisions');
}

{
  const state = emptyState();
  state.powers.levels.ICE_BALL = 1;
  state.powers.levels.ELECTRIC_BALL = 1;
  state.powers.levels.FIRE_BALL = 1;
  state.powers.levels.WIND_BALL = 1;
  const center = makeBrick('center', 10, 300);
  freezeBrick(center);
  addBrick(state, center);
  for (let columnOffset = -1; columnOffset <= 1; columnOffset += 1) {
    for (let rowOffset = -1; rowOffset <= 1; rowOffset += 1) {
      if (columnOffset === 0 && rowOffset === 0) continue;
      addBrick(state, makeBrick(`inside-${columnOffset}-${rowOffset}`, 10 + columnOffset, 300 + rowOffset * 24));
    }
  }
  addBrick(state, makeBrick('outside-column', 12, 300));
  addBrick(state, makeBrick('outside-row', 10, 348));
  assert(shatterFrozenBrick(state, center) === 9, '3x3 shatter did not destroy exactly nine occupied cells');
  assert(hasBrick(state, 'outside-column') && hasBrick(state, 'outside-row'), 'shatter sought beyond its fixed 3x3 footprint');
  assert(state.progression.currentXp === 9, 'Ice shatter XP was not awarded exactly once per brick');
  assert(state.projectiles.length === 0 && state.fireEffects.length === 0 && state.windEffects.length === 0, 'Ice destruction triggered Ball-kill procs');
  assert(state.iceShatterEffects.length === 1, 'Ice shatter visual event was not emitted');
}

for (const level of [4, 5]) {
  const state = emptyState();
  state.powers.levels.ICE_BALL = level;
  state.powers.levels.ELECTRIC_BALL = 1;
  state.powers.levels.FIRE_BALL = 1;
  state.powers.levels.WIND_BALL = 1;
  const a = makeBrick(`chain-a-${level}`, 5, 300);
  const b = makeBrick(`chain-b-${level}`, 6, 300);
  const c = makeBrick(`chain-c-${level}`, 7, 300);
  for (const brick of [a, b, c]) { freezeBrick(brick); addBrick(state, brick); }
  shatterFrozenBrick(state, a);
  assert(!hasBrick(state, a.id) && !hasBrick(state, b.id), `Lv${level} failed to clear first shatter footprint`);
  assert(hasBrick(state, c.id) === (level < 5), `Lv${level} chain behavior was incorrect`);
  assert(state.iceShatterEffects.length === (level === 5 ? 3 : 1), `Lv${level} emitted the wrong shatter count`);
  assert(state.nextProjectileId === 1 && state.fireEffects.length === 0 && state.windEffects.length === 0, `Lv${level} Ice chain triggered Ball elementals`);
}

{
  const state = emptyState();
  state.powers.levels.ICE_BALL = 5;
  const frozenBricks = [
    makeBrick('overlap-a', 5, 300),
    makeBrick('overlap-b', 6, 300),
    makeBrick('overlap-c', 5, 324),
    makeBrick('overlap-d', 6, 324),
  ];
  for (const brick of frozenBricks) { freezeBrick(brick); addBrick(state, brick); }
  addBrick(state, makeBrick('overlap-shared-target', 7, 324));
  shatterFrozenBrick(state, frozenBricks[0]);
  assert(state.brickField.columns.flat().length === 0, 'overlapping Lv5 chain left an in-range brick alive');
  assert(state.iceShatterEffects.length === frozenBricks.length, 'a frozen brick shattered more or less than once');
  assert(state.progression.currentXp === frozenBricks.length + 1, 'overlapping chain double-counted or missed XP');
}

function runBallHit(face: 'TOP' | 'BOTTOM' | 'LEFT' | 'RIGHT', frozen = false, pierceLevel = 1): GameState {
  const state = emptyState();
  state.powers.levels.ICE_BALL = 1;
  state.powers.levels.PIERCING_BALL = pierceLevel;
  const brick = makeBrick('ball-target', 8, 300);
  if (frozen) freezeBrick(brick);
  addBrick(state, brick);
  addBrick(state, makeBrick('entry-blocker', 0, 8));
  const ball = state.balls[0];
  ball.pierceCharge = pierceLevel;
  const centerX = brick.x + brick.width / 2;
  const centerY = brick.y + brick.height / 2;
  if (face === 'TOP') Object.assign(ball, { x: centerX, y: brick.y - ball.radius - 1, velocity: { x: 0, y: 240 } });
  if (face === 'BOTTOM') Object.assign(ball, { x: centerX, y: brick.y + brick.height + ball.radius + 1, velocity: { x: 0, y: -240 } });
  if (face === 'LEFT') Object.assign(ball, { x: brick.x - ball.radius - 1, y: centerY, velocity: { x: 240, y: 0 } });
  if (face === 'RIGHT') Object.assign(ball, { x: brick.x + brick.width + ball.radius + 1, y: centerY, velocity: { x: -240, y: 0 } });
  stepSimulation(state, { movementAxis: 0, mouseDisplacement: 0, speedMultiplier: 1 }, 1 / 120);
  return state;
}

{
  const state = runBallHit('TOP', false, 0);
  const brick = state.brickField.columns.flat().find(({ id }) => id === 'ball-target');
  assert(brick && isFrozenBrick(brick), 'non-Pierce Ball hit did not leave a frozen brick');
  assert(state.balls[0].velocity.y < 0, 'non-Pierce Ball did not bounce from its freezing hit');
  assert(state.progression.currentXp === 0, 'first freeze awarded XP');
  assert(state.projectiles.length === 0 && state.fireEffects.length === 0 && state.windEffects.length === 0, 'first freeze triggered Ball-kill procs');
}

for (const face of ['BOTTOM', 'LEFT', 'RIGHT'] as const) {
  const state = runBallHit(face);
  const brick = state.brickField.columns.flat().find(({ id }) => id === 'ball-target');
  assert(brick && isFrozenBrick(brick), `${face} Ice/Pierce hit did not freeze the brick`);
  assert(state.balls[0].pierceCharge === 0, `${face} Ice/Pierce hit did not consume Pierce capacity`);
  if (face === 'BOTTOM') assert(state.balls[0].velocity.y < 0, 'BOTTOM Ice/Pierce hit bounced');
  if (face === 'LEFT') assert(state.balls[0].velocity.x > 0, 'LEFT Ice/Pierce hit bounced');
  if (face === 'RIGHT') assert(state.balls[0].velocity.x < 0, 'RIGHT Ice/Pierce hit bounced');
  assert(state.progression.currentXp === 0, `${face} freeze incorrectly awarded XP`);
}
{
  const state = runBallHit('TOP');
  const brick = state.brickField.columns.flat().find(({ id }) => id === 'ball-target');
  assert(brick && isFrozenBrick(brick), 'top Ice/Pierce hit did not freeze the brick');
  assert(state.balls[0].velocity.y < 0, 'top Ice/Pierce hit incorrectly passed through');
  assert(state.balls[0].pierceCharge === 1, 'top Ice/Pierce bounce did not preserve reload semantics');
}
{
  const state = runBallHit('BOTTOM', true);
  const brick = state.brickField.columns.flat().find(({ id }) => id === 'ball-target');
  assert(brick && isFrozenBrick(brick), 'Ball shattered a safety-protected frozen brick');
  assert(state.balls[0].pierceCharge === 0, 'protected frozen brick changed Pierce consumption');
  assert(brick.iceFreezeSafetyActive, 'protected Ball hit cleared generic freeze safety early');
}
{
  const state = runBallHit('TOP', true);
  assert(hasBrick(state, 'ball-target'), 'top Ball hit shattered a safety-protected frozen brick');
  assert(state.balls[0].velocity.y < 0, 'protected frozen brick changed top-face bounce behavior');
}

{
  const state = runBallHit('LEFT');
  const brick = state.brickField.columns.flat().find(({ id }) => id === 'ball-target');
  assert(brick && isFrozenBrick(brick), 'initial Ice/Pierce traversal failed to freeze');
  const freezingBall = state.balls[0];
  assert(brick.iceFreezeSafetyBallId === freezingBall.id && brick.iceFreezeSafetyActive, 'freeze did not track its creating Ball');
  for (let step = 0; step < 40 && brick.iceFreezeSafetyActive; step += 1) {
    const directionBefore = Math.sign(freezingBall.velocity.x);
    stepSimulation(state, { movementAxis: 0, mouseDisplacement: 0, speedMultiplier: 1 }, 1 / 120);
    assert(Math.sign(freezingBall.velocity.x) === directionBefore, 'same Ice/Pierce traversal bounced during safety overlap');
    assert(hasBrick(state, brick.id), 'same Ice/Pierce traversal prematurely shattered its frozen brick');
  }
  assert(!brick.iceFreezeSafetyActive, 'freeze safety did not end when the creating Ball cleared');
  assert((brick.iceFreezeSafetyElapsedSeconds ?? 1) < 1, 'exit-aware safety waited for its one-second ceiling');
  freezingBall.x = brick.x - freezingBall.radius - 1;
  freezingBall.y = brick.y + brick.height / 2;
  freezingBall.velocity = { x: 240, y: 0 };
  stepSimulation(state, { movementAxis: 0, mouseDisplacement: 0, speedMultiplier: 1 }, 1 / 120);
  assert(!hasBrick(state, brick.id), 'future direct Ball hit did not shatter an armed frozen brick');
}

{
  const state = emptyState();
  const brick = makeBrick('safety-ceiling', 8, 300);
  freezeBrick(brick);
  addBrick(state, brick);
  advanceFrozenBrickSafety(state, 0);
  assert(brick.iceFreezeSafetyActive, 'suspended world time advanced freeze safety');
  advanceFrozenBrickSafety(state, 0.999);
  assert(brick.iceFreezeSafetyActive, 'freeze safety expired before its one-second ceiling');
  advanceFrozenBrickSafety(state, 0.001);
  assert(!brick.iceFreezeSafetyActive, 'freeze safety exceeded its one-second ceiling');
}

for (const kind of ['GUN', 'MISSILE'] as const) {
  const state = emptyState();
  state.powers.levels.ICE_BALL = 1;
  const brick = makeBrick(`${kind}-target`, 8, 300);
  freezeBrick(brick);
  addBrick(state, brick);
  advanceFrozenBrickSafety(state, 0.5);
  addBrick(state, makeBrick(`${kind}-entry-blocker`, 0, 8));
  state.projectiles.push(kind === 'GUN'
    ? { id: 1, kind, x: brick.x + brick.width / 2, y: 322, velocity: { x: 0, y: -720 }, damage: 1 }
    : {
      id: 1, kind, x: brick.x + brick.width / 2, y: brick.y + brick.height / 2,
      velocity: { x: 0, y: 0 }, damage: 1, missilePhase: 'DEPLOYING', deploymentRemainingSeconds: 1,
    });
  stepSimulation(state, { movementAxis: 0, mouseDisplacement: 0, speedMultiplier: 1 }, 1 / 120);
  assert(hasBrick(state, brick.id), `${kind} shattered a safety-protected frozen brick`);
  assert(!state.projectiles.some(({ id }) => id === 1), `${kind} projectile survived its frozen-brick impact`);
  assert(brick.iceFreezeSafetyActive, `${kind} hit cleared or restarted freeze safety`);
}

for (const kind of ['BALL', 'GUN', 'MISSILE'] as const) {
  const state = emptyState();
  state.powers.levels.ICE_BALL = 1;
  state.powers.levels.ELECTRIC_BALL = 1;
  state.powers.levels.FIRE_BALL = 1;
  state.powers.levels.WIND_BALL = 1;
  const brick = makeBrick(`armed-${kind}`, 8, 300);
  freezeBrick(brick);
  addBrick(state, brick);
  addBrick(state, makeBrick(`armed-${kind}-elemental-target`, 12, 300));
  addBrick(state, makeBrick(`armed-${kind}-entry-blocker`, 0, 8));
  advanceFrozenBrickSafety(state, GAME_CONFIG.powers.iceDirectShatterSafetyMaximumSeconds);
  if (kind === 'BALL') {
    const ball = state.balls[0];
    Object.assign(ball, {
      x: brick.x + brick.width / 2,
      y: brick.y + brick.height + ball.radius + 1,
      velocity: { x: 0, y: -240 },
    });
  } else {
    state.projectiles.push(kind === 'GUN'
      ? { id: 1, kind, x: brick.x + brick.width / 2, y: 322, velocity: { x: 0, y: -720 }, damage: 1 }
      : {
        id: 1, kind, x: brick.x + brick.width / 2, y: brick.y + brick.height / 2,
        velocity: { x: 0, y: 0 }, damage: 1, missilePhase: 'DEPLOYING', deploymentRemainingSeconds: 1,
      });
  }
  stepSimulation(state, { movementAxis: 0, mouseDisplacement: 0, speedMultiplier: 1 }, 1 / 120);
  assert(!hasBrick(state, brick.id), `${kind} did not shatter an armed frozen brick`);
  if (kind === 'BALL') {
    assert(state.nextProjectileId === 2, 'direct Ball shatter did not trigger Electric');
    assert(state.fireEffects.length === 1 && state.windEffects.length === 1, 'direct Ball shatter did not trigger Fire/Wind');
  } else {
    assert(state.nextProjectileId === 1, `${kind} frozen shatter triggered Electric`);
    assert(state.fireEffects.length === 0 && state.windEffects.length === 0, `${kind} frozen shatter triggered Fire/Wind`);
  }
}

{
  const state = emptyState();
  state.powers.levels.ICE_BALL = 1;
  const left = makeBrick('bounce-left', 6, 300);
  const right = makeBrick('bounce-right', 8, 300);
  left.x = 400;
  right.x = 500;
  freezeBrick(left);
  freezeBrick(right);
  addBrick(state, left);
  addBrick(state, right);
  addBrick(state, makeBrick('bounce-entry-blocker', 0, 8));
  const ball = state.balls[0];
  Object.assign(ball, { x: 478, y: 310, velocity: { x: -240, y: 0 }, pierceCharge: 0 });
  for (let step = 0; step < 150 && hasBrick(state, left.id) && hasBrick(state, right.id); step += 1) {
    stepSimulation(state, { movementAxis: 0, mouseDisplacement: 0, speedMultiplier: 1 }, 1 / 120);
  }
  assert(!hasBrick(state, left.id) || !hasBrick(state, right.id), 'repeated bounce remained blocked by long frozen-brick immunity');
  assert(state.survivalTimeSeconds < 1.25, 'repeated bounce did not become shatterable near the one-second ceiling');
}
