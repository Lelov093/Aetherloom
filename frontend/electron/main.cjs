const { app, BrowserWindow, dialog, session, Tray, Menu, nativeImage } = require('electron');
const { spawn } = require('node:child_process');
const { existsSync, mkdirSync, openSync, closeSync } = require('node:fs');
const path = require('node:path');
const net = require('node:net');

const root = path.resolve(__dirname, '../..');
let service;
let quitting = false;
let tray, serviceOrigin, quittingRequest = false;
app.setName('Aetherloom');
// Development shell state belongs to this project, not a global Electron profile.
app.setPath('userData', process.env.AETHERLOOM_DESKTOP_DATA || path.join(root, '.data', 'desktop'));
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) showWindow(win);
  });
  app.whenReady().then(start).catch(error => {
    dialog.showErrorBox('Aetherloom 无法启动', error.message);
    app.quit();
  });
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
  mkdirSync(path.join(root, '.logs'), { recursive: true });
  const log = openSync(path.join(root, '.logs', 'desktop-service.log'), 'a');
  service = spawn(python, ['-m', 'uvicorn', 'aetherloom.api:app', '--host', '127.0.0.1', '--port', String(port)], {
    cwd: root, env: { ...process.env, PYTHONUNBUFFERED: '1' }, stdio: ['ignore', log, log], windowsHide: true,
  });
  closeSync(log);
  let failure;
  service.on('error', error => { failure = error; });
  service.on('exit', code => {
    failure = new Error(`本地服务已退出（${code}）。详情见 .logs/desktop-service.log。`);
    if (!quitting && BrowserWindow.getAllWindows().length) {
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
    title: 'Aetherloom', width: 1440, height: 940, minWidth: 820, minHeight: 640,
    backgroundColor: '#F7F8F6', show: false, autoHideMenuBar: true,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
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
  showWindow(win);
  console.log(`Aetherloom renderer: ${origin}`);
  console.log(`Aetherloom desktop window: ${win.isVisible() ? 'visible' : 'hidden'}`);
}

app.on('window-all-closed', () => { if(quitting)app.quit(); });
app.on('before-quit',event=>{
  if(quitting||!serviceOrigin)return;
  event.preventDefault();if(quittingRequest)return;quittingRequest=true;
  (async()=>{
    try {
      const response=await fetch(`${serviceOrigin}/api/runtime/pause-all`,{method:'POST',signal:AbortSignal.timeout(8000)});
      if(!response.ok)throw new Error('暂停服务未完成');
      quitting=true;app.quit();
    } catch {
      quittingRequest=false;
      if(service?.exitCode!==null){quitting=true;app.quit();return;}
      const win=BrowserWindow.getAllWindows()[0];if(win)showWindow(win);
      dialog.showErrorBox('暂停保存未完成','本地服务尚未确认暂停。应用保持打开，请稍后再试；不会在未确认时直接退出。');
    }
  })();
});
app.on('will-quit', () => {
  quitting = true;
  tray?.destroy();
  if (service && service.exitCode === null) {
    // Windows venv redirectors can have an actual Python child: stop our whole owned tree.
    if(process.platform==='win32')spawn('taskkill',['/PID',String(service.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});
    else service.kill();
  }
});
