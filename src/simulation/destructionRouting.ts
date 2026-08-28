import type { BrickState } from './brickField';
import { applyBrickDamage, type BrickDestruction, type DamageSource } from './combat';
import type { GameState } from './gameState';
import { isFrozenBrick, shatterFrozenBrick, tryDirectShatterFrozenBrick } from './iceBall';

export interface RoutedBrickDamageResult {
  destruction: BrickDestruction | null;
  frozenShattered: boolean;
}

/**
 * Authoritative gameplay-damage routing. Raw ICE damage intentionally stays in
 * iceBall.ts so Lv1-4 blasts remove caught frozen neighbors without chaining,
 * while Lv5 explicitly queues their full shatters.
 */
export function applyRoutedBrickDamage(
  state: GameState,
  brick: BrickState,
  damage: number,
  source: DamageSource,
): RoutedBrickDamageResult {
  if (!isFrozenBrick(brick) || source === 'ICE') {
    return { destruction: applyBrickDamage(state, brick, damage, source), frozenShattered: false };
  }

  if (source === 'BALL' || source === 'GUN' || source === 'MISSILE') {
    return {
      destruction: null,
      frozenShattered: tryDirectShatterFrozenBrick(state, brick),
    };
  }

  if (damage < brick.hp) {
    return { destruction: applyBrickDamage(state, brick, damage, source), frozenShattered: false };
  }

  return {
    destruction: null,
    frozenShattered: shatterFrozenBrick(state, brick) > 0,
  };
}
