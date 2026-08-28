import { GAME_CONFIG } from './config';
import { spawnBallsFromParent } from './ballSpawning';
import type { GameState } from './gameState';

export type PowerId = 'GUN' | 'PIERCING_BALL' | 'SPLITTING_BALL' | 'PADDLE_SIZE'
  | 'ELECTRIC_BALL' | 'FIRE_BALL' | 'WIND_BALL' | 'HOMING_MISSILE' | 'ICE_BALL';

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
  bansRemaining: number;
  bannedPowerIds: Set<PowerId>;
  pendingSelections: number;
  currentChoices: Array<PowerId | null>;
  offerGeneratorState: number;
  splitTimerSeconds: number;
  gunShotCooldownSeconds: number;
  gunReloadSeconds: number;
  gunVolleysRemaining: number;
  missileLaunchCooldownSeconds: number;
  missileReloadSeconds: number;
  missilesRemainingInVolley: number;
  missileLaunchIndex: number;
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
    describeCurrent: (level) => `Splits a ball every ${GAME_CONFIG.powers.splittingCooldownSecondsByLevel[level - 1]} seconds.`,
    describeSelection: (level) => level === 1
      ? `Immediately splits once, then every ${GAME_CONFIG.powers.splittingCooldownSecondsByLevel[0]} seconds.`
      : `Splits a ball every ${GAME_CONFIG.powers.splittingCooldownSecondsByLevel[level - 1]} seconds.`,
  },
  {
    id: 'PADDLE_SIZE', name: 'PADDLE SIZE', enabledInOfferPool: true,
    describeCurrent: (level) => `${level * 20}% wider. Edge hits reach ${GAME_CONFIG.powers.paddleOuterEdgeElevationDegreesByLevel[level - 1]}°.`,
  },
  {
    id: 'ELECTRIC_BALL', name: 'ELECTRIC BALL', enabledInOfferPool: true,
    describeCurrent: (level) => level === 5
      ? 'Zaps 5 nearby bricks, with each zap chaining once.'
      : `Zaps ${GAME_CONFIG.powers.electricPrimaryTargetsByLevel[level - 1]} nearby bricks.`,
  },
  {
    id: 'FIRE_BALL', name: 'FIRE BALL', enabledInOfferPool: true,
    describeCurrent: (level) => level === 5
      ? 'Blasts a 9-wide area across three rows.'
      : `Blasts a ${GAME_CONFIG.powers.fireHorizontalRadiusSpacesByLevel[level - 1] * 2 + 1}-brick-wide horizontal area.`,
  },
  {
    id: 'WIND_BALL', name: 'WIND BALL', enabledInOfferPool: true,
    describeCurrent: (level) => level === 5
      ? 'Unleashes a widening tornado above the destroyed brick.'
      : `Strikes ${GAME_CONFIG.powers.windRangeSpacesByLevel[level - 1]} spaces above.`,
  },
  {
    id: 'HOMING_MISSILE', name: 'HOMING MISSILE', enabledInOfferPool: true,
    describeCurrent: (level) => level === 5
      ? 'Rapidly launches 5 missiles that hunt the lowest bricks.'
      : `Launches ${level} missile${level === 1 ? '' : 's'} that hunt the lowest brick${level === 1 ? '' : 's'}.`,
  },
  {
    id: 'ICE_BALL', name: 'ICE BALL', enabledInOfferPool: true,
    describeCurrent: (level) => level === GAME_CONFIG.powers.maxLevel
      ? 'Frozen bricks destroy 5 incoming bricks. Shatters chain through other frozen bricks.'
      : level === 1
        ? 'Freezes Ball-hit bricks. They destroy 1 incoming brick, then shatter nearby bricks.'
        : `Frozen bricks destroy ${level} incoming bricks before shattering.`,
  },
] as const;

export function createRunPowerState(): RunPowerState {
  return {
    levels: {}, ownedOrder: [], maxedPowerOrder: [],
    rerollsRemaining: GAME_CONFIG.powers.startingRerolls,
    bansRemaining: GAME_CONFIG.powers.startingBans, bannedPowerIds: new Set<PowerId>(),
    pendingSelections: 0, currentChoices: [], offerGeneratorState: GAME_CONFIG.powers.offerSeed >>> 0,
    splitTimerSeconds: 0, gunShotCooldownSeconds: 0, gunReloadSeconds: 0, gunVolleysRemaining: 0,
    missileLaunchCooldownSeconds: 0, missileReloadSeconds: 0,
    missilesRemainingInVolley: 0, missileLaunchIndex: 0,
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
    .filter((id) => !powers.bannedPowerIds.has(id))
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

export function banPowerChoice(powers: RunPowerState, id: PowerId): boolean {
  if (powers.bansRemaining <= 0 || powers.bannedPowerIds.has(id)) return false;
  const slot = powers.currentChoices.indexOf(id);
  if (slot < 0) return false;

  powers.bannedPowerIds.add(id);
  powers.bansRemaining -= 1;
  const displayedElsewhere = new Set(
    powers.currentChoices.filter((choice, index): choice is PowerId => index !== slot && choice !== null),
  );
  const eligible = getEligiblePowerIds(powers).filter((candidate) => !displayedElsewhere.has(candidate));
  powers.currentChoices[slot] = eligible.length > 0
    ? eligible[Math.floor(nextOfferRandom(powers) * eligible.length)]
    : null;

  if (!powers.currentChoices.some((choice) => choice !== null)) {
    powers.pendingSelections = Math.max(0, powers.pendingSelections - 1);
    prepareNextPowerSelection(powers);
  }
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
  } else if (id === 'HOMING_MISSILE' && oldLevel === 0) {
    state.powers.missilesRemainingInVolley = newLevel;
    state.powers.missileLaunchIndex = 0;
    state.powers.missileLaunchCooldownSeconds = 0;
    state.powers.missileReloadSeconds = 0;
  }

  state.powers.pendingSelections -= 1;
  state.powers.currentChoices = [];
  return true;
}
