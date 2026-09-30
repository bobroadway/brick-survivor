import { GAME_CONFIG } from './config';
import type { GameState } from './gameState';

export function damagePlayer(state: GameState, damage: number): number {
  const appliedDamage = Math.max(0, Math.floor(damage));
  const previousHp = state.playerHp;
  state.playerHp = Math.max(0, state.playerHp - appliedDamage);
  if (state.playerHp < previousHp) state.playerDamageEventId += 1;
  return state.playerHp;
}

export function healPlayerForLevelGains(state: GameState, levelsGained: number): number {
  if (state.playerHp <= 0) return state.playerHp;
  const healing = Math.max(0, Math.floor(levelsGained)) * GAME_CONFIG.player.levelUpHeal;
  state.playerHp = Math.min(state.playerMaxHp, state.playerHp + healing);
  return state.playerHp;
}
