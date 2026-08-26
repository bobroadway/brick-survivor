import { prepareSingleBall, type GameState } from './gameState';
import {
  beginLifeLost,
  continueAfterLifeLost,
  enterGameOver,
  type SessionState,
} from './sessionState';

export function resolveFinalBallLoss(state: GameState, session: SessionState): void {
  state.lives = Math.max(0, state.lives - 1);
  if (state.lives > 0) beginLifeLost(session);
  else enterGameOver(session);
}

export function continueLifeLost(state: GameState, session: SessionState): boolean {
  if (!continueAfterLifeLost(session)) return false;
  prepareSingleBall(state);
  return true;
}
