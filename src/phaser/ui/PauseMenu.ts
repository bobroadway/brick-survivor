import Phaser from 'phaser';
import { GAME_CONFIG } from '../../simulation/config';
import { RenderQualityManager } from '../rendering/RenderQualityManager';
import {
  createPauseMenuState,
  getMenuTitle,
  isFocusAvailable,
  movePauseMenuHorizontal,
  movePauseMenuVertical,
  resetPauseMenuState,
  type ConfirmationKind,
  type MenuFocus,
  type MenuMode,
  type PauseMenuState,
} from './pauseMenuState';

interface ButtonVisual {
  background: Phaser.GameObjects.Rectangle;
  label: Phaser.GameObjects.Text;
}

const MENU_LAYOUT = {
  title: { x: 640, y: 122 },
  primary: { x: 640, y: 215, width: 270 },
  displayLabel: { x: 640, y: 288 },
  windowed: { x: 500, y: 342, width: 245 },
  fullscreen: { x: 780, y: 342, width: 245 },
  restart: { x: 640, y: 435, width: 270 },
  quit: { x: 640, y: 515, width: 270 },
} as const;

export interface PauseMenuActions {
  start(): void;
  resume(): void;
  setDisplayMode(mode: DisplayMode): void;
  restart(): void;
  quit(): void;
}

export class PauseMenu {
  private readonly state: PauseMenuState = createPauseMenuState();
  private readonly main: Phaser.GameObjects.Container;
  private readonly modal: Phaser.GameObjects.Container;
  private readonly buttons = new Map<MenuFocus, ButtonVisual>();
  private readonly modalButtons = new Map<'CONFIRM' | 'CANCEL', ButtonVisual>();
  private readonly modalQuestion: Phaser.GameObjects.Text;
  private readonly title: Phaser.GameObjects.Text;
  private displayMode: DisplayMode = 'WINDOWED';
  private mode: MenuMode = 'START';

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly renderQuality: RenderQualityManager,
    private readonly actions: PauseMenuActions,
  ) {
    this.main = this.scene.add.container(0, 0).setDepth(21).setVisible(false);
    this.modal = this.scene.add.container(0, 0).setDepth(22).setVisible(false);
    this.title = this.renderQuality.addText(MENU_LAYOUT.title.x, MENU_LAYOUT.title.y, '', {
      color: '#f0eee6', fontFamily: 'Arial, sans-serif', fontSize: '52px', fontStyle: 'bold',
    }).setOrigin(0.5);
    this.main.add(this.title);
    this.createMainButton('START', MENU_LAYOUT.primary.x, MENU_LAYOUT.primary.y, MENU_LAYOUT.primary.width);
    this.createMainButton('RESUME', MENU_LAYOUT.primary.x, MENU_LAYOUT.primary.y, MENU_LAYOUT.primary.width);
    this.main.add(this.renderQuality.addText(MENU_LAYOUT.displayLabel.x, MENU_LAYOUT.displayLabel.y, 'DISPLAY MODE', {
      color: '#aeb8c8', fontFamily: 'Arial, sans-serif', fontSize: '18px',
    }).setOrigin(0.5));
    this.createMainButton('WINDOWED', MENU_LAYOUT.windowed.x, MENU_LAYOUT.windowed.y, MENU_LAYOUT.windowed.width);
    this.createMainButton('FULLSCREEN', MENU_LAYOUT.fullscreen.x, MENU_LAYOUT.fullscreen.y, MENU_LAYOUT.fullscreen.width);
    this.createMainButton('RESTART', MENU_LAYOUT.restart.x, MENU_LAYOUT.restart.y, MENU_LAYOUT.restart.width);
    this.createMainButton('QUIT', MENU_LAYOUT.quit.x, MENU_LAYOUT.quit.y, MENU_LAYOUT.quit.width);

    const blocker = this.scene.add.rectangle(0, 0, GAME_CONFIG.width, GAME_CONFIG.height, 0x06080c, 0.72)
      .setOrigin(0)
      .setInteractive();
    blocker.on(Phaser.Input.Events.POINTER_DOWN, (_pointer: Phaser.Input.Pointer, _x: number, _y: number, event: Phaser.Types.Input.EventData) => event.stopPropagation());
    this.modal.add(blocker);
    this.modal.add(this.scene.add.rectangle(640, 360, 600, 280, 0x171d28, 1).setStrokeStyle(2, 0x65758c));
    this.modalQuestion = this.renderQuality.addText(640, 304, '', {
      color: '#f0eee6', fontFamily: 'Arial, sans-serif', fontSize: '28px', fontStyle: 'bold',
    }).setOrigin(0.5);
    this.modal.add(this.modalQuestion);
    this.createModalButton('CONFIRM', 505, 410, 220);
    this.createModalButton('CANCEL', 775, 410, 220);
  }

  private createMainButton(id: MenuFocus, x: number, y: number, width: number): void {
    const visual = this.createButton(id, x, y, width, () => {
      this.state.focus = id;
      this.activateFocused();
    });
    this.buttons.set(id, visual);
    this.main.add([visual.background, visual.label]);
  }

  private createModalButton(id: 'CONFIRM' | 'CANCEL', x: number, y: number, width: number): void {
    const visual = this.createButton(id, x, y, width, () => {
      this.state.confirmationFocus = id;
      this.activateFocused();
    });
    this.modalButtons.set(id, visual);
    this.modal.add([visual.background, visual.label]);
  }

  private createButton(id: string, x: number, y: number, width: number, activate: () => void): ButtonVisual {
    const background = this.scene.add.rectangle(x, y, width, 48, 0x273243, 0.96)
      .setStrokeStyle(2, 0x53637a)
      .setInteractive({ useHandCursor: true });
    const label = this.renderQuality.addText(x, y, id, {
      color: '#e7ecf3', fontFamily: 'Arial, sans-serif', fontSize: '19px', fontStyle: 'bold',
    }).setOrigin(0.5);
    background.on(Phaser.Input.Events.POINTER_OVER, () => {
      if (this.state.confirmation) this.state.confirmationFocus = id as 'CONFIRM' | 'CANCEL';
      else this.state.focus = id as MenuFocus;
      this.refresh();
    });
    background.on(Phaser.Input.Events.POINTER_DOWN, activate);
    return { background, label };
  }

  show(mode: MenuMode): void {
    this.mode = mode;
    resetPauseMenuState(this.state, mode);
    this.title.setText(getMenuTitle(mode));
    this.main.setVisible(true);
    this.modal.setVisible(false);
    this.refresh();
  }

  hide(): void {
    this.main.setVisible(false);
    this.modal.setVisible(false);
  }

  setDisplayMode(mode: DisplayMode): void {
    this.displayMode = mode;
    this.refresh();
  }

  hasConfirmation(): boolean {
    return this.state.confirmation !== null;
  }

  cancelConfirmation(): void {
    if (!this.state.confirmation) return;
    this.state.confirmation = null;
    this.main.setVisible(true);
    this.modal.setVisible(false);
    this.refresh();
  }

  moveVertical(direction: -1 | 1): void {
    movePauseMenuVertical(this.state, this.mode, direction);
    this.refresh();
  }

  moveHorizontal(direction: -1 | 1): void {
    movePauseMenuHorizontal(this.state, direction);
    this.refresh();
  }

  activateFocused(): void {
    if (this.state.confirmation) {
      if (this.state.confirmationFocus === 'CANCEL') {
        this.cancelConfirmation();
      } else if (this.state.confirmation === 'RESTART') {
        this.actions.restart();
      } else {
        this.actions.quit();
      }
      return;
    }
    switch (this.state.focus) {
      case 'START': this.actions.start(); break;
      case 'RESUME': this.actions.resume(); break;
      case 'WINDOWED': this.actions.setDisplayMode('WINDOWED'); break;
      case 'FULLSCREEN': this.actions.setDisplayMode('FULLSCREEN'); break;
      case 'RESTART': this.openConfirmation('RESTART'); break;
      case 'QUIT': this.openConfirmation('QUIT'); break;
    }
  }

  private openConfirmation(kind: ConfirmationKind): void {
    this.state.confirmation = kind;
    this.state.confirmationFocus = kind === 'RESTART' ? 'CONFIRM' : 'CANCEL';
    this.modalQuestion.setText(kind === 'RESTART' ? 'Restart game?' : 'Quit game?');
    this.modalButtons.get('CONFIRM')?.label.setText(kind);
    this.main.setVisible(false);
    this.modal.setVisible(true);
    this.refresh();
  }

  private refresh(): void {
    for (const [id, visual] of this.buttons) {
      const available = isFocusAvailable(this.mode, id);
      visual.background.setVisible(available);
      visual.label.setVisible(available);
      if (available) visual.background.setInteractive({ useHandCursor: true });
      else visual.background.disableInteractive();
      if (!available) continue;
      const selectedMode = id === this.displayMode;
      const focused = !this.state.confirmation && id === this.state.focus;
      visual.background.setFillStyle(selectedMode ? 0x356675 : 0x273243, 0.96);
      visual.background.setStrokeStyle(focused ? 3 : 2, focused ? 0xe4c46c : selectedMode ? 0x78c6d0 : 0x53637a);
    }
    for (const [id, visual] of this.modalButtons) {
      const focused = this.state.confirmation !== null && id === this.state.confirmationFocus;
      visual.background.setStrokeStyle(focused ? 3 : 2, focused ? 0xe4c46c : 0x53637a);
    }
  }
}
