const { app, BrowserWindow, dialog, session, Tray, Menu, nativeImage, ipcMain } = require('electron');
const { randomBytes } = require('node:crypto');
const { spawn } = require('node:child_process');
const { existsSync, mkdirSync, openSync, closeSync } = require('node:fs');
const fs = require('node:fs/promises');
const path = require('node:path');
const net = require('node:net');
const { ViewerPreferences } = require('./viewer-preferences.cjs');
const { registerWorkspaceExport } = require('./workspace-export.cjs');

const root = path.resolve(__dirname, '../..');
const desktopLogPath = path.join(root, '.logs', 'desktop-service.log');
let service;
let quitting = false;
let tray, serviceOrigin, quittingRequest = false;
app.setName('Aetherloom');
// Development shell state belongs to this project, not a global Electron profile.
app.setPath('userData', process.env.AETHERLOOM_DESKTOP_DATA || path.join(root, '.data', 'desktop'));
const stopRequested = process.argv.includes('--aetherloom-stop');
const focusRequested = process.argv.includes('--aetherloom-focus');
if (!app.requestSingleInstanceLock({ root, stopRequested })) app.quit();
else if (stopRequested || focusRequested) app.exit(focusRequested ? 2 : 0);
else {
  app.on('second-instance', (_event, _commandLine, _cwd, request) => {
    if (request?.stopRequested) {
      if (request.root === root) app.quit();
      return;
    }
    const win = BrowserWindow.getAllWindows()[0];
    if (win) showWindow(win);
  });
  app.whenReady().then(start).catch(handleStartupFailure);
}

function showWindow(win) {
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

async function start() {
  const python = path.join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  if (!existsSync(python) || !existsSync(path.join(root, 'frontend/dist/index.html'))) {
    throw new Error('请先运行 scripts/start.ps1，准备项目环境并构建界面。');
  }
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  serviceOrigin = origin;
  const vnextEnabled = process.env.AETHERLOOM_VNEXT_ENABLED === '1';
  const hostSecret = randomBytes(32).toString('hex');
  mkdirSync(path.dirname(desktopLogPath), { recursive: true });
  const log = openSync(desktopLogPath, 'a');
  service = spawn(python, ['-m', 'uvicorn', 'aetherloom.api:app', '--host', '127.0.0.1', '--port', String(port)], {
    cwd: root, env: { ...process.env, PYTHONUNBUFFERED: '1',
      AETHERLOOM_VNEXT_HOST_ORIGIN: origin, AETHERLOOM_VNEXT_HOST_SECRET: hostSecret }, stdio: ['ignore', log, log], windowsHide: true,
  });
  closeSync(log);
  let failure;
  let windowReady = false;
  service.on('error', error => { failure = error; });
  service.on('exit', (code, signal) => {
    failure = new Error(`本地服务已退出（${code ?? signal}）。详情见 .logs/desktop-service.log。`);
    if (!quitting && windowReady && BrowserWindow.getAllWindows().length) {
      dialog.showErrorBox('本地服务已停止', '已保存的世界仍保存在本机。请重开应用后继续。');
      app.quit();
    }
  });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (failure) throw failure;
    try {
      const response = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(500) });
      if (response.ok) { ready = true; break; }
    } catch { /* Wait for this child service to start. */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!ready) throw new Error('本地服务未能及时启动。请查看 .logs/desktop-service.log。');
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  const win = new BrowserWindow({
    title: `Aetherloom ${app.getVersion()} · 世界工作室`, width: 1440, height: 940, minWidth: 820, minHeight: 640,
    backgroundColor: '#F7F8F6', show: false, autoHideMenuBar: true,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, preload: path.join(__dirname, 'preload.cjs') },
  });
  win.on('page-title-updated', event => event.preventDefault());
  registerWorkspaceExport(win, origin, hostSecret);
  let activeSession, activeIdentity;
  const viewerPreferences = new ViewerPreferences(app.getPath('userData'));
  const exploreViewDirectory = path.join(app.getPath('userData'), 'explore-views');
  let exploreViewQueue = Promise.resolve();
  ipcMain.handle('explore:saved-views', (event, { world, value } = {}) => {
    if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame ||
        new URL(event.senderFrame.url).origin !== origin ||
        typeof world !== 'string' || !/^[a-z0-9-]{1,120}$/i.test(world)) throw new Error('Untrusted Explore caller');
    const file = path.join(exploreViewDirectory, world + '.json');
    const operation = exploreViewQueue.catch(() => {}).then(async () => {
      if (value === undefined) {
        try { return JSON.parse(await fs.readFile(file, 'utf8')); }
        catch (error) {
          if (error.code === 'ENOENT') return null;
          throw error;
        }
      }
      const encoded = JSON.stringify(value);
      if (!Array.isArray(value) || value.length > 20 || Buffer.byteLength(encoded) > 512 * 1024) {
        throw new Error('Invalid Explore views');
      }
      await fs.mkdir(exploreViewDirectory, { recursive: true });
      await fs.writeFile(file + '.tmp', encoded, 'utf8');
      await fs.rename(file + '.tmp', file);
    });
    exploreViewQueue = operation;
    return operation;
  });
  let sessionQueue = Promise.resolve();
  ipcMain.handle('runtime:session', (event, { world, role, worldline, actor, spoilerFree = false } = {}) => {
    if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame ||
        new URL(event.senderFrame.url).origin !== origin) throw new Error('Untrusted runtime caller');
    if (!vnextEnabled) return null;
    if (typeof world !== 'string' || !world || !['creator_observer', 'observer', 'participant'].includes(role)) throw new Error('Invalid scope');
    if (typeof spoilerFree !== 'boolean') throw new Error('Invalid viewing preference');
    if (role === 'participant' && (process.env.AETHERLOOM_VNEXT_INTERACTIVE !== '1' || typeof worldline !== 'string' || typeof actor !== 'string')) throw new Error('Invalid participant binding');
    sessionQueue = sessionQueue.catch(() => {}).then(async () => {
      if (activeSession) {
        const closed = await fetch(`${origin}/api/v2/session`, { method: 'DELETE', headers: { Authorization: `Bearer ${activeSession}` } });
        if (!closed.ok) throw new Error('Could not replace runtime session');
        activeSession = undefined;
          activeIdentity = undefined;
      }
      const response = await fetch(`${origin}/api/v2/session`, { method: 'POST', headers: {
        'Content-Type': 'application/json', 'X-Aetherloom-Host': hostSecret,
      }, body: JSON.stringify({ world_id: world, role, spoiler_free: spoilerFree,
        ...(role === 'participant' ? {worldline_id:worldline,actor_id:actor} : {}) }) });
      if (!response.ok) throw new Error('Runtime session unavailable');
      const result = await response.json();
      activeSession = result.token;
      activeIdentity = {world,role,actor};
      return result;
    });
    return sessionQueue;
  });
  ipcMain.handle('runtime:available', event => event.sender === win.webContents &&
    event.senderFrame === win.webContents.mainFrame && new URL(event.senderFrame.url).origin === origin && vnextEnabled);
  ipcMain.handle('runtime:experiments', event => ({godotLibrary:
    event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame &&
    new URL(event.senderFrame.url).origin === origin && vnextEnabled && process.env.AETHERLOOM_GODOT_LIBRARY_POC === '1'}));
  ipcMain.handle('runtime:viewer-layout', async(event, {worldline, value, view} = {}) => {
    if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame ||
        new URL(event.senderFrame.url).origin !== origin || !activeSession || !vnextEnabled ||
        typeof worldline !== 'string' || worldline.length > 120 ||
        (view !== undefined && !/^godot:(courtyard|classroom|library|street)$/.test(view))) throw new Error('Untrusted viewer caller');
    const token=activeSession, identity=activeIdentity;
    const response=await fetch(`${origin}/api/v2/worldlines/${encodeURIComponent(worldline)}/snapshot`,
      {headers:{Authorization:`Bearer ${token}`}});
    if (!response.ok || token !== activeSession) throw new Error('Viewer scope expired');
    const {projection:p}=await response.json();
    if (token !== activeSession) throw new Error('Viewer scope expired');
    if (view && !(view.slice(6) in p.world.place_topology)) throw new Error('Scene not visible');
    const key=JSON.stringify([identity.world,worldline,identity.role,identity.actor || null,p.policy_version,...(view ? [view] : [])]);
    const layout=await viewerPreferences.operation(key,value);
    if (token !== activeSession) throw new Error('Viewer scope expired');
    const visible=new Set([...Object.keys(p.world.place_topology),...Object.values(p.world.place_topology).flat()]);
    return layout ? {...layout,places:layout.places.filter(place=>visible.has(place.id))} : null;
  });
  // A small native bitmap avoids a new asset/dependency for the persistent tray entry.
  const pixels = Buffer.alloc(24*24*4);
  for(let y=0;y<24;y++)for(let x=0;x<24;x++){
    const d=Math.hypot(x-11.5,y-11.5),i=(y*24+x)*4;
    if((d>7&&d<10)||Math.hypot(x-11.5,y-11.5)<3){pixels[i]=230;pixels[i+1]=155;pixels[i+2]=35;pixels[i+3]=255;}
  }
  tray = new Tray(nativeImage.createFromBitmap(pixels,{width:24,height:24}));
  tray.setToolTip('Aetherloom · 关窗口后世界继续运行；退出会暂停保存');
  tray.setContextMenu(Menu.buildFromTemplate([
    {label:'打开 Aetherloom',click:()=>showWindow(win)},
    {label:'暂停所有世界线',click:async()=>{try{await fetch(`${origin}/api/runtime/pause-all`,{method:'POST'})}catch{showWindow(win);dialog.showErrorBox('无法暂停','本地服务未响应，请重开应用检查保存状态。')}}},
    {type:'separator'}, {label:'暂停保存并退出',click:()=>app.quit()},
  ]));
  tray.on('double-click',()=>showWindow(win));
  win.on('close',event=>{if(!quitting){event.preventDefault();win.hide();}});
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => {
    if (new URL(url).origin !== origin) event.preventDefault();
  });
  win.webContents.on('will-prevent-unload', event => {
    const response = dialog.showMessageBoxSync(win, {
      type: 'question', buttons: ['继续编辑', '放弃未保存的修改'], defaultId: 0, cancelId: 0,
      title: '还有未保存的资料', message: '要离开当前编辑吗？已保存的世界不会受到影响。',
    });
    if (response === 1) event.preventDefault();
    else { quitting = false; quittingRequest = false; }
  });
  await win.loadURL(origin);
  if (failure) throw failure;
  showWindow(win);
  windowReady = true;
  console.log(`Aetherloom renderer: ${origin}`);
  console.log(`Aetherloom desktop window: ${win.isVisible() ? 'visible' : 'hidden'}`);
}

async function pauseRuntime() {
  const response = await fetch(`${serviceOrigin}/api/runtime/pause-all`, { method: 'POST', signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error('暂停服务未完成');
}

function isServiceRunning() {
  return Boolean(service?.pid && service.exitCode === null && service.signalCode === null);
}

function closeDesktop() {
  quitting = true;
  tray?.destroy();
  if (isServiceRunning()) {
    // The Windows venv redirector can have a Python child, so stop the owned process tree.
    if (process.platform === 'win32') spawn('taskkill', ['/PID', String(service.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    else service.kill();
  }
}

async function handleStartupFailure(error) {
  quitting = true;
  const message = error?.message || String(error);
  const entry = `[${new Date().toISOString()}] [desktop startup] ${error?.stack || message}`;
  console.error(entry);
  try {
    await fs.mkdir(path.dirname(desktopLogPath), { recursive: true });
    await fs.appendFile(desktopLogPath, `${entry}\n`, 'utf8');
  } catch (logError) {
    console.error('无法写入 .logs/desktop-service.log。', logError);
  }
  if (isServiceRunning()) {
    try {
      await pauseRuntime();
    } catch (pauseError) {
      console.error('启动失败后未能暂停本地服务。', pauseError);
    }
  }
  try {
    closeDesktop();
    dialog.showErrorBox('Aetherloom 无法启动', message);
  } finally {
    app.exit(1);
  }
}

app.on('window-all-closed', () => { if(quitting)app.quit(); });
app.on('before-quit',event=>{
  if(quitting||!serviceOrigin)return;
  event.preventDefault();if(quittingRequest)return;quittingRequest=true;
  (async()=>{
    try {
      await pauseRuntime();
      quitting=true;app.quit();
    } catch {
      quittingRequest=false;
      if(!isServiceRunning()){quitting=true;app.quit();return;}
      const win=BrowserWindow.getAllWindows()[0];if(win)showWindow(win);
      dialog.showErrorBox('暂停保存未完成','本地服务尚未确认暂停。应用保持打开，请稍后再试；不会在未确认时直接退出。');
    }
  })();
});
app.on('will-quit', closeDesktop);
