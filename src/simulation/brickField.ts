import { GAME_CONFIG } from './config';
import {
  getBrickBottom,
  getBrickTop,
  getBrickRowPitch,
  getMinimumBrickVerticalEdgeGap,
  getMinimumUpperBrickY,
} from './brickGeometry';
import { resolveBrickDescentSpeed, type BrickSpeedClass } from './difficulty';

export type BrickKind = 'NORMAL' | 'BOSS';

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
  armored?: boolean;
  displayHp?: number;
  displayHpStepTimerSeconds?: number;
  bossHitJoltRemainingSeconds?: number;
  bossArrivalPhase?: 'RUSH' | 'DECELERATING' | 'CRUISE';
  bossDecelerationElapsedSeconds?: number;
  /** Ice ownership state; pending bricks keep descending until entry geometry permits stopping. */
  iceState?: 'PENDING_FREEZE' | 'FROZEN';
  /** Ball responsible for a pending freeze, retained for same-contact safety on commit. */
  icePendingFreezeBallId?: number;
  /** True only while the creating Ball's original traversal still overlaps this brick. */
  icePendingFreezeContactActive?: boolean;
  /** Present only while frozen; its value is the number of incoming bricks destroyed. */
  iceCollisionKills?: number;
  /** The Ball whose creation contact must clear before direct hits may shatter this brick. */
  iceFreezeSafetyBallId?: number;
  /** Active world time elapsed since this brick was frozen. */
  iceFreezeSafetyElapsedSeconds?: number;
  /** Suppresses direct shatter only until the creating Ball clears or the safety ceiling expires. */
  iceFreezeSafetyActive?: boolean;
}

export interface BrickFieldState {
  /** Each column remains ordered from top to bottom. */
  columns: BrickState[][];
  generatorState: number;
  speedClassGeneratorState: number;
  armorGeneratorState: number;
  nextRowId: number;
}

export interface FrozenBrickContact {
  frozenBrick: BrickState;
  incomingBrick: BrickState;
}

export interface BrickFieldCallbacks {
  onFrozenBrickContact?: (contact: FrozenBrickContact) => void;
  onPendingFreezeReady?: (brick: BrickState) => void;
  queuedBossStartColumn?: number;
  onBossSpawned?: (boss: BrickState) => void;
  bossPreGapGenerated?: boolean;
  bossPreGapRowId?: number;
  onBossPreGapGenerated?: (rowId: number) => void;
}

function nextRandom(field: BrickFieldState): number {
  field.generatorState = (Math.imul(field.generatorState, 1664525) + 1013904223) >>> 0;
  return field.generatorState / 0x100000000;
}

function nextSpeedRandom(field: BrickFieldState): number {
  field.speedClassGeneratorState = (Math.imul(field.speedClassGeneratorState, 1664525) + 1013904223) >>> 0;
  return field.speedClassGeneratorState / 0x100000000;
}

function nextArmorRandom(field: BrickFieldState): number {
  field.armorGeneratorState = (Math.imul(field.armorGeneratorState, 1664525) + 1013904223) >>> 0;
  return field.armorGeneratorState / 0x100000000;
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
  excludedColumns: ReadonlySet<number> = new Set(),
): void {
  const config = GAME_CONFIG.bricks;
  const rowId = field.nextRowId;
  field.nextRowId += 1;
  const occupancy = getBrickOccupancyRange(level);
  const normalTargetCount = occupancy.minimum
    + Math.floor(nextRandom(field) * (occupancy.maximum - occupancy.minimum + 1));
  const availableColumnCount = config.columns - excludedColumns.size;
  const targetCount = getReservedFormationTargetCount(normalTargetCount, availableColumnCount);
  const rankedColumns = Array.from({ length: config.columns }, (_, column) => ({
    column,
    rank: nextRandom(field),
  })).filter(({ column }) => !excludedColumns.has(column))
    .sort((left, right) => left.rank - right.rank);

  for (let rank = 0; rank < targetCount; rank += 1) {
    const column = rankedColumns[rank].column;
    const speedClass = generateSpeedClass(field);
    const armored = (speedClass === 'SLOW' || speedClass === 'MEDIUM')
      && nextArmorRandom(field) < config.armoredEligibleChance;
    const brick: BrickState = {
      id: `${rowId}:${column}`,
      rowId,
      column,
      x: getBrickGridOriginX() + column * (config.brickWidth + config.horizontalGap),
      y,
      width: config.brickWidth,
      height: config.brickHeight,
      speedClass,
      hp: armored ? config.armoredHp : 1,
      xpValue: armored ? config.armoredXp : GAME_CONFIG.progression.normalBrickXp,
      kind: 'NORMAL',
      armored,
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

export function getReservedFormationTargetCount(
  normalTargetCount: number,
  availableColumnCount: number,
): number {
  return Math.min(availableColumnCount, Math.ceil(
    normalTargetCount / GAME_CONFIG.bricks.columns * availableColumnCount,
  ));
}

/** Earliest top-edge Y where a stationary brick leaves one legal spawn row above it. */
export function getEarliestStationaryBrickY(): number {
  const formationSpawnBounds = {
    y: getBrickSpawnY(),
    height: GAME_CONFIG.bricks.brickHeight,
  };
  return getBrickBottom(formationSpawnBounds) + getMinimumBrickVerticalEdgeGap();
}

export function hasClearedFormationEntryCorridor(brick: Pick<BrickState, 'y' | 'height'>): boolean {
  return getBrickTop(brick) + 1e-9 >= getEarliestStationaryBrickY();
}

export function getFormationEntryClearance(
  field: BrickFieldState,
  allowedColumns?: ReadonlySet<number>,
): number {
  let topmostBrickTop = Number.POSITIVE_INFINITY;
  for (let columnIndex = 0; columnIndex < field.columns.length; columnIndex += 1) {
    if (allowedColumns && !allowedColumns.has(columnIndex)) continue;
    const column = field.columns[columnIndex];
    for (const brick of column) topmostBrickTop = Math.min(topmostBrickTop, getBrickTop(brick));
  }
  if (!Number.isFinite(topmostBrickTop)) return Number.POSITIVE_INFINITY;
  const spawnedBrick = { y: getBrickSpawnY(), height: GAME_CONFIG.bricks.brickHeight };
  return topmostBrickTop - getBrickBottom(spawnedBrick);
}

export function hasFormationEntryClearance(
  field: BrickFieldState,
  allowedColumns?: ReadonlySet<number>,
): boolean {
  return getFormationEntryClearance(field, allowedColumns) + 1e-9 >= getMinimumBrickVerticalEdgeGap();
}

export function getActiveBoss(field: BrickFieldState): BrickState | undefined {
  return field.columns.flat().find(({ kind }) => kind === 'BOSS');
}

function getBossColumns(startColumn: number): number[] {
  return Array.from({ length: GAME_CONFIG.boss.widthColumns }, (_, offset) => startColumn + offset);
}

function getReservedBossColumns(field: BrickFieldState, queuedStartColumn?: number): Set<number> {
  const boss = getActiveBoss(field);
  if (boss && boss.y < GAME_CONFIG.bricks.fieldTopY
    + GAME_CONFIG.boss.roofClearanceRows * getBrickRowPitch()) {
    return new Set(getBossColumns(boss.column));
  }
  return queuedStartColumn === undefined ? new Set() : new Set(getBossColumns(queuedStartColumn));
}

function canSpawnBoss(field: BrickFieldState, startColumn: number, spawnBottom: number): boolean {
  for (const columnIndex of getBossColumns(startColumn)) {
    for (const brick of field.columns[columnIndex]) {
      if (getBrickTop(brick) - spawnBottom + 1e-9 < getMinimumBrickVerticalEdgeGap()) return false;
    }
  }
  return true;
}

function spawnBoss(field: BrickFieldState, startColumn: number, y: number): BrickState {
  const config = GAME_CONFIG.bricks;
  const boss: BrickState = {
    id: `boss:${field.nextRowId}`,
    rowId: field.nextRowId++,
    column: startColumn,
    x: getBrickGridOriginX() + startColumn * (config.brickWidth + config.horizontalGap),
    y,
    width: config.brickWidth * GAME_CONFIG.boss.widthColumns
      + config.horizontalGap * (GAME_CONFIG.boss.widthColumns - 1),
    height: config.brickHeight * GAME_CONFIG.boss.heightRows
      + config.verticalEdgeGap * (GAME_CONFIG.boss.heightRows - 1),
    speedClass: 'SLOW', hp: GAME_CONFIG.boss.hp, displayHp: GAME_CONFIG.boss.hp,
    displayHpStepTimerSeconds: 0, bossHitJoltRemainingSeconds: 0,
    bossArrivalPhase: 'RUSH', bossDecelerationElapsedSeconds: 0,
    xpValue: GAME_CONFIG.boss.xp, kind: 'BOSS',
  };
  field.columns[startColumn].unshift(boss);
  return boss;
}

export function getMaximumConfiguredRushSpeed(): number {
  return resolveBrickDescentSpeed('RUSH', GAME_CONFIG.survival.rampEndDifficultyLevel);
}

export function getBossDescentSpeed(brick: BrickState, speedLevel: number): number {
  const cruiseSpeed = resolveBrickDescentSpeed('SLOW', speedLevel) * GAME_CONFIG.boss.slowSpeedMultiplier;
  if (brick.kind !== 'BOSS') return resolveBrickDescentSpeed(brick.speedClass, speedLevel);
  if (brick.bossArrivalPhase === 'RUSH') return getMaximumConfiguredRushSpeed();
  if (brick.bossArrivalPhase === 'DECELERATING') {
    const progress = Math.max(0, Math.min(1,
      (brick.bossDecelerationElapsedSeconds ?? 0) / GAME_CONFIG.boss.entranceDecelerationSeconds));
    const eased = progress * progress * (3 - 2 * progress);
    return getMaximumConfiguredRushSpeed() + (cruiseSpeed - getMaximumConfiguredRushSpeed()) * eased;
  }
  return cruiseSpeed;
}

export function createBrickField(): BrickFieldState {
  const seed = GAME_CONFIG.bricks.generationSeed >>> 0;
  const field: BrickFieldState = {
    columns: Array.from({ length: GAME_CONFIG.bricks.columns }, () => []),
    generatorState: seed,
    speedClassGeneratorState: (seed ^ 0x9e3779b9) >>> 0,
    armorGeneratorState: (seed ^ 0xa511e9b3) >>> 0,
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
  densityLevel: number = GAME_CONFIG.progression.startingLevel,
  speedLevel: number = densityLevel,
  callbacks: BrickFieldCallbacks | ((contact: FrozenBrickContact) => void) = {},
): boolean {
  const resolvedCallbacks: BrickFieldCallbacks = typeof callbacks === 'function'
    ? { onFrozenBrickContact: callbacks }
    : callbacks;
  const frozenContacts: FrozenBrickContact[] = [];
  const activeBoss = getActiveBoss(field);
  const allBricks = field.columns.flat();
  for (const column of field.columns) {
    for (let index = column.length - 1; index >= 0; index -= 1) {
      const brick = column[index];
      if (brick.iceCollisionKills !== undefined) continue;
      const descentSpeed = getBossDescentSpeed(brick, speedLevel);
      let nextY = brick.y + descentSpeed * deltaSeconds;
      const brickBelow = allBricks
        .filter((candidate) => candidate !== brick
          && field.columns[candidate.column].includes(candidate)
          && candidate.y >= brick.y
          && candidate.x < brick.x + brick.width
          && candidate.x + candidate.width > brick.x)
        .sort((left, right) => left.y - right.y || left.id.localeCompare(right.id))[0];
      if (brickBelow) {
        const closestLegalY = getMinimumUpperBrickY(brickBelow, brick.height);
        if (brickBelow.iceCollisionKills !== undefined && nextY + 1e-9 >= closestLegalY) {
          column.splice(index, 1);
          frozenContacts.push({ frozenBrick: brickBelow, incomingBrick: brick });
          continue;
        }
        // A newly spawned formation keeps its authoritative entry Y if the
        // spawn area is temporarily tight; blocking must never move it upward
        // or pack it against a lower brick at insertion time.
        nextY = closestLegalY < brick.y ? brick.y : Math.min(nextY, closestLegalY);
      }
      if (brick.iceState === 'PENDING_FREEZE') {
        nextY = Math.min(nextY, getEarliestStationaryBrickY());
      }
      brick.y = nextY;
      if (brick.kind === 'BOSS') {
        if (brick.bossArrivalPhase === 'RUSH' && brick.y >= GAME_CONFIG.bricks.fieldTopY) {
          brick.y = GAME_CONFIG.bricks.fieldTopY;
          brick.bossArrivalPhase = 'DECELERATING';
          brick.bossDecelerationElapsedSeconds = 0;
        } else if (brick.bossArrivalPhase === 'DECELERATING') {
          brick.bossDecelerationElapsedSeconds = Math.min(
            GAME_CONFIG.boss.entranceDecelerationSeconds,
            (brick.bossDecelerationElapsedSeconds ?? 0) + deltaSeconds,
          );
          if (brick.bossDecelerationElapsedSeconds >= GAME_CONFIG.boss.entranceDecelerationSeconds) {
            brick.bossArrivalPhase = 'CRUISE';
          }
        }
      }
      if (brick.iceState === 'PENDING_FREEZE' && hasClearedFormationEntryCorridor(brick)) {
        resolvedCallbacks.onPendingFreezeReady?.(brick);
      }
    }
  }

  for (const contact of frozenContacts) resolvedCallbacks.onFrozenBrickContact?.(contact);

  const preGapBricks = resolvedCallbacks.bossPreGapRowId === undefined
    ? []
    : field.columns.flat().filter(({ rowId }) => rowId === resolvedCallbacks.bossPreGapRowId);
  const preGapHasEntered = preGapBricks.some((brick) => getBrickBottom(brick) >= GAME_CONFIG.bricks.fieldTopY);
  const bossSpawnBottom = preGapBricks.length > 0
    ? Math.min(...preGapBricks.map(({ y }) => y)) - getMinimumBrickVerticalEdgeGap()
    : GAME_CONFIG.bricks.fieldTopY;
  if (!activeBoss && resolvedCallbacks.queuedBossStartColumn !== undefined
    && resolvedCallbacks.bossPreGapGenerated && preGapHasEntered
    && canSpawnBoss(field, resolvedCallbacks.queuedBossStartColumn, bossSpawnBottom)) {
    const bossHeight = GAME_CONFIG.bricks.brickHeight * GAME_CONFIG.boss.heightRows
      + GAME_CONFIG.bricks.verticalEdgeGap * (GAME_CONFIG.boss.heightRows - 1);
    resolvedCallbacks.onBossSpawned?.(spawnBoss(
      field,
      resolvedCallbacks.queuedBossStartColumn,
      bossSpawnBottom - bossHeight,
    ));
  }

  for (const column of field.columns) {
    for (const brick of column) {
      if (brick.y + brick.height >= getBrickFailureBoundaryY()) return true;
    }
  }

  const reservedColumns = getReservedBossColumns(field, resolvedCallbacks.queuedBossStartColumn);
  const allowedColumns = new Set(Array.from({ length: GAME_CONFIG.bricks.columns }, (_, index) => index)
    .filter((index) => !reservedColumns.has(index)));
  if (!activeBoss && resolvedCallbacks.queuedBossStartColumn !== undefined
    && !resolvedCallbacks.bossPreGapGenerated) {
    if (hasFormationEntryClearance(field)) {
      const rowId = field.nextRowId;
      generateFormation(field, getBrickSpawnY(), true, densityLevel, reservedColumns);
      resolvedCallbacks.onBossPreGapGenerated?.(rowId);
    }
    return false;
  }
  if (allowedColumns.size > 0 && hasFormationEntryClearance(field, allowedColumns)) {
    generateFormation(field, getBrickSpawnY(), true, densityLevel, reservedColumns);
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
