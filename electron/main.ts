import { app, BrowserWindow, session, ipcMain, dialog } from 'electron';
import path from 'path';
import { registerSettingsIpc } from './ipc/settings';
import { registerBorderDetectIpc } from './ipc/borderDetect';
import { registerAiLauncherIpc } from './ipc/aiLauncher';
import { registerPortfolioIpc } from './ipc/portfolioIpc';
import { configurePlaywrightBrowsersPath } from './ipc/shellEdge';

const isDev = !app.isPackaged;
let mainWindow: BrowserWindow | null = null;

function getDesktopHtmlPath(): string {
  return path.join(app.getAppPath(), 'dist', 'app-desktop.html');
}

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 900,
    minHeight: 700,
    title: 'RawGraded Studio',
    backgroundColor: '#000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  const win = mainWindow;

  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error('[RawGraded Studio] load failed:', errorCode, errorDescription, validatedURL);
    if (!isDev) {
      dialog.showErrorBox(
        'RawGraded Studio',
        `Failed to load the app (${errorCode}): ${errorDescription}\n\n${validatedURL}`
      );
    }
  });

  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    if (permission === 'media') {
      callback(true);
      return;
    }
    callback(false);
  });

  if (isDev) {
    const devUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:3000/app-desktop.html';
    await win.loadURL(devUrl);
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    await session.defaultSession.clearCache();
    const htmlPath = getDesktopHtmlPath();
    console.log('[RawGraded Studio] Loading:', htmlPath);
    await win.loadFile(htmlPath);
  }
}

app.whenReady().then(() => {
  configurePlaywrightBrowsersPath();
  registerSettingsIpc(ipcMain);
  registerBorderDetectIpc(ipcMain);
  registerAiLauncherIpc(ipcMain, () => mainWindow);
  registerPortfolioIpc(ipcMain, () => mainWindow);
  void createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
