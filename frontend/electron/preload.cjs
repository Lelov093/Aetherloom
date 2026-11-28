const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('aetherloomExplore', {
  savedViews: (world, value) => ipcRenderer.invoke('explore:saved-views', { world, value }),
});

contextBridge.exposeInMainWorld('aetherloomExport', {
  run: (world, selection, packaging, stamp) => ipcRenderer.invoke('workspace:export', world, selection, packaging, stamp),
  reveal: () => ipcRenderer.invoke('workspace:reveal-export'),
});

// Narrow IPC surface: never expose the Host credential, arbitrary requests or grants.
contextBridge.exposeInMainWorld('aetherloomRuntime', {
  available: () => ipcRenderer.invoke('runtime:available'),
  experiments: () => ipcRenderer.invoke('runtime:experiments'),
  session: (world, role, worldline, actor, spoilerFree) => ipcRenderer.invoke('runtime:session', { world, role, worldline, actor, spoilerFree }),
  viewerLayout: (worldline, value, view) => ipcRenderer.invoke('runtime:viewer-layout', { worldline, value, view }),
});
