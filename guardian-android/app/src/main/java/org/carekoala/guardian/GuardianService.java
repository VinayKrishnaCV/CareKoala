package org.carekoala.guardian;

import android.app.*;
import android.content.*;
import android.os.IBinder;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;
import org.json.JSONArray;
import org.json.JSONObject;

public final class GuardianService extends Service {
  private volatile boolean running;
  private volatile int generation;
  private ExecutorService workers;
  private final Set<HttpURLConnection> connections = ConcurrentHashMap.newKeySet();

  @Override
  public IBinder onBind(Intent i) {
    return null;
  }

  private Notification notice(String text) {
    PendingIntent open =
        PendingIntent.getActivity(
            this,
            0,
            new Intent(this, MainActivity.class),
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    PendingIntent stop =
        PendingIntent.getService(
            this,
            1,
            new Intent(this, GuardianService.class).setAction("STOP"),
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    return new Notification.Builder(this, "listener")
        .setSmallIcon(R.drawable.ic_guardian)
        .setContentTitle("CareKoala Guardian")
        .setContentText(text)
        .setOngoing(true)
        .setContentIntent(open)
        .addAction(new Notification.Action.Builder(null, "Stop", stop).build())
        .build();
  }

  private void status(String text) {
    ReceiverState.status(this, text);
    getSystemService(NotificationManager.class).notify(1, notice(text));
  }

  @Override
  public int onStartCommand(Intent intent, int flags, int id) {
    if (intent != null && "STOP".equals(intent.getAction())) {
      ReceiverState.enabled(this, false);
      ReceiverState.status(this, "Paused by you");
      stopSelf();
      return START_NOT_STICKY;
    }
    if (!ReceiverState.enabled(this)) {
      stopSelf();
      return START_NOT_STICKY;
    }
    NotificationManager nm = getSystemService(NotificationManager.class);
    nm.createNotificationChannel(
        new NotificationChannel("listener", "Receiver status", NotificationManager.IMPORTANCE_LOW));
    nm.createNotificationChannel(
        new NotificationChannel(
            "checkins", "Guardian check-in requests", NotificationManager.IMPORTANCE_HIGH));
    startForeground(1, notice("Connecting to ntfy.sh…"));
    ReceiverState.status(this, "Connecting to ntfy.sh…");
    try {
      JSONArray profiles = PairStore.list(this);
      halt();
      final int session = generation;
      java.util.List<JSONObject> active = new ArrayList<>();
      for (int i = 0; i < profiles.length(); i++) {
        JSONObject p = profiles.getJSONObject(i);
        if (p.getBoolean("enabled")) active.add(p);
      }
      if (active.isEmpty()) {
        status("No active people — enable a profile in the app");
        stopSelf();
        return START_NOT_STICKY;
      }
      running = true;
      workers = Executors.newFixedThreadPool(active.size());
      for (JSONObject p : active) {
        String profileId = p.getString("id"), name = p.getString("name");
        JSONObject pair = PairStore.profile(this, profileId).getJSONObject("pair");
        workers.submit(() -> listen(pair, profileId, name, session));
      }
      status("Receiving for " + active.size() + (active.size() == 1 ? " person" : " people"));
    } catch (Exception e) {
      status("Pairing unavailable — open the app");
      stopSelf();
      return START_NOT_STICKY;
    }
    return START_STICKY;
  }

  private void listen(JSONObject pair, String profileId, String name, int session) {
    long retryMillis = 1000;
    while (running && generation == session) {
      HttpURLConnection connection = null;
      try {
        URL url = new URL("https://ntfy.sh/" + Protocol.topic(pair) + "/json?since=5m");
        connection = (HttpURLConnection) url.openConnection();
        connections.add(connection);
        connection.setInstanceFollowRedirects(false);
        connection.setConnectTimeout(15000);
        connection.setReadTimeout(60000);
        connection.setRequestProperty("Accept", "application/json");
        if (connection.getResponseCode() != 200) throw new IOException("Relay unavailable");
        if (!running || generation != session) break;
        ReceiverState.status(this, profileId, "Connected · listening for encrypted alerts");
        retryMillis = 1000;
        try (Reader reader =
            new InputStreamReader(connection.getInputStream(), StandardCharsets.UTF_8)) {
          StringBuilder line = new StringBuilder();
          int ch;
          while (running && generation == session && (ch = reader.read()) != -1) {
            if (ch == '\n') {
              accept(pair, profileId, name, line.toString(), session);
              line.setLength(0);
            } else {
              if (line.length() >= 16384) throw new IOException("Oversized network record");
              line.append((char) ch);
            }
          }
        }
        if (running) throw new IOException("Relay disconnected");
      } catch (java.net.SocketTimeoutException expected) {
      } catch (Exception error) {
        if (running && generation == session)
          ReceiverState.status(this, profileId, "Reconnecting automatically…");
      } finally {
        if (connection != null) {
          connections.remove(connection);
          connection.disconnect();
        }
      }
      if (running && generation == session) {
        try {
          Thread.sleep(retryMillis);
        } catch (InterruptedException e) {
          Thread.currentThread().interrupt();
          break;
        }
        retryMillis = Math.min(30000, retryMillis * 2);
      }
    }
  }

  private synchronized void accept(
      JSONObject pair, String profileId, String name, String record, int session) {
    try {
      if (!running || generation != session || record.trim().isEmpty()) return;
      long now = System.currentTimeMillis() / 1000;
      JSONObject alert = Protocol.ntfyAlert(pair, record, now);
      if (alert == null) return;
      String id = alert.getString("id");
      if ("lockdown_resolved".equals(alert.getString("kind"))) {
        if (PairStore.resolve(this, profileId, alert)) {
          getSystemService(NotificationManager.class)
              .cancel((profileId + id).hashCode() & 0x7fffffff);
          ReceiverState.status(this, profileId, "PC unlocked");
        }
        return;
      }
      boolean lockdown = "lockdown".equals(alert.getString("kind"));
      JSONObject event = lockdown ? GuardianKeys.decrypt(pair, alert, now) : null;
      if (!PairStore.accept(this, profileId, alert, event, now)) return;
      name = PairStore.profile(this, profileId).getString("name");
      ReceiverState.status(
          this,
          profileId,
          lockdown ? "New lockdown request — check in before unlocking" : "New check-in request");
      Intent destination =
          new Intent(this, MainActivity.class)
              .setData(android.net.Uri.parse("carekoala://person/" + profileId))
              .putExtra("profile_id", profileId);
      PendingIntent open =
          PendingIntent.getActivity(
              this,
              profileId.hashCode(),
              destination,
              PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
      boolean test = alert.optBoolean("test", false);
      String text =
          lockdown
              ? "CareKoala has paused the paired desktop. Open Guardian privately to view its"
                  + " unlock key."
              : test
                  ? Protocol.TEST_MESSAGE
                  : "Please check in with the person paired with this device.";
      Notification n =
          new Notification.Builder(this, "checkins")
              .setSmallIcon(R.drawable.ic_guardian)
              .setContentTitle(
                  name
                      + " · "
                      + (lockdown
                          ? (test ? "Lockdown demo" : "Check-in needed")
                          : test ? "Test warning" : "Check-in recommended"))
              .setContentText(text)
              .setStyle(new Notification.BigTextStyle().bigText(text))
              .setContentIntent(open)
              .setAutoCancel(true)
              .setVisibility(Notification.VISIBILITY_PRIVATE)
              .setPublicVersion(
                  new Notification.Builder(this, "checkins")
                      .setSmallIcon(R.drawable.ic_guardian)
                      .setContentTitle("CareKoala Guardian")
                      .setContentText("Open Guardian to view a private check-in request.")
                      .build())
              .build();
      getSystemService(NotificationManager.class)
          .notify((profileId + id).hashCode() & 0x7fffffff, n);
    } catch (Exception ignored) {
    }
  }

  private synchronized void halt() {
    running = false;
    generation++;
    for (HttpURLConnection c : connections) c.disconnect();
    if (workers != null) workers.shutdownNow();
  }

  @Override
  public void onDestroy() {
    halt();
    stopForeground(STOP_FOREGROUND_REMOVE);
    super.onDestroy();
  }
}
