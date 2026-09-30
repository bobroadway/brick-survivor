import { GAME_CONFIG } from '../src/simulation/config';
import { damagePlayer, healPlayerForLevelGains } from '../src/simulation/gameFlow';
import { createInitialGameState } from '../src/simulation/gameState';
import {
  getHealthColor,
  getHealthFraction,
  HEALTH_COLOR_GREEN,
  HEALTH_COLOR_RED,
  HEALTH_COLOR_YELLOW,
} from '../src/simulation/playerHealthPresentation';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function near(actual: number, expected: number, message: string): void {
  assert(Math.abs(actual - expected) < 1e-9, `${message}: expected ${expected}, received ${actual}`);
}

assert(getHealthColor(10, 10) === HEALTH_COLOR_GREEN, '100% Health was not pure green');
assert(getHealthColor(8, 10) === HEALTH_COLOR_GREEN, '80% Health was not pure green');
assert(getHealthColor(5, 10) === HEALTH_COLOR_YELLOW, '50% Health was not pure yellow');
assert(getHealthColor(2, 10) === HEALTH_COLOR_RED, '20% Health was not pure red');
assert(getHealthColor(0, 10) === HEALTH_COLOR_RED, '0% Health was not pure red');
assert(HEALTH_COLOR_GREEN === GAME_CONFIG.rendering.brickSpeedClassColors.SLOW,
  'Health green drifted from the canonical SLOW brick palette');
assert(HEALTH_COLOR_RED === GAME_CONFIG.rendering.brickSpeedClassColors.RUSH,
  'Health red drifted from the canonical RUSH brick palette');
assert(HEALTH_COLOR_YELLOW === GAME_CONFIG.rendering.healthYellowColor,
  'Health yellow drifted from the canonical presentation palette');
assert(getHealthColor(3.5, 10) === 0xac9383, '35% Health did not interpolate red to muted yellow');
assert(getHealthColor(6.5, 10) === 0x919f7b, '65% Health did not interpolate muted yellow to green');

for (const [current, maximum, expected] of [
  [10, 10, 1], [8, 10, 0.8], [5, 10, 0.5], [2, 10, 0.2], [0, 10, 0],
  [20, 10, 1], [-5, 10, 0], [5, 0, 0],
] as const) near(getHealthFraction(current, maximum), expected, `${current}/${maximum} Health fraction`);

const state = createInitialGameState();
damagePlayer(state, GAME_CONFIG.player.armoredBrickPaddleDamage);
assert(state.playerDamageEventId === 1 && state.playerHp === 4,
  'one Armored paddle transaction did not produce exactly one damage event');
state.playerHp = 10;
damagePlayer(state, GAME_CONFIG.boss.paddleContactDamage);
assert(state.playerDamageEventId === 2 && state.playerHp === 7,
  'one Boss contact tick did not produce exactly one damage event');
state.playerHp = 10;
damagePlayer(state, GAME_CONFIG.player.finalBallLostDamage);
assert(state.playerDamageEventId === 3 && state.playerHp === 5,
  'one Ball-loss transaction did not produce exactly one damage event');
healPlayerForLevelGains(state, 1);
assert(state.playerDamageEventId === 3 && state.playerHp === 6,
  'healing incorrectly emitted a player-damage presentation event');
