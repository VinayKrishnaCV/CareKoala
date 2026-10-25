const crypto = require("node:crypto");
const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
function base32(bytes) {
  let value = 0,
    bits = 0,
    out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += alphabet[(value >>> bits) & 31];
    }
  }
  if (bits) out += alphabet[(value << (5 - bits)) & 31];
  return out;
}
function decode(text) {
  let value = 0,
    bits = 0,
    out = [];
  for (const c of text) {
    const n = alphabet.indexOf(c);
    if (n < 0) throw Error("Invalid pairing code");
    value = (value << 5) | n;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((value >>> bits) & 255);
    }
  }
  const b = Buffer.from(out);
  if (base32(b) !== text) throw Error("Invalid pairing code");
  return b;
}
function invitation(secret = crypto.randomBytes(16)) {
  const data = base32(secret),
    sum = base32(
      crypto
        .createHash("sha256")
        .update("CareKoala invitation v2")
        .update(secret)
        .digest(),
    ).slice(0, 4);
  return "CK2-" + (data + sum).match(/.{1,5}/g).join("-");
}
function parse(code) {
  if (typeof code !== "string" || code.length > 256)
    throw Error("Enter the single pairing code shown on the PC.");
  const text = code
    .toUpperCase()
    .replace(/[\s\u200B-\u200D\uFEFF-]/gu, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
  if (!/^CK2[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{30}$/.test(text))
    throw Error("Use the complete CK2 pairing code from the PC.");
  const secret = decode(text.slice(3, 29));
  if (secret.length !== 16 || invitation(secret).replaceAll("-", "") !== text)
    throw Error("Pairing code has a typing error. Check it against the PC.");
  const derive = (label) =>
    crypto
      .createHmac("sha256", secret)
      .update("carekoala/enrollment/v2/" + label)
      .digest();
  return {
    pair: {
      v: 1,
      key: derive("key").toString("base64"),
      route: derive("route").toString("base64"),
    },
    secret,
  };
}
function channel(pair) {
  return (
    "ck-" +
    crypto
      .createHmac("sha256", Buffer.from(pair.route, "base64"))
      .update("carekoala/enrollment/v2/channel")
      .digest("base64url")
  );
}
function seal(pair, payload, direction) {
  const nonce = crypto.randomBytes(12),
    cipher = crypto.createCipheriv(
      "aes-256-gcm",
      Buffer.from(pair.key, "base64"),
      nonce,
    );
  cipher.setAAD(Buffer.from("CareKoala enrollment " + direction + " v2"));
  const data = Buffer.concat([
    cipher.update(JSON.stringify(payload)),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  return JSON.stringify({
    v: 2,
    nonce: nonce.toString("base64"),
    ciphertext: data.toString("base64"),
  });
}
function open(pair, envelope, direction, now = Math.floor(Date.now() / 1000)) {
  if (typeof envelope !== "string" || envelope.length > 4096)
    throw Error("Invalid pairing response");
  const outer = JSON.parse(envelope);
  if (outer.v !== 2) throw Error("Unknown pairing version");
  const nonce = Buffer.from(outer.nonce, "base64"),
    data = Buffer.from(outer.ciphertext, "base64");
  if (nonce.length !== 12 || data.length < 17)
    throw Error("Invalid pairing response");
  const cipher = crypto.createDecipheriv(
    "aes-256-gcm",
    Buffer.from(pair.key, "base64"),
    nonce,
  );
  cipher.setAAD(Buffer.from("CareKoala enrollment " + direction + " v2"));
  cipher.setAuthTag(data.subarray(-16));
  const p = JSON.parse(
    Buffer.concat([cipher.update(data.subarray(0, -16)), cipher.final()]),
  );
  if (
    p.v !== 2 ||
    !Number.isInteger(p.issued_at) ||
    !Number.isInteger(p.expires_at) ||
    p.issued_at > now + 30 ||
    now >= p.expires_at ||
    p.expires_at <= p.issued_at ||
    p.expires_at - p.issued_at > 600
  )
    throw Error("Pairing response expired");
  return p;
}
module.exports = { base32, invitation, parse, channel, seal, open };
