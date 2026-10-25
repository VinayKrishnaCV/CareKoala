package org.carekoala.guardian;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Base64;
import javax.crypto.Cipher;
import javax.crypto.Mac;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import org.json.JSONObject;

public final class EnrollmentProtocol {
  private static final String ABC = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

  public static String base32(byte[] bytes) {
    int value = 0, bits = 0;
    StringBuilder out = new StringBuilder();
    for (byte b : bytes) {
      value = (value << 8) | (b & 255);
      bits += 8;
      while (bits >= 5) {
        bits -= 5;
        out.append(ABC.charAt((value >>> bits) & 31));
      }
    }
    if (bits > 0) out.append(ABC.charAt((value << (5 - bits)) & 31));
    return out.toString();
  }

  public static JSONObject parse(String code) throws Exception {
    if (code == null || code.length() > 256)
      throw new IllegalArgumentException("Enter the single pairing code shown on the PC");
    String text =
        code.toUpperCase(java.util.Locale.ROOT)
            .replaceAll("[\\s\\u200B-\\u200D\\uFEFF-]", "")
            .replace('O', '0')
            .replace('I', '1')
            .replace('L', '1');
    if (!text.matches("CK2[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{30}"))
      throw new IllegalArgumentException("Use the complete CK2 pairing code from the PC");
    String encoded = text.substring(3, 29);
    java.io.ByteArrayOutputStream bytes = new java.io.ByteArrayOutputStream();
    int value = 0, bits = 0;
    for (char c : encoded.toCharArray()) {
      value = (value << 5) | ABC.indexOf(c);
      bits += 5;
      if (bits >= 8) {
        bits -= 8;
        bytes.write((value >>> bits) & 255);
      }
    }
    byte[] secret = bytes.toByteArray();
    MessageDigest hash = MessageDigest.getInstance("SHA-256");
    hash.update("CareKoala invitation v2".getBytes(StandardCharsets.UTF_8));
    hash.update(secret);
    if (secret.length != 16
        || !base32(secret).equals(encoded)
        || !base32(hash.digest()).startsWith(text.substring(29)))
      throw new IllegalArgumentException(
          "Pairing code has a typing error. Check it against the PC");
    return new JSONObject()
        .put("v", 1)
        .put("key", Base64.getEncoder().encodeToString(derive(secret, "key")))
        .put("route", Base64.getEncoder().encodeToString(derive(secret, "route")));
  }

  private static byte[] derive(byte[] secret, String label) throws Exception {
    Mac mac = Mac.getInstance("HmacSHA256");
    mac.init(new SecretKeySpec(secret, "HmacSHA256"));
    return mac.doFinal(("carekoala/enrollment/v2/" + label).getBytes(StandardCharsets.UTF_8));
  }

  public static String channel(JSONObject pair) throws Exception {
    Mac mac = Mac.getInstance("HmacSHA256");
    mac.init(new SecretKeySpec(Base64.getDecoder().decode(pair.getString("route")), "HmacSHA256"));
    return "ck-"
        + Base64.getUrlEncoder()
            .withoutPadding()
            .encodeToString(
                mac.doFinal("carekoala/enrollment/v2/channel".getBytes(StandardCharsets.UTF_8)));
  }

  public static String seal(JSONObject pair, JSONObject payload, String direction)
      throws Exception {
    byte[] nonce = new byte[12];
    new SecureRandom().nextBytes(nonce);
    Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
    cipher.init(
        Cipher.ENCRYPT_MODE,
        new SecretKeySpec(Base64.getDecoder().decode(pair.getString("key")), "AES"),
        new GCMParameterSpec(128, nonce));
    cipher.updateAAD(
        ("CareKoala enrollment " + direction + " v2").getBytes(StandardCharsets.UTF_8));
    return new JSONObject()
        .put("v", 2)
        .put("nonce", Base64.getEncoder().encodeToString(nonce))
        .put(
            "ciphertext",
            Base64.getEncoder()
                .encodeToString(
                    cipher.doFinal(payload.toString().getBytes(StandardCharsets.UTF_8))))
        .toString();
  }

  public static JSONObject open(JSONObject pair, String envelope, String direction, long now)
      throws Exception {
    if (envelope.length() > 4096) throw new IllegalArgumentException("Oversized pairing message");
    JSONObject outer = new JSONObject(envelope);
    if (outer.getInt("v") != 2) throw new IllegalArgumentException("Invalid pairing version");
    byte[] nonce = Base64.getDecoder().decode(outer.getString("nonce"));
    if (nonce.length != 12) throw new IllegalArgumentException("Invalid nonce");
    Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
    cipher.init(
        Cipher.DECRYPT_MODE,
        new SecretKeySpec(Base64.getDecoder().decode(pair.getString("key")), "AES"),
        new GCMParameterSpec(128, nonce));
    cipher.updateAAD(
        ("CareKoala enrollment " + direction + " v2").getBytes(StandardCharsets.UTF_8));
    JSONObject p =
        new JSONObject(
            new String(
                cipher.doFinal(Base64.getDecoder().decode(outer.getString("ciphertext"))),
                StandardCharsets.UTF_8));
    long issued = p.getLong("issued_at"), expires = p.getLong("expires_at");
    if (p.getInt("v") != 2
        || issued > now + 30
        || now >= expires
        || expires <= issued
        || expires - issued > 600) throw new IllegalArgumentException("Pairing response expired");
    return p;
  }
}
