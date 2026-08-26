import Phaser from 'phaser';
import { createInitialGameState } from '../../simulation/gameState';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('BootScene');
  }

  create(): void {
    const state = createInitialGameState();

    this.add
      .text(640, 360, state.status, {
        color: '#e7ecf3',
        fontFamily: 'Arial, sans-serif',
        fontSize: '28px',
      })
      .setOrigin(0.5);
  }
}
