const { contextBridge, ipcRenderer } = require("electron");

async function invoke(channel, ...args) {
  const result = await ipcRenderer.invoke(channel, ...args);
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

contextBridge.exposeInMainWorld("carekoala", {
  beginPairing: (name) => invoke("carekoala:pairing-start", name),
  pairingStatus: () => invoke("carekoala:pairing-status"),
  approvePairing: () => invoke("carekoala:pairing-approve"),
  cancelPairing: () => invoke("carekoala:pairing-cancel"),
  onPairingState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("carekoala:pairing-state", listener);
    return () =>
      ipcRenderer.removeListener("carekoala:pairing-state", listener);
  },
  importGuardianKey: (code, fingerprint) =>
    invoke("carekoala:rsa-import", code, fingerprint),
  lockdownDemo: () => invoke("carekoala:lockdown-demo"),
  saveTriggers: (list) => invoke("carekoala:triggers-save", list),
  domainStatus: () => invoke("carekoala:domain-status"),
  domainChange: (mode) => invoke("carekoala:domain-change", mode),
  settings: () => invoke("carekoala:settings"),
  sendTestWarning: () => invoke("carekoala:send-test-warning"),
  createPairing: () => invoke("carekoala:create-pairing"),
  verifyPairing: (f) => invoke("carekoala:verify-pairing", f),
  forgetPairing: () => invoke("carekoala:forget-pairing"),
  startReal: () => invoke("carekoala:auto-start"),
  stopReal: () => invoke("carekoala:auto-stop"),
  setStartup: (value) => invoke("carekoala:startup", value),
  onAutoStatus: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on("carekoala:auto-status", listener);
    return () => ipcRenderer.removeListener("carekoala:auto-status", listener);
  },
  health: () => invoke("carekoala:health"),
  listSources: () => invoke("carekoala:list-sources"),
  captureSource: (sourceId) => invoke("carekoala:capture-source", sourceId),
  chooseImage: () => invoke("carekoala:choose-image"),
  ocrImage: (dataUrl) => invoke("carekoala:ocr-image", dataUrl),
  analyze: (payload) => invoke("carekoala:analyze", payload),
  sendGuardianAlert: (payload) =>
    invoke("carekoala:send-guardian-alert", payload),
});
