type DisplayMode = 'WINDOWED' | 'FULLSCREEN';

interface DesktopBridge {
  getDisplayMode(): Promise<DisplayMode>;
  setDisplayMode(mode: DisplayMode): Promise<DisplayMode>;
  toggleDisplayMode(): Promise<DisplayMode>;
  quit(): Promise<void>;
  onDisplayModeChanged(listener: (mode: DisplayMode) => void): () => void;
}

interface Window {
  desktop?: DesktopBridge;
}
