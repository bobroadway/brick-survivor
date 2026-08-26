import { GAME_CONFIG } from './config';
import { prepareSingleBall, type GameState } from './gameState';
import {
  advanceLifeLost,
  beginLifeLost,
  enterGameOver,
  type SessionState,
} from './sessionState';

export function resolveFinalBallLoss(state: GameState, session: SessionState): void {
  state.lives = Math.max(0, state.lives - 1);
  if (state.lives > 0) beginLifeLost(session, GAME_CONFIG.run.lifeLostDelaySeconds);
  else enterGameOver(session);
}

export function updateLifeLostTransition(
  state: GameState,
  session: SessionState,
  deltaSeconds: number,
): boolean {
  if (!advanceLifeLost(session, deltaSeconds)) return false;
  prepareSingleBall(state);
  return true;
}
