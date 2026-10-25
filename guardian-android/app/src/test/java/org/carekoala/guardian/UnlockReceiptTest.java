package org.carekoala.guardian;

import static org.junit.Assert.*;

import java.nio.charset.StandardCharsets;
import org.json.JSONObject;
import org.junit.Test;

public class UnlockReceiptTest {
  private JSONObject vector() throws Exception {
    return new JSONObject(
        new String(
            getClass().getResourceAsStream("/unlock-receipt-vector.json").readAllBytes(),
            StandardCharsets.UTF_8));
  }

  @Test
  public void desktopConfirmationIsAuthenticatedFreshAndBoundToTheCurrentRequest()
      throws Exception {
    JSONObject v = vector(), pair = v.getJSONObject("pair");
    JSONObject receipt = Protocol.open(pair, v.getString("envelope"), v.getLong("now"));
    assertEquals("lockdown_resolved", receipt.getString("kind"));
    assertFalse(receipt.getBoolean("contact_guardian"));
    assertFalse(receipt.has("key"));
    JSONObject event =
        new JSONObject().put("id", v.getString("id")).put("key", "private-one-time-key");
    JSONObject profile = new JSONObject().put("lockdown", event);
    assertTrue(Profiles.pendingUnlock(profile));
    assertTrue(Profiles.resolve(profile, receipt));
    assertFalse(Profiles.pendingUnlock(profile));
    assertFalse(event.has("key"));
    assertFalse(Profiles.resolve(profile, receipt));
    assertFalse(Profiles.pendingUnlock(new JSONObject(profile.toString())));
    assertThrows(Exception.class, () -> Protocol.open(pair, v.getString("envelope"), 1300));
    JSONObject other =
        new JSONObject(pair.toString())
            .put("key", java.util.Base64.getEncoder().encodeToString(new byte[32]));
    assertThrows(Exception.class, () -> Protocol.open(other, v.getString("envelope"), 1100));
  }

  @Test
  public void lateConfirmationDoesNotClearANewerLockdownOrAnotherPerson() throws Exception {
    JSONObject v = vector();
    JSONObject receipt = Protocol.open(v.getJSONObject("pair"), v.getString("envelope"), 1100);
    JSONObject current =
        new JSONObject().put("id", "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb").put("key", "new-key");
    JSONObject profile = new JSONObject().put("lockdown", current);
    assertTrue(Profiles.resolve(profile, receipt));
    assertTrue(Profiles.pendingUnlock(profile));
    assertEquals("new-key", current.getString("key"));
    JSONObject otherPerson = new JSONObject().put("lockdown", new JSONObject(current.toString()));
    assertFalse(otherPerson.has("unlock_confirmed"));
    JSONObject earlier = new JSONObject();
    assertTrue(Profiles.resolve(earlier, receipt));
    assertTrue(earlier.getJSONObject("resolved").has(v.getString("id")));
  }
}
