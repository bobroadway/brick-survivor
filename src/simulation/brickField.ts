import { GAME_CONFIG } from './config';

export type BrickKind = 'NORMAL';

export interface BrickState {
  id: string;
  rowId: number;
  column: number;
  x: number;
  y: number;
  width: number;
  height: number;
  hp: number;
  kind: BrickKind;
}

export interface BrickRowState {
  id: number;
  gridRow: number;
  visualVariant: number;
  cells: Array<BrickState | null>;
}

export interface BrickFieldState {
  rows: BrickRowState[];
  scrollOffsetY: number;
  generatorState: number;
  nextRowId: number;
}

function nextRandom(field: BrickFieldState): number {
  field.generatorState = (Math.imul(field.generatorState, 1664525) + 1013904223) >>> 0;
  return field.generatorState / 0x100000000;
}

function createRow(field: BrickFieldState, gridRow: number): BrickRowState {
  const config = GAME_CONFIG.bricks;
  const rowId = field.nextRowId;
  field.nextRowId += 1;
  const targetCount = config.minimumBricksPerRow
    + Math.floor(nextRandom(field) * (config.maximumBricksPerRow - config.minimumBricksPerRow + 1));
  const rankedColumns = Array.from({ length: config.columns }, (_, column) => ({
    column,
    rank: nextRandom(field),
  })).sort((left, right) => left.rank - right.rank);
  const occupied = new Set(rankedColumns.slice(0, targetCount).map(({ column }) => column));
  const rowY = config.fieldTopY + gridRow * getBrickRowPitch() + field.scrollOffsetY;
  const cells: Array<BrickState | null> = [];

  for (let column = 0; column < config.columns; column += 1) {
    cells.push(occupied.has(column) ? {
      id: `${rowId}:${column}`,
      rowId,
      column,
      x: config.originX + column * (config.brickWidth + config.horizontalGap),
      y: rowY,
      width: config.brickWidth,
      height: config.brickHeight,
      hp: 1,
      kind: 'NORMAL',
    } : null);
  }
  const visualVariant = Math.floor(nextRandom(field) * 4);
  return { id: rowId, gridRow, visualVariant, cells };
}

export function getBrickRowPitch(): number {
  return GAME_CONFIG.bricks.brickHeight + GAME_CONFIG.bricks.verticalGap;
}

export function createBrickField(): BrickFieldState {
  const field: BrickFieldState = {
    rows: [],
    scrollOffsetY: 0,
    generatorState: GAME_CONFIG.bricks.generationSeed >>> 0,
    nextRowId: 1,
  };
  for (let gridRow = 0; gridRow < GAME_CONFIG.bricks.initialRowCount; gridRow += 1) {
    field.rows.push(createRow(field, gridRow));
  }
  field.rows.push(createRow(field, -1));
  return field;
}

export function getBrickFailureBoundaryY(): number {
  return GAME_CONFIG.playfield.bottom;
}

export function advanceBrickField(field: BrickFieldState, deltaSeconds: number): boolean {
  const distance = GAME_CONFIG.bricks.descentSpeed * deltaSeconds;
  field.scrollOffsetY += distance;
  for (const row of field.rows) {
    for (const brick of row.cells) {
      if (brick) brick.y += distance;
    }
  }
  for (const row of field.rows) {
    for (const brick of row.cells) {
      if (brick && brick.y + brick.height >= getBrickFailureBoundaryY()) return true;
    }
  }

  const rowPitch = getBrickRowPitch();
  while (field.scrollOffsetY >= rowPitch) {
    field.scrollOffsetY -= rowPitch;
    for (const row of field.rows) row.gridRow += 1;
    field.rows.push(createRow(field, -1));
  }

  for (let rowIndex = field.rows.length - 1; rowIndex >= 0; rowIndex -= 1) {
    if (!field.rows[rowIndex].cells.some((brick) => brick !== null)) field.rows.splice(rowIndex, 1);
  }
  return false;
}

export function damageBrick(field: BrickFieldState, brick: BrickState, damage: number): void {
  const row = field.rows.find(({ id }) => id === brick.rowId);
  if (!row || row.cells[brick.column] !== brick) return;
  brick.hp -= damage;
  if (brick.hp <= 0) row.cells[brick.column] = null;
}

export function getActiveBrickCount(field: BrickFieldState): number {
  let count = 0;
  for (const row of field.rows) {
    for (const brick of row.cells) if (brick) count += 1;
  }
  return count;
}
