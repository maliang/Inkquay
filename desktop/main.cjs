const { app, BrowserWindow, Menu, dialog, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');

app.setName('Inkquay');
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

let mainWindow = null;
let serverProcess = null;
let serverPort = null;
let serverLog = null;
let updatePromptOpen = false;
let updateRequested = false;

function writeLog(line) {
  try {
    if (!serverLog) {
      const dir = path.join(app.getPath('userData'), 'logs');
      fs.mkdirSync(dir, { recursive: true });
      serverLog = fs.createWriteStream(path.join(dir, 'server.log'), { flags: 'a' });
    }
    serverLog.write(`[${new Date().toISOString()}] ${line}\n`);
  } catch {
    // logging must never crash the app
  }
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

function waitForHealth(port, timeoutMs = 20000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const request = http.get({ host: '127.0.0.1', port, path: '/api/health', timeout: 1200 }, (response) => {
        response.resume();
        if (response.statusCode === 200) return resolve();
        retry();
      });
      request.on('timeout', () => { request.destroy(); retry(); });
      request.on('error', retry);
    };
    const retry = () => {
      if (Date.now() - started > timeoutMs) return reject(new Error('本地写作服务启动超时'));
      setTimeout(tick, 180);
    };
    tick();
  });
}

async function startServer() {
  const packaged = app.isPackaged;
  const serverPath = packaged
    ? path.join(process.resourcesPath, 'server.cjs')
    : path.join(__dirname, 'server.cjs');
  const staticDir = packaged
    ? path.join(process.resourcesPath, 'dist')
    : path.join(__dirname, '..', 'software', 'dist');
  const dataDir = process.env.PW_DESKTOP_DATA_DIR
    ? path.resolve(process.env.PW_DESKTOP_DATA_DIR)
    : path.join(app.getPath('userData'), 'data');
  fs.mkdirSync(dataDir, { recursive: true });

  if (!fs.existsSync(serverPath)) throw new Error(`找不到本地服务：${serverPath}`);
  if (!fs.existsSync(path.join(staticDir, 'index.html'))) throw new Error(`找不到前端构建：${staticDir}`);

  serverPort = await freePort();
  serverProcess = spawn(process.execPath, [serverPath], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      NODE_ENV: 'production',
      PORT: String(serverPort),
      PW_DATA_DIR: dataDir,
      PW_STATIC_DIR: staticDir,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  serverProcess.stdout.on('data', (chunk) => writeLog(chunk.toString().trim()));
  serverProcess.stderr.on('data', (chunk) => writeLog(chunk.toString().trim()));
  serverProcess.on('exit', (code) => {
    writeLog(`server exited with code ${code}`);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('server-exited', code);
    }
  });
  await waitForHealth(serverPort);
  writeLog(`server ready on 127.0.0.1:${serverPort} data=${dataDir}`);
}

async function promptForUpdate(info) {
  if (updatePromptOpen || !mainWindow) return;
  updatePromptOpen = true;
  try {
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Inkquay 有新版本',
      message: `发现新版本 ${info.version}`,
      detail: '点击「更新并重启」会自动下载并在完成后重启。也可以稍后从菜单「检查更新」再试。',
      buttons: ['更新并重启', '稍后'],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 0) {
      updateRequested = true;
      await autoUpdater.downloadUpdate();
    }
  } catch (error) {
    writeLog(`update download failed: ${error.message}`);
  } finally {
    updatePromptOpen = false;
  }
}

function setupAutoUpdates() {
  if (!app.isPackaged) return;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('download-progress', (progress) => {
    writeLog(`update downloading ${Math.round(progress.percent || 0)}%`);
  });
  autoUpdater.on('update-downloaded', () => {
    writeLog('update downloaded, restarting');
    if (updateRequested) autoUpdater.quitAndInstall();
  });
  autoUpdater.on('checking-for-update', () => writeLog('checking for updates'));
  autoUpdater.on('update-available', (info) => {
    writeLog(`update available: ${info.version}`);
    void promptForUpdate(info);
  });
  autoUpdater.on('update-not-available', () => writeLog('no update available'));
  autoUpdater.on('error', (error) => {
    writeLog(`updater error: ${error.message}`);
    if (updateRequested && mainWindow) {
      updateRequested = false;
      void dialog.showMessageBox(mainWindow, {
        type: 'warning',
        title: '自动更新未完成',
        message: '新版本下载或安装失败',
        detail: '当前构建可能没有完成签名/公证。可以打开 GitHub Releases 手动安装最新版。',
        buttons: ['打开下载页', '稍后'],
        defaultId: 0,
        cancelId: 1,
      }).then(({ response }) => {
        if (response === 0) void shell.openExternal('https://github.com/maliang/Inkquay/releases/latest');
      });
    }
  });
  setTimeout(() => { void checkForUpdates(false); }, 8000);
  setInterval(() => { void checkForUpdates(false); }, 4 * 60 * 60 * 1000);
}

async function checkForUpdates(manual = false) {
  if (!app.isPackaged) {
    if (manual) dialog.showMessageBox({ type: 'info', title: '开发版本', message: '开发版本不检查更新', detail: '打包后的 Inkquay 才会连接 GitHub Releases。' });
    return;
  }
  try {
    await autoUpdater.checkForUpdates();
  } catch (error) {
    writeLog(`check update failed: ${error.message}`);
    if (manual) dialog.showMessageBox({ type: 'warning', title: '检查更新失败', message: '暂时无法连接更新服务器', detail: error.message });
  }
}

function buildMenu() {
  const template = [];
  if (process.platform === 'darwin') {
    template.push({
      label: '私家写手',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { label: '检查更新…', click: () => { void checkForUpdates(true); } },
        { type: 'separator' },
        { role: 'quit' },
      ],
    });
  }
  template.push({
    label: '编辑',
    submenu: [
      { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
      { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
    ],
  });
  template.push({
    label: '视图',
    submenu: [
      { role: 'reload' }, { role: 'forceReload' }, { role: 'toggleDevTools' },
      { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
      { type: 'separator' }, { role: 'togglefullscreen' },
    ],
  });
  template.push({
    label: '窗口',
    submenu: [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'close' }],
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1180,
    minHeight: 760,
    backgroundColor: '#0a0c10',
    show: false,
    title: 'Inkquay · 私家写手',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!serverPort || !url.startsWith(`http://127.0.0.1:${serverPort}`)) {
      event.preventDefault();
      if (/^https?:/.test(url)) void shell.openExternal(url);
    }
  });
  mainWindow.on('closed', () => { mainWindow = null; });
  return mainWindow.loadURL(`http://127.0.0.1:${serverPort}/`);
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.whenReady().then(async () => {
  try {
    buildMenu();
    await startServer();
    await createWindow();
    setupAutoUpdates();
    if (process.platform === 'darwin') {
      const icon = app.isPackaged
        ? path.join(process.resourcesPath, 'icon.png')
        : path.join(__dirname, 'build', 'icon.png');
      if (fs.existsSync(icon)) app.dock.setIcon(icon);
    }
  } catch (error) {
    writeLog(`startup failed: ${error.stack || error.message}`);
    dialog.showErrorBox('私家写手启动失败', `${error.message}\n\n日志：${path.join(app.getPath('userData'), 'logs', 'server.log')}`);
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0 && serverPort) void createWindow();
});

app.on('before-quit', () => {
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill('SIGTERM');
    setTimeout(() => { if (serverProcess && !serverProcess.killed) serverProcess.kill('SIGKILL'); }, 1200);
  }
});

app.on('window-all-closed', () => {
  app.quit();
});
