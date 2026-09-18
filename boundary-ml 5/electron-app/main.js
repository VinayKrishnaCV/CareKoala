const { app, BrowserWindow, desktopCapturer, dialog, ipcMain } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const BACKEND_URL = process.env.BOUNDARY_BACKEND_URL || "http://127.0.0.1:8765";
let backendProcess = null;
let heavyQueue = Promise.resolve();

function pythonPath() {
  if (process.env.BOUNDARY_PYTHON) return process.env.BOUNDARY_PYTHON;
  const candidate = process.platform === "win32"
    ? path.join(PROJECT_ROOT, ".venv", "Scripts", "python.exe")
    : path.join(PROJECT_ROOT, ".venv", "bin", "python");
  return candidate;
}

async function health() {
  try {
    const response = await fetch(`${BACKEND_URL}/health`, { signal: AbortSignal.timeout(1500) });
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
  throw new Error("Boundary backend did not start within 30 seconds.");
}

async function ensureBackend() {
  const existing = await health();
  if (existing) return existing;
  if (backendProcess) return waitForBackend();

  const env = {
    ...process.env,
    BOUNDARY_MODEL: process.env.BOUNDARY_MODEL || "Qwen/Qwen3-0.6B",
  };
  backendProcess = spawn(
    pythonPath(),
    ["-m", "uvicorn", "boundary_ml.api:app", "--host", "127.0.0.1", "--port", "8765", "--no-access-log"],
    { cwd: PROJECT_ROOT, env, stdio: ["ignore", "pipe", "pipe"] },
  );
  backendProcess.stdout.on("data", (data) => console.log(`[backend] ${String(data).trim()}`));
  backendProcess.stderr.on("data", (data) => console.error(`[backend] ${String(data).trim()}`));
  backendProcess.on("error", (error) => console.error(`[backend] failed to start: ${error.message}`));
  backendProcess.on("exit", () => { backendProcess = null; });
  return waitForBackend();
}

function serialHeavyTask(task) {
  const run = heavyQueue.then(task, task);
  heavyQueue = run.catch(() => undefined);
  return run;
}

async function releaseModel() {
  await ensureBackend();
  const response = await fetch(`${BACKEND_URL}/model/release`, { method: "POST" });
  if (!response.ok) throw new Error("Could not release model memory before OCR.");
}

function runOcrProcess(imagePath) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      pythonPath(),
      [path.join(__dirname, "python", "ocr_easy.py"), "--image", imagePath],
      {
        cwd: PROJECT_ROOT,
        env: {
          ...process.env,
          OMP_NUM_THREADS: process.env.BOUNDARY_OCR_THREADS || "4",
          MKL_NUM_THREADS: process.env.BOUNDARY_OCR_THREADS || "4",
          VECLIB_MAXIMUM_THREADS: process.env.BOUNDARY_OCR_THREADS || "4",
          TOKENIZERS_PARALLELISM: "false",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (data) => { stdout += data; });
    child.stderr.on("data", (data) => { stderr += data; });
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
  const match = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl || "");
  if (!match) throw new Error("Expected a PNG or JPEG image.");
  const data = Buffer.from(match[2], "base64");
  if (data.length > 15 * 1024 * 1024) throw new Error("Image exceeds the 15 MB local limit.");
  return { data, extension: match[1] === "jpeg" ? "jpg" : "png" };
}

async function ocrDataUrl(dataUrl) {
  return serialHeavyTask(async () => {
    await releaseModel();
    const decoded = decodeImageDataUrl(dataUrl);
    const temporary = path.join(os.tmpdir(), `boundary-${process.pid}-${Date.now()}.${decoded.extension}`);
    await fs.writeFile(temporary, decoded.data, { mode: 0o600 });
    try {
      return await runOcrProcess(temporary);
    } finally {
      await fs.rm(temporary, { force: true });
    }
  });
}

async function analyze(payload) {
  return serialHeavyTask(async () => {
    await ensureBackend();
    const response = await fetch(`${BACKEND_URL}/analyze`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(180000),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = body.detail?.message || body.detail || "Analysis failed.";
      throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
    }
    return body;
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 900,
    minHeight: 650,
    backgroundColor: "#0b1020",
    title: "Boundary",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.removeMenu();
  win.webContents.on("did-finish-load", () => {
    console.log("Boundary Electron UI loaded");
    const smokeExitMs = Number(process.env.BOUNDARY_SMOKE_EXIT_MS || 0);
    if (smokeExitMs > 0) setTimeout(() => app.quit(), smokeExitMs);
  });
  win.webContents.on("did-fail-load", (_event, code, description) => {
    console.error(`Boundary renderer failed to load (${code}): ${description}`);
  });
  win.loadFile(path.join(__dirname, "renderer", "index.html"));
}

ipcMain.handle("boundary:health", () => ensureBackend());
ipcMain.handle("boundary:list-sources", async () => {
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
ipcMain.handle("boundary:ocr-image", (_event, dataUrl) => ocrDataUrl(dataUrl));
ipcMain.handle("boundary:choose-image", async () => {
  const selection = await dialog.showOpenDialog({
    properties: ["openFile"],
    filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg"] }],
  });
  if (selection.canceled || !selection.filePaths[0]) return null;
  const file = selection.filePaths[0];
  const extension = path.extname(file).toLowerCase() === ".png" ? "png" : "jpeg";
  const bytes = await fs.readFile(file);
  if (bytes.length > 15 * 1024 * 1024) throw new Error("Image exceeds the 15 MB local limit.");
  return `data:image/${extension};base64,${bytes.toString("base64")}`;
});
ipcMain.handle("boundary:analyze", (_event, payload) => analyze(payload));

app.whenReady().then(createWindow);
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
app.on("before-quit", () => {
  if (backendProcess) backendProcess.kill("SIGTERM");
});
