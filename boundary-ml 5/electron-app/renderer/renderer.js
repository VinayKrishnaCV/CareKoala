const state = { sources: [], imageDataUrl: null, messages: [] };

const $ = (id) => document.getElementById(id);
const status = $("backend-status");
const sourceSelect = $("source-select");
const preview = $("preview");
const messagesContainer = $("messages");
const analysisContainer = $("analysis");

function setBusy(active, text = "Working locally…") {
  $("busy").hidden = !active;
  $("busy-text").textContent = text;
  for (const button of document.querySelectorAll("button")) button.disabled = active;
  if (!active) {
    for (const button of document.querySelectorAll("button")) button.disabled = false;
    $("ocr-button").disabled = !state.imageDataUrl;
    $("analyze-button").disabled = state.messages.length === 0;
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
    const sources = await window.boundary.listSources();
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
  setBusy(true, "Releasing Qwen, then reading the screenshot locally…");
  try {
    const result = await window.boundary.ocrImage(state.imageDataUrl);
    state.messages = ocrLinesToMessages(result);
    renderMessages();
    $("ocr-status").textContent = `${state.messages.length} text lines found with ${result.engine}`;
    status.className = "status good";
    status.textContent = "OCR complete · model released";
  } catch (error) {
    showError(error);
  } finally {
    setBusy(false);
  }
}

function renderAnalysis(result) {
  analysisContainer.replaceChildren();
  analysisContainer.className = "analysis";
  const heading = document.createElement("h3");
  heading.textContent = result.status.replaceAll("_", " ");
  analysisContainer.append(heading);
  if (!result.concerns.length) {
    const text = document.createElement("p");
    text.textContent = result.status === "no_clear_concern"
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
}

async function analyze() {
  const cleaned = state.messages
    .map((message, index) => ({ id: `M${index + 1}`, speaker: message.speaker, text: message.text.trim() }))
    .filter((message) => message.text);
  if (!cleaned.length) return;
  const boundaries = $("boundaries").value.split("\n").map((item) => item.trim()).filter(Boolean);
  setBusy(true, "Loading Qwen, then interpreting reviewed messages…");
  try {
    const result = await window.boundary.analyze({
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
$("capture-button").addEventListener("click", () => {
  const source = state.sources[Number(sourceSelect.value)];
  if (source) setImage(source.thumbnail);
});
$("upload-button").addEventListener("click", async () => {
  const value = await window.boundary.chooseImage();
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

(async () => {
  try {
    const health = await window.boundary.health();
    status.className = "status good";
    status.textContent = `Backend ready · ${health.mode}`;
  } catch (error) {
    showError(error);
  }
  await loadSources();
})();
