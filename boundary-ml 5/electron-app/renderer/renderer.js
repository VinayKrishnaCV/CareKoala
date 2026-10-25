const state = {
  sources: [],
  imageDataUrl: null,
  messages: [],
  analysis: null,
  busy: false,
  monitoring: false,
  timer: null,
  sourceId: null,
  guardianReady: false,
  pairFingerprint: null,
  testWarningPending: false,
  triggerList: [],
  shownInvitation: "",
  shownPairingPhase: "",
};

const $ = (id) => document.getElementById(id);
const operationStatus = $("operation-status");
const sourceSelect = $("source-select");
const preview = $("preview");

function changePage(name) {
  const navigation = document.querySelector(`[data-page="${name}"]`);
  $("page-label").textContent = navigation
    ? navigation.textContent.trim()
    : name;
  for (const page of document.querySelectorAll(".page"))
    page.hidden = page.id !== `page-${name}`;
  for (const item of document.querySelectorAll("[data-page]")) {
    const selected = item.dataset.page === name;
    item.classList.toggle("selected", selected);
    item.setAttribute("aria-selected", String(selected));
  }
  window.scrollTo({ top: 0, behavior: "instant" });
}
for (const item of document.querySelectorAll("[data-page]"))
  item.addEventListener("click", () => changePage(item.dataset.page));
for (const item of document.querySelectorAll("[data-go]"))
  item.addEventListener("click", () => changePage(item.dataset.go));
const messagesContainer = $("messages");
const analysisContainer = $("analysis");

function setBusy(active, text = "Working locally…") {
  state.busy = active;
  $("busy").hidden = !active || state.monitoring;
  $("busy-text").textContent = text;
  for (const button of document.querySelectorAll("button"))
    button.disabled = active;
  if (!active) {
    for (const button of document.querySelectorAll("button"))
      button.disabled = false;
    $("ocr-button").disabled = !state.imageDataUrl;
    $("analyze-button").disabled = state.messages.length === 0;
  }
  $("monitor-stop").disabled = !state.monitoring;
  $("monitor-start").disabled = active || state.monitoring;
  sourceSelect.disabled = active || state.monitoring;
  if (state.monitoring) {
    for (const id of [
      "capture-button",
      "refresh-sources",
      "upload-button",
      "ocr-button",
      "analyze-button",
    ])
      $(id).disabled = true;
    $("monitor-status").textContent = text;
  }
}

function showError(error) {
  analysisContainer.className = "analysis";
  analysisContainer.textContent = error?.message || String(error);
  operationStatus.textContent = error?.message || String(error);
  operationStatus.hidden = false;
}

async function loadSources() {
  try {
    const sources = await window.carekoala.listSources();
    state.sources = sources;
    sourceSelect.replaceChildren(
      ...sources.map((source, index) => {
        const option = document.createElement("option");
        option.value = String(index);
        option.textContent = source.name;
        return option;
      }),
    );
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
  analysisContainer.textContent =
    "Screenshot ready. Read it locally, then review the text.";
}

function renderMessages() {
  messagesContainer.replaceChildren();
  messagesContainer.className = "messages";
  state.messages.forEach((message, index) => {
    const row = document.createElement("div");
    row.className = "message-row";
    const text = document.createElement("textarea");
    text.value = message.text;
    text.setAttribute("aria-label", `Line ${index + 1}`);
    text.addEventListener("input", () => {
      state.messages[index].text = text.value;
    });
    const remove = document.createElement("button");
    remove.textContent = "×";
    remove.setAttribute("aria-label", `Remove line ${index + 1}`);
    remove.addEventListener("click", () => {
      state.messages.splice(index, 1);
      renderMessages();
    });
    row.append(text, remove);
    messagesContainer.append(row);
  });
  $("analyze-button").disabled = state.messages.length === 0;
}

function ocrLinesToMessages(result) {
  return (result.lines || []).map((line, index) => ({
    id: `M${index + 1}`,
    text: line.text,
    confidence: line.confidence,
  }));
}

function toApiMessages(messages) {
  return messages
    .map((message, index) => ({
      id: `M${index + 1}`,
      speaker: "other",
      text: message.text.trim(),
    }))
    .filter((message) => message.text);
}

async function runOcr() {
  if (!state.imageDataUrl) return;
  setBusy(true, "Releasing model memory, then reading the screenshot locally…");
  try {
    const result = await window.carekoala.ocrImage(state.imageDataUrl);
    state.messages = ocrLinesToMessages(result);
    renderMessages();
    $("ocr-status").textContent =
      `${state.messages.length} recognized lines · expand review to correct text`;
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
  if (result.mock)
    heading.textContent = "MOCK TEST — trained model was not run";
  analysisContainer.append(heading);
  if (Number.isInteger(result.score)) {
    heading.textContent = `Danger score: ${result.score}/10 · ${result.level}`;
    const summary = document.createElement("p");
    summary.textContent = `Category: ${result.category.replaceAll("_", " ")} · Guardian check-in: ${result.contact_guardian ? "Yes" : "No"} · ${result.windows} text windows. Scores describe screen content, not a diagnosis.`;
    analysisContainer.append(summary);
  }
  if (!result.concerns.length) {
    const text = document.createElement("p");
    text.textContent = result.mock
      ? "This is a keyword demo, not a safety assessment. Quit and start CareKoala without -Mock to analyze with the trained model."
      : Number.isInteger(result.score)
        ? "This score is below the guardian-alert threshold of 6. It is not a guarantee that a person is safe."
        : result.status === "no_clear_concern"
          ? "No listed concern is supported by the supplied text. This is not a guarantee that a person is safe."
          : "More context is needed before interpreting this interaction.";
    analysisContainer.append(text);
  }
  if (result.triggerMatches > 0) {
    const card = document.createElement("div");
    card.className = "analysis-card";
    const title = document.createElement("strong");
    title.textContent = "Personal trigger list";
    const explanation = document.createElement("span");
    explanation.textContent =
      result.triggerMatches === 1
        ? "This text includes 1 word or phrase from your trigger list."
        : `This text includes ${result.triggerMatches} words or phrases from your trigger list.`;
    card.append(title, explanation);
    analysisContainer.append(card);
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
  if (result.status === "concern_detected" || result.triggerMatches > 0) {
    stopMonitoring("Paused for guardian recommendation. Restart when ready.");
    showGuardianRecommendation(result);
  }
}

function showGuardianRecommendation(result) {
  $("guardian-reason").textContent =
    result.status === "concern_detected"
      ? "CareKoala found a concern in the text you reviewed. You can ask your paired guardian for help."
      : "This text includes something from your personal trigger list. You can ask your paired guardian for help.";
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
    $("guardian-status").textContent =
      "Encrypted check-in request published. Guardian receipt is not yet confirmed.";
    $("guardian-dismiss").textContent = "Close";
  } catch (error) {
    $("guardian-status").textContent =
      error?.message || "The help alert could not be sent.";
    $("guardian-send").disabled = false;
  }
}

async function analyze() {
  const cleaned = toApiMessages(state.messages);
  if (!cleaned.length) return;
  const boundaries = $("boundaries")
    .value.split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
  setBusy(true, "Analyzing locally...");
  try {
    const result = await window.carekoala.analyze({
      conversation_id: `local-${Date.now()}`,
      messages: cleaned,
      boundaries,
    });
    renderAnalysis(result);
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
  try {
    await captureFresh(source.id);
  } catch (error) {
    showError(error);
  } finally {
    setBusy(false);
  }
});
function stopMonitoring(
  message = "Periodic capture stopped. Any active stage will finish safely.",
) {
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
    $("ocr-status").textContent =
      `${state.messages.length} recognized lines · expand review to correct text`;
    const lines = toApiMessages(state.messages);
    if (lines.length) {
      $("monitor-status").textContent = "OCR finished. Analyzing locally…";
      const result = await window.carekoala.analyze({
        conversation_id: `local-${Date.now()}`,
        messages: lines,
        boundaries: $("boundaries")
          .value.split("\n")
          .map((s) => s.trim())
          .filter(Boolean),
      });
      if (!state.monitoring) return;
      renderAnalysis(result);
    } else {
      analysisContainer.textContent =
        "No readable text found. Try another window or a larger view of the text.";
    }
  } catch (error) {
    stopMonitoring(
      "Periodic capture paused after an error. Review the message and restart.",
    );
    showError(error);
  } finally {
    setBusy(false);
    if (state.monitoring) {
      const delay = Number($("capture-interval").value) * 1000;
      $("monitor-status").textContent =
        `Cycle complete. Next capture in ${delay / 1000} seconds.`;
      state.timer = setTimeout(captureCycle, delay);
    }
  }
}
$("monitor-start").addEventListener("click", () => {
  if (state.busy || state.monitoring) return;
  const source = state.sources[Number(sourceSelect.value)];
  if (!source) {
    showError(new Error("Select a screen or window first."));
    return;
  }
  state.sourceId = source.id;
  state.monitoring = true;
  captureCycle();
});
$("monitor-stop").addEventListener("click", () => {
  stopMonitoring();
  setBusy(state.busy);
});
window.addEventListener("beforeunload", () => stopMonitoring());
$("upload-button").addEventListener("click", async () => {
  const value = await window.carekoala.chooseImage();
  if (value) setImage(value);
});
$("ocr-button").addEventListener("click", runOcr);
$("analyze-button").addEventListener("click", analyze);
$("guardian-send").addEventListener("click", sendGuardianAlert);
$("guardian-dismiss").addEventListener("click", hideGuardianRecommendation);

(async () => {
  try {
    await window.carekoala.health();
  } catch (error) {
    showError(error);
  }
  await loadSources();
})();

$("guardian-test-send").addEventListener("click", async () => {
  if (state.testWarningPending) return;
  state.testWarningPending = true;
  $("guardian-test-send").disabled = true;
  $("guardian-test-status").textContent = "Sending encrypted test warning…";
  try {
    await window.carekoala.sendTestWarning();
    $("guardian-test-status").textContent =
      "Encrypted test warning published to ntfy.sh. Check your Android notification; receipt is not yet confirmed.";
  } catch (error) {
    $("guardian-test-status").textContent =
      error.message || "Test warning could not be sent.";
  } finally {
    state.testWarningPending = false;
    $("guardian-test-send").disabled = false;
  }
});
function renderRealStatus(value) {
  if (!value) return;
  $("real-status").textContent =
    value.status +
    (Number.isInteger(value.score)
      ? ` · Score: ${value.score}/10 (${value.level}, ${value.category.replaceAll("_", " ")})`
      : "") +
    (value.decision === true
      ? " · Check-in: Yes"
      : value.decision === false
        ? " · Check-in: No"
        : "") +
    (value.triggered ? " · Personal trigger word found" : "");
  $("real-start").disabled = value.running;

  const details = $("real-progress");
  if (details)
    details.textContent = `Completed cycles: ${value.cycles || 0} · OCR items: ${value.recognizedItems ?? "waiting"} · Last model check: ${value.lastCheck ? new Date(value.lastCheck).toLocaleTimeString() : "not yet"} · Last alert published: ${value.lastPublication ? new Date(value.lastPublication).toLocaleTimeString() : "none"}. Publication does not confirm phone receipt.`;
}
async function refreshSettings() {
  const value = await window.carekoala.settings();
  $("startup-enabled").checked = value.startAtLogin;
  state.guardianReady = !!value.paired && !!value.guardianRsa;
  $("pair-status").textContent = state.guardianReady
    ? "Keys configured. Your guardian phone receives encrypted check-ins while its receiver is enabled."
    : value.paired
      ? "Alert pairing is saved. Complete guardian unlock setup using the single-code flow."
      : "Connect your guardian using one QR code or single code.";
  $("pair-badge").textContent = state.guardianReady
    ? "Connected"
    : value.paired
      ? "Finish setup"
      : "Not connected";
  $("pair-badge").className =
    "status " + (state.guardianReady ? "good" : "neutral");
  $("guardian-name").textContent = value.guardianName || "Your guardian";
  $("guardian-summary").textContent = state.guardianReady
    ? `${value.guardianName || "Your guardian"} is paired for private alerts and guardian unlock.`
    : "No guardian paired.";
  $("real-start").textContent = state.guardianReady
    ? "Start real mode"
    : "Configure guardian";
  if (!$("pair-user-name").value)
    $("pair-user-name").value = value.userName || "";
  $("pair-fingerprint").textContent = value.fingerprint
    ? `Fingerprint: ${value.fingerprint}`
    : "";
  renderRealStatus(value.auto);
  $("rsa-status").textContent = value.guardianRsa
    ? "Guardian public key saved · " + value.guardianRsa
    : "Guardian public key required for lockdown protection.";
  renderTriggers(value.triggers);
}

function renderTriggers(list) {
  state.triggerList = list || [];
  $("trigger-summary").textContent =
    `Personal trigger words · ${state.triggerList.length} saved`;
  $("trigger-list").replaceChildren(
    ...state.triggerList.map((item) => {
      const row = document.createElement("li");
      const text = document.createElement("span");
      text.textContent = item;
      const remove = document.createElement("button");
      remove.className = "secondary";
      remove.textContent = "Remove";
      remove.setAttribute("aria-label", `Remove ${item}`);
      remove.addEventListener("click", () =>
        saveTriggers(
          state.triggerList.filter((other) => other !== item),
          "Removed.",
        ),
      );
      row.append(text, remove);
      return row;
    }),
  );
}
async function saveTriggers(list, done) {
  const before = state.triggerList.length;
  try {
    renderTriggers(await window.carekoala.saveTriggers(list));
  } catch (error) {
    $("trigger-status").textContent = error.message;
    return false;
  }

  $("trigger-status").textContent =
    list.length > before && state.triggerList.length === before
      ? "That word or phrase is already on your list."
      : done;
  return true;
}
async function addTrigger() {
  const value = $("trigger-input").value.trim();
  if (!value) {
    $("trigger-status").textContent = "Type a word or phrase first.";
    return;
  }
  if (
    await saveTriggers(
      [...state.triggerList, value],
      "Saved. Real mode will watch for it.",
    )
  )
    $("trigger-input").value = "";
}
$("trigger-add").addEventListener("click", addTrigger);
$("trigger-input").addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    addTrigger();
  }
});
const realAction = (fn) => async () => {
  try {
    await fn();
  } catch (error) {
    $("real-status").textContent = error.message;
  }
};
$("real-start").addEventListener(
  "click",
  realAction(async () => {
    if (!state.guardianReady) {
      changePage("guardian");
      $("pair-user-name").focus();
      return;
    }
    stopMonitoring();
    renderRealStatus(await window.carekoala.startReal());
  }),
);
$("real-stop").addEventListener(
  "click",
  realAction(async () => renderRealStatus(await window.carekoala.stopReal())),
);
$("startup-enabled").addEventListener(
  "change",
  realAction(async () => {
    try {
      await window.carekoala.setStartup($("startup-enabled").checked);
    } finally {
      await refreshSettings();
    }
  }),
);
$("pair-create").addEventListener(
  "click",
  realAction(async () => {
    const pair = await window.carekoala.createPairing();
    state.pairFingerprint = pair.fingerprint;
    $("pair-code").value = pair.code;
    $("pair-code").hidden = false;
    $("pair-verify").disabled = false;
    await refreshSettings();
  }),
);
$("pair-verify").addEventListener(
  "click",
  realAction(async () => {
    await window.carekoala.verifyPairing(state.pairFingerprint);
    $("pair-code").value = "";
    $("pair-code").hidden = true;
    $("pair-verify").disabled = true;
    await refreshSettings();
  }),
);
$("pair-forget").addEventListener(
  "click",
  realAction(async () => {
    await window.carekoala.forgetPairing();
    $("pair-code").value = "";
    $("pair-code").hidden = true;
    $("pair-verify").disabled = true;
    await refreshSettings();
  }),
);
window.carekoala.onAutoStatus(renderRealStatus);
refreshSettings().catch((error) => {
  $("real-status").textContent = error.message;
});

$("rsa-import").addEventListener("click", async () => {
  $("rsa-import").disabled = true;
  try {
    await window.carekoala.importGuardianKey(
      $("rsa-code").value.trim(),
      $("rsa-fingerprint").value.trim(),
    );
    $("rsa-code").value = "";
    $("rsa-fingerprint").value = "";
    await refreshSettings();
  } catch (error) {
    $("rsa-status").textContent = error.message;
  } finally {
    $("rsa-import").disabled = false;
  }
});
$("lockdown-demo").addEventListener(
  "click",
  realAction(async () => {
    stopMonitoring();
    await window.carekoala.lockdownDemo();
  }),
);
function renderDomain(s) {
  $("domain-status").textContent =
    s.message + (s.count ? ` (${s.count.toLocaleString()} domains)` : "");
}
for (const [id, mode] of [
  ["domain-enable", "Enable"],
  ["domain-update", "Update"],
  ["domain-disable", "Disable"],
]) {
  $(id).addEventListener("click", async () => {
    for (const button of ["domain-enable", "domain-update", "domain-disable"])
      $(button).disabled = true;
    $("domain-status").textContent =
      "Waiting for Windows administrator approval and blocklist update…";
    try {
      renderDomain(await window.carekoala.domainChange(mode));
    } catch (e) {
      $("domain-status").textContent = e.message;
    } finally {
      for (const button of ["domain-enable", "domain-update", "domain-disable"])
        $(button).disabled = false;
    }
  });
}
window.carekoala
  .domainStatus()
  .then(renderDomain)
  .catch((e) => {
    $("domain-status").textContent = e.message;
  });

function renderPairing(value) {
  if (!value) return;
  const active = !!value.code;
  $("pairing-invite").hidden = !active;
  $("pairing-cancel").hidden = !active;
  $("pairing-code").value = value.code || "";
  if (value.qr) $("pairing-qr").src = value.qr;
  else $("pairing-qr").removeAttribute("src");
  $("pairing-expiry").textContent = value.expires
    ? `Expires at ${new Date(value.expires * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}. Keep this PC online until pairing finishes.`
    : "";
  $("pairing-message").textContent = value.message || "";
  $("pairing-confirm").hidden = value.phase !== "confirm";
  $("pairing-candidate").textContent =
    `${value.candidate || "Your guardian"} is ready to connect`;
  if (active && value.code !== state.shownInvitation) {
    requestAnimationFrame(() =>
      $("pairing-invite").scrollIntoView({
        block: "center",
        behavior: "smooth",
      }),
    );
    state.shownInvitation = value.code;
  }
  if (value.phase === "confirm" && state.shownPairingPhase !== "confirm")
    requestAnimationFrame(() =>
      $("pairing-confirm").scrollIntoView({
        block: "center",
        behavior: "smooth",
      }),
    );
  state.shownPairingPhase = value.phase;
  if (value.phase === "complete")
    refreshSettings().catch((e) => {
      $("pairing-message").textContent = e.message;
    });
}
async function pairingAction(action) {
  for (const id of ["pairing-start", "pairing-approve", "pairing-cancel"])
    $(id).disabled = true;
  try {
    renderPairing(await action());
  } catch (e) {
    $("pairing-message").textContent = e.message;
  } finally {
    for (const id of ["pairing-start", "pairing-approve", "pairing-cancel"])
      $(id).disabled = false;
  }
}
$("pairing-start").addEventListener("click", () =>
  pairingAction(async () => {
    if (
      state.guardianReady &&
      !confirm(
        "Replace the current guardian connection? It stays connected until the new guardian is approved.",
      )
    )
      return window.carekoala.pairingStatus();
    stopMonitoring();
    return window.carekoala.beginPairing($("pair-user-name").value);
  }),
);
$("pairing-approve").addEventListener("click", () =>
  pairingAction(() => window.carekoala.approvePairing()),
);
$("pairing-cancel").addEventListener("click", () =>
  pairingAction(() => window.carekoala.cancelPairing()),
);
$("pairing-copy").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText($("pairing-code").value);
    $("pairing-message").textContent =
      "Single code copied. Share it privately with your guardian.";
  } catch {
    $("pairing-code").select();
    $("pairing-message").textContent =
      "Select and copy the code, then share it privately.";
  }
});
window.carekoala.onPairingState(renderPairing);
window.carekoala
  .pairingStatus()
  .then(renderPairing)
  .catch((e) => {
    $("pairing-message").textContent = e.message;
  });
