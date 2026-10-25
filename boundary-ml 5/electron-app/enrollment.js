const crypto = require("node:crypto");
const protocol = require("./enrollment-protocol");
const { publicKey } = require("./lockdown-protocol");
const { listen } = require("./unlock-listener");
class Enrollment {
  constructor({
    settings,
    changed,
    encodeQr,
    encrypt,
    publish = async (topic, body) => {
      const r = await fetch("https://ntfy.sh/" + topic, {
        method: "POST",
        redirect: "error",
        headers: { "Content-Type": "text/plain" },
        body,
        signal: AbortSignal.timeout(15000),
      });
      if (!r.ok) throw Error("Pairing relay unavailable");
      await r.body?.cancel();
    },
    subscribe = listen,
  }) {
    Object.assign(this, {
      settings,
      changed,
      encodeQr,
      encrypt,
      publish,
      subscribe,
    });
    this.state = { phase: "idle" };
  }
  snapshot() {
    return { ...this.state };
  }
  update(value) {
    Object.assign(this.state, value);
    this.changed?.(this.snapshot());
  }
  cancel() {
    this.session?.listener?.stop();
    clearTimeout(this.timer);
    this.session = null;
    this.update({
      phase: "idle",
      code: null,
      qr: null,
      candidate: null,
      message: "Pairing invitation closed.",
    });
  }
  async start(name) {
    if (this.approving)
      throw Error("Wait for the current connection to finish saving.");
    this.cancel();
    name = String(name || "My PC")
      .trim()
      .slice(0, 60);
    if (!name) throw Error("Enter a name for this PC or user.");
    const code = protocol.invitation(),
      { pair } = protocol.parse(code),
      expires = Math.floor(Date.now() / 1000) + 600;
    const finalPair = {
      v: 1,
      key: crypto.randomBytes(32).toString("base64"),
      route: crypto.randomBytes(32).toString("base64"),
    };
    const session = {
      pair,
      finalPair,
      expires,
      name,
      channel: protocol.channel(pair),
      candidate: null,
      approved: null,
    };
    this.session = session;
    const qr = await this.encodeQr(code);
    if (this.session !== session) return this.snapshot();
    this.update({
      phase: "waiting",
      code,
      qr,
      name,
      expires,
      candidate: null,
      message: "Scan the QR code or enter the same code on the guardian phone.",
    });
    session.listener = this.subscribe({
      url: "https://ntfy.sh/" + session.channel + "/json?since=10m",
      topic: session.channel,
      onMessage: (message) => this.receive(session, message),
      onState: (state) => {
        if (this.session === session && !session.approved)
          this.update({
            message:
              state === "listening"
                ? "Ready for your guardian. Keep this screen open."
                : "Reconnecting to the pairing relay…",
          });
      },
    });
    this.timer = setTimeout(() => {
      if (this.session === session) {
        const completed = !!session.approved;
        this.cancel();
        this.update({
          phase: completed ? "complete" : "expired",
          message: completed
            ? "Guardian connection saved."
            : "Invitation expired. Create a new code to continue.",
        });
      }
    }, 600000);
    return this.snapshot();
  }
  async receive(session, message) {
    if (
      this.session !== session ||
      Math.floor(Date.now() / 1000) >= session.expires
    )
      return;
    const offer = protocol.open(session.pair, message, "offer");
    if (
      offer.kind !== "guardian_offer" ||
      !/^[-a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
        offer.id,
      ) ||
      typeof offer.public_code !== "string" ||
      typeof offer.guardian !== "string"
    )
      return;
    const key = publicKey(
      offer.public_code,
      this.settings.fingerprint(session.pair),
    );
    if (session.approved) {
      if (
        offer.id === session.approved.id &&
        key.spki === session.approved.key.spki
      )
        await this.ack(session);
      return;
    }
    if (
      session.candidate &&
      (session.candidate.id !== offer.id ||
        session.candidate.key.spki !== key.spki)
    )
      return;
    session.candidate = {
      id: offer.id,
      key,
      guardian:
        offer.guardian
          .replace(/[\p{Cc}]/gu, "")
          .trim()
          .slice(0, 60) || "Guardian phone",
    };
    this.update({
      phase: "confirm",
      candidate: session.candidate.guardian,
      message:
        "Your guardian is ready. Approve this connection to finish all key setup.",
    });
  }
  async approve() {
    const session = this.session;
    if (
      !session?.candidate ||
      Math.floor(Date.now() / 1000) >= session.expires - 30
    )
      throw Error(
        "Create a fresh pairing invitation. This code is too close to expiry.",
      );
    if (this.approving) throw Error("Pairing is being saved.");
    this.approving = true;
    try {
      if (!session.approved) {
        await this.settings.installPair(
          session.finalPair,
          session.candidate.key,
          session.name,
          session.candidate.guardian,
        );
        session.approved = session.candidate;
      }
      await this.ack(session);
      this.update({
        phase: "complete",
        code: null,
        qr: null,
        candidate: session.candidate.guardian,
        message:
          "Guardian connected. All keys are configured. The phone will confirm when it receives the acknowledgement.",
      });
      return this.snapshot();
    } catch (e) {
      this.update({
        message:
          "Could not finish pairing. Check your connection and select Approve again.",
      });
      throw e;
    } finally {
      this.approving = false;
    }
  }
  async ack(session) {
    const now = Math.floor(Date.now() / 1000),
      expires_at = Math.min(session.expires, now + 300);
    const rsa = await this.encrypt(session.approved.key.spki, {
      v: 2,
      kind: "pair_keys",
      id: session.approved.id,
      issued_at: now,
      expires_at,
      pair: session.finalPair,
    });
    await this.publish(
      session.channel,
      protocol.seal(
        session.pair,
        {
          v: 2,
          kind: "pc_ack",
          id: session.approved.id,
          issued_at: now,
          expires_at,
          name: session.name,
          public_fingerprint: session.approved.key.fingerprint,
          rsa,
        },
        "ack",
      ),
    );
  }
}
module.exports = { Enrollment };
