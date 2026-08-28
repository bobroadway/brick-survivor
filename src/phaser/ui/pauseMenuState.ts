export type MenuMode = 'START' | 'PAUSE' | 'GAME_OVER' | 'WIN';
export type MenuFocus = 'START' | 'RESUME' | 'WINDOWED' | 'FULLSCREEN' | 'RESTART' | 'QUIT';
export type ConfirmationKind = 'RESTART' | 'QUIT';
export type ConfirmationFocus = 'CONFIRM' | 'CANCEL';

export interface PauseMenuState {
  focus: MenuFocus;
  confirmation: ConfirmationKind | null;
  confirmationFocus: ConfirmationFocus;
}

const ROWS_BY_MODE: Record<MenuMode, MenuFocus[][]> = {
  START: [['START'], ['WINDOWED', 'FULLSCREEN'], ['QUIT']],
  PAUSE: [['RESUME'], ['WINDOWED', 'FULLSCREEN'], ['RESTART'], ['QUIT']],
  GAME_OVER: [['WINDOWED', 'FULLSCREEN'], ['RESTART'], ['QUIT']],
  WIN: [['WINDOWED', 'FULLSCREEN'], ['RESTART'], ['QUIT']],
};

const DEFAULT_FOCUS: Record<MenuMode, MenuFocus> = {
  START: 'START', PAUSE: 'RESUME', GAME_OVER: 'RESTART', WIN: 'RESTART',
};

export function createPauseMenuState(): PauseMenuState {
  return { focus: 'START', confirmation: null, confirmationFocus: 'CANCEL' };
}

export function getMenuTitle(mode: MenuMode): string {
  return mode === 'GAME_OVER' ? 'YOU DIED' : 'BRICK SURVIVOR';
}

export function resetPauseMenuState(state: PauseMenuState, mode: MenuMode): void {
  state.focus = DEFAULT_FOCUS[mode];
  state.confirmation = null;
  state.confirmationFocus = 'CANCEL';
}

export function isFocusAvailable(mode: MenuMode, focus: MenuFocus): boolean {
  return ROWS_BY_MODE[mode].some((row) => row.includes(focus));
}

export function movePauseMenuVertical(state: PauseMenuState, mode: MenuMode, direction: -1 | 1): void {
  if (state.confirmation) {
    state.confirmationFocus = state.confirmationFocus === 'CONFIRM' ? 'CANCEL' : 'CONFIRM';
    return;
  }
  const rows = ROWS_BY_MODE[mode];
  const rowIndex = rows.findIndex((row) => row.includes(state.focus));
  const nextRow = rows[(rowIndex + direction + rows.length) % rows.length];
  state.focus = nextRow.includes(state.focus) ? state.focus : nextRow[0];
}

export function movePauseMenuHorizontal(state: PauseMenuState, direction: -1 | 1): void {
  if (state.confirmation) {
    state.confirmationFocus = direction < 0 ? 'CONFIRM' : 'CANCEL';
  } else if (state.focus === 'WINDOWED' || state.focus === 'FULLSCREEN') {
    state.focus = state.focus === 'WINDOWED' ? 'FULLSCREEN' : 'WINDOWED';
  }
}
