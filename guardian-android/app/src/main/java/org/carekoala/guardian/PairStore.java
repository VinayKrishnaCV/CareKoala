package org.carekoala.guardian;

import android.content.Context;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.Base64;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import org.json.JSONArray;
import org.json.JSONObject;

final class PairStore {
  private static SecretKey key() throws Exception {
    KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
    ks.load(null);
    if (!ks.containsAlias("carekoala-pair-wrap")) {
      KeyGenerator g = KeyGenerator.getInstance("AES", "AndroidKeyStore");
      g.init(
          new KeyGenParameterSpec.Builder(
                  "carekoala-pair-wrap",
                  KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
              .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
              .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
              .setKeySize(256)
              .build());
      g.generateKey();
    }
    return (SecretKey) ks.getKey("carekoala-pair-wrap", null);
  }

  private static String seal(JSONObject value) throws Exception {
    Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
    cipher.init(Cipher.ENCRYPT_MODE, key());
    return Base64.getEncoder().encodeToString(cipher.getIV())
        + ":"
        + Base64.getEncoder()
            .encodeToString(cipher.doFinal(value.toString().getBytes(StandardCharsets.UTF_8)));
  }

  private static JSONObject open(String data) throws Exception {
    String[] parts = data.split(":");
    Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
    cipher.init(
        Cipher.DECRYPT_MODE,
        key(),
        new GCMParameterSpec(128, Base64.getDecoder().decode(parts[0])));
    return new JSONObject(
        new String(cipher.doFinal(Base64.getDecoder().decode(parts[1])), StandardCharsets.UTF_8));
  }

  private static JSONObject all(Context c) throws Exception {
    android.content.SharedPreferences prefs = c.getSharedPreferences("guardian", 0);
    String data = prefs.getString("sealed_profiles", null);
    if (data != null) return open(data);
    JSONObject people = new JSONObject();
    String old = prefs.getString("sealed_pair", null);
    if (old != null) {
      JSONObject pair = open(old).getJSONObject("pair"),
          profile = Profiles.upsert(people, pair, "My PC");
      String event = prefs.getString("sealed_lockdown", null);
      if (event != null) profile.put("lockdown", open(event));
      profile
          .put("seen", new JSONObject(prefs.getString("seen", "{}")))
          .put("unlock_sent", prefs.getString("unlock_sent", ""))
          .put("unlock_sent_at", prefs.getLong("unlock_sent_at", 0));
      persist(c, people);
      if (!prefs
          .edit()
          .remove("sealed_pair")
          .remove("sealed_lockdown")
          .remove("seen")
          .remove("unlock_sent")
          .remove("unlock_sent_at")
          .commit()) throw new IllegalStateException("Could not finish profile migration");
    }
    return people;
  }

  private static void persist(Context c, JSONObject people) throws Exception {
    if (!c.getSharedPreferences("guardian", 0)
        .edit()
        .putString("sealed_profiles", seal(people))
        .commit()) throw new IllegalStateException("Could not save guardian profiles");
  }

  static synchronized JSONArray list(Context c) throws Exception {
    return Profiles.summaries(all(c));
  }

  static synchronized String selected(Context c) throws Exception {
    JSONObject people = all(c);
    String id = c.getSharedPreferences("guardian", 0).getString("selected", "");
    if (people.has(id)) return id;
    return people.keys().hasNext() ? people.keys().next() : "";
  }

  static synchronized void select(Context c, String id) throws Exception {
    if (!all(c).has(id)) throw new IllegalArgumentException("This person is no longer paired");
    c.getSharedPreferences("guardian", 0).edit().putString("selected", id).apply();
  }

  static synchronized JSONObject profile(Context c, String id) throws Exception {
    JSONObject value = all(c).optJSONObject(id);
    if (value == null) throw new IllegalStateException("Add a person to connect their PC");
    return value;
  }

  static synchronized JSONObject load(Context c) throws Exception {
    return new JSONObject().put("pair", profile(c, selected(c)).getJSONObject("pair"));
  }

  static synchronized String saveNamed(Context c, JSONObject pair, String name) throws Exception {
    JSONObject people = all(c);
    Profiles.upsert(people, pair, name);
    persist(c, people);
    String id = Protocol.fingerprint(pair);
    select(c, id);
    return id;
  }

  static synchronized void save(Context c, JSONObject pair) throws Exception {
    saveNamed(c, pair, "My PC");
  }

  static synchronized void rename(Context c, String id, String name) throws Exception {
    JSONObject people = all(c);
    people.getJSONObject(id).put("name", Profiles.cleanName(name));
    persist(c, people);
  }

  static synchronized void enabled(Context c, String id, boolean enabled) throws Exception {
    JSONObject people = all(c);
    people.getJSONObject(id).put("enabled", enabled);
    persist(c, people);
  }

  static synchronized void remove(Context c, String id) throws Exception {
    JSONObject people = all(c);
    people.remove(id);
    persist(c, people);
    c.getSharedPreferences("receiver", 0).edit().remove("status_" + id).apply();
  }

  static synchronized void clear(Context c) {
    try {
      remove(c, selected(c));
    } catch (Exception ignored) {
    }
  }

  static synchronized JSONObject lockdown(Context c) throws Exception {
    return lockdown(c, selected(c));
  }

  static synchronized JSONObject lockdown(Context c, String id) throws Exception {
    JSONObject profile = profile(c, id);
    return Profiles.pendingUnlock(profile) ? profile.optJSONObject("lockdown") : null;
  }

  static synchronized boolean resolve(Context c, String id, JSONObject receipt) throws Exception {
    JSONObject people = all(c);
    JSONObject profile = people.optJSONObject(id);
    if (profile == null || !Profiles.resolve(profile, receipt)) return false;
    persist(c, people);
    JSONObject event = profile.optJSONObject("lockdown");
    return event != null && receipt.getString("id").equals(event.getString("id"));
  }

  static synchronized void saveLockdown(Context c, JSONObject event) throws Exception {
    saveLockdown(c, selected(c), event);
  }

  static synchronized void saveLockdown(Context c, String id, JSONObject event) throws Exception {
    JSONObject people = all(c);
    people.getJSONObject(id).put("lockdown", event);
    persist(c, people);
  }

  static synchronized void sent(Context c, String id, String event) throws Exception {
    JSONObject people = all(c);
    people
        .getJSONObject(id)
        .put("unlock_sent", event)
        .put("unlock_sent_at", System.currentTimeMillis());
    persist(c, people);
  }

  static synchronized boolean accept(
      Context c, String id, JSONObject alert, JSONObject event, long now) throws Exception {
    JSONObject people = all(c);
    JSONObject profile = people.optJSONObject(id);
    if (profile == null || !profile.optBoolean("enabled", true)) return false;
    JSONObject seen = profile.optJSONObject("seen");
    if (seen == null) seen = new JSONObject();
    for (java.util.Iterator<String> it = seen.keys(); it.hasNext(); ) {
      String key = it.next();
      if (seen.getLong(key) <= now) it.remove();
    }
    String eventId = alert.getString("id");
    JSONObject resolved = profile.optJSONObject("resolved");
    if (resolved != null && resolved.optLong(eventId, 0) > now) return false;
    if (seen.has(eventId) || seen.length() >= 1000) return false;
    if (event != null) {
      JSONObject previous = profile.optJSONObject("lockdown");
      if (previous != null && previous.getLong("issued_at") > event.getLong("issued_at"))
        return false;
      profile.put("lockdown", event);
    }
    seen.put(eventId, alert.getLong("expires_at"));
    profile.put("seen", seen);
    persist(c, people);
    return true;
  }
}
