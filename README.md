# Brick Survivor

An early playable desktop prototype using TypeScript, Phaser, Vite, and Electron.

## Requirements

- Node.js 20.19 or newer (or Node.js 22.12+)
- npm

## Development

```sh
npm install
npm run dev
```

Vite serves the renderer and Electron opens the game window. Changes to renderer code reload automatically; restart the command after changing Electron main-process code.

Move the paddle with the mouse, **A/D**, or the **Left/Right Arrow** keys; hold either **Shift** key to sprint with keyboard controls. Pause with **Tab**, **Escape**, **Enter**, or **Numpad Enter**. Use **F11** to toggle fullscreen.

## Checks and distribution build

```sh
npm run typecheck
npm run build
```

The build command creates a Windows ZIP in `release/`. Its executable and supporting files can be extracted and run on a Windows computer without installing Node.js.

## Structure

- `src/phaser/` contains Phaser-specific presentation, input, and audio integration.
- `src/simulation/` contains framework-independent game state and simulation code.
- `electron-src/` contains the desktop application shell.

Keeping simulation state outside Phaser makes it easier to test deterministically and later introduce an authoritative cooperative host without coupling the core rules to rendering or networking.
