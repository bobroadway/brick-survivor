import { recordBossSpawned } from '../src/simulation/boss';
import { type BrickState } from '../src/simulation/brickField';
import { applyBrickDamage } from '../src/simulation/combat';
import { GAME_CONFIG } from '../src/simulation/config';
import { createInitialGameState, type BallState, type GameState } from '../src/simulation/gameState';
import { getXpRequiredForNextLevel } from '../src/simulation/progression';
import { resolveBrickThreats, SimulationStepOutcome, stepSimulation } from '../src/simulation/simulation';

const idleInput = { movementAxis: 0, mouseDisplacement: 0, speedMultiplier: 1 };

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertNear(actual: number, expected: number, message: string, tolerance = 1e-8): void {
  assert(Math.abs(actual - expected) <= tolerance, `${message}: expected ${expected}, received ${actual}`);
}

function clearField(state: GameState): void {
  for (const column of state.brickField.columns) column.splice(0);
}

function addBrick(state: GameState, brick: BrickState): void {
  state.brickField.columns[brick.column].push(brick);
}

function makeBrick(id: string, y: number, overrides: Partial<BrickState> = {}): BrickState {
  return {
    id, rowId: 1, column: 9, x: 582, y,
    width: GAME_CONFIG.bricks.brickWidth, height: GAME_CONFIG.bricks.brickHeight,
    speedClass: 'SLOW', hp: 1, xpValue: 1, kind: 'NORMAL',
    ...overrides,
  };
}

function loseBall(ball: BallState): void {
  ball.y = GAME_CONFIG.playfield.bottom + ball.radius + 1;
  ball.velocity.x = 0;
  ball.velocity.y = GAME_CONFIG.ball.speed;
}

function testInitialHpAndRestartDefaults(): void {
  const first = createInitialGameState();
  const restarted = createInitialGameState();
  assert(first.playerHp === 10 && first.playerMaxHp === 10, 'new run did not start at 10/10 HP');
  assert(restarted.playerHp === 10 && restarted.playerMaxHp === 10, 'restart state did not reset to 10/10 HP');
  assert(GAME_CONFIG.player.maxHp === 10, 'max HP is not canonical config');
  assert(GAME_CONFIG.player.finalBallLostDamage === 5
    && GAME_CONFIG.player.normalBrickLostDamage === 6
    && GAME_CONFIG.player.normalBrickPaddleDamage === 3
    && GAME_CONFIG.player.armoredBrickLostDamage === 8
    && GAME_CONFIG.player.armoredBrickPaddleDamage === 6
    && GAME_CONFIG.player.bossLostDamage === 10
    && GAME_CONFIG.player.levelUpHeal === 1,
  'canonical HP damage/heal values drifted');
}

function testMultiballLossAndImmediateReplacement(): void {
  const state = createInitialGameState();
  clearField(state);
  const parent = state.balls[0];
  state.balls.push({ ...structuredClone(parent), id: 2 }, { ...structuredClone(parent), id: 3 });
  state.nextBallId = 4;

  loseBall(state.balls[2]);
  assert(stepSimulation(state, idleInput, 0, 0) === SimulationStepOutcome.None, 'partial multiball loss produced an outcome');
  assert(state.balls.length === 2 && state.playerHp === 10, 'first multiball loss damaged HP');
  loseBall(state.balls[1]);
  stepSimulation(state, idleInput, 0, 0);
  assert(state.balls.length === 1 && state.playerHp === 10, 'second multiball loss damaged HP');

  const preservedPaddleX = 830;
  state.paddle.x = preservedPaddleX;
  state.brickPressureAssist.timeSinceLastBallPaddleContact = 30;
  state.brickPressureAssist.trappedBallSpeedBoost = GAME_CONFIG.ball.speedAssistMaximumPercentage;
  state.powers.levels.GUN = 1;
  state.powers.gunReloadSeconds = 2;
  state.powers.levels.HOMING_MISSILE = 1;
  state.powers.missileReloadSeconds = 2;
  state.powers.levels.SPLITTING_BALL = 1;
  state.powers.splitTimerSeconds = 1;
  state.powers.levels.GUN = 1;
  state.powers.gunReloadSeconds = 2;
  state.powers.levels.HOMING_MISSILE = 1;
  state.powers.missileReloadSeconds = 2;
  state.powers.levels.SPLITTING_BALL = 1;
  state.powers.splitTimerSeconds = 1;
  loseBall(state.balls[0]);
  const beforeTime = state.survivalTimeSeconds;
  const outcome = stepSimulation(state, idleInput, GAME_CONFIG.fixedStepSeconds, GAME_CONFIG.fixedStepSeconds);
  assert(outcome === SimulationStepOutcome.None, 'survived final-Ball loss interrupted simulation');
  assert(state.playerHp === 5 && state.balls.length === 1, 'final Ball did not deal five damage and spawn one replacement');
  assertNear(state.balls[0].x, preservedPaddleX, 'replacement Ball did not preserve paddle X');
  assertNear(state.brickPressureAssist.timeSinceLastBallPaddleContact, 0, 'replacement Ball did not reset trapped inactivity');
  assert(state.survivalTimeSeconds > beforeTime, 'survival timer stopped for replacement');
  assert(state.powers.gunReloadSeconds < 2 && state.powers.missileReloadSeconds < 2
    && state.powers.splitTimerSeconds > 1,
  'world cooldowns did not continue through final-Ball replacement');
  assert(state.powers.gunReloadSeconds < 2 && state.powers.missileReloadSeconds < 2
    && state.powers.splitTimerSeconds > 1,
  'world cooldowns did not continue through final-Ball replacement');
}

function testFinalBallDeath(): void {
  const state = createInitialGameState();
  clearField(state);
  state.playerHp = 1;
  loseBall(state.balls[0]);
  assert(stepSimulation(state, idleInput, 0, 0) === SimulationStepOutcome.PlayerDefeated,
    'lethal final-Ball loss did not defeat player');
  assert(state.playerHp === 0 && state.balls.length === 0, 'lethal final-Ball loss spawned a replacement');
}

function testBrickEscapeAndMultipleEscapes(): void {
  const state = createInitialGameState();
  clearField(state);
  const escaped = makeBrick('escaped', GAME_CONFIG.playfield.bottom - GAME_CONFIG.bricks.brickHeight);
  addBrick(state, escaped);
  const beforeTime = state.survivalTimeSeconds;
  assert(stepSimulation(state, idleInput, GAME_CONFIG.fixedStepSeconds, GAME_CONFIG.fixedStepSeconds)
    === SimulationStepOutcome.None, 'nonlethal brick escape interrupted play');
  assert(state.playerHp === 4 && !state.brickField.columns[escaped.column].includes(escaped), 'brick escape did not deal six damage and remove brick');
  assert(state.fallingBrickEffects.length === 1, 'brick escape did not retain a visual-only falling copy');
  assert(state.progression.currentXp === 0 && state.projectiles.length === 0
    && state.fireEffects.length === 0 && state.windEffects.length === 0,
  'escaped brick produced kill rewards or procs');
  assert(state.survivalTimeSeconds > beforeTime, 'brick escape stopped survival time');

  const multiple = createInitialGameState();
  clearField(multiple);
  for (let index = 0; index < 1; index += 1) {
    addBrick(multiple, makeBrick(`escape-${index}`, GAME_CONFIG.playfield.bottom - 20, { column: index, x: 42 + index * 60 }));
  }
  assert(stepSimulation(multiple, idleInput, 0, 0) === SimulationStepOutcome.None,
    'one deterministic escape incorrectly killed player');
  assert(multiple.playerHp === 4, 'one escape did not deal six damage');
  const second = makeBrick('escape-1', GAME_CONFIG.playfield.bottom - 20, { column: 3, x: 222 });
  addBrick(multiple, second);
  assert(stepSimulation(multiple, idleInput, 0, 0) === SimulationStepOutcome.PlayerDefeated
    && multiple.playerHp === 0, 'second escape did not cause HP death');
}

function paddleContactY(height = GAME_CONFIG.bricks.brickHeight): number {
  return GAME_CONFIG.paddle.y - GAME_CONFIG.paddle.height / 2 - height + 0.01;
}

function testPaddleFacetankVariants(): void {
  const normal = createInitialGameState();
  clearField(normal);
  normal.powers.levels.ELECTRIC_BALL = 1;
  normal.powers.levels.FIRE_BALL = 1;
  normal.powers.levels.WIND_BALL = 1;
  const normalBrick = makeBrick('facetank', paddleContactY());
  addBrick(normal, normalBrick);
  stepSimulation(normal, idleInput, 0, 0);
  assert(normal.playerHp === 7 && normal.progression.currentXp === 1, 'normal facetank damage/XP mismatch');
  assert(normal.nextProjectileId === 1 && normal.fireEffects.length === 0 && normal.windEffects.length === 0,
    'PADDLE destruction triggered Ball elementals');

  const armored = createInitialGameState();
  clearField(armored);
  const armoredBrick = makeBrick('armored-facetank', paddleContactY(), {
    armored: true, hp: GAME_CONFIG.bricks.armoredHp, xpValue: GAME_CONFIG.bricks.armoredXp,
  });
  addBrick(armored, armoredBrick);
  stepSimulation(armored, idleInput, 0, 0);
  assert(armored.playerHp === 4 && armored.progression.currentXp === GAME_CONFIG.bricks.armoredXp,
    'Armored facetank did not terminally destroy for normal XP');
  assert(!armored.brickField.columns[armoredBrick.column].includes(armoredBrick), 'Armored facetank left brick active');

  const stripped = createInitialGameState();
  clearField(stripped);
  const strippedBrick = makeBrick('stripped-facetank', paddleContactY(), {
    armored: true, hp: 1, xpValue: GAME_CONFIG.bricks.armoredXp,
  });
  addBrick(stripped, strippedBrick);
  stepSimulation(stripped, idleInput, 0, 0);
  assert(stripped.playerHp === 7, 'stripped Armored brick did not use ordinary paddle damage');

  const frozen = createInitialGameState();
  clearField(frozen);
  frozen.powers.levels.ICE_BALL = 1;
  frozen.powers.levels.ELECTRIC_BALL = 1;
  const frozenBrick = makeBrick('frozen-facetank', paddleContactY(), {
    iceState: 'FROZEN', iceCollisionKills: 0, iceFreezeSafetyActive: false,
  });
  addBrick(frozen, frozenBrick);
  stepSimulation(frozen, idleInput, 0, 0);
  assert(frozen.playerHp === 7 && frozen.iceShatterEffects.length === 1, 'frozen facetank did not shatter');
  assert(frozen.nextProjectileId === 1, 'frozen PADDLE shatter triggered Ball Electric proc');

  const pending = createInitialGameState();
  clearField(pending);
  const pendingBrick = makeBrick('pending-facetank', paddleContactY(), { iceState: 'PENDING_FREEZE' });
  addBrick(pending, pendingBrick);
  resolveBrickThreats(pending);
  assert(pending.playerHp === 7 && pending.iceShatterEffects.length === 0,
    'pending-freeze facetank incorrectly produced a frozen shatter');
}

function testArmoredEscapeAndFallingVisual(): void {
  const armored = createInitialGameState();
  clearField(armored);
  const brick = makeBrick('armored-escape', GAME_CONFIG.playfield.bottom - GAME_CONFIG.bricks.brickHeight, {
    armored: true, hp: GAME_CONFIG.bricks.armoredHp, xpValue: GAME_CONFIG.bricks.armoredXp,
  });
  addBrick(armored, brick);
  stepSimulation(armored, idleInput, 0, 0);
  assert(armored.playerHp === 2, 'fresh Armored escape did not deal eight damage');
  const ghost = armored.fallingBrickEffects[0];
  assert(ghost?.armored && !armored.brickField.columns[brick.column].includes(brick),
    'Armored escape did not preserve a non-authoritative visual copy');
  const initialY = ghost.y;
  const initialVelocity = ghost.velocityY;
  stepSimulation(armored, idleInput, 0.1, 0.1);
  assert(ghost.y > initialY && ghost.velocityY > initialVelocity,
    'escaped-brick visual did not accelerate downward');

  const stripped = createInitialGameState();
  clearField(stripped);
  addBrick(stripped, makeBrick('stripped-escape', GAME_CONFIG.playfield.bottom - 20, {
    armored: true, hp: 1, xpValue: GAME_CONFIG.bricks.armoredXp,
  }));
  stepSimulation(stripped, idleInput, 0, 0);
  assert(stripped.playerHp === 4, 'stripped Armored escape did not use ordinary lost damage');
}

function makeBoss(state: GameState, hp = GAME_CONFIG.boss.hp): BrickState {
  const boss = makeBrick(`boss:contact:${hp}`, paddleContactY(68), {
    column: 8, x: state.paddle.x - 88, width: 176, height: 68,
    kind: 'BOSS', hp, displayHp: hp, xpValue: GAME_CONFIG.boss.xp, bossArrivalPhase: 'CRUISE',
  });
  addBrick(state, boss);
  recordBossSpawned(state, boss);
  return boss;
}

function testBossContactCombat(): void {
  const state = createInitialGameState();
  clearField(state);
  const boss = makeBoss(state);
  resolveBrickThreats(state);
  assert(state.playerHp === 7 && boss.hp === 47, 'first Boss contact was not immediate mutual 3 damage');
  stepSimulation(state, idleInput, 0.5, 0.5);
  assert(state.playerHp === 7 && boss.hp === 47, 'Boss contact ticked before one active-world second');
  stepSimulation(state, idleInput, 0.5, 0.5);
  assert(state.playerHp === 4 && boss.hp === 44, 'Boss contact did not repeat at one active-world second');
  stepSimulation(state, idleInput, 1, 1);
  assert(state.playerHp === 1 && boss.hp === 41, 'third Boss contact tick mismatch');
  stepSimulation(state, idleInput, 1, 1);
  assert(state.playerHp === 0, 'fourth Boss contact did not defeat player');

  const recontact = createInitialGameState();
  clearField(recontact);
  const recontactBoss = makeBoss(recontact);
  resolveBrickThreats(recontact);
  recontactBoss.x = GAME_CONFIG.playfield.left;
  resolveBrickThreats(recontact);
  recontactBoss.x = recontact.paddle.x - recontactBoss.width / 2;
  resolveBrickThreats(recontact);
  assert(recontact.playerHp === 4 && recontactBoss.hp === 44,
    'clear separation did not make Boss recontact immediately ready');

  const contactKill = createInitialGameState();
  clearField(contactKill);
  contactKill.progression.xpRequiredForNextLevel = 200;
  makeBoss(contactKill, 3);
  resolveBrickThreats(contactKill);
  assert(contactKill.playerHp === 7 && contactKill.progression.currentXp === GAME_CONFIG.boss.xp
    && contactKill.bossDeathEffects.length === 1, 'paddle-contact Boss kill did not award normal XP/presentation');

  const mutual = createInitialGameState();
  clearField(mutual);
  mutual.playerHp = 3;
  makeBoss(mutual, 3);
  assert(stepSimulation(mutual, idleInput, 0, 0) === SimulationStepOutcome.PlayerDefeated
    && mutual.playerHp === 0, 'simultaneous Boss/player death did not prioritize GAME OVER');
}

function testBossEscapeAndNoRewards(): void {
  const state = createInitialGameState();
  clearField(state);
  const boss = makeBrick('boss:escape', GAME_CONFIG.playfield.bottom - 68, {
    column: 8, x: 522, width: 176, height: 68, kind: 'BOSS', hp: 50, xpValue: 50,
    displayHp: 50, bossArrivalPhase: 'CRUISE',
  });
  addBrick(state, boss);
  recordBossSpawned(state, boss);
  stepSimulation(state, idleInput, 0, 0);
  assert(state.playerHp === 0, 'Boss escape did not deal ten damage');
  assert(!state.brickField.columns[boss.column].includes(boss), 'escaped Boss remained active');
  assert(state.progression.currentXp === 0 && state.bossDeathEffects.length === 0,
    'escaped Boss awarded XP or victorious death presentation');
  assert(state.bossDirector.activeNormalBossId === undefined, 'escaped Boss retained director ownership');
}

function testLevelHealingAndCap(): void {
  const state = createInitialGameState();
  clearField(state);
  state.playerHp = 8;
  for (let index = 0; index < 3; index += 1) {
    const xp = getXpRequiredForNextLevel(state.progression.level) - state.progression.currentXp;
    const reward = makeBrick(`level-${index}`, 200, { column: index, x: 42 + index * 60, xpValue: xp });
    addBrick(state, reward);
    applyBrickDamage(state, reward, Number.POSITIVE_INFINITY, 'GUN');
  }
  assert(state.progression.level === 4, 'three actual level increments were not earned');
  assert(state.playerHp === state.playerMaxHp, 'level healing did not heal once per level or respect cap');

  const queued = createInitialGameState();
  clearField(queued);
  queued.playerHp = 5;
  const threeLevelsXp = getXpRequiredForNextLevel(1) + getXpRequiredForNextLevel(2) + getXpRequiredForNextLevel(3);
  const largeReward = makeBrick('three-levels', 200, { xpValue: threeLevelsXp });
  addBrick(queued, largeReward);
  applyBrickDamage(queued, largeReward, Number.POSITIVE_INFINITY, 'GUN');
  assert(queued.progression.level === 4 && queued.powers.pendingSelections === 3 && queued.playerHp === 8,
    'multi-level reward did not heal exactly once per actual level');
}

function testDeathPrecedesSameStepWin(): void {
  const state = createInitialGameState();
  clearField(state);
  state.playerHp = 1;
  state.survivalTimeSeconds = GAME_CONFIG.survival.winTimeSeconds - GAME_CONFIG.fixedStepSeconds / 2;
  addBrick(state, makeBrick('boundary-death', GAME_CONFIG.playfield.bottom - 20));
  const outcome = stepSimulation(state, idleInput, GAME_CONFIG.fixedStepSeconds, GAME_CONFIG.fixedStepSeconds);
  assert(outcome === SimulationStepOutcome.PlayerDefeated, 'same-step win overrode zero-HP death');
}

testInitialHpAndRestartDefaults();
testMultiballLossAndImmediateReplacement();
testFinalBallDeath();
testBrickEscapeAndMultipleEscapes();
testPaddleFacetankVariants();
testArmoredEscapeAndFallingVisual();
testBossContactCombat();
testBossEscapeAndNoRewards();
testLevelHealingAndCap();
testDeathPrecedesSameStepWin();
