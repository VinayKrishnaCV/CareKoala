const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");

test("package points to the Electron main process", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  assert.equal(pkg.main, "main.js");
  assert.match(pkg.scripts.start, /^electron/);
});

test("renderer uses a restrictive content security policy", () => {
  const html = fs.readFileSync(path.join(root, "renderer", "index.html"), "utf8");
  assert.match(html, /default-src 'self'/);
  assert.doesNotMatch(html, /unsafe-eval|https?:\/\//);
});

test("preload exposes only the Boundary operations", () => {
  const preload = fs.readFileSync(path.join(root, "preload.js"), "utf8");
  for (const operation of ["health", "listSources", "chooseImage", "ocrImage", "analyze"]) {
    assert.match(preload, new RegExp(`${operation}:`));
  }
  assert.doesNotMatch(preload, /exposeInMainWorld\([^,]+,\s*ipcRenderer/);
});

test("heavy OCR and analysis use the same serialized queue", () => {
  const main = fs.readFileSync(path.join(root, "main.js"), "utf8");
  assert.match(main, /function serialHeavyTask/);
  assert.match(main, /return serialHeavyTask\(async \(\) => \{/g);
  assert.match(main, /await releaseModel\(\)/);
});

