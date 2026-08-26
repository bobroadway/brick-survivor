import { contextBridge, ipcRenderer } from 'electron';

type DisplayMode = 'WINDOWED' | 'FULLSCREEN';

contextBridge.exposeInMainWorld('desktop', {
  getDisplayMode: (): Promise<DisplayMode> => ipcRenderer.invoke('desktop:get-display-mode'),
  setDisplayMode: (mode: DisplayMode): Promise<DisplayMode> => ipcRenderer.invoke('desktop:set-display-mode', mode),
  toggleDisplayMode: (): Promise<DisplayMode> => ipcRenderer.invoke('desktop:toggle-display-mode'),
  quit: (): Promise<void> => ipcRenderer.invoke('desktop:quit'),
  onDisplayModeChanged: (listener: (mode: DisplayMode) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, mode: DisplayMode): void => listener(mode);
    ipcRenderer.on('desktop:display-mode-changed', handler);
    return () => ipcRenderer.removeListener('desktop:display-mode-changed', handler);
  },
});
