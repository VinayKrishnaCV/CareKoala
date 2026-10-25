package org.carekoala.guardian;

import org.json.JSONArray;
import org.json.JSONObject;

public final class Profiles {
  public static final int MAX = 10;

  public static JSONObject upsert(JSONObject people, JSONObject pair, String name)
      throws Exception {
    String id = Protocol.fingerprint(pair);
    JSONObject profile = people.optJSONObject(id);
    if (profile == null) {
      if (people.length() >= MAX)
        throw new IllegalArgumentException(
            "You can connect up to 10 people. Remove a disconnected profile first.");
      profile = new JSONObject().put("enabled", true).put("seen", new JSONObject());
    }
    profile.put("pair", pair).put("name", cleanName(name));
    people.put(id, profile);
    return profile;
  }

  public static String cleanName(String name) {
    String n = name == null ? "" : name.trim().replaceAll("[\\p{Cntrl}]", "");
    return n.isEmpty() ? "My PC" : n.substring(0, Math.min(60, n.length()));
  }

  public static JSONArray summaries(JSONObject people) throws Exception {
    JSONArray rows = new JSONArray();
    for (java.util.Iterator<String> it = people.keys(); it.hasNext(); ) {
      String id = it.next();
      JSONObject p = people.getJSONObject(id);
      rows.put(
          new JSONObject()
              .put("id", id)
              .put("name", p.getString("name"))
              .put("enabled", p.optBoolean("enabled", true))
              .put("hasLockdown", pendingUnlock(p)));
    }
    return rows;
  }

  public static boolean pendingUnlock(JSONObject profile) throws Exception {
    JSONObject event = profile.optJSONObject("lockdown");
    return event != null && !event.getString("id").equals(profile.optString("unlock_confirmed"));
  }

  public static boolean resolve(JSONObject profile, JSONObject receipt) throws Exception {
    JSONObject resolved = profile.optJSONObject("resolved");
    if (resolved == null) resolved = new JSONObject();
    String id = receipt.getString("id");
    if (resolved.has(id)) return false;
    long now = receipt.getLong("issued_at");
    for (java.util.Iterator<String> it = resolved.keys(); it.hasNext(); ) {
      String key = it.next();
      if (resolved.getLong(key) <= now) it.remove();
    }
    if (resolved.length() >= 1000) return false;
    resolved.put(id, receipt.getLong("expires_at"));
    profile.put("resolved", resolved);
    JSONObject event = profile.optJSONObject("lockdown");
    if (event != null && id.equals(event.getString("id"))) {
      profile.put("unlock_confirmed", id);
      event.remove("key");
    }
    return true;
  }
}
