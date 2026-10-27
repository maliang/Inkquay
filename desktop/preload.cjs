const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('inkquayDesktop', {
  onCloseRequest(callback) {
    const listener = () => callback();
    ipcRenderer.on('inkquay:request-close', listener);
    return () => ipcRenderer.removeListener('inkquay:request-close', listener);
  },
  readyToClose() {
    ipcRenderer.send('inkquay:flush-complete');
  },
  cancelClose() {
    ipcRenderer.send('inkquay:flush-cancel');
  },
});
