const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { EventEmitter } = require("node:events");
const protocol = require("../lockdown-protocol");
const pair = {
  v: 1,
  key: "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=",
  route: "ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8=",
};
function fixture() {
  const scheduled = [],
    windows = [],
    published = [];
  class Window extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      this.webContents = new EventEmitter();
      this.webContents.send = () => {};
      this.webContents.focus = () => {
        this.inputFocused = true;
      };
      this.webContents.setWindowOpenHandler = () => {};
      windows.push(this);
    }
    isDestroyed() {
      return !!this.destroyed;
    }
    isFocused() {
      return !!this.focused;
    }
    setAlwaysOnTop() {}
    setMenu() {}
    loadFile() {}
    showInactive() {
      this.visible = true;
    }
    setBounds(bounds) {
      this.bounds = bounds;
    }
    focus() {
      windows.forEach((w) => (w.focused = false));
      this.focused = true;
    }
    destroy() {
      this.destroyed = true;
    }
  }
  const displays = [
    { id: 1, bounds: { x: 0, y: 0, width: 1280, height: 720 } },
    { id: 2, bounds: { x: 1280, y: 0, width: 1280, height: 720 } },
  ];
  const screen = new EventEmitter();
  Object.assign(screen, {
    getAllDisplays: () => displays,
    getDisplayNearestPoint: () => displays[1],
    getCursorScreenPoint: () => ({ x: 1500, y: 200 }),
  });
  const context = {
    module: { exports: {} },
    require: (name) =>
      name === "electron"
        ? { BrowserWindow: Window, screen }
        : name === "./lockdown-protocol"
          ? protocol
          : name === "./unlock-listener"
            ? { listen: () => ({ stop() {} }) }
            : require(name),
    __dirname: path.resolve(__dirname, ".."),
    Buffer,
    AbortSignal,
    Date,
    console,
    setTimeout: (fn, delay) => {
      scheduled.push({ fn, delay });
      return { unref() {} };
    },
    fetch: async (url, request) => {
      published.push({ url, request });
      return { ok: true, body: { cancel: async () => {} } };
    },
  };
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, "../lockdown.js"), "utf8"),
    context,
  );
  const event = protocol.event(true);
  const settings = {
    data: {
      pairing: "saved-pair",
      lockdown: {
        id: event.id,
        hash: protocol.digest(event.key),
        expires: event.expires_at,
      },
    },
    pair: () => pair,
    save: async () => {},
  };
  let unlocked = 0;
  const lock = new context.module.exports.Lockdown(
    settings,
    null,
    () => unlocked++,
  );
  return {
    lock,
    settings,
    event,
    windows,
    scheduled,
    published,
    get unlocked() {
      return unlocked;
    },
  };
}
test("overlay covers displays without native fullscreen or competing window focus", () => {
  const f = fixture();
  f.lock.show();
  assert.equal(f.windows.length, 2);
  for (const w of f.windows) {
    assert.equal(w.options.frame, false);
    assert.equal(w.options.show, false);
    assert.equal(w.options.focusable, true);
    assert.equal(w.options.fullscreen, undefined);
    w.emit("ready-to-show");
  }
  assert.equal(f.windows[1].focused, true);
  assert.equal(f.windows[1].inputFocused, true);
  assert.equal(f.windows[0].focused, false);
  f.lock.close();
});
test("typed unlock persists a receipt before releasing and confirms without sending the key", async () => {
  const f = fixture();
  assert.equal(await f.lock.unlock(f.event.key), true);
  assert.equal(f.settings.data.lockdown, null);
  assert.equal(f.settings.data.unlockReceipts[0].id, f.event.id);
  f.scheduled[0].fn();
  assert.equal(f.unlocked, 1);
  await f.lock.flushReceipts();
  assert.equal(f.published.length, 1);
  assert.equal(f.settings.data.unlockReceipts.length, 0);
  assert.equal(f.published[0].request.body.includes(f.event.key), false);
  const crypto = require("node:crypto");
  const outer = JSON.parse(f.published[0].request.body),
    data = Buffer.from(outer.ciphertext, "base64");
  const d = crypto.createDecipheriv(
    "aes-256-gcm",
    Buffer.from(pair.key, "base64"),
    Buffer.from(outer.nonce, "base64"),
  );
  d.setAAD(Buffer.from("CareKoala guardian check-in v1"));
  d.setAuthTag(data.subarray(-16));
  const receipt = JSON.parse(
    Buffer.concat([d.update(data.subarray(0, -16)), d.final()]),
  );
  assert.equal(receipt.kind, "lockdown_resolved");
  assert.equal(receipt.id, f.event.id);
  assert.equal(receipt.contact_guardian, false);
  assert.equal(receipt.key, undefined);
});
test("failed persistence leaves lockdown active and does not create a false confirmation", async () => {
  const f = fixture();
  f.settings.save = async () => {
    throw Error("disk unavailable");
  };
  await assert.rejects(f.lock.unlock(f.event.key));
  assert.equal(f.settings.data.lockdown.id, f.event.id);
  assert.equal(f.published.length, 0);
  assert.equal(f.settings.data.unlockReceipts.length, 0);
});
test("unsent confirmation survives relay failure and is not sent to a replacement pairing", async () => {
  const f = fixture();
  await f.lock.unlock(f.event.key);
  f.settings.pair = () => {
    throw Error("unavailable");
  };
  await f.lock.flushReceipts();
  assert.equal(f.settings.data.unlockReceipts.length, 1);
  f.settings.data.pairing = "new-pair";
  await f.lock.flushReceipts();
  assert.equal(f.settings.data.unlockReceipts.length, 0);
  assert.equal(f.published.length, 0);
});
