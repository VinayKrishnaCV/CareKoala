package org.carekoala.guardian;

import android.content.Context;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.util.Base64;
import org.json.JSONObject;

final class GuardianKeys {
  private static String alias(JSONObject pair) throws Exception {
    String id = pair.optString("guardian_key_id", Protocol.fingerprint(pair));
    if (!id.matches("[a-f0-9]{4}(?:-[a-f0-9]{4}){5}"))
      throw new IllegalArgumentException("Invalid guardian key identifier");
    return "carekoala-rsa-" + id;
  }

  private static KeyStore store() throws Exception {
    KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
    ks.load(null);
    return ks;
  }

  static synchronized byte[] publicKey(JSONObject pair) throws Exception {
    String name = alias(pair);
    KeyStore ks = store();
    if (!ks.containsAlias(name)) {
      KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA", "AndroidKeyStore");
      generator.initialize(
          new KeyGenParameterSpec.Builder(name, KeyProperties.PURPOSE_DECRYPT)
              .setKeySize(3072)
              .setDigests(KeyProperties.DIGEST_SHA256)
              .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_RSA_OAEP)
              .build());
      generator.generateKeyPair();
    }
    return ks.getCertificate(name).getPublicKey().getEncoded();
  }

  static String export(JSONObject pair) throws Exception {
    return "CKR1."
        + Base64.getUrlEncoder()
            .withoutPadding()
            .encodeToString(
                new JSONObject()
                    .put("v", 1)
                    .put("pair", Protocol.fingerprint(pair))
                    .put("spki", Base64.getEncoder().encodeToString(publicKey(pair)))
                    .toString()
                    .getBytes(StandardCharsets.UTF_8));
  }

  static String fingerprint(JSONObject pair) throws Exception {
    return Protocol.hex(MessageDigest.getInstance("SHA-256").digest(publicKey(pair)))
        .replaceAll("(.{4})(?!$)", "$1-");
  }

  static JSONObject decrypt(JSONObject pair, JSONObject alert, long now) throws Exception {
    KeyStore ks = store();
    String name = alias(pair);
    if (!ks.containsAlias(name)) throw new IllegalStateException("Guardian key is not configured");
    return LockdownProtocol.decrypt((PrivateKey) ks.getKey(name, null), alert, now);
  }

  static JSONObject decryptEnrollment(JSONObject pair, String rsa) throws Exception {
    byte[] bytes = Base64.getDecoder().decode(rsa);
    if (bytes.length != 384) throw new IllegalArgumentException("Invalid key bundle");
    javax.crypto.Cipher cipher = javax.crypto.Cipher.getInstance("RSA/ECB/OAEPPadding");
    cipher.init(
        javax.crypto.Cipher.DECRYPT_MODE,
        store().getKey(alias(pair), null),
        new javax.crypto.spec.OAEPParameterSpec(
            "SHA-256",
            "MGF1",
            java.security.spec.MGF1ParameterSpec.SHA1,
            javax.crypto.spec.PSource.PSpecified.DEFAULT));
    return new JSONObject(new String(cipher.doFinal(bytes), StandardCharsets.UTF_8));
  }

  static void saveEvent(Context c, JSONObject event) throws Exception {

    PairStore.saveLockdown(c, event);
  }
}
