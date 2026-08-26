import { GAME_CONFIG } from './config';
import { advanceBrickField, damageBrick, type BrickState } from './brickField';
import type { BallState, GameState } from './gameState';

export interface SimulationInput {
  movementAxis: number;
  mouseDisplacement: number;
  speedMultiplier: number;
}

export enum SimulationStepOutcome {
  None,
  FinalBallLost,
  BrickOverflow,
}

export function getBallSpeed(ball: BallState): number {
  return Math.hypot(ball.velocity.x, ball.velocity.y);
}

function setBallDirection(ball: BallState, horizontalRatio: number, upward: boolean): void {
  const config = GAME_CONFIG.ball;
  const magnitude = Math.min(config.maxHorizontalRatio, Math.max(config.minHorizontalRatio, Math.abs(horizontalRatio)));
  const sign = horizontalRatio === 0 ? (ball.velocity.x < 0 ? -1 : 1) : Math.sign(horizontalRatio);
  ball.velocity.x = config.speed * magnitude * sign;
  ball.velocity.y = Math.sqrt(config.speed ** 2 - ball.velocity.x ** 2) * (upward ? -1 : 1);
}

function updatePaddle(state: GameState, input: SimulationInput, deltaSeconds: number): void {
  const { paddle } = state;
  const speedMultiplier = Math.max(0, input.speedMultiplier);
  const maxDistance = GAME_CONFIG.paddle.speed * speedMultiplier * deltaSeconds;
  const movementAxis = Math.max(-1, Math.min(1, input.movementAxis));
  if (movementAxis !== 0) {
    paddle.x += movementAxis * maxDistance;
  } else {
    paddle.x += Math.max(-maxDistance, Math.min(maxDistance, input.mouseDisplacement));
  }
  const minX = GAME_CONFIG.playfield.left + paddle.width / 2;
  const maxX = GAME_CONFIG.playfield.right - paddle.width / 2;
  paddle.x = Math.min(maxX, Math.max(minX, paddle.x));
}

function overlapsBrick(ball: BallState, brick: BrickState): boolean {
  const closestX = Math.max(brick.x, Math.min(ball.x, brick.x + brick.width));
  const closestY = Math.max(brick.y, Math.min(ball.y, brick.y + brick.height));
  return (ball.x - closestX) ** 2 + (ball.y - closestY) ** 2 <= ball.radius ** 2;
}

function collideWithBrick(ball: BallState, brick: BrickState, previousX: number, previousY: number): void {
  const left = brick.x - ball.radius;
  const right = brick.x + brick.width + ball.radius;
  const top = brick.y - ball.radius;
  const bottom = brick.y + brick.height + ball.radius;
  if (previousY <= top && ball.y > top) {
    ball.y = top; ball.velocity.y = -Math.abs(ball.velocity.y);
  } else if (previousY >= bottom && ball.y < bottom) {
    ball.y = bottom; ball.velocity.y = Math.abs(ball.velocity.y);
  } else if (previousX <= left && ball.x > left) {
    ball.x = left; ball.velocity.x = -Math.abs(ball.velocity.x);
  } else if (previousX >= right && ball.x < right) {
    ball.x = right; ball.velocity.x = Math.abs(ball.velocity.x);
  } else {
    const horizontalPenetration = Math.min(Math.abs(ball.x - left), Math.abs(right - ball.x));
    const verticalPenetration = Math.min(Math.abs(ball.y - top), Math.abs(bottom - ball.y));
    if (horizontalPenetration < verticalPenetration) ball.velocity.x *= -1;
    else ball.velocity.y *= -1;
  }
}

function updateBall(state: GameState, ball: BallState, deltaSeconds: number): boolean {
  const { paddle } = state;

  const previousX = ball.x;
  const previousY = ball.y;
  ball.x += ball.velocity.x * deltaSeconds;
  ball.y += ball.velocity.y * deltaSeconds;
  const field = GAME_CONFIG.playfield;
  if (ball.x - ball.radius < field.left) {
    ball.x = field.left + ball.radius; ball.velocity.x = Math.abs(ball.velocity.x);
  } else if (ball.x + ball.radius > field.right) {
    ball.x = field.right - ball.radius; ball.velocity.x = -Math.abs(ball.velocity.x);
  }
  if (ball.y - ball.radius < field.top) {
    ball.y = field.top + ball.radius; ball.velocity.y = Math.abs(ball.velocity.y);
  }

  const paddleLeft = paddle.x - paddle.width / 2;
  const paddleRight = paddle.x + paddle.width / 2;
  const paddleTop = paddle.y - paddle.height / 2;
  const crossedPaddleTop = previousY + ball.radius <= paddleTop && ball.y + ball.radius >= paddleTop;
  if (ball.velocity.y > 0 && crossedPaddleTop && ball.x + ball.radius >= paddleLeft && ball.x - ball.radius <= paddleRight) {
    ball.y = paddleTop - ball.radius;
    const hitOffset = (ball.x - paddle.x) / (paddle.width / 2);
    setBallDirection(ball, hitOffset * GAME_CONFIG.ball.maxHorizontalRatio, true);
  }

  let collided = false;
  for (const row of state.brickField.rows) {
    for (const brick of row.cells) {
      if (!brick || !overlapsBrick(ball, brick)) continue;
      collideWithBrick(ball, brick, previousX, previousY);
      damageBrick(state.brickField, brick, 1);
      collided = true;
      break;
    }
    if (collided) break;
  }
  if (ball.y - ball.radius > field.bottom) {
    return true;
  }

  ball.historySampleTimer += deltaSeconds;
  if (ball.historySampleTimer >= GAME_CONFIG.ball.trailSampleIntervalSeconds) {
    ball.historySampleTimer %= GAME_CONFIG.ball.trailSampleIntervalSeconds;
    ball.positionHistory.push({ x: ball.x, y: ball.y });
    if (ball.positionHistory.length > GAME_CONFIG.ball.trailSampleCount) ball.positionHistory.shift();
  }
  return false;
}

export function stepSimulation(
  state: GameState,
  input: SimulationInput,
  deltaSeconds: number,
): SimulationStepOutcome {
  if (advanceBrickField(state.brickField, deltaSeconds)) return SimulationStepOutcome.BrickOverflow;
  updatePaddle(state, input, deltaSeconds);
  for (let index = state.balls.length - 1; index >= 0; index -= 1) {
    if (updateBall(state, state.balls[index], deltaSeconds)) state.balls.splice(index, 1);
  }
  return state.balls.length === 0 ? SimulationStepOutcome.FinalBallLost : SimulationStepOutcome.None;
}
