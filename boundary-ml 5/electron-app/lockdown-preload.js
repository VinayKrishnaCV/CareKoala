const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("lockdown", {
  unlock: (key) => ipcRenderer.invoke("lockdown:unlock", key),
  resend: () => ipcRenderer.invoke("lockdown:resend"),
  status: (fn) => ipcRenderer.on("lockdown:status", (_e, s) => fn(s)),
  guardianUnlocked: (fn) =>
    ipcRenderer.on("lockdown:guardian-unlocked", () => fn()),
});
