import Phaser from 'phaser';
import type { GameState } from '../../simulation/gameState';
import { getPowerDefinition, getPowerDescription, getPowerLevel } from '../../simulation/powers';
import { RenderQualityManager } from '../rendering/RenderQualityManager';

export class BuildOverlay {
  private readonly container: Phaser.GameObjects.Container;
  private readonly entries: Phaser.GameObjects.Text[] = [];
  private readonly emptyText: Phaser.GameObjects.Text;

  constructor(scene: Phaser.Scene, renderQuality: RenderQualityManager) {
    this.container = scene.add.container(0, 0).setDepth(30).setVisible(false);
    this.container.add(scene.add.rectangle(0, 0, 1280, 720, 0x080a0f, 0.86).setOrigin(0));
    this.container.add(renderQuality.addText(640, 80, 'BUILD / POWERS', {
      color: '#f0eee6', fontFamily: 'Arial, sans-serif', fontSize: '42px', fontStyle: 'bold',
    }).setOrigin(0.5));
    for (let index = 0; index < 5; index += 1) {
      const entry = renderQuality.addText(230, 155 + index * 95, '', {
        color: '#e7ecf3', fontFamily: 'Arial, sans-serif', fontSize: '18px',
        wordWrap: { width: 820 },
      });
      this.entries.push(entry);
      this.container.add(entry);
    }
    this.emptyText = renderQuality.addText(640, 320, 'NO POWERS ACQUIRED', {
      color: '#aeb8c8', fontFamily: 'Arial, sans-serif', fontSize: '22px',
    }).setOrigin(0.5);
    this.container.add(this.emptyText);
    this.container.add(renderQuality.addText(640, 655, 'TAB — RETURN    ESC — PAUSE MENU', {
      color: '#8491a6', fontFamily: 'Consolas, monospace', fontSize: '15px',
    }).setOrigin(0.5));
  }

  show(state: GameState): void {
    this.container.setVisible(true);
    this.emptyText.setVisible(state.powers.ownedOrder.length === 0);
    for (let index = 0; index < this.entries.length; index += 1) {
      const id = state.powers.ownedOrder[index];
      const entry = this.entries[index];
      entry.setVisible(Boolean(id));
      if (!id) continue;
      const definition = getPowerDefinition(id);
      const level = getPowerLevel(state.powers, id);
      entry.setText(`${definition.name}     Lv. ${level}${level === 5 ? '  MAX' : ''}\n${getPowerDescription(id, level, false)}`);
    }
  }

  hide(): void { this.container.setVisible(false); }
}
