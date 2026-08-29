import { damageBrick, type BrickState } from './brickField';
import type { GameState } from './gameState';
import { awardRunXp } from './progression';
import { isBossBrick, recordBossDamage, recordBossRemoved, recordOrdinaryBrickDestruction } from './boss';

export type DamageSource = 'BALL' | 'GUN' | 'ELECTRIC' | 'FIRE' | 'WIND' | 'MISSILE' | 'ICE';

export interface BrickDestruction {
  source: DamageSource;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Powers described as triggering "when a ball destroys a brick" use this category. */
export function isBallKill(destruction: BrickDestruction | null): destruction is BrickDestruction {
  return destruction?.source === 'BALL';
}

export function applyBrickDamage(
  state: GameState,
  brick: BrickState,
  damage: number,
  source: DamageSource,
): BrickDestruction | null {
  recordBossDamage(brick);
  const xpAwarded = damageBrick(state.brickField, brick, damage);
  if (xpAwarded <= 0) return null;
  return awardBrickDestruction(state, brick, source);
}

/** Records an already-removed brick exactly once at the caller's authoritative removal point. */
export function awardBrickDestruction(
  state: GameState,
  brick: BrickState,
  source: DamageSource,
): BrickDestruction {
  const xpAwarded = brick.xpValue;
  const rewards = awardRunXp(state.progression, xpAwarded);
  state.powers.pendingSelections += rewards.length;
  if (isBossBrick(brick)) recordBossRemoved(state, brick);
  else recordOrdinaryBrickDestruction(state);
  return { source, x: brick.x, y: brick.y, width: brick.width, height: brick.height };
}
