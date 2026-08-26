import { GAME_CONFIG } from './config';
import { spawnBallsFromParent } from './ballSpawning';
import type { GameState } from './gameState';

export type PowerId = 'GUN' | 'PIERCING_BALL' | 'SPLITTING_BALL' | 'PADDLE_SIZE'
  | 'ELECTRIC_BALL' | 'FIRE_BALL' | 'WIND_BALL';

export interface PowerDefinition {
  id: PowerId;
  name: string;
  enabledInOfferPool: boolean;
  describeCurrent(level: number): string;
  describeSelection?(level: number): string;
}

export interface RunPowerState {
  levels: Partial<Record<PowerId, number>>;
  ownedOrder: PowerId[];
  maxedPowerOrder: PowerId[];
  rerollsRemaining: number;
  pendingSelections: number;
  currentChoices: PowerId[];
  offerGeneratorState: number;
  splitTimerSeconds: number;
  gunShotCooldownSeconds: number;
  gunReloadSeconds: number;
  gunVolleysRemaining: number;
}

export const POWER_DEFINITIONS: readonly PowerDefinition[] = [
  {
    id: 'GUN', name: 'GUN', enabledInOfferPool: true,
    describeCurrent: (level) => level === 1
      ? 'Dual guns automatically fire upward from the paddle.'
      : `Fires ${level} volleys before reloading.`,
  },
  {
    id: 'PIERCING_BALL', name: 'PIERCING BALL', enabledInOfferPool: true,
    describeCurrent: (level) => `Balls can pierce through ${level} brick${level === 1 ? '' : 's'} before needing to bounce and recharge.`,
  },
  {
    id: 'SPLITTING_BALL', name: 'SPLITTING BALL', enabledInOfferPool: true,
    describeCurrent: (level) => `Creates ${level} additional ball${level === 1 ? '' : 's'} every ${GAME_CONFIG.powers.splittingIntervalSeconds} seconds.`,
    describeSelection: (level) => level === 1
      ? `Immediately creates 1 additional ball, then creates another every ${GAME_CONFIG.powers.splittingIntervalSeconds} seconds.`
      : `Creates ${level} additional balls every ${GAME_CONFIG.powers.splittingIntervalSeconds} seconds.`,
  },
  {
    id: 'PADDLE_SIZE', name: 'PADDLE SIZE', enabledInOfferPool: false,
    describeCurrent: (level) => level === 5 ? 'Doubles paddle width.' : `Increases paddle width by ${level * 20}%.`,
  },
  {
    id: 'ELECTRIC_BALL', name: 'ELECTRIC BALL', enabledInOfferPool: true,
    describeCurrent: (level) => level === 1
      ? 'Destroyed bricks zap the nearest brick within range.'
      : `Destroyed bricks zap up to ${level} nearby bricks.`,
  },
  {
    id: 'FIRE_BALL', name: 'FIRE BALL', enabledInOfferPool: true,
    describeCurrent: (level) => [
      '',
      'Destroyed bricks blast nearby bricks to the left and right.',
      'Horizontal blast range increases.',
      'Horizontal blast range increases further.',
      'Horizontal blast range becomes very large.',
      'Destroyed bricks blast the entire horizontal line.',
    ][level],
  },
  {
    id: 'WIND_BALL', name: 'WIND BALL', enabledInOfferPool: true,
    describeCurrent: (level) => level === 5
      ? 'Destroyed bricks blast every brick above.'
      : `Destroyed bricks blast ${level + 1} brick spaces above.`,
  },
] as const;

export function createRunPowerState(): RunPowerState {
  return {
    levels: {}, ownedOrder: [], maxedPowerOrder: [], rerollsRemaining: GAME_CONFIG.powers.startingRerolls,
    pendingSelections: 0, currentChoices: [], offerGeneratorState: GAME_CONFIG.powers.offerSeed >>> 0,
    splitTimerSeconds: 0, gunShotCooldownSeconds: 0, gunReloadSeconds: 0, gunVolleysRemaining: 0,
  };
}

export function getPowerDefinition(id: PowerId): PowerDefinition {
  const definition = POWER_DEFINITIONS.find((candidate) => candidate.id === id);
  if (!definition) throw new Error(`Unknown power: ${id}`);
  return definition;
}

export function getPowerDescription(id: PowerId, level: number, forSelection: boolean): string {
  const definition = getPowerDefinition(id);
  return forSelection && definition.describeSelection
    ? definition.describeSelection(level)
    : definition.describeCurrent(level);
}

export function getPowerLevel(powers: RunPowerState, id: PowerId): number {
  return powers.levels[id] ?? 0;
}

export function getEligiblePowerIds(powers: RunPowerState): PowerId[] {
  const atOwnershipCap = powers.ownedOrder.length >= GAME_CONFIG.powers.maxOwned;
  return POWER_DEFINITIONS
    .filter(({ enabledInOfferPool }) => enabledInOfferPool)
    .map(({ id }) => id)
    .filter((id) => {
      const level = getPowerLevel(powers, id);
      return level < GAME_CONFIG.powers.maxLevel && (level > 0 || !atOwnershipCap);
    });
}

export function getMaxedPowerPairs(powers: RunPowerState): ReadonlyArray<readonly [PowerId, PowerId]> {
  const pairs: Array<readonly [PowerId, PowerId]> = [];
  for (let index = 0; index + 1 < powers.maxedPowerOrder.length; index += 2) {
    pairs.push([powers.maxedPowerOrder[index], powers.maxedPowerOrder[index + 1]]);
  }
  return pairs;
}

function nextOfferRandom(powers: RunPowerState): number {
  powers.offerGeneratorState = (Math.imul(powers.offerGeneratorState, 1664525) + 1013904223) >>> 0;
  return powers.offerGeneratorState / 0x100000000;
}

function generateOffer(powers: RunPowerState): PowerId[] {
  const eligible = getEligiblePowerIds(powers);
  const choices: PowerId[] = [];
  while (choices.length < GAME_CONFIG.powers.offerCount && eligible.length > 0) {
    const index = Math.floor(nextOfferRandom(powers) * eligible.length);
    choices.push(eligible[index]);
    eligible.splice(index, 1);
  }
  return choices;
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
  if (newLevel === GAME_CONFIG.powers.maxLevel && !state.powers.maxedPowerOrder.includes(id)) {
    state.powers.maxedPowerOrder.push(id);
  }

  if (id === 'PIERCING_BALL') {
    const increase = newLevel - oldLevel;
    for (const ball of state.balls) ball.pierceCharge = Math.min(newLevel, ball.pierceCharge + increase);
  } else if (id === 'PADDLE_SIZE') {
    state.paddle.width = GAME_CONFIG.paddle.width * (1 + newLevel * 0.2);
    const minimumX = GAME_CONFIG.playfield.left + state.paddle.width / 2;
    const maximumX = GAME_CONFIG.playfield.right - state.paddle.width / 2;
    state.paddle.x = Math.max(minimumX, Math.min(maximumX, state.paddle.x));
  } else if (id === 'GUN' && oldLevel === 0) {
    state.powers.gunVolleysRemaining = newLevel;
    state.powers.gunShotCooldownSeconds = 0;
  } else if (id === 'SPLITTING_BALL' && oldLevel === 0) {
    let oldestBall = state.balls[0];
    for (const ball of state.balls) if (!oldestBall || ball.id < oldestBall.id) oldestBall = ball;
    if (oldestBall) {
      spawnBallsFromParent(state, oldestBall, newLevel, getPowerLevel(state.powers, 'PIERCING_BALL'));
    }
    state.powers.splitTimerSeconds = 0;
  }

  state.powers.pendingSelections -= 1;
  state.powers.currentChoices = [];
  return true;
}
