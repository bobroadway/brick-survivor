import { spawnFinalBoss, type BrickState } from './brickField';
import { GAME_CONFIG } from './config';
import type { GameState } from './gameState';
import { getBrickSpeedProgress } from './survivalDifficulty';

export function isBossBrick(brick: Pick<BrickState, 'kind'>): boolean {
  return brick.kind === 'BOSS';
}

function nextBossRandom(state: GameState): number {
  const director = state.bossDirector;
  director.lotteryGeneratorState = (Math.imul(director.lotteryGeneratorState, 1664525) + 1013904223) >>> 0;
  return director.lotteryGeneratorState / 0x100000000;
}

export function getFinalBossTimeSeconds(): number {
  return GAME_CONFIG.survival.winTimeSeconds - GAME_CONFIG.boss.finalBossLeadSeconds;
}

function chooseBossColumn(state: GameState): number {
  const minimum = GAME_CONFIG.boss.edgeExcludedColumns;
  const maximum = GAME_CONFIG.bricks.columns
    - GAME_CONFIG.boss.edgeExcludedColumns - GAME_CONFIG.boss.widthColumns;
  return minimum + Math.floor(nextBossRandom(state) * (maximum - minimum + 1));
}

function queueBoss(state: GameState): void {
  const director = state.bossDirector;
  director.queuedStartColumn = chooseBossColumn(state);
  director.bossQueued = true;
  director.bossPreGapGenerated = false;
  director.bossPreGapRowId = undefined;
}

export function updateBossDirector(state: GameState): void {
  const director = state.bossDirector;
  const finalBossTime = getFinalBossTimeSeconds();
  const preparationTime = finalBossTime - GAME_CONFIG.boss.finalBossLeadSeconds;
  if (director.finalBossStartColumn === undefined && state.survivalTimeSeconds >= preparationTime) {
    director.finalBossStartColumn = chooseBossColumn(state);
  }
  if (!director.finalBossTriggered && state.survivalTimeSeconds >= finalBossTime) {
    director.finalBossTriggered = true;
    const duration = Math.max(GAME_CONFIG.fixedStepSeconds,
      GAME_CONFIG.survival.winTimeSeconds - state.survivalTimeSeconds);
    spawnFinalBoss(state.brickField, director.finalBossStartColumn ?? chooseBossColumn(state),
      duration, getBrickSpeedProgress(state.survivalTimeSeconds));
  }
}

/** One deterministic lottery roll for one destroyed ordinary brick. */
export function recordOrdinaryBrickDestruction(state: GameState): void {
  const director = state.bossDirector;
  if (state.survivalTimeSeconds < GAME_CONFIG.boss.firstLotterySeconds
    || state.survivalTimeSeconds >= getFinalBossTimeSeconds()
    || state.survivalTimeSeconds < director.ordinaryLotteryCooldownUntilSeconds
    || director.bossQueued || director.activeNormalBossId) return;
  if (nextBossRandom(state) >= GAME_CONFIG.boss.killLotteryChance) return;
  queueBoss(state);
}

export function recordBossSpawned(state: GameState, boss: BrickState): void {
  if (boss.isFinalBoss) return;
  state.bossDirector.activeNormalBossId = boss.id;
  state.bossDirector.bossQueued = false;
  state.bossDirector.bossPreGapGenerated = false;
  state.bossDirector.bossPreGapRowId = undefined;
  state.bossDirector.queuedStartColumn = undefined;
}

export function recordBossDamage(brick: BrickState): void {
  if (!isBossBrick(brick)) return;
  brick.bossHitJoltRemainingSeconds = GAME_CONFIG.boss.hitJoltSeconds;
}

export function recordBossRemoved(state: GameState, boss: BrickState): void {
  if (!boss.isFinalBoss && state.bossDirector.activeNormalBossId === boss.id) {
    state.bossDirector.activeNormalBossId = undefined;
    state.bossDirector.ordinaryLotteryCooldownUntilSeconds = state.survivalTimeSeconds
      + GAME_CONFIG.boss.lotteryRearmSeconds;
  }
  state.bossDeathEffects.push({
    x: boss.x, y: boss.y, width: boss.width, height: boss.height,
    displayHp: boss.displayHp ?? boss.hp,
    displayHpStepTimerSeconds: boss.displayHpStepTimerSeconds ?? 0,
    frozen: boss.iceState === 'FROZEN',
    remainingSeconds: GAME_CONFIG.boss.deathEffectSeconds,
  });
}

/** Clears authoritative Boss ownership without kill rewards or death presentation. */
export function recordBossEscaped(state: GameState, boss: BrickState): void {
  if (!boss.isFinalBoss && state.bossDirector.activeNormalBossId === boss.id) {
    state.bossDirector.activeNormalBossId = undefined;
    state.bossDirector.ordinaryLotteryCooldownUntilSeconds = state.survivalTimeSeconds
      + GAME_CONFIG.boss.lotteryRearmSeconds;
  }
}

export function updateBossPresentation(state: GameState, unscaledDeltaSeconds: number): void {
  for (const column of state.brickField.columns) {
    for (const brick of column) {
      if (!isBossBrick(brick)) continue;
      brick.bossHitJoltRemainingSeconds = Math.max(0,
        (brick.bossHitJoltRemainingSeconds ?? 0) - unscaledDeltaSeconds);
      let timer = (brick.displayHpStepTimerSeconds ?? 0) + unscaledDeltaSeconds;
      while ((brick.displayHp ?? brick.hp) !== brick.hp
        && timer >= GAME_CONFIG.boss.hpDisplayStepSeconds) {
        timer -= GAME_CONFIG.boss.hpDisplayStepSeconds;
        const displayed = brick.displayHp ?? brick.hp;
        brick.displayHp = displayed + Math.sign(brick.hp - displayed);
      }
      brick.displayHpStepTimerSeconds = timer;
    }
  }
  for (let index = state.bossDeathEffects.length - 1; index >= 0; index -= 1) {
    const effect = state.bossDeathEffects[index];
    const displayWasAlreadyZero = effect.displayHp === 0;
    effect.remainingSeconds -= unscaledDeltaSeconds;
    effect.displayHpStepTimerSeconds += unscaledDeltaSeconds;
    while (effect.displayHp > 0
      && effect.displayHpStepTimerSeconds >= GAME_CONFIG.boss.hpDisplayStepSeconds) {
      effect.displayHpStepTimerSeconds -= GAME_CONFIG.boss.hpDisplayStepSeconds;
      effect.displayHp -= 1;
    }
    if (effect.remainingSeconds <= 0 && displayWasAlreadyZero) state.bossDeathEffects.splice(index, 1);
  }
}
