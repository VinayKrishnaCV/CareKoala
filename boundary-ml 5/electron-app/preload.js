const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("boundary", {
  health: () => ipcRenderer.invoke("boundary:health"),
  listSources: () => ipcRenderer.invoke("boundary:list-sources"),
  chooseImage: () => ipcRenderer.invoke("boundary:choose-image"),
  ocrImage: (dataUrl) => ipcRenderer.invoke("boundary:ocr-image", dataUrl),
  analyze: (payload) => ipcRenderer.invoke("boundary:analyze", payload),
});

