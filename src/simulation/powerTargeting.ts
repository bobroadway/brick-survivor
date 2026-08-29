import type { BrickState } from './brickField';
import type { BrickDestruction } from './combat';
import { GAME_CONFIG } from './config';

function getCenterX(bounds: { x: number; width: number }): number {
  return bounds.x + bounds.width / 2;
}

function getCenterY(bounds: { y: number; height: number }): number {
  return bounds.y + bounds.height / 2;
}

export interface ElectricTargetScore {
  brick: BrickState;
  tileDistance: number;
  effectiveScore: number;
}

export function rankElectricTargets(
  source: BrickDestruction,
  bricks: readonly BrickState[],
  excludedBrickIds?: ReadonlySet<string>,
): ElectricTargetScore[] {
  const horizontalPitch = GAME_CONFIG.bricks.brickWidth + GAME_CONFIG.bricks.horizontalGap;
  const verticalPitch = GAME_CONFIG.bricks.brickHeight + GAME_CONFIG.bricks.verticalEdgeGap;
  const sourceCenterX = getCenterX(source);
  const sourceCenterY = getCenterY(source);
  const candidates: ElectricTargetScore[] = [];
  for (const brick of bricks) {
    if (excludedBrickIds?.has(brick.id)) continue;
    const sourceMinCenterX = source.x + GAME_CONFIG.bricks.brickWidth / 2;
    const sourceMaxCenterX = source.x + source.width - GAME_CONFIG.bricks.brickWidth / 2;
    const targetMinCenterX = brick.x + GAME_CONFIG.bricks.brickWidth / 2;
    const targetMaxCenterX = brick.x + brick.width - GAME_CONFIG.bricks.brickWidth / 2;
    const sourceMinCenterY = source.y + GAME_CONFIG.bricks.brickHeight / 2;
    const sourceMaxCenterY = source.y + source.height - GAME_CONFIG.bricks.brickHeight / 2;
    const targetMinCenterY = brick.y + GAME_CONFIG.bricks.brickHeight / 2;
    const targetMaxCenterY = brick.y + brick.height - GAME_CONFIG.bricks.brickHeight / 2;
    const horizontalDistance = Math.max(0,
      sourceMinCenterX - targetMaxCenterX, targetMinCenterX - sourceMaxCenterX);
    const verticalDistance = Math.max(0,
      sourceMinCenterY - targetMaxCenterY, targetMinCenterY - sourceMaxCenterY);
    const columnDistance = horizontalDistance / horizontalPitch;
    const rowDistance = verticalDistance / verticalPitch;
    const tileDistance = columnDistance + rowDistance;
    if (tileDistance > GAME_CONFIG.powers.electricRadiusInBrickPitches) continue;
    const sameColumnUpward = getCenterY(brick) < sourceCenterY
      && rowDistance >= 1
      && columnDistance <= GAME_CONFIG.powers.electricSameColumnThresholdTiles;
    candidates.push({
      brick,
      tileDistance,
      effectiveScore: tileDistance + (sameColumnUpward
        ? GAME_CONFIG.powers.electricSameColumnUpwardPenaltyTiles
        : 0),
    });
  }
  const tolerance = GAME_CONFIG.powers.electricLowerTargetTieToleranceTiles;
  candidates.sort((left, right) => {
    if (left.brick.kind !== right.brick.kind) return left.brick.kind === 'BOSS' ? -1 : 1;
    const scoreDifference = left.effectiveScore - right.effectiveScore;
    if (Math.abs(scoreDifference) > tolerance) return scoreDifference;
    if (left.brick.y !== right.brick.y) return right.brick.y - left.brick.y;
    if (scoreDifference !== 0) return scoreDifference;
    return left.brick.id.localeCompare(right.brick.id);
  });
  return candidates;
}

export function rankWindTargets(
  source: BrickDestruction,
  bricks: readonly BrickState[],
): BrickState[] {
  const sourceRight = source.x + source.width;
  return bricks
    .filter((brick) => {
      const horizontallyOverlaps = brick.x < sourceRight && brick.x + brick.width > source.x;
      return horizontallyOverlaps && getCenterY(brick) < getCenterY(source);
    })
    .sort((left, right) => right.y - left.y || left.id.localeCompare(right.id));
}

export function selectWindTargets(
  level: number,
  source: BrickDestruction,
  bricks: readonly BrickState[],
): BrickState[] {
  const verticalPitch = GAME_CONFIG.bricks.brickHeight + GAME_CONFIG.bricks.verticalEdgeGap;
  const horizontalPitch = GAME_CONFIG.bricks.brickWidth + GAME_CONFIG.bricks.horizontalGap;
  const sourceCenterX = getCenterX(source);
  const sourceCenterY = getCenterY(source);
  if (level >= GAME_CONFIG.powers.maxLevel) {
    return bricks
      .filter((brick) => {
        const spacesAbove = (sourceCenterY - getCenterY(brick)) / verticalPitch;
        if (spacesAbove <= 0 || spacesAbove > 7) return false;
        const columnsAway = Math.abs(getCenterX(brick) - sourceCenterX) / horizontalPitch;
        return spacesAbove <= 3 ? columnsAway <= 0.5 : columnsAway <= 1.5;
      })
      .sort((left, right) => right.y - left.y || left.x - right.x || left.id.localeCompare(right.id));
  }
  const eligible = rankWindTargets(source, bricks);
  const rangeSpaces = GAME_CONFIG.powers.windRangeSpacesByLevel[level - 1] ?? 0;
  const range = rangeSpaces * verticalPitch;
  return eligible.filter((brick) => sourceCenterY - getCenterY(brick) <= range);
}

export function selectMissileTarget(
  missileX: number,
  bricks: readonly BrickState[],
  reservedBrickIds: ReadonlySet<string>,
): BrickState | undefined {
  let selected: BrickState | undefined;
  const verticalTolerance = GAME_CONFIG.powers.missileVerticalTieTolerance;
  for (const brick of bricks) {
    if (brick.kind === 'BOSS' || reservedBrickIds.has(brick.id)) continue;
    if (!selected) {
      selected = brick;
      continue;
    }
    const yDifference = getCenterY(brick) - getCenterY(selected);
    if (yDifference > verticalTolerance) {
      selected = brick;
      continue;
    }
    if (Math.abs(yDifference) > verticalTolerance) continue;
    const horizontalDistance = Math.abs(getCenterX(brick) - missileX);
    const selectedHorizontalDistance = Math.abs(getCenterX(selected) - missileX);
    if (horizontalDistance < selectedHorizontalDistance
      || (horizontalDistance === selectedHorizontalDistance && brick.id.localeCompare(selected.id) < 0)) {
      selected = brick;
    }
  }
  return selected;
}
