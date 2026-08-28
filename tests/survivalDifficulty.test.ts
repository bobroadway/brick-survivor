import { getBrickOccupancyRange } from '../src/simulation/brickField';
import { advanceBrickPressureAssist, createBrickPressureAssistState } from '../src/simulation/brickPressureAssist';
import { GAME_CONFIG } from '../src/simulation/config';
import { resolveBrickDescentSpeed, type BrickSpeedClass } from '../src/simulation/difficulty';
import { continueLifeLost, resolveFinalBallLoss } from '../src/simulation/gameFlow';
import { createInitialGameState } from '../src/simulation/gameState';
import { SimulationStepOutcome, stepSimulation } from '../src/simulation/simulation';
import { createSessionState, enterWin, GamePhase, isSimulationRunning } from '../src/simulation/sessionState';
import {
  getBrickDensityDifficultyLevel,
  getSurvivalPhase,
  getVirtualDifficultyLevel,
  SurvivalPhase,
} from '../src/simulation/survivalDifficulty';
import { getMenuTitle } from '../src/phaser/ui/pauseMenuState';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertNear(actual: number, expected: number, message: string, tolerance = 1e-6): void {
  assert(Math.abs(actual - expected) <= tolerance, `${message}: expected ${expected}, received ${actual}`);
}

function testDifficultyPhasesAndCurve(): void {
  const config = GAME_CONFIG.survival;
  assert(getSurvivalPhase(0) === SurvivalPhase.EasyStart, '0:00 phase mismatch');
  assert(getSurvivalPhase(29.9) === SurvivalPhase.EasyStart, '0:29.9 phase mismatch');
  assert(getSurvivalPhase(30) === SurvivalPhase.Ramp, '0:30 phase mismatch');
  assert(getSurvivalPhase(719.999) === SurvivalPhase.Ramp, 'pre-enrage phase mismatch');
  assert(getSurvivalPhase(720) === SurvivalPhase.Enrage, '12:00 phase mismatch');
  assert(getSurvivalPhase(1019.9) === SurvivalPhase.Enrage, '16:59.9 phase mismatch');
  assert(getSurvivalPhase(1020) === SurvivalPhase.Win, '17:00 phase mismatch');
  assertNear(getVirtualDifficultyLevel(0), 1, 'easy-start difficulty');
  assertNear(getVirtualDifficultyLevel(30), 1, 'ramp-start difficulty');
  assertNear(getVirtualDifficultyLevel((30 + 720) / 2), 8.5, 'mid-ramp difficulty');
  assertNear(getVirtualDifficultyLevel(720), 16, 'ramp-end difficulty');
  assertNear(getVirtualDifficultyLevel(1000), 16, 'enrage speed ceiling');
  assert(config.enrageDensityMin === 20 && config.enrageDensityMax === 20, 'enrage density config mismatch');
}

function testOldLevel16EquivalenceAndEnrageDensity(): void {
  const expected: Record<BrickSpeedClass, number> = {
    SLOW: 16.5,
    MEDIUM: 20,
    FAST: 23.5,
    RUSH: 27,
  };
  let weightedTotal = 0;
  let totalWeight = 0;
  for (const entry of GAME_CONFIG.bricks.speedClassDistribution) {
    const oldLevel16Speed = resolveBrickDescentSpeed(entry.speedClass, 16);
    const timedSpeed = resolveBrickDescentSpeed(entry.speedClass, getVirtualDifficultyLevel(720));
    assertNear(oldLevel16Speed, expected[entry.speedClass], `old Level16 ${entry.speedClass}`);
    assertNear(timedSpeed, oldLevel16Speed, `timed Level16 ${entry.speedClass}`);
    weightedTotal += timedSpeed * entry.weight;
    totalWeight += entry.weight;
  }
  assertNear(weightedTotal / totalWeight, 18.6, 'old Level16 weighted average');
  const oldLevel16Density = getBrickOccupancyRange(16);
  assert(oldLevel16Density.minimum === 12 && oldLevel16Density.maximum === 14, 'old Level16 density mismatch');
  const preEnrageDensity = getBrickOccupancyRange(getBrickDensityDifficultyLevel(719.999));
  assert(preEnrageDensity.minimum === 12 && preEnrageDensity.maximum === 14, 'pre-enrage density mismatch');
  const enrageDensity = getBrickOccupancyRange(getBrickDensityDifficultyLevel(720));
  assert(enrageDensity.minimum === 20 && enrageDensity.maximum === 20, 'enrage density was not full');
}

function testPlayerLevelDecouplingAndWorldTimer(): void {
  const lowLevel = createInitialGameState();
  const highLevel = createInitialGameState();
  lowLevel.survivalTimeSeconds = highLevel.survivalTimeSeconds = 300;
  lowLevel.progression.level = 5;
  highLevel.progression.level = 20;
  const lowBrick = lowLevel.brickField.columns.flat()[0];
  const highBrick = highLevel.brickField.columns.flat()[0];
  const lowStartY = lowBrick.y;
  const highStartY = highBrick.y;
  const input = { movementAxis: 0, mouseDisplacement: 0, speedMultiplier: 1 };
  stepSimulation(lowLevel, input, 1 / 120, 1 / 120);
  stepSimulation(highLevel, input, 1 / 120, 1 / 120);
  assertNear(lowBrick.y - lowStartY, highBrick.y - highStartY, 'player level changed timed brick speed');
  assertNear(lowLevel.survivalTimeSeconds, 300 + 1 / 120, 'world timer advancement');
  const before = lowLevel.survivalTimeSeconds;
  stepSimulation(lowLevel, input, 1 / 120, 0);
  assertNear(lowLevel.survivalTimeSeconds, before, 'zero world delta advanced survival time');
}

function testLifeLostPaddlePreservation(): void {
  for (const x of [120, GAME_CONFIG.width / 2, 1160]) {
    const state = createInitialGameState();
    const session = createSessionState();
    session.phase = GamePhase.Running;
    state.paddle.x = x;
    state.survivalTimeSeconds = 321;
    resolveFinalBallLoss(state, session);
    assert(String(session.phase) === GamePhase.LifeLost, 'life loss did not enter LIFE_LOST');
    assert(continueLifeLost(state, session), 'life-loss continue failed');
    assertNear(state.paddle.x, x, 'life-loss continue moved paddle');
    assertNear(state.balls[0].x, x, 'replacement ball did not use paddle position');
    assertNear(state.survivalTimeSeconds, 321, 'life loss reset survival timer');
  }
  const clamped = createInitialGameState();
  const clampedSession = createSessionState();
  clampedSession.phase = GamePhase.Running;
  clamped.paddle.x = -100;
  resolveFinalBallLoss(clamped, clampedSession);
  assert(continueLifeLost(clamped, clampedSession), 'clamped life-loss continue failed');
  assertNear(
    clamped.paddle.x,
    GAME_CONFIG.playfield.left + clamped.paddle.width / 2,
    'invalid preserved paddle position did not use normal world clamp',
  );
}

function testGraceAndWinOutcome(): void {
  const assist = createBrickPressureAssistState();
  advanceBrickPressureAssist(assist, 6.9);
  assertNear(assist.brickPressureAssistLevels, 0, 'assist began before seven seconds');
  assertNear(assist.trappedBallSpeedBoost, 0, 'ball boost began before seven seconds');
  advanceBrickPressureAssist(assist, 0.1);
  assertNear(assist.brickPressureAssistLevels, 0, 'assist advanced at the grace boundary');
  advanceBrickPressureAssist(assist, 1);
  assertNear(assist.brickPressureAssistLevels, 1, 'assist did not ramp after grace');
  assertNear(assist.trappedBallSpeedBoost, 0.05, 'ball boost did not ramp after grace');

  const state = createInitialGameState();
  state.survivalTimeSeconds = GAME_CONFIG.survival.winTimeSeconds - GAME_CONFIG.fixedStepSeconds / 2;
  const outcome = stepSimulation(
    state,
    { movementAxis: 0, mouseDisplacement: 0, speedMultiplier: 1 },
    GAME_CONFIG.fixedStepSeconds,
    GAME_CONFIG.fixedStepSeconds,
  );
  assert(outcome === SimulationStepOutcome.Win, '17:00 did not produce immediate win outcome');
  assertNear(state.survivalTimeSeconds, GAME_CONFIG.survival.winTimeSeconds, 'win timer was not clamped');
  const session = createSessionState();
  enterWin(session);
  assert(session.phase === GamePhase.Win && !isSimulationRunning(session), 'WIN did not freeze simulation');
  assert(getMenuTitle('WIN') === 'BRICK SURVIVOR', 'WIN heading mismatch');
  assert(getMenuTitle('GAME_OVER') === 'YOU DIED', 'loss heading regressed');
  for (const suspendedPhase of [
    GamePhase.Ready,
    GamePhase.Paused,
    GamePhase.Build,
    GamePhase.LevelUp,
    GamePhase.LifeLost,
    GamePhase.GameOver,
    GamePhase.Win,
  ]) {
    session.phase = suspendedPhase;
    assert(!isSimulationRunning(session), `${suspendedPhase} incorrectly advances world survival time`);
  }
}

testDifficultyPhasesAndCurve();
testOldLevel16EquivalenceAndEnrageDensity();
testPlayerLevelDecouplingAndWorldTimer();
testLifeLostPaddlePreservation();
testGraceAndWinOutcome();
