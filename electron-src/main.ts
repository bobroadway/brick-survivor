import { app, BrowserWindow, ipcMain, Menu } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
type DisplayMode = 'WINDOWED' | 'FULLSCREEN';

function getWindowForEvent(event: Electron.IpcMainInvokeEvent): BrowserWindow {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window) throw new Error('Desktop window is unavailable');
  return window;
}

function getDisplayMode(window: BrowserWindow): DisplayMode {
  return window.isFullScreen() ? 'FULLSCREEN' : 'WINDOWED';
}

async function setDisplayMode(window: BrowserWindow, mode: DisplayMode): Promise<DisplayMode> {
  if (mode === 'FULLSCREEN') {
    if (!window.isFullScreen()) {
      await new Promise<void>((resolve) => {
        window.once('enter-full-screen', () => resolve());
        window.setFullScreen(true);
      });
    }
  } else {
    if (window.isFullScreen()) {
      await new Promise<void>((resolve) => {
        window.once('leave-full-screen', () => resolve());
        window.setFullScreen(false);
      });
    }
    window.setContentSize(1280, 720);
    window.center();
  }
  return mode;
}

ipcMain.handle('desktop:get-display-mode', (event) => getDisplayMode(getWindowForEvent(event)));
ipcMain.handle('desktop:set-display-mode', (event, mode: DisplayMode) => setDisplayMode(getWindowForEvent(event), mode));
ipcMain.handle('desktop:toggle-display-mode', (event) => {
  const window = getWindowForEvent(event);
  return setDisplayMode(window, window.isFullScreen() ? 'WINDOWED' : 'FULLSCREEN');
});
ipcMain.handle('desktop:quit', () => app.quit());

function createWindow(): void {
  const balanceLab = process.env.BALANCE_LAB === '1';
  const window = new BrowserWindow({
    width: balanceLab ? 1180 : 1280,
    height: balanceLab ? 820 : 720,
    useContentSize: true,
    minWidth: balanceLab ? 760 : 800,
    minHeight: balanceLab ? 600 : 450,
    resizable: true,
    maximizable: true,
    backgroundColor: '#10131a',
    show: false,
    webPreferences: {
      preload: path.join(currentDirectory, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  if (balanceLab) window.setTitle('Brick Survivor — Balance Lab');

  window.once('ready-to-show', () => window.show());
  window.on('enter-full-screen', () => window.webContents.send('desktop:display-mode-changed', 'FULLSCREEN'));
  window.on('leave-full-screen', () => window.webContents.send('desktop:display-mode-changed', 'WINDOWED'));

  const developmentUrl = process.env.VITE_DEV_SERVER_URL;
  if (developmentUrl) {
    void window.loadURL(developmentUrl);
  } else {
    void window.loadFile(path.join(currentDirectory, '..', 'dist', 'index.html'));
  }
}

void app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
