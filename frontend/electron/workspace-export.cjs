const { app, BrowserWindow, dialog, ipcMain, session, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { fileURLToPath } = require('node:url');

function within(directory, url) {
  if (!url.startsWith('file:')) return false;
  try {
    const relative = path.relative(directory, fileURLToPath(url));
    return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
  } catch {
    return false;
  }
}

async function printFiles(job) {
  if (!job.pdf.length) return;
  const root = path.resolve(job.directory);
  const printSession = session.fromPartition('workspace-export');
  printSession.webRequest.onBeforeRequest((details, respond) => respond({ cancel: !within(root, details.url) }));
  const printer = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false, session: printSession },
  });
  try {
    for (const { input, output } of job.pdf) {
      await printer.loadFile(input);
      const document = await printer.webContents.printToPDF({
        pageSize: 'A4', printBackground: true, margins: { top: 0.65, bottom: 0.65, left: 0.65, right: 0.65 },
      });
      await fs.writeFile(output, document, { flag: 'wx' });
    }
  } finally {
    printer.destroy();
    printSession.webRequest.onBeforeRequest(null);
  }
}

async function exportStartDirectory(previous) {
  const isDirectory = directory => fs.stat(directory).then(info => info.isDirectory(), () => false);
  if (previous && await isDirectory(previous)) return previous;
  for (const place of ['downloads', 'documents', 'home', 'userData']) {
    try {
      const directory = app.getPath(place);
      if (await isDirectory(directory)) return directory;
    } catch { /* A system folder may be absent in this profile. */ }
  }
}

function registerWorkspaceExport(win, origin, hostSecret) {
  let running = false;
  let artifact;
  let previousDirectory;
  const trusted = event => event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame &&
    new URL(event.senderFrame.url).origin === origin;
  async function service(route, method, body) {
    const response = await fetch(origin + '/api' + route, {
      method, headers: { 'Content-Type': 'application/json', 'X-Aetherloom-Host': hostSecret },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(360000),
    });
    if (response.status === 204) return;
    const value = await response.json();
    if (!response.ok) throw new Error(typeof value.detail === 'string' ? value.detail : '导出资料格式无效，请重新读取预览。');
    return value;
  }
  ipcMain.handle('workspace:export', async (event, world, selection, packaging, stamp) => {
    if (!trusted(event) || typeof world !== 'string' || !/^[a-z0-9-]{1,120}$/i.test(world)) {
      throw new Error('Untrusted workspace export caller');
    }
    if (running) return { error: '请等当前导出完成。' };
    running = true;
    let job;
    try {
      const destination = await dialog.showOpenDialog(win, {
        title: '选择导出位置', buttonLabel: '导出到此处', properties: ['openDirectory', 'createDirectory'],
        defaultPath: await exportStartDirectory(previousDirectory),
      });
      if (destination.canceled || !destination.filePaths[0]) return null;
      previousDirectory = destination.filePaths[0];
      job = await service('/worlds/' + world + '/exports/prepare', 'POST', {
        ...selection, packaging, stamp, destination: previousDirectory,
      });
      await printFiles(job);
      const result = await service('/exports/' + job.id + '/finish', 'POST');
      artifact = result.path;
      return result;
    } catch (error) {
      if (job) await service('/exports/' + job.id, 'DELETE').catch(() => {});
      return { error: error.message || '导出失败，请查看导出范围和所选目录。' };
    } finally {
      running = false;
    }
  });
  ipcMain.handle('workspace:reveal-export', event => {
    if (trusted(event) && artifact) shell.showItemInFolder(artifact);
  });
}

module.exports = { registerWorkspaceExport };
