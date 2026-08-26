import { GAME_CONFIG } from '../src/simulation/config';
import {
  getBrickRowPitch,
  getBrickVerticalEdgeGap,
  getMinimumBrickVerticalEdgeGap,
  getMinimumUpperBrickY,
  type VerticalBrickBounds,
} from '../src/simulation/brickGeometry';
import {
  advanceBrickField,
  createBrickField,
  getBrickSpawnY,
  getFormationEntryClearance,
  hasFormationEntryClearance,
  type BrickFieldState,
  type BrickState,
} from '../src/simulation/brickField';
import {
  getTargetAverageBrickSpeed,
  resolveBrickDescentSpeed,
  type BrickSpeedClass,
} from '../src/simulation/difficulty';

function assertNear(actual: number, expected: number, message: string): void {
  if (Math.abs(actual - expected) > 1e-9) {
    throw new Error(`${message}: expected ${expected}, received ${actual}`);
  }
}

export function verifyBrickVerticalGeometry(): void {
  const authoritativeGap = getMinimumBrickVerticalEdgeGap();
  const spawnedUpper: VerticalBrickBounds = { y: 0, height: GAME_CONFIG.bricks.brickHeight };
  const spawnedLower: VerticalBrickBounds = { y: getBrickRowPitch(), height: GAME_CONFIG.bricks.brickHeight };
  const spawnGap = getBrickVerticalEdgeGap(spawnedUpper, spawnedLower);

  const caughtLower: VerticalBrickBounds = { y: 100, height: GAME_CONFIG.bricks.brickHeight };
  const caughtUpper: VerticalBrickBounds = {
    y: getMinimumUpperBrickY(caughtLower, GAME_CONFIG.bricks.brickHeight),
    height: GAME_CONFIG.bricks.brickHeight,
  };
  const caughtGap = getBrickVerticalEdgeGap(caughtUpper, caughtLower);

  assertNear(spawnGap, authoritativeGap, 'spawned edge gap');
  assertNear(caughtGap, authoritativeGap, 'caught-up edge gap');
  assertNear(spawnGap, caughtGap, 'spawned and caught-up edge gaps');

  const expectedSpeeds: Record<BrickSpeedClass, number> = {
    SLOW: 3, MEDIUM: 4, FAST: 5, RUSH: 6,
  };
  verifyOldSlowBrickRegression();
  for (const speedClass of Object.keys(expectedSpeeds) as BrickSpeedClass[]) {
    assertNear(resolveBrickDescentSpeed(speedClass, 1), expectedSpeeds[speedClass], `${speedClass} speed`);
    verifySpatialEntryGate(speedClass, expectedSpeeds[speedClass]);
  }
}

function verifyOldSlowBrickRegression(): void {
  const field = createSingleBrickField('SLOW');
  const originalNextRowId = field.nextRowId;
  const oldAverageBasedInterval = getBrickRowPitch() / getTargetAverageBrickSpeed(1);
  advanceBrickField(field, oldAverageBasedInterval, 1);
  assertNear(oldAverageBasedInterval, 6.666666666666667, 'old average-based interval');
  assertNear(resolveBrickDescentSpeed('SLOW', 1) * oldAverageBasedInterval, 20, 'old SLOW displacement');
  assertNear(getFormationEntryClearance(field), 0, 'old SLOW edge clearance');
  if (field.nextRowId !== originalNextRowId) {
    throw new Error('SLOW formation spawned at the old illegal average-speed interval');
  }
}

function verifySpatialEntryGate(speedClass: BrickSpeedClass, speed: number): void {
  const field = createSingleBrickField(speedClass);
  const originalNextRowId = field.nextRowId;
  const almostClearSeconds = (getBrickRowPitch() - 0.001) / speed;
  advanceBrickField(field, almostClearSeconds, 1);
  if (hasFormationEntryClearance(field) || field.nextRowId !== originalNextRowId) {
    throw new Error(`${speedClass} formation spawned before spatial clearance was legal`);
  }
  advanceBrickField(field, 0.001 / speed, 1);
  if (field.nextRowId !== originalNextRowId + 1) {
    throw new Error(`${speedClass} formation did not spawn at legal spatial clearance`);
  }
  const frontier = field.columns[0].find((brick) => brick.id === 'entry-frontier');
  const spawned = field.columns.flat().find((brick) => brick.rowId === originalNextRowId);
  if (!frontier || !spawned) throw new Error(`${speedClass} spatial-gate test lost a brick`);
  assertNear(getBrickVerticalEdgeGap(spawned, frontier), getMinimumBrickVerticalEdgeGap(), `${speedClass} spawned gap`);
}

function createSingleBrickField(speedClass: BrickSpeedClass): BrickFieldState {
  const field = createBrickField();
  field.columns.forEach((column) => column.splice(0));
  const brick: BrickState = {
    id: 'entry-frontier', rowId: 1, column: 0,
    x: 42, y: getBrickSpawnY(), width: GAME_CONFIG.bricks.brickWidth,
    height: GAME_CONFIG.bricks.brickHeight, speedClass, hp: 1, xpValue: 1, kind: 'NORMAL',
  };
  field.columns[0].push(brick);
  return field;
}

verifyBrickVerticalGeometry();
