import { getBrickOccupancyRange } from '../src/simulation/brickField';
import { advanceBrickPressureAssist, createBrickPressureAssistState } from '../src/simulation/brickPressureAssist';
import { GAME_CONFIG } from '../src/simulation/config';
import { resolveBrickDescentSpeed, type BrickSpeedClass } from '../src/simulation/difficulty';
import { createInitialGameState } from '../src/simulation/gameState';
import { SimulationStepOutcome, stepSimulation } from '../src/simulation/simulation';
import { createSessionState, enterWin, GamePhase, isSimulationRunning } from '../src/simulation/sessionState';
import {
  getSurvivalPhase,
  getBrickSpeedProgress,
  SurvivalPhase,
} from '../src/simulation/survivalDifficulty';
import { getMenuTitle } from '../src/phaser/ui/pauseMenuState';
import {
  getBrickSpeedProgressForRules,
  getCanonicalBrickSpeedTimingRuleParameters,
  getSpeedRampEndSecondsForRules,
  resolveBrickDescentSpeedForRules,
} from '../src/simulation/gameplayRules';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertNear(actual: number, expected: number, message: string, tolerance = 1e-6): void {
  assert(Math.abs(actual - expected) <= tolerance, `${message}: expected ${expected}, received ${actual}`);
}

function testSurvivalPhasesAndSpeedCurve(): void {
  const config = GAME_CONFIG.survival;
  assert(getSurvivalPhase(0) === SurvivalPhase.EasyStart, '0:00 phase mismatch');
  assert(getSurvivalPhase(29.9) === SurvivalPhase.EasyStart, '0:29.9 phase mismatch');
  assert(getSurvivalPhase(30) === SurvivalPhase.Ramp, '0:30 phase mismatch');
  assert(getSurvivalPhase(899.999) === SurvivalPhase.Ramp, 'pre-win phase mismatch');
  assert(getSurvivalPhase(900) === SurvivalPhase.Win, '15:00 phase mismatch');
  assertNear(getBrickSpeedProgress(0), 0, 'easy-start progress at 0:00');
  assertNear(getBrickSpeedProgress(15), 0, 'easy-start progress at 0:15');
  assertNear(getBrickSpeedProgress(30), 0, 'speed-ramp progress at 0:30');
  assertNear(getBrickSpeedProgress((30 + 840) / 2), 0.5, 'mid-ramp progress');
  assert(getBrickSpeedProgress(839) < 1, 'speed reached maximum before 14:00');
  assertNear(getBrickSpeedProgress(840), 1, '14:00 speed progress');
  assertNear(getBrickSpeedProgress(899.999), 1, 'final-minute speed plateau');
  const rules = getCanonicalBrickSpeedTimingRuleParameters();
  assert(getSpeedRampEndSecondsForRules(rules) === config.winTimeSeconds - GAME_CONFIG.brickSpeed.maxSpeedLeadSeconds,
    'speed ramp end was not derived from win time');
}

function testCanonicalSpeedsAndLevelBasedDensity(): void {
  const start: Record<BrickSpeedClass, number> = {
    SLOW: 2,
    MEDIUM: 3,
    FAST: 4,
    RUSH: 5,
  };
  const maximum: Record<BrickSpeedClass, number> = {
    SLOW: 12,
    MEDIUM: 14,
    FAST: 17,
    RUSH: 21,
  };
  for (const timestamp of [0, 15, 30]) {
    for (const speedClass of Object.keys(start) as BrickSpeedClass[]) {
      assertNear(resolveBrickDescentSpeed(speedClass, getBrickSpeedProgress(timestamp)), start[speedClass],
        `${speedClass} starting speed at ${timestamp}s`);
    }
  }
  const halfwayTime = (GAME_CONFIG.brickSpeed.easyStartSeconds
    + getSpeedRampEndSecondsForRules(getCanonicalBrickSpeedTimingRuleParameters())) / 2;
  for (const speedClass of Object.keys(start) as BrickSpeedClass[]) {
    assertNear(resolveBrickDescentSpeed(speedClass, getBrickSpeedProgress(halfwayTime)),
      (start[speedClass] + maximum[speedClass]) / 2, `${speedClass} halfway speed`);
  }
  let weightedTotal = 0;
  let weightedStartTotal = 0;
  let totalWeight = 0;
  for (const entry of GAME_CONFIG.bricks.speedClassDistribution) {
    const timedSpeed = resolveBrickDescentSpeed(entry.speedClass, getBrickSpeedProgress(840));
    assertNear(timedSpeed, maximum[entry.speedClass], `capped ${entry.speedClass}`);
    weightedTotal += timedSpeed * entry.weight;
    weightedStartTotal += start[entry.speedClass] * entry.weight;
    totalWeight += entry.weight;
  }
  assertNear(weightedStartTotal / totalWeight, 3, 'starting weighted average');
  assertNear(weightedTotal / totalWeight, 14.5, 'maximum weighted average');
  for (const timestamp of [840, 870, 899]) {
    for (const speedClass of Object.keys(maximum) as BrickSpeedClass[]) {
      assertNear(resolveBrickDescentSpeed(speedClass, getBrickSpeedProgress(timestamp)), maximum[speedClass],
        `${speedClass} final plateau at ${timestamp}s`);
    }
  }
  const startDensity = getBrickOccupancyRange(GAME_CONFIG.bricks.densityStartLevel);
  assert(startDensity.minimum === 4 && startDensity.maximum === 7, 'starting density mismatch');
  const midpointLevel = (GAME_CONFIG.bricks.densityStartLevel + GAME_CONFIG.bricks.densityFullLevel) / 2;
  const midpointDensity = getBrickOccupancyRange(midpointLevel);
  assert(midpointDensity.minimum === 12 && midpointDensity.maximum === 14, 'midpoint density mismatch');
  const fullDensity = getBrickOccupancyRange(GAME_CONFIG.bricks.densityFullLevel);
  const level25Density = getBrickOccupancyRange(25);
  const aboveFullDensity = getBrickOccupancyRange(GAME_CONFIG.bricks.densityFullLevel + 10);
  assert(level25Density.minimum === 19 && level25Density.maximum === 19, 'Level 25 density was not near-full');
  assert(fullDensity.minimum === 20 && fullDensity.maximum === 20, 'full-level density mismatch');
  assert(aboveFullDensity.minimum === 20 && aboveFullDensity.maximum === 20, 'above-full density mismatch');
}

function testConfigDerivedTwentyMinuteRamp(): void {
  const timing = { easyEndSeconds: 30, winSeconds: 20 * 60, maxSpeedLeadSeconds: 60 };
  assertNear(getSpeedRampEndSecondsForRules(timing), 19 * 60, '20-minute max-speed timestamp');
  const rules = {
    startSpeeds: { SLOW: 2, MEDIUM: 3, FAST: 4, RUSH: 5 },
    maxSpeeds: { SLOW: 12, MEDIUM: 14, FAST: 17, RUSH: 21 },
    classWeights: { SLOW: 60, MEDIUM: 25, FAST: 10, RUSH: 5 },
  };
  const midpoint = (timing.easyEndSeconds + getSpeedRampEndSecondsForRules(timing)) / 2;
  assertNear(getBrickSpeedProgressForRules(midpoint, timing), 0.5, '20-minute midpoint progress');
  for (const speedClass of Object.keys(rules.startSpeeds) as BrickSpeedClass[]) {
    assertNear(resolveBrickDescentSpeedForRules(speedClass, 0.5, rules),
      (rules.startSpeeds[speedClass] + rules.maxSpeeds[speedClass]) / 2,
      `20-minute ${speedClass} midpoint speed`);
  }
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

function testGraceAndWinOutcome(): void {
  const assist = createBrickPressureAssistState();
  advanceBrickPressureAssist(assist, 6.9);
  assertNear(assist.brickSpeedAssistProgress, 0, 'assist began before seven seconds');
  assertNear(assist.trappedBallSpeedBoost, 0, 'ball boost began before seven seconds');
  advanceBrickPressureAssist(assist, 0.1);
  assertNear(assist.brickSpeedAssistProgress, 0, 'assist advanced at the grace boundary');
  advanceBrickPressureAssist(assist, 1);
  assertNear(assist.brickSpeedAssistProgress, 1 / 15, 'assist did not ramp after grace');
  assertNear(assist.trappedBallSpeedBoost, 0.05, 'ball boost did not ramp after grace');

  const state = createInitialGameState();
  state.bossDirector.activeNormalBossId = 'boss:still-alive';
  state.bossDirector.finalBossTriggered = true; // Final Boss was already spawned and defeated.
  state.survivalTimeSeconds = GAME_CONFIG.survival.winTimeSeconds - GAME_CONFIG.fixedStepSeconds / 2;
  const outcome = stepSimulation(
    state,
    { movementAxis: 0, mouseDisplacement: 0, speedMultiplier: 1 },
    GAME_CONFIG.fixedStepSeconds,
    GAME_CONFIG.fixedStepSeconds,
  );
  assert(outcome === SimulationStepOutcome.Win, '15:00 did not produce immediate win outcome');
  assertNear(state.survivalTimeSeconds, GAME_CONFIG.survival.winTimeSeconds, 'win timer was not clamped');
  const session = createSessionState();
  enterWin(session);
  assert(session.phase === GamePhase.Win && !isSimulationRunning(session), 'WIN did not freeze simulation');
  assert(getMenuTitle('WIN') === 'BRICKS SURVIVED!', 'WIN heading mismatch');
  assert(getMenuTitle('GAME_OVER') === 'YOU DIED', 'loss heading regressed');
  for (const suspendedPhase of [
    GamePhase.Ready,
    GamePhase.Paused,
    GamePhase.Build,
    GamePhase.LevelUp,
    GamePhase.GameOver,
    GamePhase.Win,
  ]) {
    session.phase = suspendedPhase;
    assert(!isSimulationRunning(session), `${suspendedPhase} incorrectly advances world survival time`);
  }
}

testSurvivalPhasesAndSpeedCurve();
testCanonicalSpeedsAndLevelBasedDensity();
testConfigDerivedTwentyMinuteRamp();
testPlayerLevelDecouplingAndWorldTimer();
testGraceAndWinOutcome();
