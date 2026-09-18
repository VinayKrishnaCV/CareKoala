const state = { sources: [], imageDataUrl: null, messages: [], analysis: null, busy: false, monitoring: false, timer: null, sourceId: null };

const $ = (id) => document.getElementById(id);
const status = $("backend-status");
const sourceSelect = $("source-select");
const preview = $("preview");
const messagesContainer = $("messages");
const analysisContainer = $("analysis");

function setBusy(active, text = "Working locally…") {
  state.busy = active;
  $("busy").hidden = !active || state.monitoring;
  $("busy-text").textContent = text;
  for (const button of document.querySelectorAll("button")) button.disabled = active;
  if (!active) {
    for (const button of document.querySelectorAll("button")) button.disabled = false;
    $("ocr-button").disabled = !state.imageDataUrl;
    $("analyze-button").disabled = state.messages.length === 0;
  }
  $("monitor-stop").disabled = !state.monitoring;
  $("monitor-start").disabled = active || state.monitoring;
  sourceSelect.disabled = active || state.monitoring;
  if (state.monitoring) {
    for (const id of ["capture-button", "refresh-sources", "upload-button", "ocr-button", "analyze-button", "demo-button"]) $(id).disabled = true;
    $("monitor-status").textContent = text;
  }
}

function showError(error) {
  analysisContainer.className = "analysis";
  analysisContainer.textContent = error?.message || String(error);
  status.className = "status bad";
  status.textContent = "Action failed";
}

async function loadSources() {
  try {
    const sources = await window.carekoala.listSources();
    state.sources = sources;
    sourceSelect.replaceChildren(...sources.map((source, index) => {
      const option = document.createElement("option");
      option.value = String(index);
      option.textContent = source.name;
      return option;
    }));
  } catch (error) {
    sourceSelect.innerHTML = "<option>Screen permission required</option>";
    showError(error);
  }
}

function setImage(dataUrl) {
  state.imageDataUrl = dataUrl;
  preview.src = dataUrl;
  preview.hidden = false;
  $("ocr-button").disabled = false;
  analysisContainer.className = "analysis empty";
  analysisContainer.textContent = "Screenshot ready. Read it locally, then review the text.";
}

function renderMessages() {
  messagesContainer.replaceChildren();
  messagesContainer.className = "messages";
  state.messages.forEach((message, index) => {
    const row = document.createElement("div");
    row.className = "message-row";
    const speaker = document.createElement("select");
    speaker.innerHTML = '<option value="other">Other</option><option value="user">You</option>';
    speaker.value = message.speaker;
    speaker.addEventListener("change", () => { state.messages[index].speaker = speaker.value; });
    const text = document.createElement("textarea");
    text.value = message.text;
    text.setAttribute("aria-label", `Message ${index + 1}`);
    text.addEventListener("input", () => { state.messages[index].text = text.value; });
    const remove = document.createElement("button");
    remove.textContent = "×";
    remove.setAttribute("aria-label", `Remove message ${index + 1}`);
    remove.addEventListener("click", () => {
      state.messages.splice(index, 1);
      renderMessages();
    });
    row.append(speaker, text, remove);
    messagesContainer.append(row);
  });
  $("analyze-button").disabled = state.messages.length === 0;
}

function ocrLinesToMessages(result) {
  const width = result.image?.width || 1;
  return (result.lines || []).map((line, index) => {
    const center = ((line.box?.left || 0) + (line.box?.right || 0)) / 2;
    return {
      id: `M${index + 1}`,
      speaker: center > width * 0.58 ? "user" : "other",
      text: line.text,
      confidence: line.confidence,
    };
  });
}

async function runOcr() {
  if (!state.imageDataUrl) return;
  setBusy(true, "Releasing model memory, then reading the screenshot locally…");
  try {
    const result = await window.carekoala.ocrImage(state.imageDataUrl);
    state.messages = ocrLinesToMessages(result);
    renderMessages();
    $("ocr-status").textContent = `${state.messages.length} recognized items · expand review to correct text`;
    status.className = "status good";
    status.textContent = "OCR complete · model released";
  } catch (error) {
    showError(error);
  } finally {
    setBusy(false);
  }
}

function renderAnalysis(result) {
  state.analysis = result;
  analysisContainer.replaceChildren();
  analysisContainer.className = "analysis";
  const heading = document.createElement("h3");
  heading.textContent = result.status.replaceAll("_", " ");
  if(result.mock)heading.textContent='MOCK TEST — trained model was not run';
  analysisContainer.append(heading);
  if(Number.isInteger(result.score)){
    heading.textContent=`Danger score: ${result.score}/10 · ${result.level}`;
    const summary=document.createElement('p');
    summary.textContent=`Category: ${result.category.replaceAll('_',' ')} · Guardian check-in: ${result.contact_guardian?'Yes':'No'} · ${result.windows} text windows. Model: CareKoala v2. Scores describe screen content, not a diagnosis.`;
    analysisContainer.append(summary);
  }
  if (!result.concerns.length) {
    const text = document.createElement("p");
    text.textContent = result.mock
      ? 'This is a keyword demo, not a safety assessment. Quit and start CareKoala without -Mock to analyze with the trained model.'
      : Number.isInteger(result.score)
      ? "This score is below the guardian-alert threshold of 7. It is not a guarantee that a person is safe."
      : result.status === "no_clear_concern"
      ? "No listed concern is supported by the supplied messages. This is not a guarantee that a person is safe."
      : "More context is needed before interpreting this interaction.";
    analysisContainer.append(text);
  }
  for (const concern of result.concerns) {
    const card = document.createElement("div");
    card.className = "analysis-card";
    const title = document.createElement("strong");
    title.textContent = concern.type.replaceAll("_", " ");
    const explanation = document.createElement("span");
    explanation.textContent = concern.explanation;
    const evidence = document.createElement("div");
    evidence.className = "evidence";
    evidence.textContent = `Evidence: ${concern.evidence_ids.join(", ")}`;
    card.append(title, explanation, evidence);
    analysisContainer.append(card);
  }
  if (result.clarifying_question) {
    const question = document.createElement("p");
    question.className = "question";
    question.textContent = result.clarifying_question;
    analysisContainer.append(question);
  }
  if (result.status === "concern_detected") { stopMonitoring("Paused for guardian recommendation. Restart when ready."); showGuardianRecommendation(); }
}

function showGuardianRecommendation() {
  $("guardian-status").textContent = "";
  $("guardian-dialog").hidden = false;
  $("guardian-send").focus();
}

function hideGuardianRecommendation() {
  $("guardian-dialog").hidden = true;
}

async function sendGuardianAlert() {
  if (!state.analysis) return;
  $("guardian-send").disabled = true;
  $("guardian-status").textContent = "Sending your short help request…";
  try {
    await window.carekoala.sendGuardianAlert({ analysis: state.analysis });
    $("guardian-status").textContent = "Encrypted check-in request published. Guardian receipt is not yet confirmed.";
    $("guardian-dismiss").textContent = "Close";
  } catch (error) {
    $("guardian-status").textContent = error?.message || "The help alert could not be sent.";
    $("guardian-send").disabled = false;
  }
}

async function analyze() {
  const cleaned = state.messages
    .map((message, index) => ({ id: `M${index + 1}`, speaker: message.speaker, text: message.text.trim() }))
    .filter((message) => message.text);
  if (!cleaned.length) return;
  const boundaries = $("boundaries").value.split("\n").map((item) => item.trim()).filter(Boolean);
  setBusy(true, "Scoring locally with the trained CareKoala v2 model…");
  try {
    const result = await window.carekoala.analyze({
      conversation_id: `local-${Date.now()}`,
      messages: cleaned,
      boundaries,
    });
    renderAnalysis(result);
    status.className = "status good";
    status.textContent = "Local analysis complete";
  } catch (error) {
    showError(error);
  } finally {
    setBusy(false);
  }
}

$("refresh-sources").addEventListener("click", loadSources);
async function captureFresh(sourceId) {
  const image = await window.carekoala.captureSource(sourceId);
  setImage(image);
}
$("capture-button").addEventListener("click", async () => {
  const source = state.sources[Number(sourceSelect.value)];
  if (!source) return;
  setBusy(true, "Taking a fresh screenshot…");
  try { await captureFresh(source.id); } catch (error) { showError(error); }
  finally { setBusy(false); }
});
function stopMonitoring(message = "Periodic capture stopped. Any active stage will finish safely.") {
  state.monitoring = false;
  clearTimeout(state.timer);
  state.timer = null;
  $("monitor-status").textContent = message;
  $("monitor-stop").disabled = true;
  $("monitor-start").disabled = state.busy;
}
async function captureCycle() {
  if (!state.monitoring) return;
  setBusy(true, "Capturing selected window…");
  try {
    await captureFresh(state.sourceId);
    if (!state.monitoring) return;
    $("monitor-status").textContent = "Reading locally with OCR…";
    const result = await window.carekoala.ocrImage(state.imageDataUrl);
    if (!state.monitoring) return;
    state.messages = ocrLinesToMessages(result);
    renderMessages();
    setBusy(true, "OCR finished. Preparing local analysis…");
    $("ocr-status").textContent = `${state.messages.length} recognized items · automatic speaker estimates`;
    if (state.messages.length) {
      $("monitor-status").textContent = "OCR finished. Analyzing locally…";
      const result = await window.carekoala.analyze({
        conversation_id: `local-${Date.now()}`,
        messages: state.messages.map(({id, speaker, text}) => ({id, speaker, text})),
        boundaries: $("boundaries").value.split("\n").map(s => s.trim()).filter(Boolean),
      });
      if (!state.monitoring) return;
      renderAnalysis(result);
      status.textContent = "Local analysis complete";
      status.className = "status good";
    } else {
      analysisContainer.textContent = "No readable text found. Try another window or a larger conversation view.";
    }
  } catch (error) {
    stopMonitoring("Periodic capture paused after an error. Review the message and restart.");
    showError(error);
  } finally {
    setBusy(false);
    if (state.monitoring) {
      const delay = Number($("capture-interval").value) * 1000;
      $("monitor-status").textContent = `Cycle complete. Next capture in ${delay / 1000} seconds.`;
      state.timer = setTimeout(captureCycle, delay);
    }
  }
}
$("monitor-start").addEventListener("click", () => {
  if (state.busy || state.monitoring) return;
  const source = state.sources[Number(sourceSelect.value)];
  if (!source) { showError(new Error("Select a screen or window first.")); return; }
  state.sourceId = source.id;
  state.monitoring = true;
  captureCycle();
});
$("monitor-stop").addEventListener("click", () => { stopMonitoring(); setBusy(state.busy); });
window.addEventListener("beforeunload", () => stopMonitoring());
$("upload-button").addEventListener("click", async () => {
  const value = await window.carekoala.chooseImage();
  if (value) setImage(value);
});
$("ocr-button").addEventListener("click", runOcr);
$("analyze-button").addEventListener("click", analyze);
$("demo-button").addEventListener("click", () => {
  state.messages = [
    { id: "M1", speaker: "other", text: "Send me the OTP." },
    { id: "M2", speaker: "user", text: "No, I won't share it." },
    { id: "M3", speaker: "other", text: "Send it or arrange your own ride to the clinic." },
  ];
  renderMessages();
  $("ocr-status").textContent = "Demo conversation loaded";
});
$("guardian-send").addEventListener("click", sendGuardianAlert);
$("guardian-dismiss").addEventListener("click", hideGuardianRecommendation);

(async () => {
  try {
    const health = await window.carekoala.health();
    status.className = "status good";
    status.textContent = `Backend ready · ${health.mode}`;
  } catch (error) {
    showError(error);
  }
  await loadSources();
})();

let pairFingerprint=null;
let testWarningPending=false;
$("guardian-test-send").addEventListener('click',async()=>{
  if(testWarningPending)return;
  testWarningPending=true;
  $("guardian-test-send").disabled=true;
  $("guardian-test-status").textContent='Sending encrypted test warning…';
  try{
    await window.carekoala.sendTestWarning();
    $("guardian-test-status").textContent='Encrypted test warning published to ntfy.sh. Check your Android notification; receipt is not yet confirmed.';
  }catch(error){
    $("guardian-test-status").textContent=error.message || 'Test warning could not be sent.';
  }finally{
    testWarningPending=false;
    $("guardian-test-send").disabled=false;
  }
});
function renderRealStatus(value){
  if(!value)return;
  $("real-status").textContent=value.status+(Number.isInteger(value.score)?` · Score: ${value.score}/10 (${value.level}, ${value.category.replaceAll('_',' ')})`:'')+(value.decision===true?' · Check-in: Yes':value.decision===false?' · Check-in: No':'');
  $("real-start").disabled=value.running;
}
async function refreshSettings(){
  const value=await window.carekoala.settings();
  $("startup-enabled").checked=value.startAtLogin;
  $("pair-status").textContent=value.paired?'Fingerprint verified on this PC. ntfy.sh relay configured automatically. Phone pairing, receiver connection, and delivery are not confirmed.':'No guardian fingerprint verified on this PC';
  $("pair-fingerprint").textContent=value.fingerprint?`Fingerprint: ${value.fingerprint}`:'';
  renderRealStatus(value.auto);
}
const realAction=fn=>async()=>{try{await fn();}catch(error){$("real-status").textContent=error.message;}};
$("real-start").addEventListener('click',realAction(async()=>{stopMonitoring();renderRealStatus(await window.carekoala.startReal());}));
$("real-stop").addEventListener('click',realAction(async()=>renderRealStatus(await window.carekoala.stopReal())));
$("startup-enabled").addEventListener('change',realAction(async()=>{try{await window.carekoala.setStartup($("startup-enabled").checked);}finally{await refreshSettings();}}));
$("pair-create").addEventListener('click',realAction(async()=>{
  const pair=await window.carekoala.createPairing();pairFingerprint=pair.fingerprint;
  $("pair-code").value=pair.code;$("pair-code").hidden=false;$("pair-verify").disabled=false;await refreshSettings();
}));
$("pair-verify").addEventListener('click',realAction(async()=>{
  await window.carekoala.verifyPairing(pairFingerprint);$("pair-code").value='';$("pair-code").hidden=true;$("pair-verify").disabled=true;await refreshSettings();
}));
$("pair-forget").addEventListener('click',realAction(async()=>{await window.carekoala.forgetPairing();$("pair-code").value='';$("pair-code").hidden=true;$("pair-verify").disabled=true;await refreshSettings();}));
window.carekoala.onAutoStatus(renderRealStatus);
refreshSettings().catch(error=>{$("real-status").textContent=error.message;});
