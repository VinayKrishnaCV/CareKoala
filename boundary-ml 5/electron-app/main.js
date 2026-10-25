const { batches, merge, protectPipe } = require("./pipeline");
const { mockMode, endpoint, validateResult } = require("./analysis-mode");
const MOCK_MODE = mockMode(process.argv);
protectPipe(process.stdout);
protectPipe(process.stderr);
const {
  app,
  BrowserWindow,
  desktopCapturer,
  dialog,
  ipcMain,
  Tray,
  Menu,
  nativeImage,
  Notification,
  powerMonitor,
} = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { AutoMode } = require("./auto-mode");
const { Settings } = require("./settings");
const settings = new Settings();
const { Enrollment } = require("./enrollment");
let enrollment;
const { Lockdown } = require("./lockdown");
const lockdownProtocol = require("./lockdown-protocol");
const { DomainProtection } = require("./domain-protection");
const domainProtection = new DomainProtection();
const triggers = require("./triggers");
let lockdown;
let mainWindow,
  tray,
  quitting = false,
  auto;

app.setPath("userData", path.join(app.getPath("appData"), "carekoala-desktop"));
const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) app.quit();
app.on("second-instance", () => {
  mainWindow?.show();
  mainWindow?.focus();
});

const ENGINE = app.isPackaged
  ? path.join(process.resourcesPath, "engine")
  : null;
const PROJECT_ROOT = ENGINE
  ? path.join(ENGINE, "backend")
  : path.resolve(__dirname, "..");
if (ENGINE) {
  Object.assign(process.env, {
    CAREKOALA_MODEL_ROOT: path.join(ENGINE, "model"),
    CAREKOALA_LLAMA_SERVER: path.join(ENGINE, "llama", "llama-server.exe"),
    CAREKOALA_OCR_MODELS: path.join(ENGINE, "easyocr"),

    PYTHONNOUSERSITE: "1",
    PYTHONDONTWRITEBYTECODE: "1",
    PYTHONUTF8: "1",
  });
  delete process.env.PYTHONHOME;
  delete process.env.PYTHONPATH;
}
const BACKEND_URL =
  process.env.CAREKOALA_BACKEND_URL || "http://127.0.0.1:8765";
let backendProcess = null;
let heavyQueue = Promise.resolve();
const workers = new Set();
function track(child) {
  workers.add(child);
  child.once("close", () => workers.delete(child));
  return child;
}
function terminate(child) {
  if (!child?.pid) return;
  if (process.platform === "win32")
    spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    }).on("error", () => {});
  else child.kill("SIGKILL");
}

function handle(channel, callback) {
  ipcMain.handle(channel, async (...args) => {
    try {
      return { ok: true, value: await callback(...args) };
    } catch (error) {
      return {
        ok: false,
        error: error.message || "Local operation failed. Please retry.",
      };
    }
  });
}

function pythonPath() {
  if (ENGINE) return path.join(ENGINE, "python", "python.exe");
  if (process.env.CAREKOALA_PYTHON) return process.env.CAREKOALA_PYTHON;
  const candidate =
    process.platform === "win32"
      ? path.join(PROJECT_ROOT, ".venv", "Scripts", "python.exe")
      : path.join(PROJECT_ROOT, ".venv", "bin", "python");
  return candidate;
}

async function health() {
  try {
    const response = await fetch(`${BACKEND_URL}/health`, {
      signal: AbortSignal.timeout(1500),
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

async function waitForBackend(timeoutMs = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await health();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error("CareKoala backend did not start within 30 seconds.");
}

async function ensureBackend() {
  const existing = await health();
  if (existing) return existing;
  if (backendProcess) return waitForBackend();

  const env = {
    ...process.env,
    CAREKOALA_MOCK: MOCK_MODE ? "1" : "0",
  };
  backendProcess = spawn(
    pythonPath(),
    [
      "-m",
      "uvicorn",
      "boundary_ml.api:app",
      "--host",
      "127.0.0.1",
      "--port",
      "8765",
      "--no-access-log",
    ],
    {
      cwd: PROJECT_ROOT,
      env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  backendProcess.stdout.on("data", (data) =>
    console.log(`[backend] ${String(data).trim()}`),
  );
  backendProcess.stderr.on("data", (data) =>
    console.error(`[backend] ${String(data).trim()}`),
  );
  backendProcess.on("error", (error) =>
    console.error(`[backend] failed to start: ${error.message}`),
  );
  backendProcess.on("exit", () => {
    backendProcess = null;
  });
  return waitForBackend();
}

function serialHeavyTask(task) {
  const run = heavyQueue.then(task, task);
  heavyQueue = run.catch(() => undefined);
  return run;
}

async function releaseModel() {
  await ensureBackend();
  const response = await fetch(`${BACKEND_URL}/model/release`, {
    method: "POST",
  });
  if (!response.ok)
    throw new Error("Could not release model memory before OCR.");
}

function runOcrProcess(imagePath) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      pythonPath(),
      [path.join(__dirname, "python", "ocr_easy.py"), "--image", imagePath],
      {
        cwd: PROJECT_ROOT,
        windowsHide: true,
        env: {
          ...process.env,
          PYTHONIOENCODING: "utf-8",
          OMP_NUM_THREADS: process.env.CAREKOALA_OCR_THREADS || "2",
          MKL_NUM_THREADS: process.env.CAREKOALA_OCR_THREADS || "2",
          VECLIB_MAXIMUM_THREADS: process.env.CAREKOALA_OCR_THREADS || "2",
          TOKENIZERS_PARALLELISM: "false",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    track(child);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (data) => {
      stdout += data;
    });
    child.stderr.on("data", (data) => {
      stderr += data;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `EasyOCR exited with code ${code}.`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch {
        reject(new Error("EasyOCR returned invalid JSON."));
      }
    });
  });
}

function decodeImageDataUrl(dataUrl) {
  const match = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(
    dataUrl || "",
  );
  if (!match) throw new Error("Expected a PNG or JPEG image.");
  const data = Buffer.from(match[2], "base64");
  if (data.length > 15 * 1024 * 1024)
    throw new Error("Image exceeds the 15 MB local limit.");
  return { data, extension: match[1] === "jpeg" ? "jpg" : "png" };
}

async function ocrDataUrl(dataUrl) {
  return serialHeavyTask(async () => {
    await releaseModel();
    const decoded = decodeImageDataUrl(dataUrl);
    const temporary = path.join(
      os.tmpdir(),
      `boundary-${process.pid}-${Date.now()}.${decoded.extension}`,
    );
    await fs.writeFile(temporary, decoded.data, { mode: 0o600 });
    try {
      return await runOcrProcess(temporary);
    } finally {
      await fs.rm(temporary, { force: true });
    }
  });
}

async function analyze(payload, real = false) {
  return serialHeavyTask(async () => {
    await ensureBackend();
    if (
      payload.boundaries.length > 12 ||
      payload.boundaries.some((b) => b.length > 300)
    )
      throw new Error("Use up to 12 boundaries, each under 300 characters.");
    const results = [];
    for (const messages of batches(payload.messages)) {
      const response = await fetch(
        `${BACKEND_URL}${endpoint(MOCK_MODE, real)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...payload, messages }),
        },
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 422)
          throw new Error(
            "Please review the conversation and boundaries. Some values exceed the supported limits.",
          );
        throw new Error(
          body.detail?.message ||
            "Local analysis failed. Please retry with a smaller capture area.",
        );
      }
      results.push(validateResult(body, MOCK_MODE && !real));
    }
    return { ...merge(results), mock: MOCK_MODE && !real };
  });
}

async function sendGuardianAlert(test = false) {
  if (!settings.public().paired)
    throw new Error(
      "No verified guardian is paired. Open guardian setup first.",
    );
  return new Promise((resolve, reject) => {
    const child = spawn(
      pythonPath(),
      ["-m", "boundary_ml.guardian_worker", ...(test ? ["--test"] : [])],
      {
        cwd: PROJECT_ROOT,
        windowsHide: true,
        env: { ...process.env, PYTHONIOENCODING: "utf-8" },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    track(child);
    const deadline = setTimeout(() => terminate(child), 45000);
    child.once("close", () => clearTimeout(deadline));
    let output = "";
    child.stdout.on("data", (d) => (output += d));
    child.stderr.resume();
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(
          new Error(
            "Encrypted publication failed or timed out. Guardian receipt is unconfirmed.",
          ),
        );
        return;
      }
      try {
        resolve(JSON.parse(output));
      } catch {
        reject(new Error("Invalid guardian transport response."));
      }
    });
    child.stdin.on("error", () => {});
    child.stdin.end(JSON.stringify(settings.pair()));
  });
}

function trayIcon() {
  const pixels = Buffer.alloc(32 * 32 * 4);
  for (let y = 2; y < 30; y++) {
    for (let x = 2; x < 30; x++) {
      const radius = Math.hypot(x - 16, y - 16);
      const mark =
        radius >= 7 && radius <= 10 && !(x > 19 && Math.abs(y - 16) < 6);
      const offset = (y * 32 + x) * 4;
      const color = mark ? [249, 253, 255] : [45, 71, 131];
      pixels.set([...color, 255], offset);
    }
  }
  return nativeImage.createFromBitmap(pixels, { width: 32, height: 32 });
}
function refreshTray() {
  if (!tray || !auto) return;
  tray.setToolTip(`CareKoala: ${auto.status}`.slice(0, 120));
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "Open CareKoala",
        click: () => {
          mainWindow.show();
          mainWindow.focus();
        },
      },
      {
        label: auto.running ? "Pause real mode" : "Start real mode",
        click: () => {
          (auto.running ? pauseReal() : startReal()).catch((e) =>
            auto.update(`Paused: ${e.message}`),
          );
        },
      },
      {
        label: "Quit CareKoala",
        click: () => {
          quitting = true;
          auto.stop();
          app.quit();
        },
      },
    ]),
  );
  mainWindow?.webContents.send("carekoala:auto-status", auto.snapshot());
}
let startingReal = false,
  screenLocked = false,
  suspended = false;
async function startReal() {
  if (lockdown?.active) throw Error("Enter the guardian unlock key first.");
  if (startingReal || auto.running) return;
  if (screenLocked || suspended)
    throw new Error("Waiting for an unlocked, awake desktop.");
  if (!settings.public().paired)
    throw new Error(
      "Pair and verify a guardian before starting automatic check-in alerts.",
    );
  if (!settings.data.guardianRsa)
    throw Error(
      "Import and verify your Android guardian public key to enable score 8+ protection.",
    );
  if (auto.pending)
    throw new Error("The previous cycle is still finishing. Please wait.");
  startingReal = true;
  try {
    await settings.setResume(true);
    if (!settings.data.resumeReal || quitting || screenLocked || suspended)
      return;
    mainWindow?.hide();
    auto.start();
  } finally {
    startingReal = false;
  }
}
async function pauseReal() {
  auto.stop();
  await settings.setResume(false);
  return auto.snapshot();
}
async function resumeSaved() {
  if (lockdown?.active) return;
  if (auto?.running || screenLocked || suspended) return;
  if (auto?.pending) await auto.pending;
  if (
    !quitting &&
    settings.data.resumeReal &&
    settings.public().paired &&
    !auto.running
  )
    await startReal().catch((e) => auto.update(`Paused: ${e.message}`));
}
function loginArgs() {
  return app.isPackaged
    ? ["--auto-real"]
    : [path.resolve(__dirname), "--auto-real"];
}
async function initializeBackground() {
  await settings.load();
  enrollment = new Enrollment({
    settings,
    encrypt: encryptLockdown,
    encodeQr: (code) =>
      require("qrcode").toDataURL(code, {
        width: 280,
        margin: 3,
        errorCorrectionLevel: "M",
      }),
    changed: (state) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setContentProtection(!!state.code);
        mainWindow.webContents.send("carekoala:pairing-state", state);
      }
    },
  });
  lockdown = new Lockdown(settings, encryptLockdown, () => {
    mainWindow?.show();
    auto?.update(
      "Unlocked by guardian. Review the screen before restarting real mode.",
    );
  });
  auto = new AutoMode({
    capture: async () => {
      if (!auto.cycles)
        await new Promise((resolve) => setTimeout(resolve, 250));
      const sources = await desktopCapturer.getSources({
        types: ["screen"],
        thumbnailSize: { width: 1920, height: 1080 },
      });
      if (!sources.length || sources.some((s) => s.thumbnail.isEmpty()))
        throw new Error("Entire-screen capture unavailable.");
      return sources.map((s) => s.thumbnail.toDataURL());
    },
    ocr: ocrDataUrl,
    hash: (t) => crypto.createHash("sha256").update(t).digest("hex"),
    decide: async (messages) => {
      const r = await analyze(
        { conversation_id: "auto-local", messages, boundaries: [] },
        true,
      );
      auto.score = r.score;
      auto.level = r.level;
      auto.category = r.category;
      return Number.isInteger(r.score) ? r.score >= 6 : null;
    },
    triggers: (messages) =>
      triggers.matches(
        settings.data.triggers,
        messages.map((m) => m.text),
      ),
    lockdown: async () => {
      await settings.setResume(false);
      await lockdown.trigger(false);
    },
    alert: async () => {
      await sendGuardianAlert();
      return "Encrypted check-in request published; guardian receipt unconfirmed";
    },
    changed: (state) => {
      refreshTray();
      if (state.error) {
        mainWindow?.show();
        mainWindow?.focus();
      }
    },
  });
  tray = new Tray(trayIcon());
  tray.on("double-click", () => mainWindow?.show());
  refreshTray();
  powerMonitor.on("lock-screen", () => {
    screenLocked = true;
    auto.stop("Paused while Windows is locked; resumes after unlock.");
  });
  powerMonitor.on("suspend", () => {
    suspended = true;
    auto.stop("Paused while the computer sleeps; resumes after wake.");
  });
  powerMonitor.on("unlock-screen", () => {
    screenLocked = false;
    resumeSaved();
  });
  powerMonitor.on("resume", () => {
    suspended = false;
    resumeSaved();
  });
  if (lockdown.active) {
    lockdown.show();
    await lockdown.publish();
  } else if (!MOCK_MODE) await resumeSaved();
}

function encryptLockdown(publicKey, payload) {
  return new Promise((resolve, reject) => {
    const child = track(
      spawn(pythonPath(), ["-m", "boundary_ml.lockdown_worker"], {
        cwd: PROJECT_ROOT,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      }),
    );
    let output = "";
    child.stdout.on("data", (d) => (output += d));
    child.stderr.resume();
    const timer = setTimeout(() => terminate(child), 15000);
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      try {
        if (code !== 0) throw Error("Guardian encryption failed.");
        resolve(JSON.parse(output).rsa);
      } catch (e) {
        reject(e);
      }
    });
    child.stdin.on("error", () => {});
    child.stdin.end(JSON.stringify({ public: publicKey, payload }));
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 900,
    minHeight: 650,
    backgroundColor: "#f5f2ec",
    title: "CareKoala",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow = win;
  win.on("close", (event) => {
    if (tray && !quitting) {
      event.preventDefault();
      win.hide();
    }
  });
  win.removeMenu();
  win.webContents.on("did-finish-load", () => {
    console.log("CareKoala Electron UI loaded");
    const smokeExitMs = Number(process.env.CAREKOALA_SMOKE_EXIT_MS || 0);
    if (smokeExitMs > 0) setTimeout(() => app.quit(), smokeExitMs);
  });
  win.webContents.on("did-fail-load", (_event, code, description) => {
    console.error(`Boundary renderer failed to load (${code}): ${description}`);
  });
  win.loadFile(path.join(__dirname, "renderer", "index.html"));
}

handle("carekoala:health", async () => ({
  ...(await ensureBackend()),
  mode: MOCK_MODE ? "mock — trained model OFF" : "trained CareKoala v2",
}));
handle("carekoala:list-sources", async () => {
  const sources = await desktopCapturer.getSources({
    types: ["screen", "window"],
    thumbnailSize: { width: 1440, height: 900 },
    fetchWindowIcons: false,
  });
  return sources.map((source) => ({
    id: source.id,
    name: source.name,
    thumbnail: source.thumbnail.toDataURL(),
  }));
});
handle("carekoala:capture-source", async (_event, sourceId) => {
  const sources = await desktopCapturer.getSources({
    types: ["screen", "window"],
    thumbnailSize: { width: 1920, height: 1080 },
  });
  const source = sources.find((s) => s.id === sourceId);
  if (!source || source.thumbnail.isEmpty())
    throw new Error(
      "Selected window is unavailable. Select it again or restore the window.",
    );
  return source.thumbnail.toDataURL();
});
handle("carekoala:ocr-image", (_event, dataUrl) => {
  if (auto?.pending) throw new Error("Pause real mode before manual OCR.");
  return ocrDataUrl(dataUrl);
});
handle("carekoala:choose-image", async () => {
  const selection = await dialog.showOpenDialog({
    properties: ["openFile"],
    filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg"] }],
  });
  if (selection.canceled || !selection.filePaths[0]) return null;
  const file = selection.filePaths[0];
  const extension =
    path.extname(file).toLowerCase() === ".png" ? "png" : "jpeg";
  const bytes = await fs.readFile(file);
  if (bytes.length > 15 * 1024 * 1024)
    throw new Error("Image exceeds the 15 MB local limit.");
  return `data:image/${extension};base64,${bytes.toString("base64")}`;
});
handle("carekoala:analyze", async (_event, payload) => {
  if (auto?.pending) throw new Error("Pause real mode before manual analysis.");
  const result = await analyze(payload);

  return {
    ...result,
    triggerMatches: triggers.matches(
      settings.data.triggers,
      payload.messages.map((m) => String(m.text)),
    ).length,
  };
});
handle("carekoala:send-guardian-alert", (_event, payload) => {
  if (
    payload?.analysis?.status !== "concern_detected" &&
    !(payload?.analysis?.triggerMatches > 0)
  )
    throw new Error("A detected concern is required.");
  return sendGuardianAlert();
});

let testWarningPending = false;
handle("carekoala:send-test-warning", async () => {
  if (testWarningPending)
    throw new Error("A test warning is already being sent.");
  testWarningPending = true;
  try {
    return await sendGuardianAlert(true);
  } finally {
    testWarningPending = false;
  }
});
handle("carekoala:settings", () => ({
  ...settings.public(),
  guardianRsa: settings.data.guardianRsa?.fingerprint,
  triggers: settings.data.triggers || [],
  auto: auto?.snapshot(),
}));
handle("carekoala:pairing-start", async (_event, name) => {
  requireUnlocked();
  if (auto?.pending)
    throw Error(
      "Pause monitoring and wait for the current stage before pairing.",
    );
  await settings.setResume(false);
  return enrollment.start(name);
});
handle(
  "carekoala:pairing-status",
  () => enrollment?.snapshot() || { phase: "idle" },
);
handle("carekoala:pairing-approve", async () => {
  requireUnlocked();
  if (auto?.pending)
    throw Error("Pause monitoring before changing the guardian.");
  return enrollment.approve();
});
handle("carekoala:pairing-cancel", () => {
  if (enrollment?.approving) throw Error("Wait for pairing to finish saving.");
  enrollment?.cancel();
  return enrollment?.snapshot();
});
function requireUnlocked() {
  if (lockdown?.active || lockdown?.creating)
    throw Error("Unlock CareKoala before changing protection settings.");
}
handle("carekoala:triggers-save", async (_event, list) => {
  requireUnlocked();
  settings.data.triggers = triggers.clean(list);
  await settings.save();
  return settings.data.triggers;
});
handle("carekoala:rsa-import", async (_event, code, expected) => {
  requireUnlocked();
  if (auto?.running || auto?.pending)
    throw Error(
      "Pause real mode and wait for the current cycle to finish first.",
    );
  if (!settings.public().paired)
    throw Error("Verify your guardian pairing first.");
  const key = lockdownProtocol.publicKey(code, settings.public().fingerprint);
  if (key.fingerprint !== lockdownProtocol.normalizeFingerprint(expected))
    throw Error(
      "The public-key fingerprints do not match. Copy both fields from the same paired Android phone. Your saved guardian key has not been changed.",
    );
  settings.data.guardianRsa = key;
  await settings.save();
  return key.fingerprint;
});
handle("carekoala:lockdown-demo", async () => {
  requireUnlocked();
  if (auto?.pending)
    throw Error(
      "Pause real mode and wait for the current stage to finish before the demo.",
    );
  await settings.setResume(false);
  return lockdown.trigger(true);
});
handle("lockdown:unlock", async (event, key) => {
  if (!lockdown?.trusted(event.sender)) throw Error("Invalid unlock window.");
  return lockdown.unlock(key);
});
handle("lockdown:resend", async (event) => {
  if (!lockdown?.trusted(event.sender)) throw Error("Invalid unlock window.");
  return lockdown.publish();
});
handle("carekoala:domain-status", () => domainProtection.status());
handle("carekoala:domain-change", async (_event, mode) => {
  requireUnlocked();
  return domainProtection.change(mode);
});
handle("carekoala:create-pairing", async () => {
  requireUnlocked();
  if (enrollment?.approving) throw Error("Wait for pairing to finish.");
  enrollment?.cancel();
  auto.stop();
  settings.data.guardianRsa = null;
  return settings.createPair();
});
handle("carekoala:verify-pairing", (_event, fingerprint) =>
  settings.verify(fingerprint),
);
handle("carekoala:forget-pairing", async () => {
  requireUnlocked();
  if (enrollment?.approving) throw Error("Wait for pairing to finish.");
  enrollment?.cancel();
  auto.stop();
  settings.data.guardianRsa = null;
  return settings.forget();
});
handle("carekoala:auto-start", async () => {
  await startReal();
  return auto.snapshot();
});
handle("carekoala:auto-stop", () => pauseReal());
handle("carekoala:startup", async (_event, enabled) => {
  if (typeof enabled !== "boolean") throw new Error("Invalid startup setting.");
  if (enabled && !settings.public().paired)
    throw new Error(
      "Pair a guardian before enabling automatic real mode at sign-in.",
    );
  app.setLoginItemSettings({
    openAtLogin: enabled,
    path: process.execPath,
    args: loginArgs(),
  });
  settings.data.startAtLogin = enabled;
  await settings.save();
  return settings.public();
});
app
  .whenReady()
  .then(async () => {
    if (!singleInstance) return;
    createWindow();
    await initializeBackground();
  })
  .catch((error) => {
    console.error(error.message);
  });
app.on("window-all-closed", () => {
  if (!tray && process.platform !== "darwin") app.quit();
});
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
app.on("before-quit", (event) => {
  if (lockdown?.active) {
    event.preventDefault();
    quitting = false;
    lockdown.show();
    return;
  }
  quitting = true;
  auto?.stop();
  tray?.destroy();
  tray = null;
  enrollment?.cancel();
  for (const child of workers) terminate(child);
  if (backendProcess) terminate(backendProcess);
});
