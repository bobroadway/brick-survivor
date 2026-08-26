import Phaser from 'phaser';
import type { SimulationInput } from '../../simulation/simulation';

const PAUSE_CODES = new Set(['Space', 'Escape', 'Enter', 'NumpadEnter']);

export class GameInput {
  private readonly cursors: Phaser.Types.Input.Keyboard.CursorKeys;
  private readonly aKey: Phaser.Input.Keyboard.Key;
  private readonly dKey: Phaser.Input.Keyboard.Key;
  private pointerTargetX: number | null = null;
  private pointerMoved = false;

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (!event.repeat && PAUSE_CODES.has(event.code)) this.onTogglePause();
    if (PAUSE_CODES.has(event.code) || event.code === 'ArrowLeft' || event.code === 'ArrowRight') {
      event.preventDefault();
    }
  };

  private readonly handleWindowPointerDown = (): void => this.onPointerPause();
  private readonly handleWindowPointerMove = (event: PointerEvent): void => {
    const canvasBounds = this.scene.game.canvas.getBoundingClientRect();
    if (canvasBounds.width === 0) return;
    this.pointerTargetX = (event.clientX - canvasBounds.left) * (this.scene.scale.gameSize.width / canvasBounds.width);
    this.pointerMoved = true;
  };

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly onTogglePause: () => void,
    private readonly onPointerPause: () => void,
  ) {
    if (!scene.input.keyboard) throw new Error('Keyboard input is unavailable');
    this.cursors = scene.input.keyboard.createCursorKeys();
    this.aKey = scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A);
    this.dKey = scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D);
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('pointerdown', this.handleWindowPointerDown);
    window.addEventListener('pointermove', this.handleWindowPointerMove);
  }

  readSimulationInput(): SimulationInput {
    const leftHeld = this.cursors.left.isDown || this.aKey.isDown;
    const rightHeld = this.cursors.right.isDown || this.dKey.isDown;
    const horizontal: -1 | 0 | 1 = leftHeld === rightHeld ? 0 : leftHeld ? -1 : 1;
    const paddleTargetX = horizontal === 0 && this.pointerMoved ? this.pointerTargetX : null;
    if (paddleTargetX !== null) this.pointerMoved = false;
    return { horizontal, paddleTargetX };
  }

  destroy(): void {
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('pointerdown', this.handleWindowPointerDown);
    window.removeEventListener('pointermove', this.handleWindowPointerMove);
  }
}
