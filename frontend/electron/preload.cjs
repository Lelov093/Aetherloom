const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('aetherloomExplore', {
  savedViews: (world, value) => ipcRenderer.invoke('explore:saved-views', { world, value }),
});

// Narrow IPC surface: never expose the Host credential, arbitrary requests or grants.
contextBridge.exposeInMainWorld('aetherloomRuntime', {
  available: () => ipcRenderer.invoke('runtime:available'),
  experiments: () => ipcRenderer.invoke('runtime:experiments'),
  session: (world, role, worldline, actor) => ipcRenderer.invoke('runtime:session', { world, role, worldline, actor }),
  viewerLayout: (worldline, value, view) => ipcRenderer.invoke('runtime:viewer-layout', { worldline, value, view }),
});
