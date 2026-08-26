import { GAME_CONFIG } from './config';

export type BrickKind = 'NORMAL';
export type BrickSpeedClass = 'SLOW' | 'MEDIUM' | 'FAST' | 'RUSH';

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
  kind: BrickKind;
  visualVariant: number;
}

export interface BrickFieldState {
  /** Each column remains ordered from top to bottom. */
  columns: BrickState[][];
  spawnTimerSeconds: number;
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

export function resolveBrickDescentSpeed(speedClass: BrickSpeedClass, level: number): number {
  const milestones = GAME_CONFIG.difficulty.brickSpeedMilestones;
  const requestedLevel = Math.max(level, milestones[0].level);
  const finalMilestone = milestones[milestones.length - 1];
  if (requestedLevel >= finalMilestone.level) return finalMilestone.speeds[speedClass];

  for (let index = 1; index < milestones.length; index += 1) {
    const upper = milestones[index];
    if (requestedLevel > upper.level) continue;
    const lower = milestones[index - 1];
    const progress = (requestedLevel - lower.level) / (upper.level - lower.level);
    return lower.speeds[speedClass]
      + (upper.speeds[speedClass] - lower.speeds[speedClass]) * progress;
  }
  return finalMilestone.speeds[speedClass];
}

export function getBrickDescentSpeedRange(level: number): { minimum: number; maximum: number } {
  const speeds = GAME_CONFIG.bricks.speedClassDistribution
    .map(({ speedClass }) => resolveBrickDescentSpeed(speedClass, level));
  return { minimum: Math.min(...speeds), maximum: Math.max(...speeds) };
}

function generateFormation(field: BrickFieldState, y: number, insertAtTop: boolean): void {
  const config = GAME_CONFIG.bricks;
  const rowId = field.nextRowId;
  field.nextRowId += 1;
  const targetCount = config.minimumBricksPerRow
    + Math.floor(nextRandom(field) * (config.maximumBricksPerRow - config.minimumBricksPerRow + 1));
  const rankedColumns = Array.from({ length: config.columns }, (_, column) => ({
    column,
    rank: nextRandom(field),
  })).sort((left, right) => left.rank - right.rank);
  const visualVariant = Math.floor(nextRandom(field) * 4);

  for (let rank = 0; rank < targetCount; rank += 1) {
    const column = rankedColumns[rank].column;
    const brick: BrickState = {
      id: `${rowId}:${column}`,
      rowId,
      column,
      x: config.originX + column * (config.brickWidth + config.horizontalGap),
      y,
      width: config.brickWidth,
      height: config.brickHeight,
      speedClass: generateSpeedClass(field),
      hp: 1,
      kind: 'NORMAL',
      visualVariant,
    };
    if (insertAtTop) field.columns[column].unshift(brick);
    else field.columns[column].push(brick);
  }
}

export function getBrickRowPitch(): number {
  return GAME_CONFIG.bricks.brickHeight + GAME_CONFIG.bricks.verticalGap;
}

export function getBrickSpawnY(): number {
  return GAME_CONFIG.bricks.fieldTopY - getBrickRowPitch();
}

export function createBrickField(): BrickFieldState {
  const seed = GAME_CONFIG.bricks.generationSeed >>> 0;
  const field: BrickFieldState = {
    columns: Array.from({ length: GAME_CONFIG.bricks.columns }, () => []),
    spawnTimerSeconds: 0,
    generatorState: seed,
    speedClassGeneratorState: (seed ^ 0x9e3779b9) >>> 0,
    nextRowId: 1,
  };
  for (let row = 0; row < GAME_CONFIG.bricks.initialRowCount; row += 1) {
    generateFormation(field, GAME_CONFIG.bricks.fieldTopY + row * getBrickRowPitch(), false);
  }
  generateFormation(field, getBrickSpawnY(), true);
  return field;
}

export function getBrickFailureBoundaryY(): number {
  return GAME_CONFIG.playfield.bottom;
}

export function advanceBrickField(
  field: BrickFieldState,
  deltaSeconds: number,
  difficultyLevel: number = GAME_CONFIG.difficulty.currentLevel,
): boolean {
  field.spawnTimerSeconds += deltaSeconds;
  const verticalGap = GAME_CONFIG.bricks.verticalGap;

  for (const column of field.columns) {
    for (let index = column.length - 1; index >= 0; index -= 1) {
      const brick = column[index];
      const descentSpeed = resolveBrickDescentSpeed(brick.speedClass, difficultyLevel);
      let nextY = brick.y + descentSpeed * deltaSeconds;
      const brickBelow = column[index + 1];
      if (brickBelow) nextY = Math.min(nextY, brickBelow.y - verticalGap - brick.height);
      brick.y = nextY;
    }
  }

  for (const column of field.columns) {
    for (const brick of column) {
      if (brick.y + brick.height >= getBrickFailureBoundaryY()) return true;
    }
  }

  while (field.spawnTimerSeconds >= GAME_CONFIG.bricks.spawnIntervalSeconds) {
    field.spawnTimerSeconds -= GAME_CONFIG.bricks.spawnIntervalSeconds;
    generateFormation(field, getBrickSpawnY(), true);
  }
  return false;
}

export function damageBrick(field: BrickFieldState, brick: BrickState, damage: number): void {
  const column = field.columns[brick.column];
  const index = column.indexOf(brick);
  if (index < 0) return;
  brick.hp -= damage;
  if (brick.hp <= 0) column.splice(index, 1);
}

export function getActiveBrickCount(field: BrickFieldState): number {
  let count = 0;
  for (const column of field.columns) count += column.length;
  return count;
}
