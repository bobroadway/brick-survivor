import { GAME_CONFIG } from './config';
import type { BallState, GameState } from './gameState';

export function spawnBallsFromParent(
  state: GameState,
  parent: BallState,
  count: number,
  pierceCharge: number,
): void {
  const { ball } = GAME_CONFIG;
  const parentSpeed = Math.hypot(parent.velocity.x, parent.velocity.y) || ball.speed;
  for (let index = 0; index < count; index += 1) {
    const sequence = state.nextBallId;
    const fraction = (sequence * 0.6180339887498949) % 1;
    const magnitude = ball.minHorizontalRatio
      + fraction * (ball.maxHorizontalRatio - ball.minHorizontalRatio);
    const horizontalRatio = sequence % 2 === 0 ? magnitude : -magnitude;
    const horizontalVelocity = parentSpeed * horizontalRatio;
    state.balls.push({
      id: sequence,
      x: parent.x,
      y: parent.y,
      velocity: {
        x: horizontalVelocity,
        y: -Math.sqrt(parentSpeed ** 2 - horizontalVelocity ** 2),
      },
      positionHistory: [],
      historySampleTimer: 0,
      radius: ball.radius,
      pierceCharge,
      pierceProcArmed: pierceCharge > 0,
      speedAssistStart: parentSpeed,
      speedAssistTarget: parentSpeed,
      speedAssistElapsedSeconds: ball.multiballSpeedTransitionDurationSeconds,
    });
    state.nextBallId += 1;
  }
}
