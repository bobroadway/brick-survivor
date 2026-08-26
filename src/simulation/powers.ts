import { GAME_CONFIG } from './config';
import type { GameState } from './gameState';

export type PowerId = 'GUN' | 'PIERCING_BALL' | 'SPLITTING_BALL' | 'PADDLE_SIZE' | 'ELECTRIC_BALL' | 'FIRE_BALL';

export interface PowerDefinition {
  id: PowerId;
  name: string;
  describe(level: number): string;
}

export interface RunPowerState {
  levels: Partial<Record<PowerId, number>>;
  ownedOrder: PowerId[];
  rerollsRemaining: number;
  pendingSelections: number;
  currentChoices: PowerId[];
  offerGeneratorState: number;
  splitTimerSeconds: number;
  gunShotCooldownSeconds: number;
  gunReloadSeconds: number;
  gunShotsRemaining: number;
}

export const POWER_DEFINITIONS: readonly PowerDefinition[] = [
  { id: 'GUN', name: 'GUN', describe: (level) => `Automatically fires ${level}-shot bursts.` },
  { id: 'PIERCING_BALL', name: 'PIERCING BALL', describe: (level) => `Each ball recharges ${level} pierce HP at the paddle.` },
  { id: 'SPLITTING_BALL', name: 'SPLITTING BALL', describe: (level) => `Oldest ball creates ${level} additional ball${level === 1 ? '' : 's'} every 30s.` },
  { id: 'PADDLE_SIZE', name: 'PADDLE SIZE', describe: (level) => `Paddle width becomes ${100 + level * 20}% of base width.` },
  { id: 'ELECTRIC_BALL', name: 'ELECTRIC BALL', describe: (level) => level === 5 ? 'Ball kills zap up to 3 nearby bricks.' : `Ball kills zap the nearest brick within radius ${level}.` },
  { id: 'FIRE_BALL', name: 'FIRE BALL', describe: (level) => level === 5 ? 'Ball kills scorch the entire horizontal line.' : `Ball kills scorch ${level} column${level === 1 ? '' : 's'} left and right.` },
] as const;

export function createRunPowerState(): RunPowerState {
  return {
    levels: {}, ownedOrder: [], rerollsRemaining: GAME_CONFIG.powers.startingRerolls,
    pendingSelections: 0, currentChoices: [], offerGeneratorState: GAME_CONFIG.powers.offerSeed >>> 0,
    splitTimerSeconds: 0, gunShotCooldownSeconds: 0, gunReloadSeconds: 0, gunShotsRemaining: 0,
  };
}

export function getPowerDefinition(id: PowerId): PowerDefinition {
  const definition = POWER_DEFINITIONS.find((candidate) => candidate.id === id);
  if (!definition) throw new Error(`Unknown power: ${id}`);
  return definition;
}

export function getPowerLevel(powers: RunPowerState, id: PowerId): number {
  return powers.levels[id] ?? 0;
}

export function getEligiblePowerIds(powers: RunPowerState): PowerId[] {
  const atOwnershipCap = powers.ownedOrder.length >= GAME_CONFIG.powers.maxOwned;
  return POWER_DEFINITIONS
    .map(({ id }) => id)
    .filter((id) => {
      const level = getPowerLevel(powers, id);
      return level < GAME_CONFIG.powers.maxLevel && (level > 0 || !atOwnershipCap);
    });
}

function nextOfferRandom(powers: RunPowerState): number {
  powers.offerGeneratorState = (Math.imul(powers.offerGeneratorState, 1664525) + 1013904223) >>> 0;
  return powers.offerGeneratorState / 0x100000000;
}

function generateOffer(powers: RunPowerState): PowerId[] {
  return getEligiblePowerIds(powers)
    .map((id) => ({ id, rank: nextOfferRandom(powers) }))
    .sort((left, right) => left.rank - right.rank)
    .slice(0, GAME_CONFIG.powers.offerCount)
    .map(({ id }) => id);
}

export function prepareNextPowerSelection(powers: RunPowerState): boolean {
  while (powers.pendingSelections > 0) {
    const choices = generateOffer(powers);
    if (choices.length > 0) {
      powers.currentChoices = choices;
      return true;
    }
    powers.pendingSelections -= 1;
  }
  powers.currentChoices = [];
  return false;
}

export function rerollPowerChoices(powers: RunPowerState): boolean {
  if (powers.rerollsRemaining <= 0 || powers.currentChoices.length === 0) return false;
  const previous = [...powers.currentChoices].sort().join('|');
  let next = generateOffer(powers);
  for (let attempt = 0; attempt < 12 && [...next].sort().join('|') === previous && getEligiblePowerIds(powers).length > next.length; attempt += 1) {
    next = generateOffer(powers);
  }
  powers.rerollsRemaining -= 1;
  powers.currentChoices = next;
  return true;
}

export function acquirePower(state: GameState, id: PowerId): boolean {
  if (!state.powers.currentChoices.includes(id)) return false;
  const oldLevel = getPowerLevel(state.powers, id);
  if (oldLevel >= GAME_CONFIG.powers.maxLevel) return false;
  const newLevel = oldLevel + 1;
  state.powers.levels[id] = newLevel;
  if (oldLevel === 0) state.powers.ownedOrder.push(id);

  if (id === 'PIERCING_BALL') {
    const increase = newLevel - oldLevel;
    for (const ball of state.balls) ball.pierceCharge = Math.min(newLevel, ball.pierceCharge + increase);
  } else if (id === 'PADDLE_SIZE') {
    state.paddle.width = GAME_CONFIG.paddle.width * (1 + newLevel * 0.2);
    const minimumX = GAME_CONFIG.playfield.left + state.paddle.width / 2;
    const maximumX = GAME_CONFIG.playfield.right - state.paddle.width / 2;
    state.paddle.x = Math.max(minimumX, Math.min(maximumX, state.paddle.x));
  } else if (id === 'GUN' && oldLevel === 0) {
    state.powers.gunShotsRemaining = newLevel;
    state.powers.gunShotCooldownSeconds = 0;
  }

  state.powers.pendingSelections -= 1;
  state.powers.currentChoices = [];
  return true;
}
