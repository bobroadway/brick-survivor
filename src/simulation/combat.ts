import { damageBrick, type BrickState } from './brickField';
import type { GameState } from './gameState';
import { awardRunXp } from './progression';

export type DamageSource = 'BALL' | 'GUN' | 'ELECTRIC' | 'FIRE' | 'WIND';

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
  const xpAwarded = damageBrick(state.brickField, brick, damage);
  if (xpAwarded <= 0) return null;
  const rewards = awardRunXp(state.progression, xpAwarded);
  state.powers.pendingSelections += rewards.length;
  return { source, x: brick.x, y: brick.y, width: brick.width, height: brick.height };
}
