export enum GamePhase {
  Ready = 'READY',
  Running = 'RUNNING',
  Paused = 'PAUSED',
  LifeLost = 'LIFE_LOST',
  GameOver = 'GAME_OVER',
  // Future suspended phases such as LEVEL_UP can be added here.
}

export interface SessionState {
  phase: GamePhase;
  phaseTimerSeconds: number;
}

export function createSessionState(): SessionState {
  return { phase: GamePhase.Ready, phaseTimerSeconds: 0 };
}

export function isSimulationRunning(session: SessionState): boolean {
  return session.phase === GamePhase.Running;
}

export function pauseManually(session: SessionState): void {
  if (session.phase === GamePhase.Running) session.phase = GamePhase.Paused;
}

export function resumeManualPause(session: SessionState): void {
  if (session.phase === GamePhase.Paused) session.phase = GamePhase.Running;
}

export function launchReadyBall(session: SessionState): void {
  if (session.phase === GamePhase.Ready) session.phase = GamePhase.Running;
}

export function beginLifeLost(session: SessionState): void {
  session.phase = GamePhase.LifeLost;
  session.phaseTimerSeconds = 0;
}

export function continueAfterLifeLost(session: SessionState): boolean {
  if (session.phase !== GamePhase.LifeLost) return false;
  session.phase = GamePhase.Running;
  return true;
}

export function enterGameOver(session: SessionState): void {
  session.phase = GamePhase.GameOver;
}
