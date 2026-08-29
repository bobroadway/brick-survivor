import type { BrickState } from './brickField';
import { GAME_CONFIG } from './config';
import type { GameState } from './gameState';

export function isBossBrick(brick: Pick<BrickState, 'kind'>): boolean {
  return brick.kind === 'BOSS';
}

function nextBossRandom(state: GameState): number {
  const director = state.bossDirector;
  director.lotteryGeneratorState = (Math.imul(director.lotteryGeneratorState, 1664525) + 1013904223) >>> 0;
  return director.lotteryGeneratorState / 0x100000000;
}

export function updateBossDirector(state: GameState): void {
  const director = state.bossDirector;
  while (director.nextCheckpointIndex < GAME_CONFIG.boss.checkpointSeconds.length
    && state.survivalTimeSeconds >= GAME_CONFIG.boss.checkpointSeconds[director.nextCheckpointIndex]) {
    director.armedOpportunities += 1;
    director.nextCheckpointIndex += 1;
  }
}

/** One deterministic lottery roll for one destroyed ordinary brick. */
export function recordOrdinaryBrickDestruction(state: GameState): void {
  const director = state.bossDirector;
  if (director.armedOpportunities <= 0 || director.bossQueued || director.activeBossId) return;
  if (nextBossRandom(state) >= GAME_CONFIG.boss.killLotteryChance) return;
  const minimum = GAME_CONFIG.boss.edgeExcludedColumns;
  const maximum = GAME_CONFIG.bricks.columns
    - GAME_CONFIG.boss.edgeExcludedColumns - GAME_CONFIG.boss.widthColumns;
  director.queuedStartColumn = minimum + Math.floor(nextBossRandom(state) * (maximum - minimum + 1));
  director.bossQueued = true;
  director.bossPreGapGenerated = false;
  director.bossPreGapRowId = undefined;
  director.armedOpportunities -= 1;
}

export function recordBossSpawned(state: GameState, boss: BrickState): void {
  state.bossDirector.activeBossId = boss.id;
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
  state.bossDirector.activeBossId = undefined;
  state.bossDeathEffects.push({
    x: boss.x, y: boss.y, width: boss.width, height: boss.height,
    displayHp: boss.displayHp ?? boss.hp,
    displayHpStepTimerSeconds: boss.displayHpStepTimerSeconds ?? 0,
    frozen: boss.iceState === 'FROZEN',
    remainingSeconds: GAME_CONFIG.boss.deathEffectSeconds,
  });
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
    effect.remainingSeconds -= unscaledDeltaSeconds;
    effect.displayHpStepTimerSeconds += unscaledDeltaSeconds;
    while (effect.displayHp > 0
      && effect.displayHpStepTimerSeconds >= GAME_CONFIG.boss.hpDisplayStepSeconds) {
      effect.displayHpStepTimerSeconds -= GAME_CONFIG.boss.hpDisplayStepSeconds;
      effect.displayHp -= 1;
    }
    if (effect.remainingSeconds <= 0) state.bossDeathEffects.splice(index, 1);
  }
}
