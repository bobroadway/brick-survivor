import {
  hasClearedFormationEntryCorridor,
  type BrickState,
  type FrozenBrickContact,
} from './brickField';
import { applyBrickDamage, awardBrickDestruction } from './combat';
import { GAME_CONFIG } from './config';
import type { BallState, GameState } from './gameState';
import { getPowerLevel } from './powers';

export function isFrozenBrick(brick: BrickState): brick is BrickState & { iceCollisionKills: number } {
  return brick.iceState === 'FROZEN' && brick.iceCollisionKills !== undefined;
}

export function isPendingFreezeBrick(brick: BrickState): boolean {
  return brick.iceState === 'PENDING_FREEZE';
}

function initializeFrozenBrick(brick: BrickState, freezingBallId?: number): void {
  brick.iceState = 'FROZEN';
  brick.icePendingFreezeBallId = undefined;
  brick.icePendingFreezeContactActive = undefined;
  brick.iceCollisionKills = 0;
  brick.iceFreezeSafetyBallId = freezingBallId;
  brick.iceFreezeSafetyElapsedSeconds = 0;
  brick.iceFreezeSafetyActive = true;
}

export function freezeBrick(brick: BrickState, freezingBallId?: number): boolean {
  if (isFrozenBrick(brick) || isPendingFreezeBrick(brick)) return false;
  if (!hasClearedFormationEntryCorridor(brick)) {
    brick.iceState = 'PENDING_FREEZE';
    brick.icePendingFreezeBallId = freezingBallId;
    brick.icePendingFreezeContactActive = freezingBallId !== undefined;
    return true;
  }
  initializeFrozenBrick(brick, freezingBallId);
  return true;
}

export function commitPendingFreeze(brick: BrickState): boolean {
  if (!isPendingFreezeBrick(brick) || !hasClearedFormationEntryCorridor(brick)) return false;
  initializeFrozenBrick(brick, brick.icePendingFreezeBallId);
  return true;
}

export function canDirectShatterFrozenBrick(brick: BrickState): boolean {
  return isFrozenBrick(brick) && !brick.iceFreezeSafetyActive;
}

function overlapsBrick(ball: BallState, brick: BrickState): boolean {
  const closestX = Math.max(brick.x, Math.min(ball.x, brick.x + brick.width));
  const closestY = Math.max(brick.y, Math.min(ball.y, brick.y + brick.height));
  return (ball.x - closestX) ** 2 + (ball.y - closestY) ** 2 <= ball.radius ** 2;
}

export function isFreezeSafetyContact(brick: BrickState, ballId: number): boolean {
  return isFrozenBrick(brick)
    && brick.iceFreezeSafetyActive === true
    && brick.iceFreezeSafetyBallId === ballId;
}

export function isPendingFreezeSafetyContact(brick: BrickState, ballId: number): boolean {
  return isPendingFreezeBrick(brick)
    && brick.icePendingFreezeContactActive === true
    && brick.icePendingFreezeBallId === ballId;
}

export function advanceFrozenBrickSafety(state: GameState, worldDeltaSeconds: number): void {
  for (const column of state.brickField.columns) {
    for (const brick of column) {
      if (isPendingFreezeBrick(brick) && brick.icePendingFreezeContactActive) {
        const creatingBall = brick.icePendingFreezeBallId === undefined
          ? undefined
          : state.balls.find(({ id }) => id === brick.icePendingFreezeBallId);
        if (!creatingBall || !overlapsBrick(creatingBall, brick)) {
          brick.icePendingFreezeContactActive = false;
        }
      }
      if (!isFrozenBrick(brick) || !brick.iceFreezeSafetyActive) continue;
      brick.iceFreezeSafetyElapsedSeconds = (brick.iceFreezeSafetyElapsedSeconds ?? 0)
        + Math.max(0, worldDeltaSeconds);
      const freezingBall = brick.iceFreezeSafetyBallId === undefined
        ? undefined
        : state.balls.find(({ id }) => id === brick.iceFreezeSafetyBallId);
      const creatingContactCleared = brick.iceFreezeSafetyBallId !== undefined
        && (!freezingBall || !overlapsBrick(freezingBall, brick));
      const safetyExpired = brick.iceFreezeSafetyElapsedSeconds
        >= GAME_CONFIG.powers.iceDirectShatterSafetyMaximumSeconds;
      if (!creatingContactCleared && !safetyExpired) continue;
      brick.iceFreezeSafetyActive = false;
      brick.iceFreezeSafetyBallId = undefined;
    }
  }
}

export function tryDirectShatterFrozenBrick(state: GameState, brick: BrickState): boolean {
  if (!canDirectShatterFrozenBrick(brick)) return false;
  return shatterFrozenBrick(state, brick) > 0;
}

function isBrickActive(state: GameState, brick: BrickState): boolean {
  return state.brickField.columns[brick.column]?.includes(brick) ?? false;
}

function getShatterTargets(state: GameState, origin: BrickState): BrickState[] {
  const originCenterY = origin.y + origin.height / 2;
  const verticalPitch = GAME_CONFIG.bricks.brickHeight + GAME_CONFIG.bricks.verticalEdgeGap;
  const verticalTolerance = GAME_CONFIG.bricks.verticalEdgeGap / 2;
  const targets: BrickState[] = [];
  for (const column of state.brickField.columns) {
    for (const brick of column) {
      if (Math.abs(brick.column - origin.column) > 1) continue;
      const centerY = brick.y + brick.height / 2;
      if (Math.abs(centerY - originCenterY) <= verticalPitch + verticalTolerance) targets.push(brick);
    }
  }
  return targets.sort((left, right) => left.column - right.column
    || left.y - right.y
    || left.id.localeCompare(right.id));
}

export function shatterFrozenBrick(state: GameState, initialBrick: BrickState): number {
  if (!isFrozenBrick(initialBrick) || !isBrickActive(state, initialBrick)) return 0;
  const chainEnabled = getPowerLevel(state.powers, 'ICE_BALL') === GAME_CONFIG.powers.maxLevel;
  const queue: BrickState[] = [initialBrick];
  const queuedIds = new Set([initialBrick.id]);
  const shatteredIds = new Set<string>();
  let destructionCount = 0;

  while (queue.length > 0) {
    const origin = queue.shift()!;
    if (shatteredIds.has(origin.id) || !isBrickActive(state, origin) || !isFrozenBrick(origin)) continue;
    shatteredIds.add(origin.id);
    const targets = getShatterTargets(state, origin);
    if (chainEnabled) {
      const chained = targets
        .filter((target) => target !== origin && isFrozenBrick(target) && !queuedIds.has(target.id))
        .sort((left, right) => left.id.localeCompare(right.id));
      for (const target of chained) {
        queuedIds.add(target.id);
        queue.push(target);
      }
    }

    state.iceShatterEffects.push({
      x: origin.x + origin.width / 2,
      y: origin.y + origin.height / 2,
      remainingSeconds: GAME_CONFIG.powers.iceShatterEffectSeconds,
    });
    for (const target of targets) {
      if (target === origin) continue;
      if (chainEnabled && isFrozenBrick(target)) continue;
      if (applyBrickDamage(state, target, Number.POSITIVE_INFINITY, 'ICE')) destructionCount += 1;
    }
    if (applyBrickDamage(state, origin, Number.POSITIVE_INFINITY, 'ICE')) destructionCount += 1;
  }
  return destructionCount;
}

export function handleFrozenBrickContact(state: GameState, contact: FrozenBrickContact): void {
  awardBrickDestruction(state, contact.incomingBrick, 'ICE');
  const frozen = contact.frozenBrick;
  if (!isBrickActive(state, frozen) || !isFrozenBrick(frozen)) return;
  frozen.iceCollisionKills += 1;
  const level = getPowerLevel(state.powers, 'ICE_BALL');
  const capacity = GAME_CONFIG.powers.iceCollisionCapacityByLevel[Math.max(0, level - 1)] ?? 1;
  if (frozen.iceCollisionKills >= capacity) shatterFrozenBrick(state, frozen);
}
