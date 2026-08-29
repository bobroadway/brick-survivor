import { GAME_CONFIG } from './config';
import { advanceBrickField, type BrickState } from './brickField';
import { recordBossDamage, recordBossSpawned, updateBossDirector, updateBossPresentation } from './boss';
import {
  advanceBrickPressureAssist,
  getEffectiveBrickSpeedLevel,
  recordBallPaddleContact,
} from './brickPressureAssist';
import {
  isBallKill,
  type BrickDestruction,
} from './combat';
import { applyRoutedBrickDamage } from './destructionRouting';
import { spawnSplitBalls, type BallState, type GameState } from './gameState';
import { createElectricVisualAmplitude } from './electricVisual';
import {
  advanceFrozenBrickSafety,
  commitPendingFreeze,
  freezeBrick,
  freezeBossAtZero,
  handleFrozenBrickContact,
  isFreezeSafetyContact,
  isFrozenBrick,
  isPendingFreezeBrick,
  isPendingFreezeSafetyContact,
} from './iceBall';
import { rankElectricTargets, selectMissileTarget, selectWindTargets } from './powerTargeting';
import { getPaddleBounceElevationDegrees } from './paddleBounce';
import { getPowerLevel } from './powers';
import { getBrickDensityDifficultyLevel, getVirtualDifficultyLevel } from './survivalDifficulty';

export interface SimulationInput {
  movementAxis: number;
  mouseDisplacement: number;
  speedMultiplier: number;
}

export enum SimulationStepOutcome {
  None,
  FinalBallLost,
  BrickOverflow,
  Win,
}

export function getBallSpeed(ball: BallState): number {
  return Math.hypot(ball.velocity.x, ball.velocity.y);
}

export function getMultiballSlowdown(activeBallCount: number): number {
  const config = GAME_CONFIG.ball;
  const additionalBalls = Math.max(0, Math.floor(activeBallCount) - 1);
  return Math.min(
    config.speedAssistMaximumPercentage,
    config.speedAssistPercentageStep * additionalBalls,
  );
}

export function getCombinedBallSpeedMultiplier(
  activeBallCount: number,
  trappedBallSpeedBoost: number,
): number {
  return 1 - getMultiballSlowdown(activeBallCount) + Math.max(
    0,
    Math.min(GAME_CONFIG.ball.speedAssistMaximumPercentage, trappedBallSpeedBoost),
  );
}

export function getBallTargetSpeed(activeBallCount: number, trappedBallSpeedBoost = 0): number {
  return GAME_CONFIG.ball.speed
    * getCombinedBallSpeedMultiplier(activeBallCount, trappedBallSpeedBoost);
}

function updateBallSpeedAssist(ball: BallState, targetSpeed: number, deltaSeconds: number): void {
  const currentSpeed = getBallSpeed(ball);
  if (ball.speedAssistTarget !== targetSpeed) {
    const continuousTargetChange = GAME_CONFIG.ball.speed
      * GAME_CONFIG.ball.speedAssistPercentageStep
      * deltaSeconds * 1.01;
    if (Math.abs(ball.speedAssistTarget - targetSpeed) > continuousTargetChange) {
      ball.speedAssistStart = currentSpeed;
      ball.speedAssistElapsedSeconds = 0;
    }
    ball.speedAssistTarget = targetSpeed;
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

type BallElementalProcKind = 'BALL_DESTRUCTION' | 'INITIAL_ICE_FREEZE' | 'DIRECT_BALL_ICE_SHATTER';

interface BallElementalProcEvent {
  kind: BallElementalProcKind;
  origin: BrickDestruction;
  originBrickId?: string;
}

function triggerElectric(
  state: GameState,
  destruction: BrickDestruction,
  excludedBrickIds?: ReadonlySet<string>,
): void {
  const level = getPowerLevel(state.powers, 'ELECTRIC_BALL');
  if (level === 0) return;
  const sourceX = destruction.x + destruction.width / 2;
  const sourceY = destruction.y + destruction.height / 2;
  const bricks: BrickState[] = [];
  for (const column of state.brickField.columns) bricks.push(...column);
  const targetCount = GAME_CONFIG.powers.electricPrimaryTargetsByLevel[level - 1];
  const targets = rankElectricTargets(destruction, bricks, excludedBrickIds)
    .slice(0, targetCount)
    .map(({ brick }) => brick);
  const proc = level === GAME_CONFIG.powers.maxLevel && targets.length > 0
    ? {
      id: state.nextElectricProcId++,
      primaryTargetIds: new Set(targets.map(({ id }) => id)),
      secondaryTargetIds: new Set<string>(),
      excludedTargetIds: excludedBrickIds ? new Set(excludedBrickIds) : undefined,
      activeProjectileCount: targets.length,
    }
    : undefined;
  if (proc) state.electricProcs.push(proc);
  for (const brick of targets) {
    const projectileId = state.nextProjectileId++;
    const targetX = brick.x + brick.width / 2;
    const targetY = brick.y + brick.height / 2;
    const initialDistance = Math.hypot(targetX - sourceX, targetY - sourceY);
    state.projectiles.push({
      id: projectileId, kind: 'ELECTRIC', x: sourceX, y: sourceY,
      velocity: {
        x: initialDistance > 0 ? (targetX - sourceX) / initialDistance * GAME_CONFIG.powers.projectileSpeed : 0,
        y: initialDistance > 0 ? (targetY - sourceY) / initialDistance * GAME_CONFIG.powers.projectileSpeed : 0,
      },
      damage: 1, targetBrickId: brick.id,
      electricProcId: proc?.id, electricGeneration: proc ? 'PRIMARY' : undefined,
      electricFlightProgress: 0,
      electricInitialDistance: initialDistance,
      electricVisualAmplitude: createElectricVisualAmplitude(projectileId, brick.id),
    });
  }
}

function setPaddleBounceDirection(ball: BallState, elevationDegrees: number, horizontalSign: number): void {
  const speed = getBallSpeed(ball) || GAME_CONFIG.ball.speed;
  const elevationRadians = elevationDegrees * Math.PI / 180;
  const sign = horizontalSign === 0 ? (ball.velocity.x < 0 ? -1 : 1) : Math.sign(horizontalSign);
  ball.velocity.x = speed * Math.cos(elevationRadians) * sign;
  ball.velocity.y = -speed * Math.sin(elevationRadians);
}

function triggerWind(
  state: GameState,
  destruction: BrickDestruction,
  excludedBrickIds?: ReadonlySet<string>,
): void {
  const level = getPowerLevel(state.powers, 'WIND_BALL');
  if (level === 0) return;
  const bricks: BrickState[] = [];
  for (const column of state.brickField.columns) {
    for (const brick of column) if (!excludedBrickIds?.has(brick.id)) bricks.push(brick);
  }
  const sourceCount = destruction.width > GAME_CONFIG.bricks.brickWidth
    ? GAME_CONFIG.boss.widthColumns : 1;
  const sourcePitch = GAME_CONFIG.bricks.brickWidth + GAME_CONFIG.bricks.horizontalGap;
  const sources = Array.from({ length: sourceCount }, (_, index) => ({
    ...destruction,
    x: destruction.x + index * sourcePitch,
    width: GAME_CONFIG.bricks.brickWidth,
  }));
  const targets = [...new Map(sources.flatMap((source) => selectWindTargets(level, source, bricks))
    .map((brick) => [brick.id, brick])).values()];
  const sourceCenterY = destruction.y + destruction.height / 2;
  const verticalPitch = GAME_CONFIG.bricks.brickHeight + GAME_CONFIG.bricks.verticalEdgeGap;
  const rangeSpaces = level === GAME_CONFIG.powers.maxLevel
    ? 7
    : GAME_CONFIG.powers.windRangeSpacesByLevel[level - 1] ?? 0;
  const range = rangeSpaces * verticalPitch;
  for (const source of sources) state.windEffects.push({
    x: source.x + source.width / 2,
    y1: Math.max(GAME_CONFIG.playfield.top, sourceCenterY - range),
    y2: sourceCenterY,
    topHalfWidth: level === GAME_CONFIG.powers.maxLevel
      ? GAME_CONFIG.bricks.brickWidth / 2 + GAME_CONFIG.bricks.brickWidth + GAME_CONFIG.bricks.horizontalGap
      : undefined,
    remainingSeconds: GAME_CONFIG.powers.windEffectSeconds,
  });
  for (const brick of targets) applyRoutedBrickDamage(state, brick, 1, 'WIND');
}

function triggerFire(
  state: GameState,
  destruction: BrickDestruction,
  excludedBrickIds?: ReadonlySet<string>,
): void {
  const level = getPowerLevel(state.powers, 'FIRE_BALL');
  if (level === 0) return;
  const sourceCenterY = destruction.y + destruction.height / 2;
  const radiusSpaces = GAME_CONFIG.powers.fireHorizontalRadiusSpacesByLevel[level - 1] ?? 0;
  const horizontalPitch = GAME_CONFIG.bricks.brickWidth + GAME_CONFIG.bricks.horizontalGap;
  const verticalPitch = GAME_CONFIG.bricks.brickHeight + GAME_CONFIG.bricks.verticalEdgeGap;
  const radius = horizontalPitch * radiusSpaces;
  const sourceLeftCenter = destruction.x + GAME_CONFIG.bricks.brickWidth / 2;
  const sourceRightCenter = destruction.x + destruction.width - GAME_CONFIG.bricks.brickWidth / 2;
  const targets: BrickState[] = [];
  for (const column of state.brickField.columns) {
    for (const brick of column) {
      if (excludedBrickIds?.has(brick.id)) continue;
      const sourceHalfHeight = destruction.height / 2;
      const verticallyIntersects = level === GAME_CONFIG.powers.maxLevel
        ? Math.abs(brick.y + brick.height / 2 - sourceCenterY)
          <= sourceHalfHeight + verticalPitch + GAME_CONFIG.bricks.brickHeight / 2
        : brick.y <= destruction.y + destruction.height && brick.y + brick.height >= destruction.y;
      const targetCenterX = brick.x + brick.width / 2;
      const inRange = targetCenterX >= sourceLeftCenter - radius
        && targetCenterX <= sourceRightCenter + radius;
      if (verticallyIntersects && inRange) targets.push(brick);
    }
  }
  const x1 = Math.max(GAME_CONFIG.playfield.left, sourceLeftCenter - radius);
  const x2 = Math.min(GAME_CONFIG.playfield.right, sourceRightCenter + radius);
  state.fireEffects.push({
    x1, x2, y: sourceCenterY,
    additionalYs: level === GAME_CONFIG.powers.maxLevel
      ? [sourceCenterY - verticalPitch, sourceCenterY + verticalPitch]
      : undefined,
    remainingSeconds: GAME_CONFIG.powers.fireEffectSeconds,
  });
  for (const brick of targets) applyRoutedBrickDamage(state, brick, 1, 'FIRE');
}

function triggerBallElementalProc(state: GameState, event: BallElementalProcEvent): void {
  const excludedBrickIds = event.originBrickId ? new Set([event.originBrickId]) : undefined;
  triggerElectric(state, event.origin, excludedBrickIds);
  triggerFire(state, event.origin, excludedBrickIds);
  triggerWind(state, event.origin, excludedBrickIds);
}

function handleBallKill(state: GameState, destruction: BrickDestruction | null): void {
  if (!isBallKill(destruction)) return;
  triggerBallElementalProc(state, { kind: 'BALL_DESTRUCTION', origin: destruction });
}

function triggerIceBallElementalProc(
  state: GameState,
  brick: Pick<BrickState, 'id' | 'x' | 'y' | 'width' | 'height'>,
  kind: 'INITIAL_ICE_FREEZE' | 'DIRECT_BALL_ICE_SHATTER',
): void {
  triggerBallElementalProc(state, {
    kind,
    originBrickId: brick.id,
    origin: { source: 'BALL', x: brick.x, y: brick.y, width: brick.width, height: brick.height },
  });
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

function launchMissile(state: GameState): void {
  const powers = state.powers;
  const offset = GAME_CONFIG.powers.missileLaunchOffsets[powers.missileLaunchIndex] ?? 0;
  state.projectiles.push({
    id: state.nextProjectileId++,
    kind: 'MISSILE',
    x: state.paddle.x + state.paddle.width / 2 * offset,
    y: state.paddle.y - state.paddle.height / 2,
    velocity: { x: 0, y: -GAME_CONFIG.powers.missileDeploymentSpeed },
    damage: 1,
    missilePhase: 'DEPLOYING',
    deploymentRemainingSeconds: GAME_CONFIG.powers.missileDeploymentDurationSeconds,
    homingSpeed: GAME_CONFIG.powers.missileHomingInitialSpeed,
  });
  powers.missileLaunchIndex += 1;
}

function updateMissileFiring(state: GameState, deltaSeconds: number): void {
  const level = getPowerLevel(state.powers, 'HOMING_MISSILE');
  if (level === 0) return;
  const powers = state.powers;
  if (powers.missileReloadSeconds > 0) {
    powers.missileReloadSeconds = Math.max(0, powers.missileReloadSeconds - deltaSeconds);
    if (powers.missileReloadSeconds > 0) return;
    powers.missilesRemainingInVolley = level;
    powers.missileLaunchIndex = 0;
    powers.missileLaunchCooldownSeconds = 0;
  }
  powers.missileLaunchCooldownSeconds = Math.max(0, powers.missileLaunchCooldownSeconds - deltaSeconds);
  if (powers.missilesRemainingInVolley <= 0 || powers.missileLaunchCooldownSeconds > 0) return;
  launchMissile(state);
  powers.missilesRemainingInVolley -= 1;
  if (powers.missilesRemainingInVolley > 0) {
    powers.missileLaunchCooldownSeconds = level === GAME_CONFIG.powers.maxLevel
      ? GAME_CONFIG.powers.missileLevelFiveLaunchIntervalSeconds
      : GAME_CONFIG.powers.missileLaunchIntervalSeconds;
  } else {
    powers.missileReloadSeconds = GAME_CONFIG.powers.missileReloadSeconds;
  }
}

function updateSplitting(state: GameState, deltaSeconds: number): void {
  const level = getPowerLevel(state.powers, 'SPLITTING_BALL');
  if (level === 0 || state.balls.length === 0) return;
  state.powers.splitTimerSeconds += deltaSeconds;
  const cooldown = GAME_CONFIG.powers.splittingCooldownSecondsByLevel[level - 1];
  while (state.powers.splitTimerSeconds >= cooldown) {
    state.powers.splitTimerSeconds -= cooldown;
    let oldest = state.balls[0];
    for (const ball of state.balls) if (ball.id < oldest.id) oldest = ball;
    spawnSplitBalls(state, oldest, 1);
  }
}

function findElectricProc(state: GameState, id: number | undefined) {
  return id === undefined ? undefined : state.electricProcs.find((proc) => proc.id === id);
}

function finishElectricProjectile(state: GameState, procId: number | undefined): void {
  const procIndex = procId === undefined
    ? -1
    : state.electricProcs.findIndex((candidate) => candidate.id === procId);
  if (procIndex < 0) return;
  const proc = state.electricProcs[procIndex];
  proc.activeProjectileCount -= 1;
  if (proc.activeProjectileCount <= 0) state.electricProcs.splice(procIndex, 1);
}

function launchSecondaryElectric(
  state: GameState,
  procId: number | undefined,
  origin: { x: number; y: number; width: number; height: number },
): void {
  const proc = findElectricProc(state, procId);
  if (!proc) return;
  const candidates: BrickState[] = [];
  for (const column of state.brickField.columns) candidates.push(...column);
  const excludedTargetIds = new Set(proc.primaryTargetIds);
  for (const id of proc.secondaryTargetIds) excludedTargetIds.add(id);
  for (const id of proc.excludedTargetIds ?? []) excludedTargetIds.add(id);
  const target = rankElectricTargets(
    { source: 'ELECTRIC', ...origin },
    candidates,
    excludedTargetIds,
  )[0]?.brick;
  if (!target) return;
  proc.secondaryTargetIds.add(target.id);
  proc.activeProjectileCount += 1;
  const projectileId = state.nextProjectileId++;
  const sourceX = origin.x + origin.width / 2;
  const sourceY = origin.y + origin.height / 2;
  const targetX = target.x + target.width / 2;
  const targetY = target.y + target.height / 2;
  const initialDistance = Math.hypot(targetX - sourceX, targetY - sourceY);
  state.projectiles.push({
    id: projectileId,
    kind: 'ELECTRIC',
    x: sourceX,
    y: sourceY,
    velocity: {
      x: initialDistance > 0 ? (targetX - sourceX) / initialDistance * GAME_CONFIG.powers.projectileSpeed : 0,
      y: initialDistance > 0 ? (targetY - sourceY) / initialDistance * GAME_CONFIG.powers.projectileSpeed : 0,
    },
    damage: 1,
    targetBrickId: target.id,
    electricProcId: proc.id,
    electricGeneration: 'SECONDARY',
    electricFlightProgress: 0,
    electricInitialDistance: initialDistance,
    electricVisualAmplitude: createElectricVisualAmplitude(projectileId, target.id),
  });
}

function findSweptProjectileHit(
  state: GameState,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  radius: number,
): BrickState | undefined {
  const dx = endX - startX;
  const dy = endY - startY;
  let closest: BrickState | undefined;
  let closestTime = Number.POSITIVE_INFINITY;
  for (const column of state.brickField.columns) {
    for (const brick of column) {
      const minX = brick.x - radius;
      const maxX = brick.x + brick.width + radius;
      const minY = brick.y - radius;
      const maxY = brick.y + brick.height + radius;
      let entry = 0;
      let exit = 1;
      for (const [origin, movement, minimum, maximum] of [
        [startX, dx, minX, maxX],
        [startY, dy, minY, maxY],
      ] as const) {
        if (Math.abs(movement) <= Number.EPSILON) {
          if (origin < minimum || origin > maximum) { entry = 1; exit = 0; break; }
          continue;
        }
        const first = (minimum - origin) / movement;
        const second = (maximum - origin) / movement;
        entry = Math.max(entry, Math.min(first, second));
        exit = Math.min(exit, Math.max(first, second));
      }
      if (entry <= exit && entry < closestTime) {
        closest = brick;
        closestTime = entry;
      }
    }
  }
  return closest;
}

function acquireMissileTarget(state: GameState, projectileId: number, missileX: number): BrickState | undefined {
  const reserved = new Set<string>();
  for (const projectile of state.projectiles) {
    if (projectile.id !== projectileId && projectile.kind === 'MISSILE' && projectile.targetBrickId) {
      reserved.add(projectile.targetBrickId);
    }
  }
  return selectMissileTarget(missileX, state.brickField.columns.flat(), reserved);
}

function steerMissileToward(projectile: GameState['projectiles'][number], target: BrickState, deltaSeconds: number): void {
  const currentAngle = Math.atan2(projectile.velocity.y, projectile.velocity.x);
  const desiredAngle = Math.atan2(
    target.y + target.height / 2 - projectile.y,
    target.x + target.width / 2 - projectile.x,
  );
  let angleDifference = desiredAngle - currentAngle;
  while (angleDifference > Math.PI) angleDifference -= Math.PI * 2;
  while (angleDifference < -Math.PI) angleDifference += Math.PI * 2;
  const maximumTurn = GAME_CONFIG.powers.missileTurnRateRadiansPerSecond * deltaSeconds;
  const heading = currentAngle + Math.max(-maximumTurn, Math.min(maximumTurn, angleDifference));
  projectile.homingSpeed = Math.min(
    GAME_CONFIG.powers.missileHomingMaximumSpeed,
    (projectile.homingSpeed ?? GAME_CONFIG.powers.missileHomingInitialSpeed)
      + GAME_CONFIG.powers.missileHomingAcceleration * deltaSeconds,
  );
  projectile.velocity.x = Math.cos(heading) * projectile.homingSpeed;
  projectile.velocity.y = Math.sin(heading) * projectile.homingSpeed;
}

function updateMissile(state: GameState, projectile: GameState['projectiles'][number], deltaSeconds: number): boolean {
  if (projectile.missilePhase === 'DEPLOYING') {
    projectile.deploymentRemainingSeconds = Math.max(0, (projectile.deploymentRemainingSeconds ?? 0) - deltaSeconds);
    if (projectile.deploymentRemainingSeconds === 0) projectile.missilePhase = 'SEARCHING';
  }
  if (projectile.missilePhase !== 'DEPLOYING') {
    let target = projectile.targetBrickId ? findBrickById(state, projectile.targetBrickId) : undefined;
    if (!target) {
      projectile.targetBrickId = undefined;
      target = acquireMissileTarget(state, projectile.id, projectile.x);
      if (target) {
        projectile.targetBrickId = target.id;
        projectile.missilePhase = 'HOMING';
        if (!projectile.homingSpeed) projectile.homingSpeed = GAME_CONFIG.powers.missileHomingInitialSpeed;
      } else {
        projectile.missilePhase = 'SEARCHING';
        projectile.velocity.x = 0;
        projectile.velocity.y = -GAME_CONFIG.powers.missileDeploymentSpeed;
      }
    }
    if (target) steerMissileToward(projectile, target, deltaSeconds);
  }

  const previousX = projectile.x;
  const previousY = projectile.y;
  projectile.x += projectile.velocity.x * deltaSeconds;
  projectile.y += projectile.velocity.y * deltaSeconds;
  const hit = findSweptProjectileHit(
    state, previousX, previousY, projectile.x, projectile.y, GAME_CONFIG.powers.missileCollisionRadius,
  );
  if (hit) {
    applyRoutedBrickDamage(state, hit, projectile.damage, 'MISSILE');
    return true;
  }
  return projectile.y + GAME_CONFIG.powers.missileCollisionRadius < GAME_CONFIG.playfield.top;
}

function updateProjectiles(state: GameState, deltaSeconds: number): void {
  for (let index = state.projectiles.length - 1; index >= 0; index -= 1) {
    const projectile = state.projectiles[index];
    if (projectile.kind === 'MISSILE') {
      if (updateMissile(state, projectile, deltaSeconds)) state.projectiles.splice(index, 1);
      continue;
    }
    if (projectile.kind === 'ELECTRIC') {
      const target = projectile.targetBrickId ? findBrickById(state, projectile.targetBrickId) : undefined;
      if (!target) {
        finishElectricProjectile(state, projectile.electricProcId);
        state.projectiles.splice(index, 1);
        continue;
      }
      const targetX = target.x + target.width / 2;
      const targetY = target.y + target.height / 2;
      const dx = targetX - projectile.x;
      const dy = targetY - projectile.y;
      const distance = Math.hypot(dx, dy);
      const travel = GAME_CONFIG.powers.projectileSpeed * deltaSeconds;
      if (distance <= travel) {
        const impactOrigin = { x: target.x, y: target.y, width: target.width, height: target.height };
        applyRoutedBrickDamage(state, target, projectile.damage, 'ELECTRIC');
        if (projectile.electricGeneration === 'PRIMARY') {
          launchSecondaryElectric(state, projectile.electricProcId, impactOrigin);
        }
        finishElectricProjectile(state, projectile.electricProcId);
        state.projectiles.splice(index, 1);
      } else {
        projectile.velocity.x = dx / distance * GAME_CONFIG.powers.projectileSpeed;
        projectile.velocity.y = dy / distance * GAME_CONFIG.powers.projectileSpeed;
        projectile.x += projectile.velocity.x * deltaSeconds;
        projectile.y += projectile.velocity.y * deltaSeconds;
        projectile.electricFlightProgress = Math.min(
          1,
          (projectile.electricFlightProgress ?? 0)
            + travel / Math.max(1, projectile.electricInitialDistance ?? distance),
        );
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
      applyRoutedBrickDamage(state, hit, projectile.damage, 'GUN');
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

function updateIceShatterEffects(state: GameState, deltaSeconds: number): void {
  for (let index = state.iceShatterEffects.length - 1; index >= 0; index -= 1) {
    state.iceShatterEffects[index].remainingSeconds -= deltaSeconds;
    if (state.iceShatterEffects[index].remainingSeconds <= 0) state.iceShatterEffects.splice(index, 1);
  }
}

function overlapsBrick(ball: BallState, brick: BrickState): boolean {
  const closestX = Math.max(brick.x, Math.min(ball.x, brick.x + brick.width));
  const closestY = Math.max(brick.y, Math.min(ball.y, brick.y + brick.height));
  return (ball.x - closestX) ** 2 + (ball.y - closestY) ** 2 <= ball.radius ** 2;
}

type BrickCollisionFace = 'TOP' | 'BOTTOM' | 'LEFT' | 'RIGHT';
interface BrickCollisionResolution { face: BrickCollisionFace; penetrationFallback: boolean }

function resolveBrickCollisionFace(
  ball: BallState,
  brick: BrickState,
  previousX: number,
  previousY: number,
): BrickCollisionResolution {
  const left = brick.x - ball.radius;
  const right = brick.x + brick.width + ball.radius;
  const top = brick.y - ball.radius;
  const bottom = brick.y + brick.height + ball.radius;
  if (previousY <= top && ball.y > top) return { face: 'TOP', penetrationFallback: false };
  if (previousY >= bottom && ball.y < bottom) return { face: 'BOTTOM', penetrationFallback: false };
  if (previousX <= left && ball.x > left) return { face: 'LEFT', penetrationFallback: false };
  if (previousX >= right && ball.x < right) return { face: 'RIGHT', penetrationFallback: false };
  const horizontalPenetration = Math.min(Math.abs(ball.x - left), Math.abs(right - ball.x));
  const verticalPenetration = Math.min(Math.abs(ball.y - top), Math.abs(bottom - ball.y));
  if (horizontalPenetration < verticalPenetration) {
    return {
      face: Math.abs(ball.x - left) <= Math.abs(right - ball.x) ? 'LEFT' : 'RIGHT',
      penetrationFallback: true,
    };
  }
  return {
    face: Math.abs(ball.y - top) <= Math.abs(bottom - ball.y) ? 'TOP' : 'BOTTOM',
    penetrationFallback: true,
  };
}

function bounceFromBrickFace(ball: BallState, brick: BrickState, resolution: BrickCollisionResolution): void {
  const { face } = resolution;
  if (resolution.penetrationFallback) {
    if (face === 'LEFT' || face === 'RIGHT') ball.velocity.x *= -1;
    else ball.velocity.y *= -1;
    return;
  }
  if (face === 'TOP') {
    ball.y = brick.y - ball.radius;
    ball.velocity.y = -Math.abs(ball.velocity.y);
  } else if (face === 'BOTTOM') {
    ball.y = brick.y + brick.height + ball.radius;
    ball.velocity.y = Math.abs(ball.velocity.y);
  } else if (face === 'LEFT') {
    ball.x = brick.x - ball.radius;
    ball.velocity.x = -Math.abs(ball.velocity.x);
  } else {
    ball.x = brick.x + brick.width + ball.radius;
    ball.velocity.x = Math.abs(ball.velocity.x);
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
    const hitOffset = ball.x - paddle.x;
    const elevation = getPaddleBounceElevationDegrees(getPowerLevel(state.powers, 'PADDLE_SIZE'), Math.abs(hitOffset));
    setPaddleBounceDirection(ball, elevation, hitOffset);
    ball.pierceCharge = getPowerLevel(state.powers, 'PIERCING_BALL');
    recordBallPaddleContact(state.brickPressureAssist);
  }

  let collided = false;
  for (const column of state.brickField.columns) {
    for (const brick of column) {
      if (!overlapsBrick(ball, brick)) continue;
      const brickHp = brick.hp;
      const collisionResolution = resolveBrickCollisionFace(ball, brick, previousX, previousY);
      const canPierceThrough = collisionResolution.face !== 'TOP'
        && ball.pierceCharge >= brickHp
        && ball.pierceCharge > 0;
      const iceOwned = getPowerLevel(state.powers, 'ICE_BALL') > 0;
      if (isFrozenBrick(brick)) {
        if (isFreezeSafetyContact(brick, ball.id)) {
          collided = true;
          break;
        }
        const shatterOrigin = { id: brick.id, x: brick.x, y: brick.y, width: brick.width, height: brick.height };
        if (applyRoutedBrickDamage(state, brick, 1, 'BALL').frozenShattered) {
          triggerIceBallElementalProc(state, shatterOrigin, 'DIRECT_BALL_ICE_SHATTER');
        }
        if (canPierceThrough) ball.pierceCharge -= brickHp;
        else {
          ball.pierceCharge = 0;
          bounceFromBrickFace(ball, brick, collisionResolution);
          ball.pierceCharge = getPowerLevel(state.powers, 'PIERCING_BALL');
        }
      } else if (isPendingFreezeBrick(brick)) {
        if (isPendingFreezeSafetyContact(brick, ball.id)) {
          collided = true;
          break;
        }
        if (canPierceThrough) ball.pierceCharge -= brickHp;
        else {
          ball.pierceCharge = 0;
          bounceFromBrickFace(ball, brick, collisionResolution);
          ball.pierceCharge = getPowerLevel(state.powers, 'PIERCING_BALL');
        }
      } else if (brick.kind === 'BOSS') {
        const damage = 1 + ball.pierceCharge;
        ball.pierceCharge = 0;
        bounceFromBrickFace(ball, brick, collisionResolution);
        if (iceOwned && damage >= brick.hp) {
          recordBossDamage(brick);
          if (freezeBossAtZero(brick, ball.id)) {
            triggerIceBallElementalProc(state, brick, 'INITIAL_ICE_FREEZE');
          }
        } else {
          handleBallKill(state, applyRoutedBrickDamage(state, brick, damage, 'BALL').destruction);
        }
        ball.pierceCharge = getPowerLevel(state.powers, 'PIERCING_BALL');
      } else if (brick.armored && brick.hp > 1) {
        if (canPierceThrough) {
          ball.pierceCharge -= brickHp;
          handleBallKill(state, applyRoutedBrickDamage(state, brick, brickHp, 'BALL').destruction);
        } else {
          const pierceDamage = Math.min(ball.pierceCharge, Math.max(0, brickHp - 1));
          ball.pierceCharge = 0;
          bounceFromBrickFace(ball, brick, collisionResolution);
          handleBallKill(state, applyRoutedBrickDamage(state, brick, 1 + pierceDamage, 'BALL').destruction);
          ball.pierceCharge = getPowerLevel(state.powers, 'PIERCING_BALL');
        }
      } else if (iceOwned) {
        if (freezeBrick(brick, ball.id)) triggerIceBallElementalProc(state, brick, 'INITIAL_ICE_FREEZE');
        if (canPierceThrough) ball.pierceCharge -= brickHp;
        else {
          ball.pierceCharge = 0;
          bounceFromBrickFace(ball, brick, collisionResolution);
          ball.pierceCharge = getPowerLevel(state.powers, 'PIERCING_BALL');
        }
      } else if (canPierceThrough) {
        ball.pierceCharge -= brickHp;
        handleBallKill(state, applyRoutedBrickDamage(state, brick, brickHp, 'BALL').destruction);
      } else {
        const pierceDamage = Math.min(ball.pierceCharge, Math.max(0, brickHp - 1));
        ball.pierceCharge = 0;
        bounceFromBrickFace(ball, brick, collisionResolution);
        handleBallKill(state, applyRoutedBrickDamage(state, brick, 1 + pierceDamage, 'BALL').destruction);
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
  state.survivalTimeSeconds = Math.min(
    GAME_CONFIG.survival.winTimeSeconds,
    state.survivalTimeSeconds + Math.max(0, worldDeltaSeconds),
  );
  updateBossDirector(state);
  updateBossPresentation(state, playerDeltaSeconds);
  if (state.survivalTimeSeconds >= GAME_CONFIG.survival.winTimeSeconds) {
    return SimulationStepOutcome.Win;
  }
  updatePaddle(state, input, playerDeltaSeconds);
  advanceBrickPressureAssist(state.brickPressureAssist, worldDeltaSeconds);
  const virtualDifficultyLevel = getVirtualDifficultyLevel(state.survivalTimeSeconds);
  const effectiveBrickSpeedLevel = getEffectiveBrickSpeedLevel(
    virtualDifficultyLevel,
    state.brickPressureAssist,
  );
  if (advanceBrickField(
    state.brickField,
    worldDeltaSeconds,
    getBrickDensityDifficultyLevel(state.survivalTimeSeconds),
    effectiveBrickSpeedLevel,
    {
      onFrozenBrickContact: (contact) => handleFrozenBrickContact(state, contact),
      onPendingFreezeReady: (brick) => commitPendingFreeze(brick),
      queuedBossStartColumn: state.bossDirector.bossQueued
        ? state.bossDirector.queuedStartColumn
        : undefined,
      onBossSpawned: (boss) => recordBossSpawned(state, boss),
      bossPreGapGenerated: state.bossDirector.bossPreGapGenerated,
      bossPreGapRowId: state.bossDirector.bossPreGapRowId,
      onBossPreGapGenerated: (rowId) => {
        state.bossDirector.bossPreGapGenerated = true;
        state.bossDirector.bossPreGapRowId = rowId;
      },
    },
  )) {
    return SimulationStepOutcome.BrickOverflow;
  }
  updateGun(state, worldDeltaSeconds);
  updateMissileFiring(state, worldDeltaSeconds);
  updateSplitting(state, worldDeltaSeconds);
  updateProjectiles(state, worldDeltaSeconds);
  updateFireEffects(state, worldDeltaSeconds);
  updateWindEffects(state, worldDeltaSeconds);
  updateIceShatterEffects(state, worldDeltaSeconds);
  const targetBallSpeed = getBallTargetSpeed(
    state.balls.length,
    state.brickPressureAssist.trappedBallSpeedBoost,
  );
  for (let index = state.balls.length - 1; index >= 0; index -= 1) {
    updateBallSpeedAssist(state.balls[index], targetBallSpeed, worldDeltaSeconds);
    if (updateBall(state, state.balls[index], worldDeltaSeconds)) state.balls.splice(index, 1);
  }
  advanceFrozenBrickSafety(state, worldDeltaSeconds);
  return state.balls.length === 0 ? SimulationStepOutcome.FinalBallLost : SimulationStepOutcome.None;
}
