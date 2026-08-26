import { GAME_CONFIG } from './config';
import {
  getBrickBottom,
  getBrickTop,
  getBrickRowPitch,
  getMinimumBrickVerticalEdgeGap,
  getMinimumUpperBrickY,
} from './brickGeometry';
import { resolveBrickDescentSpeed, type BrickSpeedClass } from './difficulty';

export type BrickKind = 'NORMAL';

export interface BrickState {
  id: string;
  rowId: number;
  column: number;
  x: number;
  y: number;
  width: number;
  height: number;
  speedClass: BrickSpeedClass;
  hp: number;
  xpValue: number;
  kind: BrickKind;
}

export interface BrickFieldState {
  /** Each column remains ordered from top to bottom. */
  columns: BrickState[][];
  generatorState: number;
  speedClassGeneratorState: number;
  nextRowId: number;
}

function nextRandom(field: BrickFieldState): number {
  field.generatorState = (Math.imul(field.generatorState, 1664525) + 1013904223) >>> 0;
  return field.generatorState / 0x100000000;
}

function nextSpeedRandom(field: BrickFieldState): number {
  field.speedClassGeneratorState = (Math.imul(field.speedClassGeneratorState, 1664525) + 1013904223) >>> 0;
  return field.speedClassGeneratorState / 0x100000000;
}

function generateSpeedClass(field: BrickFieldState): BrickSpeedClass {
  const distribution = GAME_CONFIG.bricks.speedClassDistribution;
  let totalWeight = 0;
  for (const entry of distribution) totalWeight += entry.weight;
  let selection = nextSpeedRandom(field) * totalWeight;
  for (const entry of distribution) {
    selection -= entry.weight;
    if (selection < 0) return entry.speedClass;
  }
  return distribution[distribution.length - 1].speedClass;
}

export function getBrickOccupancyRange(level: number): { minimum: number; maximum: number } {
  const config = GAME_CONFIG.bricks;
  const progress = Math.max(0, Math.min(
    1,
    (level - config.densityStartLevel) / (config.densityFullLevel - config.densityStartLevel),
  ));
  return {
    minimum: Math.round(config.densityStartMinOccupancy
      + (config.densityFullMinOccupancy - config.densityStartMinOccupancy) * progress),
    maximum: Math.round(config.densityStartMaxOccupancy
      + (config.densityFullMaxOccupancy - config.densityStartMaxOccupancy) * progress),
  };
}

function generateFormation(
  field: BrickFieldState,
  y: number,
  insertAtTop: boolean,
  level: number,
): void {
  const config = GAME_CONFIG.bricks;
  const rowId = field.nextRowId;
  field.nextRowId += 1;
  const occupancy = getBrickOccupancyRange(level);
  const targetCount = occupancy.minimum
    + Math.floor(nextRandom(field) * (occupancy.maximum - occupancy.minimum + 1));
  const rankedColumns = Array.from({ length: config.columns }, (_, column) => ({
    column,
    rank: nextRandom(field),
  })).sort((left, right) => left.rank - right.rank);

  for (let rank = 0; rank < targetCount; rank += 1) {
    const column = rankedColumns[rank].column;
    const brick: BrickState = {
      id: `${rowId}:${column}`,
      rowId,
      column,
      x: getBrickGridOriginX() + column * (config.brickWidth + config.horizontalGap),
      y,
      width: config.brickWidth,
      height: config.brickHeight,
      speedClass: generateSpeedClass(field),
      hp: 1,
      xpValue: GAME_CONFIG.progression.normalBrickXp,
      kind: 'NORMAL',
    };
    if (insertAtTop) field.columns[column].unshift(brick);
    else field.columns[column].push(brick);
  }
}

export function getMinimumSameColumnBrickGap(): number {
  return getMinimumBrickVerticalEdgeGap();
}

export { getBrickRowPitch } from './brickGeometry';

export function getBrickGridWidth(): number {
  const config = GAME_CONFIG.bricks;
  return config.columns * config.brickWidth + (config.columns - 1) * config.horizontalGap;
}

export function getBrickGridOriginX(): number {
  return (GAME_CONFIG.width - getBrickGridWidth()) / 2;
}

export function getBrickSpawnY(): number {
  return GAME_CONFIG.bricks.fieldTopY - getBrickRowPitch();
}

export function getFormationEntryClearance(field: BrickFieldState): number {
  let topmostBrickTop = Number.POSITIVE_INFINITY;
  for (const column of field.columns) {
    for (const brick of column) topmostBrickTop = Math.min(topmostBrickTop, getBrickTop(brick));
  }
  if (!Number.isFinite(topmostBrickTop)) return Number.POSITIVE_INFINITY;
  const spawnedBrick = { y: getBrickSpawnY(), height: GAME_CONFIG.bricks.brickHeight };
  return topmostBrickTop - getBrickBottom(spawnedBrick);
}

export function hasFormationEntryClearance(field: BrickFieldState): boolean {
  return getFormationEntryClearance(field) + 1e-9 >= getMinimumBrickVerticalEdgeGap();
}

export function createBrickField(): BrickFieldState {
  const seed = GAME_CONFIG.bricks.generationSeed >>> 0;
  const field: BrickFieldState = {
    columns: Array.from({ length: GAME_CONFIG.bricks.columns }, () => []),
    generatorState: seed,
    speedClassGeneratorState: (seed ^ 0x9e3779b9) >>> 0,
    nextRowId: 1,
  };
  for (let row = 0; row < GAME_CONFIG.bricks.initialRowCount; row += 1) {
    generateFormation(
      field,
      GAME_CONFIG.bricks.fieldTopY + row * getBrickRowPitch(),
      false,
      GAME_CONFIG.progression.startingLevel,
    );
  }
  generateFormation(field, getBrickSpawnY(), true, GAME_CONFIG.progression.startingLevel);
  return field;
}

export function getBrickFailureBoundaryY(): number {
  return GAME_CONFIG.playfield.bottom;
}

export function advanceBrickField(
  field: BrickFieldState,
  deltaSeconds: number,
  difficultyLevel: number = GAME_CONFIG.progression.startingLevel,
): boolean {
  for (const column of field.columns) {
    for (let index = column.length - 1; index >= 0; index -= 1) {
      const brick = column[index];
      const descentSpeed = resolveBrickDescentSpeed(brick.speedClass, difficultyLevel);
      let nextY = brick.y + descentSpeed * deltaSeconds;
      const brickBelow = column[index + 1];
      if (brickBelow) {
        const closestLegalY = getMinimumUpperBrickY(brickBelow, brick.height);
        // A newly spawned formation keeps its authoritative entry Y if the
        // spawn area is temporarily tight; blocking must never move it upward
        // or pack it against a lower brick at insertion time.
        nextY = closestLegalY < brick.y ? brick.y : Math.min(nextY, closestLegalY);
      }
      brick.y = nextY;
    }
  }

  for (const column of field.columns) {
    for (const brick of column) {
      if (brick.y + brick.height >= getBrickFailureBoundaryY()) return true;
    }
  }

  if (hasFormationEntryClearance(field)) {
    generateFormation(field, getBrickSpawnY(), true, difficultyLevel);
  }
  return false;
}

export function damageBrick(field: BrickFieldState, brick: BrickState, damage: number): number {
  const column = field.columns[brick.column];
  const index = column.indexOf(brick);
  if (index < 0) return 0;
  brick.hp -= damage;
  if (brick.hp > 0) return 0;
  column.splice(index, 1);
  return brick.xpValue;
}

export function getActiveBrickCount(field: BrickFieldState): number {
  let count = 0;
  for (const column of field.columns) count += column.length;
  return count;
}
