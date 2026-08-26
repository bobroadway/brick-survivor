import { GAME_CONFIG } from './config';
import { advanceBrickField, type BrickState } from './brickField';
import {
  applyBrickDamage,
  isBallKill,
  type BrickDestruction,
} from './combat';
import { spawnSplitBalls, type BallState, type GameState } from './gameState';
import { rankElectricTargets, selectWindTargets } from './powerTargeting';
import { getPowerLevel } from './powers';

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

export function getMultiballTargetSpeed(activeBallCount: number): number {
  const config = GAME_CONFIG.ball;
  const additionalBalls = Math.max(0, Math.floor(activeBallCount) - 1);
  const slowdown = Math.min(
    config.multiballMaximumSlowdown,
    config.multiballSlowdownPerExtraBall * additionalBalls,
  );
  return config.speed * (1 - slowdown);
}

function updateBallSpeedAssist(ball: BallState, targetSpeed: number, deltaSeconds: number): void {
  const currentSpeed = getBallSpeed(ball);
  if (ball.speedAssistTarget !== targetSpeed) {
    ball.speedAssistStart = currentSpeed;
    ball.speedAssistTarget = targetSpeed;
    ball.speedAssistElapsedSeconds = 0;
  }
  if (currentSpeed <= Number.EPSILON) return;
  ball.speedAssistElapsedSeconds = Math.min(
    GAME_CONFIG.ball.multiballSpeedTransitionDurationSeconds,
    ball.speedAssistElapsedSeconds + deltaSeconds,
  );
  const progress = GAME_CONFIG.ball.multiballSpeedTransitionDurationSeconds <= 0
    ? 1
    : ball.speedAssistElapsedSeconds / GAME_CONFIG.ball.multiballSpeedTransitionDurationSeconds;
  const adjustedSpeed = ball.speedAssistStart + (targetSpeed - ball.speedAssistStart) * progress;
  const scale = adjustedSpeed / currentSpeed;
  ball.velocity.x *= scale;
  ball.velocity.y *= scale;
}

function setBallDirection(ball: BallState, horizontalRatio: number, upward: boolean): void {
  const config = GAME_CONFIG.ball;
  const speed = getBallSpeed(ball) || config.speed;
  const magnitude = Math.min(config.maxHorizontalRatio, Math.max(config.minHorizontalRatio, Math.abs(horizontalRatio)));
  const sign = horizontalRatio === 0 ? (ball.velocity.x < 0 ? -1 : 1) : Math.sign(horizontalRatio);
  ball.velocity.x = speed * magnitude * sign;
  ball.velocity.y = Math.sqrt(speed ** 2 - ball.velocity.x ** 2) * (upward ? -1 : 1);
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

function findBrickById(state: GameState, id: string): BrickState | undefined {
  for (const column of state.brickField.columns) {
    for (const brick of column) if (brick.id === id) return brick;
  }
  return undefined;
}

function triggerElectric(state: GameState, destruction: BrickDestruction): void {
  const level = getPowerLevel(state.powers, 'ELECTRIC_BALL');
  if (level === 0) return;
  const sourceX = destruction.x + destruction.width / 2;
  const sourceY = destruction.y + destruction.height / 2;
  const bricks: BrickState[] = [];
  for (const column of state.brickField.columns) bricks.push(...column);
  for (const { brick } of rankElectricTargets(destruction, bricks).slice(0, level)) {
    state.projectiles.push({
      id: state.nextProjectileId++, kind: 'ELECTRIC', x: sourceX, y: sourceY,
      velocity: { x: 0, y: 0 }, damage: 1, targetBrickId: brick.id,
    });
  }
}

function triggerWind(state: GameState, destruction: BrickDestruction): void {
  const level = getPowerLevel(state.powers, 'WIND_BALL');
  if (level === 0) return;
  const bricks: BrickState[] = [];
  for (const column of state.brickField.columns) bricks.push(...column);
  const targets = selectWindTargets(level, destruction, bricks);
  const sourceCenterX = destruction.x + destruction.width / 2;
  const sourceCenterY = destruction.y + destruction.height / 2;
  const verticalPitch = GAME_CONFIG.bricks.brickHeight + GAME_CONFIG.bricks.verticalEdgeGap;
  const range = (level + 1) * verticalPitch;
  state.windEffects.push({
    x: sourceCenterX,
    y1: level === GAME_CONFIG.powers.maxLevel
      ? GAME_CONFIG.playfield.top
      : Math.max(GAME_CONFIG.playfield.top, sourceCenterY - range),
    y2: sourceCenterY,
    remainingSeconds: GAME_CONFIG.powers.windEffectSeconds,
  });
  for (const brick of targets) applyBrickDamage(state, brick, 1, 'WIND');
}

function triggerFire(state: GameState, destruction: BrickDestruction): void {
  const level = getPowerLevel(state.powers, 'FIRE_BALL');
  if (level === 0) return;
  const sourceCenterX = destruction.x + destruction.width / 2;
  const sourceCenterY = destruction.y + destruction.height / 2;
  const fullLine = level === 5;
  const radius = (GAME_CONFIG.bricks.brickWidth + GAME_CONFIG.bricks.horizontalGap) * level;
  const targets: BrickState[] = [];
  for (const column of state.brickField.columns) {
    for (const brick of column) {
      const verticallyIntersects = brick.y <= destruction.y + destruction.height
        && brick.y + brick.height >= destruction.y;
      const inRange = fullLine || Math.abs(brick.x + brick.width / 2 - sourceCenterX) <= radius;
      if (verticallyIntersects && inRange) targets.push(brick);
    }
  }
  const x1 = fullLine ? GAME_CONFIG.playfield.left : Math.max(GAME_CONFIG.playfield.left, sourceCenterX - radius);
  const x2 = fullLine ? GAME_CONFIG.playfield.right : Math.min(GAME_CONFIG.playfield.right, sourceCenterX + radius);
  state.fireEffects.push({ x1, x2, y: sourceCenterY, remainingSeconds: GAME_CONFIG.powers.fireEffectSeconds });
  for (const brick of targets) applyBrickDamage(state, brick, 1, 'FIRE');
}

function handleBallKill(state: GameState, destruction: BrickDestruction | null): void {
  if (!isBallKill(destruction)) return;
  triggerElectric(state, destruction);
  triggerFire(state, destruction);
  triggerWind(state, destruction);
}

function spawnGunVolley(state: GameState): void {
  const halfWidth = state.paddle.width / 2;
  const inset = Math.min(GAME_CONFIG.powers.gunMountInset, halfWidth);
  const mountOffset = halfWidth - inset;
  for (const x of [state.paddle.x - mountOffset, state.paddle.x + mountOffset]) {
    state.projectiles.push({
      id: state.nextProjectileId++, kind: 'GUN', x,
      y: state.paddle.y - state.paddle.height / 2,
      velocity: { x: 0, y: -GAME_CONFIG.powers.projectileSpeed }, damage: 1,
    });
  }
}

function updateGun(state: GameState, deltaSeconds: number): void {
  const level = getPowerLevel(state.powers, 'GUN');
  if (level === 0) return;
  const powers = state.powers;
  if (powers.gunReloadSeconds > 0) {
    powers.gunReloadSeconds = Math.max(0, powers.gunReloadSeconds - deltaSeconds);
    if (powers.gunReloadSeconds === 0) powers.gunVolleysRemaining = level;
    return;
  }
  powers.gunShotCooldownSeconds = Math.max(0, powers.gunShotCooldownSeconds - deltaSeconds);
  if (powers.gunVolleysRemaining <= 0 || powers.gunShotCooldownSeconds > 0) return;
  spawnGunVolley(state);
  powers.gunVolleysRemaining -= 1;
  if (powers.gunVolleysRemaining > 0) powers.gunShotCooldownSeconds = GAME_CONFIG.powers.gunShotIntervalSeconds;
  else powers.gunReloadSeconds = GAME_CONFIG.powers.gunReloadSeconds;
}

function updateSplitting(state: GameState, deltaSeconds: number): void {
  const level = getPowerLevel(state.powers, 'SPLITTING_BALL');
  if (level === 0 || state.balls.length === 0) return;
  state.powers.splitTimerSeconds += deltaSeconds;
  while (state.powers.splitTimerSeconds >= GAME_CONFIG.powers.splittingIntervalSeconds) {
    state.powers.splitTimerSeconds -= GAME_CONFIG.powers.splittingIntervalSeconds;
    let oldest = state.balls[0];
    for (const ball of state.balls) if (ball.id < oldest.id) oldest = ball;
    spawnSplitBalls(state, oldest, level);
  }
}

function updateProjectiles(state: GameState, deltaSeconds: number): void {
  for (let index = state.projectiles.length - 1; index >= 0; index -= 1) {
    const projectile = state.projectiles[index];
    if (projectile.kind === 'ELECTRIC') {
      const target = projectile.targetBrickId ? findBrickById(state, projectile.targetBrickId) : undefined;
      if (!target) { state.projectiles.splice(index, 1); continue; }
      const targetX = target.x + target.width / 2;
      const targetY = target.y + target.height / 2;
      const dx = targetX - projectile.x;
      const dy = targetY - projectile.y;
      const distance = Math.hypot(dx, dy);
      const travel = GAME_CONFIG.powers.projectileSpeed * deltaSeconds;
      if (distance <= travel) {
        applyBrickDamage(state, target, projectile.damage, 'ELECTRIC');
        state.projectiles.splice(index, 1);
      } else {
        projectile.velocity.x = dx / distance * GAME_CONFIG.powers.projectileSpeed;
        projectile.velocity.y = dy / distance * GAME_CONFIG.powers.projectileSpeed;
        projectile.x += projectile.velocity.x * deltaSeconds;
        projectile.y += projectile.velocity.y * deltaSeconds;
      }
      continue;
    }

    const previousY = projectile.y;
    projectile.y += projectile.velocity.y * deltaSeconds;
    let hit: BrickState | undefined;
    for (const column of state.brickField.columns) {
      for (const brick of column) {
        if (projectile.x < brick.x || projectile.x > brick.x + brick.width) continue;
        if (brick.y + brick.height < projectile.y || brick.y > previousY) continue;
        if (!hit || brick.y > hit.y) hit = brick;
      }
    }
    if (hit) {
      applyBrickDamage(state, hit, projectile.damage, 'GUN');
      state.projectiles.splice(index, 1);
    } else if (projectile.y < GAME_CONFIG.playfield.top) {
      state.projectiles.splice(index, 1);
    }
  }
}

function updateFireEffects(state: GameState, deltaSeconds: number): void {
  for (let index = state.fireEffects.length - 1; index >= 0; index -= 1) {
    state.fireEffects[index].remainingSeconds -= deltaSeconds;
    if (state.fireEffects[index].remainingSeconds <= 0) state.fireEffects.splice(index, 1);
  }
}

function updateWindEffects(state: GameState, deltaSeconds: number): void {
  for (let index = state.windEffects.length - 1; index >= 0; index -= 1) {
    state.windEffects[index].remainingSeconds -= deltaSeconds;
    if (state.windEffects[index].remainingSeconds <= 0) state.windEffects.splice(index, 1);
  }
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
    ball.pierceCharge = getPowerLevel(state.powers, 'PIERCING_BALL');
  }

  let collided = false;
  for (const column of state.brickField.columns) {
    for (const brick of column) {
      if (!overlapsBrick(ball, brick)) continue;
      const brickHp = brick.hp;
      if (ball.pierceCharge >= brickHp && ball.pierceCharge > 0) {
        ball.pierceCharge -= brickHp;
        handleBallKill(state, applyBrickDamage(state, brick, brickHp, 'BALL'));
      } else {
        const pierceDamage = Math.min(ball.pierceCharge, Math.max(0, brickHp - 1));
        ball.pierceCharge = 0;
        collideWithBrick(ball, brick, previousX, previousY);
        handleBallKill(state, applyBrickDamage(state, brick, 1 + pierceDamage, 'BALL'));
        ball.pierceCharge = getPowerLevel(state.powers, 'PIERCING_BALL');
      }
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
    if (ball.positionHistory.length > GAME_CONFIG.levelUpTransition.maxVisibleTrajectoryGhosts) {
      ball.positionHistory.shift();
    }
  }
  return false;
}

export function stepSimulation(
  state: GameState,
  input: SimulationInput,
  playerDeltaSeconds: number,
  worldDeltaSeconds: number = playerDeltaSeconds,
): SimulationStepOutcome {
  updatePaddle(state, input, playerDeltaSeconds);
  if (advanceBrickField(state.brickField, worldDeltaSeconds, state.progression.level)) {
    return SimulationStepOutcome.BrickOverflow;
  }
  updateGun(state, worldDeltaSeconds);
  updateSplitting(state, worldDeltaSeconds);
  updateProjectiles(state, worldDeltaSeconds);
  updateFireEffects(state, worldDeltaSeconds);
  updateWindEffects(state, worldDeltaSeconds);
  const targetBallSpeed = getMultiballTargetSpeed(state.balls.length);
  for (let index = state.balls.length - 1; index >= 0; index -= 1) {
    updateBallSpeedAssist(state.balls[index], targetBallSpeed, worldDeltaSeconds);
    if (updateBall(state, state.balls[index], worldDeltaSeconds)) state.balls.splice(index, 1);
  }
  return state.balls.length === 0 ? SimulationStepOutcome.FinalBallLost : SimulationStepOutcome.None;
}
