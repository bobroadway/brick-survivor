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

## Developer Balance Lab

```sh
npm run balance
```

This opens a separate, Phaser-free desktop calculator for examining incoming board HP pressure, Ball and power throughput, and density-dependent build behavior. It loads an editable copy of the current game configuration; edits are temporary and never modify gameplay configuration or save data.

- **MAX DPS** is a practical theoretical ceiling with targets available and efficient legal paths.
- **MEDIAN DPS** is the 50th percentile from deterministic sampled layouts.
- **LIKELY DPS** is the arithmetic mean under the selected density and assumptions.
- **BOARD HP/s** estimates continuous ordinary-brick HP entering the board; Boss pressure is reported separately.
- **NET PRESSURE** is BOARD HP/s minus player DPS. It is a throughput comparison, not an exact survival prediction.

Monte Carlo calculations use an editable fixed seed and sample count, so identical inputs reproduce identical results. The model is intentionally approximate and is not a replay or frame-by-frame game simulation.

## Structure

- `src/phaser/` contains Phaser-specific presentation, input, and audio integration.
- `src/simulation/` contains framework-independent game state and simulation code.
- `electron-src/` contains the desktop application shell.

Keeping simulation state outside Phaser makes it easier to test deterministically and later introduce an authoritative cooperative host without coupling the core rules to rendering or networking.
