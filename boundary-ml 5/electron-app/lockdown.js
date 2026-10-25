const { BrowserWindow, screen, app } = require("electron");
const path = require("node:path");
const protocol = require("./lockdown-protocol");
const { listen: listenRelay } = require("./unlock-listener");
class Lockdown {
  constructor(settings, encrypt, onUnlock) {
    this.settings = settings;
    this.encrypt = encrypt;
    this.onUnlock = onUnlock;
    this.windows = [];
    this.sending = false;
    this.attemptAt = 0;
    this.message = "";
    this.remoteMessage = "";
    this.receiptDelay = 1000;
    this.queueReceipt();
  }
  get active() {
    return !!this.settings.data.lockdown;
  }
  status() {
    const s = this.settings.data.lockdown;
    return {
      active: !!s,
      id: s?.id,
      test: !!s?.test,
      message: this.message,
      remote: this.remoteMessage,
    };
  }
  update(message) {
    this.message = message;
    this.broadcast();
  }
  remote(message) {
    this.remoteMessage = message;
    this.broadcast();
  }
  broadcast() {
    for (const w of this.windows)
      if (!w.isDestroyed())
        w.webContents.send("lockdown:status", this.status());
  }
  async trigger(test = false) {
    if (this.active) {
      this.show();
      return this.status();
    }
    if (this.creating) throw Error("Lockdown is being prepared.");
    if (!this.settings.public().paired || !this.settings.data.guardianRsa)
      throw Error(
        "Import and verify the Android guardian public key before using lockdown.",
      );
    this.creating = true;
    try {
      const payload = protocol.event(test);
      const rsa = await this.encrypt(
        this.settings.data.guardianRsa.spki,
        payload,
      );
      const envelope = protocol.seal(this.settings.pair(), payload, rsa);

      this.settings.data.lockdown = {
        id: payload.id,
        test,
        hash: protocol.digest(payload.key),
        expires: payload.expires_at,
        envelope,
      };
      await this.settings.save();
      this.show();
      await this.publish();
      return this.status();
    } finally {
      this.creating = false;
    }
  }
  async publish() {
    if (!this.active || this.sending) return;
    this.sending = true;
    try {
      const s = this.settings.data.lockdown;
      if (Math.floor(Date.now() / 1000) >= s.expires) {
        const payload = protocol.event(s.test),
          rsa = await this.encrypt(
            this.settings.data.guardianRsa.spki,
            payload,
          );
        Object.assign(s, {
          id: payload.id,
          hash: protocol.digest(payload.key),
          expires: payload.expires_at,
          envelope: protocol.seal(this.settings.pair(), payload, rsa),
        });
        await this.settings.save();
      }
      this.update("Sending the encrypted unlock key to your guardian…");
      const response = await fetch(
        "https://ntfy.sh/" + protocol.topic(this.settings.pair()),
        {
          method: "POST",
          redirect: "error",
          headers: { "Content-Type": "text/plain; charset=utf-8" },
          body: s.envelope,
          signal: AbortSignal.timeout(15000),
        },
      );
      if (!response.ok) throw Error("Relay unavailable");
      await response.body?.cancel();
      this.update(
        "Encrypted key published. Ask your guardian to open CareKoala Guardian. Delivery is not yet confirmed.",
      );
    } catch (e) {
      this.update(
        "Could not deliver the key. Check the connection and select Send key again.",
      );
    } finally {
      this.sending = false;
    }
  }
  show() {
    if (!this.active) return;
    if (!this.windows.length) {
      for (const display of screen.getAllDisplays()) this.addDisplay(display);
      this.displayAdded = (_e, d) => this.addDisplay(d);
      this.displayChanged = () => {
        for (const w of this.windows) {
          const d = screen.getAllDisplays().find((d) => d.id === w.displayId);
          if (d) w.setBounds(d.bounds);
        }
      };
      screen.on("display-added", this.displayAdded);
      screen.on("display-metrics-changed", this.displayChanged);
      this.displayRemoved = (_e, d) => {
        const w = this.windows.find((w) => w.displayId === d.id);
        if (w) {
          this.windows = this.windows.filter((x) => x !== w);
          w.destroy();
        }
      };
      screen.on("display-removed", this.displayRemoved);
    }
    for (const w of this.windows) if (w.overlayReady) w.showInactive();
    this.focusOverlay();
    this.listen();
  }

  focusOverlay() {
    const display = screen.getDisplayNearestPoint(
      screen.getCursorScreenPoint(),
    );
    const ready = this.windows.filter(
      (w) => w.overlayReady && !w.isDestroyed(),
    );
    const target = ready.find((w) => w.displayId === display.id) || ready[0];
    if (target) {
      target.focus();
      target.webContents.focus();
    }
  }

  listen() {
    if (this.listener || !this.active) return;
    let pair;
    try {
      pair = this.settings.pair();
    } catch {
      this.remote(
        "Unlocking from the guardian’s phone is unavailable. Type the key from the Guardian app.",
      );
      return;
    }
    const topic = protocol.unlockTopic(pair);
    this.listener = listenRelay({
      url: `https://ntfy.sh/${topic}/json?since=5m`,
      topic,
      onMessage: (text) => this.receive(pair, text),
      onState: (state) =>
        this.remote(
          state === "listening"
            ? "Ready for your guardian to unlock this screen from their phone."
            : "Cannot reach ntfy.sh to receive your guardian’s unlock. Retrying… You can still type the key.",
        ),
    });
  }
  async receive(pair, text) {
    const s = this.settings.data.lockdown;
    if (!s || this.releasing) return;
    let value;
    try {
      value = protocol.openUnlock(pair, text);
    } catch {
      return;
    }
    const current = value.id === s.id;
    if (!protocol.fresh(value)) {
      if (current)
        this.remote(
          "Your guardian’s unlock arrived too late. Ask them to tap Send unlock key to PC again, or type the key.",
        );
      return;
    }
    if (!current) {
      if (value.issued_at >= s.expires - 330)
        this.remote(
          "Your guardian sent the key for an earlier pause. Ask them to wait for the newest alert, then tap Send unlock key to PC again.",
        );
      return;
    }

    if (!protocol.matches(value.key, s.hash)) {
      this.remote(
        "The key from your guardian did not match. Ask them to tap Send unlock key to PC again.",
      );
      return;
    }
    this.releasing = true;
    try {
      this.message = "";
      this.remoteMessage = "";
      for (const w of this.windows)
        if (!w.isDestroyed()) w.webContents.send("lockdown:guardian-unlocked");
      await this.release(1500);
    } finally {
      this.releasing = false;
    }
  }
  addDisplay(display) {
    const w = new BrowserWindow({
      ...display.bounds,
      show: false,
      focusable: true,
      frame: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      movable: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      closable: false,
      backgroundColor: "#f5f2ec",
      webPreferences: {
        preload: path.join(__dirname, "lockdown-preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        devTools: false,
      },
    });
    w.displayId = display.id;
    this.windows.push(w);
    w.setAlwaysOnTop(true, "screen-saver");
    w.setMenu(null);
    w.once("ready-to-show", () => {
      w.overlayReady = true;
      if (!this.active) return;
      w.showInactive();
      if (
        display.id ===
          screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).id ||
        !this.windows.some((other) => !other.isDestroyed() && other.isFocused())
      )
        this.focusOverlay();
    });
    w.on("close", (e) => {
      if (this.active) e.preventDefault();
    });
    w.on("minimize", () => {
      if (this.active) {
        w.restore();
        w.show();
      }
    });
    w.on("blur", () =>
      setTimeout(() => {
        if (
          this.active &&
          !w.isDestroyed() &&
          !this.windows.some((other) => other.isFocused())
        ) {
          this.focusOverlay();
        }
      }, 80),
    );
    w.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    w.webContents.on("will-navigate", (e) => e.preventDefault());
    w.webContents.on("did-finish-load", () =>
      this.update(this.message || "Contact your guardian for the unlock key."),
    );
    w.webContents.on("before-input-event", (e, input) => {
      if (
        (input.key === "F4" && input.alt) ||
        input.key === "Escape" ||
        input.key === "F11"
      )
        e.preventDefault();
    });
    w.loadFile(path.join(__dirname, "renderer", "lockdown.html"));
  }
  trusted(sender) {
    return this.windows.some((w) => w.webContents === sender);
  }
  async unlock(key) {
    if (!this.active) return false;
    if (Date.now() < this.attemptAt)
      throw Error("Wait a moment before trying again.");
    this.attemptAt = Date.now() + 1500;
    if (!protocol.matches(key, this.settings.data.lockdown.hash))
      throw Error("That key does not match the current lockdown.");
    await this.release(100);
    return true;
  }
  async release(delay) {
    const current = this.settings.data.lockdown;
    if (!current) return;
    const previous = this.settings.data.unlockReceipts || [];
    const receipt = {
      id: current.id,
      pairing: this.settings.data.pairing,
      expires: Math.floor(Date.now() / 1000) + 300,
    };
    this.settings.data.unlockReceipts = [...previous, receipt].slice(-20);
    this.settings.data.lockdown = null;
    try {
      await this.settings.save();
    } catch (error) {
      this.settings.data.lockdown = current;
      this.settings.data.unlockReceipts = previous;
      throw error;
    }

    setTimeout(() => {
      this.close();
      this.onUnlock();
      this.queueReceipt();
    }, delay);
  }
  queueReceipt() {
    if (
      this.receiptTimer ||
      this.receiptSending ||
      !this.settings.data.unlockReceipts?.length
    )
      return;
    this.receiptTimer = setTimeout(() => {
      this.receiptTimer = null;
      this.flushReceipts().catch(() => {});
    }, this.receiptDelay);
    this.receiptTimer.unref?.();
  }
  async flushReceipts() {
    if (this.receiptSending) return;
    this.receiptSending = true;
    try {
      while (this.settings.data.unlockReceipts?.length) {
        const receipt = this.settings.data.unlockReceipts[0];
        if (
          receipt.pairing === this.settings.data.pairing &&
          receipt.expires > Math.floor(Date.now() / 1000)
        ) {
          const pair = this.settings.pair();
          const response = await fetch(
            "https://ntfy.sh/" + protocol.topic(pair),
            {
              method: "POST",
              redirect: "error",
              headers: { "Content-Type": "text/plain; charset=utf-8" },
              body: protocol.sealResolution(pair, receipt.id),
              signal: AbortSignal.timeout(15000),
            },
          );
          if (!response.ok) throw Error("Relay unavailable");
          await response.body?.cancel();
        }
        this.settings.data.unlockReceipts =
          this.settings.data.unlockReceipts.filter((item) => item !== receipt);
        await this.settings.save();
        this.receiptDelay = 1000;
      }
    } catch {
      this.receiptDelay = Math.min(this.receiptDelay * 2, 30000);
    } finally {
      this.receiptSending = false;
      this.queueReceipt();
    }
  }
  close() {
    this.listener?.stop();
    this.listener = null;
    this.remoteMessage = "";
    if (this.displayAdded)
      screen.removeListener("display-added", this.displayAdded);
    if (this.displayChanged)
      screen.removeListener("display-metrics-changed", this.displayChanged);
    if (this.displayRemoved)
      screen.removeListener("display-removed", this.displayRemoved);
    for (const w of this.windows) w.destroy();
    this.windows = [];
  }
}
module.exports = { Lockdown };
