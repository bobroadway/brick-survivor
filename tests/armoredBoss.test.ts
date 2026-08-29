import { recordOrdinaryBrickDestruction, updateBossPresentation } from '../src/simulation/boss';
import {
  advanceBrickField,
  createBrickField,
  getActiveBoss,
  getBossDescentSpeed,
  getMaximumConfiguredRushSpeed,
  getReservedFormationTargetCount,
} from '../src/simulation/brickField';
import { applyBrickDamage } from '../src/simulation/combat';
import { GAME_CONFIG } from '../src/simulation/config';
import { applyRoutedBrickDamage } from '../src/simulation/destructionRouting';
import { resolveBrickDescentSpeed } from '../src/simulation/difficulty';
import { createInitialGameState } from '../src/simulation/gameState';
import { freezeBossAtZero } from '../src/simulation/iceBall';
import { selectMissileTarget } from '../src/simulation/powerTargeting';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function verifyArmoredGeneration(): void {
  const originalChance = GAME_CONFIG.bricks.armoredEligibleChance;
  GAME_CONFIG.bricks.armoredEligibleChance = 1;
  const first = createBrickField();
  const second = createBrickField();
  GAME_CONFIG.bricks.armoredEligibleChance = originalChance;
  const signature = (field: ReturnType<typeof createBrickField>) => field.columns.flat()
    .map(({ id, speedClass, armored, hp, xpValue }) => `${id}:${speedClass}:${armored}:${hp}:${xpValue}`)
    .join('|');
  assert(signature(first) === signature(second), 'armored generation was not deterministic');
  for (const brick of first.columns.flat()) {
    const eligible = brick.speedClass === 'SLOW' || brick.speedClass === 'MEDIUM';
    assert(Boolean(brick.armored) === eligible, 'armor was assigned to an ineligible speed class');
    assert(brick.hp === (eligible ? 2 : 1), 'armor HP was incorrect');
    assert(brick.xpValue === (eligible ? 4 : 1), 'armor XP was incorrect');
  }
}

function verifyBossDirectorAndEntity(): void {
  const state = createInitialGameState();
  state.brickField.columns.forEach((column) => column.splice(0));
  state.bossDirector.armedOpportunities = 1;
  for (let roll = 0; roll < 1000 && !state.bossDirector.bossQueued; roll += 1) {
    recordOrdinaryBrickDestruction(state);
  }
  assert(state.bossDirector.bossQueued, 'armed boss lottery never queued a boss');
  const startColumn = state.bossDirector.queuedStartColumn;
  assert(startColumn !== undefined && startColumn >= 2 && startColumn <= 15, 'boss start column was illegal');
  let gapGenerated = false;
  advanceBrickField(state.brickField, 0, 1, 1, {
    queuedBossStartColumn: startColumn,
    bossPreGapGenerated: false,
    onBossPreGapGenerated: () => { gapGenerated = true; },
  });
  assert(gapGenerated && !getActiveBoss(state.brickField), 'boss did not wait for its pre-gap row');
  const gapRowId = Math.max(...state.brickField.columns.flat().map(({ rowId }) => rowId));
  const gapRow = state.brickField.columns.flat().filter(({ rowId }) => rowId === gapRowId);
  assert(gapRow.every(({ column }) => column < startColumn || column >= startColumn + 3),
    'pre-gap row occupied a reserved boss column');
  assert(getReservedFormationTargetCount(10, 17) === 9, '10/20 reserved density did not scale to 9/17');
  for (let step = 0; step < 1000 && !getActiveBoss(state.brickField); step += 1) {
    advanceBrickField(state.brickField, 1 / 120, 1, 1, {
      queuedBossStartColumn: startColumn,
      bossPreGapGenerated: true,
      bossPreGapRowId: gapRowId,
      onBossSpawned: (boss) => {
        state.bossDirector.activeBossId = boss.id;
        state.bossDirector.bossQueued = false;
      },
    });
  }
  const boss = getActiveBoss(state.brickField);
  assert(boss, 'queued boss did not spawn');
  assert(boss.width === 176 && boss.height === 68, 'boss footprint was not 3x3 pitches');
  assert(boss.hp === 25 && boss.xpValue === 50, 'boss HP/XP tuning was incorrect');
  assert(selectMissileTarget(boss.x, [boss], new Set()) === undefined, 'missile intentionally targeted boss');
  const originalY = boss.y;
  advanceBrickField(state.brickField, 1, 1, 1);
  assert(Math.abs(boss.y - originalY - getMaximumConfiguredRushSpeed()) < 1e-9,
    'boss did not use maximum configured RUSH speed while emerging');
  while (boss.bossArrivalPhase === 'RUSH') advanceBrickField(state.brickField, 1 / 120, 1, 1);
  assert(boss.y === GAME_CONFIG.bricks.fieldTopY && boss.bossArrivalPhase === 'DECELERATING',
    'boss did not begin decelerating at full emergence');
  const rushSpeed = getMaximumConfiguredRushSpeed();
  assert(Math.abs(getBossDescentSpeed(boss, 1) - rushSpeed) < 1e-9,
    'boss deceleration did not begin at RUSH speed');
  advanceBrickField(state.brickField, 0.5, 1, 1);
  const midwaySpeed = getBossDescentSpeed(boss, 1);
  const cruiseSpeed = resolveBrickDescentSpeed('SLOW', 1) * 0.5;
  assert(midwaySpeed < rushSpeed && midwaySpeed > cruiseSpeed, 'boss deceleration was not smooth/monotonic');
  advanceBrickField(state.brickField, 0.5, 1, 1);
  assert(boss.bossArrivalPhase === 'CRUISE'
    && Math.abs(getBossDescentSpeed(boss, 1) - cruiseSpeed) < 1e-9,
  'boss did not settle at current half-SLOW speed');
  applyBrickDamage(state, boss, 3, 'GUN');
  assert(boss.hp === 22 && boss.displayHp === 25, 'boss actual/display HP did not separate');
  updateBossPresentation(state, GAME_CONFIG.boss.hpDisplayStepSeconds * 2.1);
  assert(boss.displayHp === 23, 'boss display HP skipped or failed to tick through integers');
  state.progression.level = 30;
  state.progression.currentXp = 0;
  state.progression.xpRequiredForNextLevel = 200;
  applyBrickDamage(state, boss, 100, 'GUN');
  assert(state.progression.currentXp === 50, 'boss XP was not awarded exactly once');
  assert(state.bossDeathEffects.length === 1, 'boss death fade was not created');
  updateBossPresentation(state, GAME_CONFIG.boss.hpDisplayStepSeconds * 23.1);
  assert(state.bossDeathEffects[0].displayHp === 0,
    'boss death representation did not present the complete HP queue');
}

function verifyFrozenBossShatter(): void {
  const state = createInitialGameState();
  state.brickField.columns.forEach((column) => column.splice(0));
  state.progression.level = 30;
  state.progression.currentXp = 0;
  state.progression.xpRequiredForNextLevel = 200;
  const boss = {
    id: 'boss:ice', rowId: 1, column: 8, x: 522, y: 100,
    width: 176, height: 68, speedClass: 'SLOW' as const,
    hp: 25, displayHp: 25, xpValue: 50, kind: 'BOSS' as const,
  };
  state.brickField.columns[boss.column].push(boss);
  assert(freezeBossAtZero(boss, 1), 'lethal Ice Ball did not create a frozen zero-HP boss');
  assert(state.progression.currentXp === 0 && getActiveBoss(state.brickField) === boss,
    'frozen Boss awarded XP or left gameplay before shatter');
  assert(applyRoutedBrickDamage(state, boss, 1, 'GUN').frozenShattered,
    'next qualifying hit did not shatter frozen Boss');
  assert(state.progression.currentXp === 50, 'frozen Boss shatter did not award 50 XP');
  assert(state.iceShatterEffects[0].width === 224 && state.iceShatterEffects[0].height === 116,
    'frozen Boss did not create the 5x5 shatter visual');
}

verifyArmoredGeneration();
verifyBossDirectorAndEntity();
verifyFrozenBossShatter();
