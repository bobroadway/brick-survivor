import { advanceBrickField, getBrickOccupancyRange, type BrickFieldState, type BrickState } from '../src/simulation/brickField';
import {
  advanceBrickPressureAssist,
  createBrickPressureAssistState,
  getEffectiveBrickSpeedProgress,
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
  advanceFixedSeconds(assist, 7);
  assertNear(assist.brickSpeedAssistProgress, 0, 'first seven seconds must have no assistance');
  assertNear(assist.trappedBallSpeedBoost, 0, 'first seven seconds must have no ball boost');
  advanceFixedSeconds(assist, 1);
  assertNear(assist.brickSpeedAssistProgress, 1 / 15, 'eight-second assistance');
  assertNear(assist.trappedBallSpeedBoost, 0.05, 'eight-second ball boost');
  advanceFixedSeconds(assist, 4);
  assertNear(assist.brickSpeedAssistProgress, 1 / 3, 'maximum assistance');
  assertNear(assist.trappedBallSpeedBoost, 0.25, 'maximum trapped-ball boost');

  recordBallPaddleContact(assist);
  assertNear(assist.brickSpeedAssistProgress, 1 / 3, 'paddle contact retained current assistance before recovery');
  assertNear(assist.trappedBallSpeedBoost, 0.25, 'paddle contact snapped ball boost');
  advanceFixedSeconds(assist, 2.3);
  assertNear(assist.brickSpeedAssistProgress, 1 / 3 - 2.3 / 15, 'constant-rate recovery');
  assertNear(assist.trappedBallSpeedBoost, 0.135, 'constant-rate ball boost recovery');
  recordBallPaddleContact(assist);
  advanceFixedSeconds(assist, 1);
  assertNear(assist.brickSpeedAssistProgress, 1 / 3 - 3.3 / 15, 'repeated contact restarted recovery');
  assertNear(assist.trappedBallSpeedBoost, 0.085, 'repeated contact restarted ball recovery');

  assist.timeSinceLastBallPaddleContact = GAME_CONFIG.brickSpeed.pressureAssistGraceSeconds;
  advanceFixedSeconds(assist, 1);
  assertNear(assist.brickSpeedAssistProgress, 1 / 3 - 2.3 / 15, 'mid-ramp target reversal');
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

function testEffectiveProgressAndFloor(): void {
  const assist = createBrickPressureAssistState();
  assist.brickSpeedAssistProgress = 0.2;
  assertNear(getEffectiveBrickSpeedProgress(0.8, assist), 0.6, 'fractional effective progress');
  assist.brickSpeedAssistProgress = 1 / 3;
  assertNear(getEffectiveBrickSpeedProgress(0.2, assist), 0, 'effective progress floor');
  assertNear(
    resolveBrickDescentSpeed('RUSH', 0.6),
    resolveBrickDescentSpeed('RUSH', getEffectiveBrickSpeedProgress(0.8, { ...assist, brickSpeedAssistProgress: 0.2 })),
    'RUSH class did not accept fractional effective progress',
  );
}

function makeField(bricks: BrickState[] = []): BrickFieldState {
  const columns = Array.from({ length: GAME_CONFIG.bricks.columns }, () => [] as BrickState[]);
  for (const brick of bricks) columns[brick.column].push(brick);
  return { columns, generatorState: 123, speedClassGeneratorState: 456, nextRowId: 1 };
}

function testSpeedProgressSeparateFromDensityLevel(): void {
  const brick: BrickState = {
    id: 'slow', rowId: 1, column: 0, x: 42, y: 100, width: 56, height: 20,
    speedClass: 'SLOW', hp: 1, xpValue: 1, kind: 'NORMAL',
  };
  const field = makeField([brick]);
  advanceBrickField(field, 0.5, 20, 0.75);
  assertNear(brick.y, 100 + resolveBrickDescentSpeed('SLOW', 0.75) * 0.5, 'existing brick effective-progress movement');
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
  state.brickPressureAssist.brickSpeedAssistProgress = 1 / 3;
  const ball = state.balls[0];
  ball.x = state.paddle.x;
  ball.y = state.paddle.y - state.paddle.height / 2 - ball.radius - 6;
  ball.velocity.x = 0;
  ball.velocity.y = GAME_CONFIG.ball.speed;
  stepSimulation(state, { movementAxis: 0, mouseDisplacement: 0, speedMultiplier: 1 }, 0.05, 0.05);
  assertNear(state.brickPressureAssist.timeSinceLastBallPaddleContact, 0, 'valid paddle contact did not reset timer');
  assertNear(state.brickPressureAssist.brickSpeedAssistProgress, 1 / 3, 'paddle contact began assistance recovery');
  assertNear(
    state.brickPressureAssist.trappedBallSpeedBoost,
    GAME_CONFIG.ball.speedAssistPercentageStep * 0.05,
    'paddle contact snapped the current trapped boost',
  );

  state.brickPressureAssist.timeSinceLastBallPaddleContact = 30;
  state.brickPressureAssist.trappedBallSpeedBoost = 0.25;
  prepareSingleBall(state);
  assertNear(state.brickPressureAssist.timeSinceLastBallPaddleContact, 0, 'replacement ball retained absence timer');
  assertNear(state.brickPressureAssist.brickSpeedAssistProgress, 1 / 3, 'replacement ball retained recovery state');
  assertNear(state.brickPressureAssist.trappedBallSpeedBoost, 0.25, 'replacement ball snapped trapped boost');

  const restarted = createInitialGameState();
  assertNear(restarted.brickPressureAssist.timeSinceLastBallPaddleContact, 0, 'new run timer reset');
  assertNear(restarted.brickPressureAssist.brickSpeedAssistProgress, 0, 'new run assistance reset');
  assertNear(restarted.brickPressureAssist.trappedBallSpeedBoost, 0, 'new run trapped boost reset');
}

function testBallAndPaddleRemainUnaffected(): void {
  const state = createInitialGameState();
  const velocity = { ...state.balls[0].velocity };
  const paddleX = state.paddle.x;
  advanceFixedSeconds(state.brickPressureAssist, 12);
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
testEffectiveProgressAndFloor();
testSpeedProgressSeparateFromDensityLevel();
testPaddleContactAndReplacementReset();
testBallAndPaddleRemainUnaffected();
testBallDirectionPreservedByBoost();
