const { contextBridge, ipcRenderer } = require("electron");

async function invoke(channel, ...args) {
  const result = await ipcRenderer.invoke(channel, ...args);
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

contextBridge.exposeInMainWorld("carekoala", {
  settings:()=>invoke('carekoala:settings'),
  sendTestWarning:()=>invoke('carekoala:send-test-warning'),
  createPairing:()=>invoke('carekoala:create-pairing'),
  verifyPairing:f=>invoke('carekoala:verify-pairing',f),
  forgetPairing:()=>invoke('carekoala:forget-pairing'),
  startReal:()=>invoke('carekoala:auto-start'),
  stopReal:()=>invoke('carekoala:auto-stop'),
  setStartup:value=>invoke('carekoala:startup',value),
  onAutoStatus:callback=>{const listener=(_event,value)=>callback(value);ipcRenderer.on('carekoala:auto-status',listener);return ()=>ipcRenderer.removeListener('carekoala:auto-status',listener);},
  health: () => invoke("carekoala:health"),
  listSources: () => invoke("carekoala:list-sources"),
  captureSource: (sourceId) => invoke("carekoala:capture-source", sourceId),
  chooseImage: () => invoke("carekoala:choose-image"),
  ocrImage: (dataUrl) => invoke("carekoala:ocr-image", dataUrl),
  analyze: (payload) => invoke("carekoala:analyze", payload),
  sendGuardianAlert: (payload) => invoke("carekoala:send-guardian-alert", payload),
});

