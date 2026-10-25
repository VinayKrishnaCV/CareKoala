package org.carekoala.guardian;

import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;

final class ReceiverState {
  static boolean enabled(Context c) {
    try {
      return c.getSharedPreferences("receiver", 0)
          .getBoolean("enabled", PairStore.list(c).length() > 0);
    } catch (Exception e) {
      return false;
    }
  }

  static void enabled(Context c, boolean enabled) {
    if (!c.getSharedPreferences("receiver", 0).edit().putBoolean("enabled", enabled).commit())
      throw new IllegalStateException("Could not save receiver preference");
  }

  static void status(Context c, String status) {
    c.getSharedPreferences("receiver", 0).edit().putString("status", status).apply();
  }

  static String status(Context c) {
    return c.getSharedPreferences("receiver", 0).getString("status", "Ready to connect");
  }

  static void resume(Context c) {
    if (!enabled(c)) return;
    try {
      if (PairStore.list(c).length() == 0) return;
      if (!c.getSystemService(NotificationManager.class).areNotificationsEnabled()) {
        status(c, "Notifications disabled. Allow them in Android settings to reconnect.");
        return;
      }
      c.startForegroundService(new Intent(c, GuardianService.class));
    } catch (Exception e) {
      status(c, "Could not resume receiver. Open the app to check pairing and permissions.");
    }
  }

  static void status(Context c, String id, String status) {
    c.getSharedPreferences("receiver", 0).edit().putString("status_" + id, status).apply();
  }

  static String personStatus(Context c, String id) {
    return c.getSharedPreferences("receiver", 0).getString("status_" + id, "Waiting to connect");
  }
}
