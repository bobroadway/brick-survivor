export enum GamePhase {
  Ready = 'READY',
  Running = 'RUNNING',
  Paused = 'PAUSED',
  LifeLost = 'LIFE_LOST',
  GameOver = 'GAME_OVER',
  LevelUpSlowdown = 'LEVEL_UP_SLOWDOWN',
  LevelUp = 'LEVEL_UP',
  LevelUpSpeedup = 'LEVEL_UP_SPEEDUP',
  Build = 'BUILD',
}

type GameplayPhase = GamePhase.Running | GamePhase.LevelUpSlowdown | GamePhase.LevelUpSpeedup;

export interface SessionState {
  phase: GamePhase;
  phaseTimerSeconds: number;
  pausedGameplayPhase: GameplayPhase | null;
}

export function createSessionState(): SessionState {
  return { phase: GamePhase.Ready, phaseTimerSeconds: 0, pausedGameplayPhase: null };
}

export function isSimulationRunning(session: SessionState): boolean {
  return session.phase === GamePhase.Running
    || session.phase === GamePhase.LevelUpSlowdown
    || session.phase === GamePhase.LevelUpSpeedup;
}

export function pauseManually(session: SessionState): void {
  if (!isSimulationRunning(session)) return;
  session.pausedGameplayPhase = session.phase as GameplayPhase;
  session.phase = GamePhase.Paused;
}

export function resumeManualPause(session: SessionState): void {
  if (session.phase !== GamePhase.Paused) return;
  session.phase = session.pausedGameplayPhase ?? GamePhase.Running;
  session.pausedGameplayPhase = null;
}

export function launchReadyBall(session: SessionState): void {
  if (session.phase === GamePhase.Ready) session.phase = GamePhase.Running;
}

export function beginLifeLost(session: SessionState): void {
  session.phase = GamePhase.LifeLost;
  session.phaseTimerSeconds = 0;
  session.pausedGameplayPhase = null;
}

export function continueAfterLifeLost(session: SessionState): boolean {
  if (session.phase !== GamePhase.LifeLost) return false;
  session.phase = GamePhase.Running;
  return true;
}

export function enterGameOver(session: SessionState): void {
  session.phase = GamePhase.GameOver;
  session.phaseTimerSeconds = 0;
  session.pausedGameplayPhase = null;
}

export function beginLevelUpSlowdown(session: SessionState): void {
  if (session.phase !== GamePhase.Running) return;
  session.phase = GamePhase.LevelUpSlowdown;
  session.phaseTimerSeconds = 0;
}

export function enterLevelUp(session: SessionState): void {
  if (session.phase !== GamePhase.LevelUpSlowdown) return;
  session.phase = GamePhase.LevelUp;
  session.phaseTimerSeconds = 0;
}

export function beginLevelUpSpeedup(session: SessionState): void {
  if (session.phase !== GamePhase.LevelUp) return;
  session.phase = GamePhase.LevelUpSpeedup;
  session.phaseTimerSeconds = 0;
}

export function finishLevelUpSpeedup(session: SessionState): void {
  if (session.phase !== GamePhase.LevelUpSpeedup) return;
  session.phase = GamePhase.Running;
  session.phaseTimerSeconds = 0;
}

export function enterBuild(session: SessionState): void {
  if (session.phase === GamePhase.Running) session.phase = GamePhase.Build;
}

export function leaveBuild(session: SessionState): void {
  if (session.phase === GamePhase.Build) session.phase = GamePhase.Running;
}

export function buildToPause(session: SessionState): void {
  if (session.phase === GamePhase.Build) session.phase = GamePhase.Paused;
}
