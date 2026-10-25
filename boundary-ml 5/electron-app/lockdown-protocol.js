const crypto = require("node:crypto");
const AAD = Buffer.from("CareKoala guardian check-in v1");
function digest(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}
function publicKey(code, pairFingerprint) {
  if (typeof code !== "string" || code.length > 8192)
    throw Error("Paste the complete guardian CKR1 public key from Android.");

  code = code.replace(/[\s\u200B-\u200D\u2060\uFEFF]/gu, "");
  if (!code.startsWith("CKR1."))
    throw Error(
      "Use Copy guardian public key on Android and paste the complete CKR1 code here. Put the fingerprint in the separate field.",
    );
  const damaged =
    "The guardian public key is incomplete or changed during copying. On Android, tap Copy guardian public key and paste it again. Do not use a screenshot or manually retype it. Your saved guardian key has not been changed.";
  let value, der, key;
  try {
    const encoded = code.slice(5);
    if (!/^[A-Za-z0-9_-]+={0,2}$/.test(encoded)) throw Error();
    const decoded = Buffer.from(encoded, "base64url");
    if (decoded.toString("base64url") !== encoded.replace(/=+$/, ""))
      throw Error();
    value = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(decoded),
    );
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      typeof value.spki !== "string" ||
      typeof value.pair !== "string"
    )
      throw Error();
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value.spki)) throw Error();
    der = Buffer.from(value.spki, "base64");
    if (der.toString("base64") !== value.spki) throw Error();
    key = crypto.createPublicKey({ key: der, format: "der", type: "spki" });
    if (!key.export({ format: "der", type: "spki" }).equals(der)) throw Error();
  } catch {
    throw Error(damaged);
  }
  if (value.v !== 1 || value.pair !== pairFingerprint)
    throw Error("This public key belongs to a different pairing.");
  if (
    key.asymmetricKeyType !== "rsa" ||
    key.asymmetricKeyDetails.modulusLength !== 3072
  )
    throw Error("Expected a 3072-bit RSA public key.");
  return {
    spki: der.toString("base64"),
    fingerprint: digest(der).match(/.{4}/g).join("-"),
  };
}
function normalizeFingerprint(value) {
  if (typeof value !== "string")
    throw Error("Paste the public-key fingerprint from Android.");
  const hex = value
    .replace(/[\s\u200B-\u200D\u2060\uFEFF:\-\u2010-\u2015]/gu, "")
    .toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(hex))
    throw Error(
      "Use Copy public-key fingerprint on Android. This is the 64-digit RSA fingerprint, not the shorter pairing fingerprint.",
    );
  return hex.match(/.{4}/g).join("-");
}
function event(test = false, now = Math.floor(Date.now() / 1000)) {
  return {
    v: 1,
    kind: "lockdown",
    id: crypto.randomUUID(),
    key: crypto.randomBytes(24).toString("base64url"),
    issued_at: now,
    expires_at: now + 300,
    test,
  };
}
function seal(pair, payload, rsa) {
  const nonce = crypto.randomBytes(12),
    cipher = crypto.createCipheriv(
      "aes-256-gcm",
      Buffer.from(pair.key, "base64"),
      nonce,
    );
  cipher.setAAD(AAD);
  const { key, ...metadata } = payload;
  const ciphertext = Buffer.concat([
    cipher.update(
      JSON.stringify({ ...metadata, contact_guardian: true, rsa }),
      "utf8",
    ),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  return JSON.stringify({
    v: 1,
    nonce: nonce.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  });
}
function topic(pair) {
  return (
    "ck-" +
    crypto
      .createHmac("sha256", Buffer.from(pair.route, "base64"))
      .update("carekoala/ntfy/v1")
      .digest("base64url")
  );
}

const UNLOCK_AAD = Buffer.from("CareKoala guardian unlock v1");
function unlockTopic(pair) {
  return (
    "ck-" +
    crypto
      .createHmac("sha256", Buffer.from(pair.route, "base64"))
      .update("carekoala/ntfy/unlock/v1")
      .digest("base64url")
  );
}
function openUnlock(pair, envelope) {
  if (typeof envelope !== "string" || envelope.length > 4096)
    throw Error("Invalid unlock message");
  const outer = JSON.parse(envelope);
  if (
    outer?.v !== 1 ||
    typeof outer.nonce !== "string" ||
    typeof outer.ciphertext !== "string"
  )
    throw Error("Invalid unlock message");
  const nonce = Buffer.from(outer.nonce, "base64"),
    data = Buffer.from(outer.ciphertext, "base64");
  if (nonce.length !== 12 || data.length <= 16)
    throw Error("Invalid unlock message");
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    Buffer.from(pair.key, "base64"),
    nonce,
    { authTagLength: 16 },
  );
  decipher.setAAD(UNLOCK_AAD);
  decipher.setAuthTag(data.subarray(-16));
  const value = JSON.parse(
    Buffer.concat([
      decipher.update(data.subarray(0, -16)),
      decipher.final(),
    ]).toString("utf8"),
  );
  if (
    value?.v !== 1 ||
    value.kind !== "unlock" ||
    typeof value.id !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value.id,
    ) ||
    typeof value.key !== "string" ||
    !/^[A-Za-z0-9_-]{32}$/.test(value.key) ||
    !Number.isInteger(value.issued_at) ||
    !Number.isInteger(value.expires_at)
  )
    throw Error("Invalid unlock message");
  return value;
}
function fresh(value, now = Math.floor(Date.now() / 1000)) {
  return (
    value.issued_at <= now + 30 &&
    now < value.expires_at &&
    value.expires_at > value.issued_at &&
    value.expires_at - value.issued_at <= 300
  );
}
function matches(key, hash) {
  return (
    typeof key === "string" &&
    /^[A-Za-z0-9_-]{32}$/.test(key) &&
    crypto.timingSafeEqual(
      Buffer.from(digest(key), "hex"),
      Buffer.from(hash, "hex"),
    )
  );
}
function actionForScore(score) {
  if (!Number.isInteger(score) || score < 0 || score > 10) return null;
  return score >= 8 ? "lockdown" : score >= 6 ? "notify" : "none";
}
function sealResolution(pair, id, now = Math.floor(Date.now() / 1000)) {
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(
    "aes-256-gcm",
    Buffer.from(pair.key, "base64"),
    nonce,
  );
  cipher.setAAD(AAD);
  const payload = {
    v: 1,
    kind: "lockdown_resolved",
    id,
    issued_at: now,
    expires_at: now + 300,
    contact_guardian: false,
  };
  return JSON.stringify({
    v: 1,
    nonce: nonce.toString("base64"),
    ciphertext: Buffer.concat([
      cipher.update(JSON.stringify(payload)),
      cipher.final(),
      cipher.getAuthTag(),
    ]).toString("base64"),
  });
}
module.exports = {
  sealResolution,
  publicKey,
  normalizeFingerprint,
  event,
  seal,
  topic,
  unlockTopic,
  openUnlock,
  fresh,
  digest,
  matches,
  actionForScore,
};
