const { contextBridge, ipcRenderer, webUtils } = require("electron");
contextBridge.exposeInMainWorld("desktop", {
  call: (command, payload) =>
    ipcRenderer.invoke("desktop:call", command, payload),
  filePath: (file) => webUtils.getPathForFile(file),
  on: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on("desktop:event", handler);
    return () => ipcRenderer.removeListener("desktop:event", handler);
  },
});
