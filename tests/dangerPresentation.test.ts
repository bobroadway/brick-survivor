import type { BrickState } from '../src/simulation/brickField';
import { getBrickFailureBoundaryY } from '../src/simulation/brickField';
import { GAME_CONFIG } from '../src/simulation/config';
import {
  getBrickDangerDepthProgress,
  getDangerVignetteTarget,
  getMaximumDangerDepth,
  isDangerBrick,
  smoothDangerIntensity,
} from '../src/simulation/dangerPresentation';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertNear(actual: number, expected: number, message: string, tolerance = 1e-6): void {
  assert(Math.abs(actual - expected) <= tolerance, `${message}: expected ${expected}, received ${actual}`);
}

function makeBrick(id: string, bottom: number): BrickState {
  return {
    id, rowId: 1, column: 0, x: 100, y: bottom - 20, width: 56, height: 20,
    speedClass: 'SLOW', hp: 1, xpValue: 1, kind: 'NORMAL',
  };
}

const threshold = GAME_CONFIG.bricks.dangerLineY;
const above = makeBrick('above', threshold - 0.01);
const crossing = makeBrick('crossing', threshold);
const halfway = makeBrick('halfway', (threshold + GAME_CONFIG.paddle.y) / 2);
const paddleAligned = makeBrick('paddle', GAME_CONFIG.paddle.y);
const beyondPaddle = makeBrick('beyond', GAME_CONFIG.paddle.y + 50);

assert(!isDangerBrick(above), 'brick above threshold was marked dangerous');
assert(isDangerBrick(crossing), 'brick crossing with its bottom edge was not dangerous');
assertNear(getBrickDangerDepthProgress(above), 0, 'above-threshold progress');
assertNear(getBrickDangerDepthProgress(crossing), 0, 'threshold progress');
assertNear(getBrickDangerDepthProgress(halfway), 0.5, 'half-depth progress');
assertNear(getBrickDangerDepthProgress(paddleAligned), 1, 'paddle-aligned progress');
assertNear(getBrickDangerDepthProgress(beyondPaddle), 1, 'danger progress clamp');
assertNear(getMaximumDangerDepth([above, halfway, paddleAligned]), 1, 'maximum danger depth');
assertNear(getMaximumDangerDepth([above, halfway]), 0.5, 'deepest remaining brick');
assertNear(getMaximumDangerDepth([]), 0, 'empty danger field');
assertNear(getDangerVignetteTarget([above]), 0, 'above-threshold vignette target');
assertNear(
  getDangerVignetteTarget([crossing]),
  GAME_CONFIG.rendering.dangerVignetteMinimumIntensity,
  'threshold vignette target',
);
assertNear(getDangerVignetteTarget([halfway]), 0.59, 'half-depth vignette target');
assertNear(getDangerVignetteTarget([halfway, paddleAligned]), 1, 'deepest-brick vignette target');

const easedIn = smoothDangerIntensity(0, 1, 0.1);
assert(easedIn > 0 && easedIn < 1, 'vignette did not ease in');
const easedDeeper = smoothDangerIntensity(easedIn, 1, 0.1);
assert(easedDeeper > easedIn && easedDeeper < 1, 'vignette did not smoothly intensify');
const easedOut = smoothDangerIntensity(easedDeeper, 0, 0.1);
assert(easedOut > 0 && easedOut < easedDeeper, 'vignette did not ease out');
assert(getBrickFailureBoundaryY() === GAME_CONFIG.playfield.bottom, 'game-over boundary changed');
assert(GAME_CONFIG.bricks.dangerLineY < getBrickFailureBoundaryY(), 'danger threshold is not an early warning');
