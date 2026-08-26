import { advanceBrickField, getBrickOccupancyRange, type BrickFieldState, type BrickState } from '../src/simulation/brickField';
import {
  advanceBrickPressureAssist,
  createBrickPressureAssistState,
  getEffectiveBrickSpeedLevel,
  recordBallPaddleContact,
} from '../src/simulation/brickPressureAssist';
import { GAME_CONFIG } from '../src/simulation/config';
import { resolveBrickDescentSpeed } from '../src/simulation/difficulty';
import { createInitialGameState, prepareSingleBall } from '../src/simulation/gameState';
import {
  getBallTargetSpeed,
  getCombinedBallSpeedMultiplier,
  getMultiballSlowdown,
  stepSimulation,
} from '../src/simulation/simulation';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertNear(actual: number, expected: number, message: string, tolerance = 1e-6): void {
  assert(Math.abs(actual - expected) <= tolerance, `${message}: expected ${expected}, received ${actual}`);
}

function advanceFixedSeconds(state: ReturnType<typeof createBrickPressureAssistState>, seconds: number): void {
  const steps = Math.round(seconds / GAME_CONFIG.fixedStepSeconds);
  for (let step = 0; step < steps; step += 1) {
    advanceBrickPressureAssist(state, GAME_CONFIG.fixedStepSeconds);
  }
}

function testGraceRampRecoveryAndReversal(): void {
  const assist = createBrickPressureAssistState();
  advanceFixedSeconds(assist, 5);
  assertNear(assist.brickPressureAssistLevels, 0, 'first five seconds must have no assistance');
  assertNear(assist.trappedBallSpeedBoost, 0, 'first five seconds must have no ball boost');
  advanceFixedSeconds(assist, 1);
  assertNear(assist.brickPressureAssistLevels, 1, 'six-second assistance');
  assertNear(assist.trappedBallSpeedBoost, 0.05, 'six-second ball boost');
  advanceFixedSeconds(assist, 4);
  assertNear(assist.brickPressureAssistLevels, 5, 'maximum assistance');
  assertNear(assist.trappedBallSpeedBoost, 0.25, 'maximum trapped-ball boost');

  recordBallPaddleContact(assist);
  assertNear(assist.brickPressureAssistLevels, 5, 'paddle contact snapped assistance');
  assertNear(assist.trappedBallSpeedBoost, 0.25, 'paddle contact snapped ball boost');
  advanceFixedSeconds(assist, 2.3);
  assertNear(assist.brickPressureAssistLevels, 2.7, 'constant-rate recovery');
  assertNear(assist.trappedBallSpeedBoost, 0.135, 'constant-rate ball boost recovery');
  recordBallPaddleContact(assist);
  advanceFixedSeconds(assist, 1);
  assertNear(assist.brickPressureAssistLevels, 1.7, 'repeated contact restarted recovery');
  assertNear(assist.trappedBallSpeedBoost, 0.085, 'repeated contact restarted ball recovery');

  assist.timeSinceLastBallPaddleContact = GAME_CONFIG.difficulty.brickPressureAssistGraceSeconds;
  advanceFixedSeconds(assist, 1);
  assertNear(assist.brickPressureAssistLevels, 2.7, 'mid-ramp target reversal');
  assertNear(assist.trappedBallSpeedBoost, 0.135, 'mid-ramp ball boost reversal');
}

function testAdditiveBallSpeedTargets(): void {
  assertNear(GAME_CONFIG.ball.speedAssistPercentageStep, 0.05, 'shared speed-assist step');
  assertNear(GAME_CONFIG.ball.speedAssistMaximumPercentage, 0.25, 'shared speed-assist maximum');
  const expectedAtMaximumBoost = [300, 288, 276, 264, 252, 240, 240];
  for (let count = 1; count <= expectedAtMaximumBoost.length; count += 1) {
    assertNear(getBallTargetSpeed(count, 0.25), expectedAtMaximumBoost[count - 1], `${count}-ball maximum trapped target`);
  }
  assertNear(getMultiballSlowdown(3), 0.1, 'three-ball slowdown');
  assertNear(getCombinedBallSpeedMultiplier(3, 0.25), 1.15, 'additive three-ball multiplier');
  assertNear(getBallTargetSpeed(2, 0.25), 288, 'additive target must not multiply modifiers');
}

function testEffectiveFractionalLevelAndFloor(): void {
  const assist = createBrickPressureAssistState();
  assist.brickPressureAssistLevels = 2.6;
  assertNear(getEffectiveBrickSpeedLevel(20, assist), 17.4, 'fractional effective level');
  assist.brickPressureAssistLevels = 5;
  assertNear(getEffectiveBrickSpeedLevel(3, assist), 1, 'effective level floor');
  assertNear(
    resolveBrickDescentSpeed('RUSH', 17.4),
    resolveBrickDescentSpeed('RUSH', getEffectiveBrickSpeedLevel(20, { ...assist, brickPressureAssistLevels: 2.6 })),
    'RUSH class did not accept fractional effective level',
  );
}

function makeField(bricks: BrickState[] = []): BrickFieldState {
  const columns = Array.from({ length: GAME_CONFIG.bricks.columns }, () => [] as BrickState[]);
  for (const brick of bricks) columns[brick.column].push(brick);
  return { columns, generatorState: 123, speedClassGeneratorState: 456, nextRowId: 1 };
}

function testSpeedLevelSeparateFromDensityLevel(): void {
  const brick: BrickState = {
    id: 'slow', rowId: 1, column: 0, x: 42, y: 100, width: 56, height: 20,
    speedClass: 'SLOW', hp: 1, xpValue: 1, kind: 'NORMAL',
  };
  const field = makeField([brick]);
  advanceBrickField(field, 0.5, 20, 17.5);
  assertNear(brick.y, 100 + resolveBrickDescentSpeed('SLOW', 17.5) * 0.5, 'existing brick effective-level movement');
  assert(brick.speedClass === 'SLOW', 'assistance changed brick class identity');

  const emptyField = makeField();
  advanceBrickField(emptyField, 0, 20, 1);
  const generatedCount = emptyField.columns.reduce((sum, column) => sum + column.length, 0);
  const density = getBrickOccupancyRange(20);
  assert(generatedCount >= density.minimum && generatedCount <= density.maximum, 'formation density used assisted level');
}

function testPaddleContactAndReplacementReset(): void {
  const state = createInitialGameState();
  state.brickPressureAssist.timeSinceLastBallPaddleContact = 10;
  state.brickPressureAssist.brickPressureAssistLevels = 5;
  const ball = state.balls[0];
  ball.x = state.paddle.x;
  ball.y = state.paddle.y - state.paddle.height / 2 - ball.radius - 6;
  ball.velocity.x = 0;
  ball.velocity.y = GAME_CONFIG.ball.speed;
  stepSimulation(state, { movementAxis: 0, mouseDisplacement: 0, speedMultiplier: 1 }, 0.05, 0.05);
  assertNear(state.brickPressureAssist.timeSinceLastBallPaddleContact, 0, 'valid paddle contact did not reset timer');
  assertNear(state.brickPressureAssist.brickPressureAssistLevels, 5, 'paddle contact snapped assistance to zero');
  assertNear(
    state.brickPressureAssist.trappedBallSpeedBoost,
    GAME_CONFIG.ball.speedAssistPercentageStep * 0.05,
    'paddle contact snapped the current trapped boost',
  );

  state.brickPressureAssist.timeSinceLastBallPaddleContact = 30;
  state.brickPressureAssist.trappedBallSpeedBoost = 0.25;
  prepareSingleBall(state);
  assertNear(state.brickPressureAssist.timeSinceLastBallPaddleContact, 0, 'replacement ball retained absence timer');
  assertNear(state.brickPressureAssist.brickPressureAssistLevels, 5, 'replacement ball snapped recovery state');
  assertNear(state.brickPressureAssist.trappedBallSpeedBoost, 0.25, 'replacement ball snapped trapped boost');

  const restarted = createInitialGameState();
  assertNear(restarted.brickPressureAssist.timeSinceLastBallPaddleContact, 0, 'new run timer reset');
  assertNear(restarted.brickPressureAssist.brickPressureAssistLevels, 0, 'new run assistance reset');
  assertNear(restarted.brickPressureAssist.trappedBallSpeedBoost, 0, 'new run trapped boost reset');
}

function testBallAndPaddleRemainUnaffected(): void {
  const state = createInitialGameState();
  const velocity = { ...state.balls[0].velocity };
  const paddleX = state.paddle.x;
  advanceFixedSeconds(state.brickPressureAssist, 10);
  assertNear(state.balls[0].velocity.x, velocity.x, 'assistance changed ball horizontal velocity');
  assertNear(state.balls[0].velocity.y, velocity.y, 'assistance changed ball vertical velocity');
  assertNear(state.paddle.x, paddleX, 'assistance changed paddle position');
}

function testBallDirectionPreservedByBoost(): void {
  const state = createInitialGameState();
  const ball = state.balls[0];
  ball.x = 640;
  ball.y = 500;
  state.brickPressureAssist.trappedBallSpeedBoost = 0.25;
  state.brickPressureAssist.timeSinceLastBallPaddleContact = 10;
  const before = { ...ball.velocity };
  stepSimulation(state, { movementAxis: 0, mouseDisplacement: 0, speedMultiplier: 1 }, 1 / 120, 1 / 120);
  const crossProduct = before.x * ball.velocity.y - before.y * ball.velocity.x;
  assertNear(crossProduct, 0, 'speed assistance rotated ball direction', 1e-8);
  assert(Math.hypot(ball.velocity.x, ball.velocity.y) > GAME_CONFIG.ball.speed, 'trapped boost did not begin smooth acceleration');
}

testGraceRampRecoveryAndReversal();
testAdditiveBallSpeedTargets();
testEffectiveFractionalLevelAndFloor();
testSpeedLevelSeparateFromDensityLevel();
testPaddleContactAndReplacementReset();
testBallAndPaddleRemainUnaffected();
testBallDirectionPreservedByBoost();
