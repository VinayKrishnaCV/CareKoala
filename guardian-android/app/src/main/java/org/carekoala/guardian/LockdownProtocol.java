package org.carekoala.guardian;

import java.nio.charset.StandardCharsets;
import java.security.PrivateKey;
import java.security.spec.MGF1ParameterSpec;
import java.util.Base64;
import javax.crypto.Cipher;
import javax.crypto.spec.OAEPParameterSpec;
import javax.crypto.spec.PSource;
import org.json.JSONObject;

public final class LockdownProtocol {
  public static JSONObject decrypt(PrivateKey key, JSONObject outer, long now) throws Exception {
    byte[] encrypted = Base64.getDecoder().decode(outer.getString("rsa"));
    if (encrypted.length != 384) throw new IllegalArgumentException("Invalid RSA ciphertext");
    Cipher cipher = Cipher.getInstance("RSA/ECB/OAEPPadding");
    cipher.init(
        Cipher.DECRYPT_MODE,
        key,
        new OAEPParameterSpec(
            "SHA-256", "MGF1", MGF1ParameterSpec.SHA1, PSource.PSpecified.DEFAULT));
    JSONObject event =
        new JSONObject(new String(cipher.doFinal(encrypted), StandardCharsets.UTF_8));
    if (event.getInt("v") != 1
        || !"lockdown".equals(event.getString("kind"))
        || !event.getString("key").matches("[A-Za-z0-9_-]{32}"))
      throw new IllegalArgumentException("Invalid lockdown");
    long issued = event.getLong("issued_at"), expires = event.getLong("expires_at");
    if (issued > now + 30 || now >= expires || expires <= issued || expires - issued > 300)
      throw new IllegalArgumentException("Expired lockdown");
    if (!event.getString("id").equals(outer.getString("id"))
        || issued != outer.getLong("issued_at")
        || expires != outer.getLong("expires_at")
        || event.getBoolean("test") != outer.getBoolean("test"))
      throw new IllegalArgumentException("Lockdown metadata mismatch");
    return event;
  }
}
