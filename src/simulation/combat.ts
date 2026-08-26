import { damageBrick, type BrickState } from './brickField';
import type { GameState } from './gameState';
import { awardRunXp } from './progression';

export type DamageSource = 'BALL' | 'GUN' | 'ELECTRIC' | 'FIRE';

export interface BrickDestruction {
  source: DamageSource;
  x: number;
  y: number;
  width: number;
  height: number;
}

export type BallBrickCollisionOutcome = 'BOUNCED' | 'PIERCED_THROUGH';

export interface BallBrickCollisionResult {
  destruction: BrickDestruction | null;
  outcome: BallBrickCollisionOutcome;
  /** Explicit one-per-reload Pierce synergy; does not change the collision outcome. */
  pierceProcGranted: boolean;
}

/**
 * Qualifies destruction for powers in the normal-hit proc category. A real
 * destructive bounce always qualifies. Piercing may explicitly grant one
 * pass-through destruction per armed charge cycle without redefining it as a
 * normal destructive ball hit.
 */
export function getNormalHitProcDestruction(
  collision: BallBrickCollisionResult,
): BrickDestruction | null {
  const normalHit = getNormalDestructiveBallHit(collision);
  if (normalHit) return normalHit;
  const destruction = collision.destruction;
  return destruction?.source === 'BALL'
    && collision.outcome === 'PIERCED_THROUGH'
    && collision.pierceProcGranted
    ? destruction
    : null;
}

/**
 * Qualifies the semantic event used by powers that proc when a ball destroys a
 * brick with a normal, bouncing hit. A generic BALL-source destruction is not
 * sufficient: successful pass-through destruction intentionally does not qualify.
 * Future all-destruction or projectile-destruction powers should use their own
 * explicit event/source rule instead of this one.
 */
export function getNormalDestructiveBallHit(
  collision: BallBrickCollisionResult,
): BrickDestruction | null {
  const destruction = collision.destruction;
  return destruction?.source === 'BALL' && collision.outcome === 'BOUNCED' ? destruction : null;
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
