package org.carekoala.guardian;

import android.content.Context;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.concurrent.*;
import org.json.JSONObject;

final class EnrollmentClient {
  interface Listener {
    void state(String message);

    void complete(String profileId);
  }

  private final Context context;
  private final JSONObject pair;
  private final String guardian, id = UUID.randomUUID().toString();
  private final Listener listener;
  private final long expires = System.currentTimeMillis() / 1000 + 600;
  private volatile boolean stopped;
  private volatile HttpURLConnection stream;
  private final ScheduledExecutorService threads = Executors.newScheduledThreadPool(2);
  private String publicCode, publicFingerprint, channel;

  EnrollmentClient(Context context, String code, String guardian, Listener listener)
      throws Exception {
    this.context = context.getApplicationContext();
    this.pair = EnrollmentProtocol.parse(code);
    this.guardian = guardian.trim();
    this.listener = listener;
  }

  void start() {
    threads.submit(
        () -> {
          try {
            publicCode = GuardianKeys.export(pair);
            publicFingerprint = GuardianKeys.fingerprint(pair);
            channel = EnrollmentProtocol.channel(pair);
            if (stopped) return;
            threads.scheduleWithFixedDelay(() -> offer(), 0, 8, TimeUnit.SECONDS);
            listen();
          } catch (Exception e) {
            if (!stopped)
              listener.state(
                  "Could not prepare pairing. Try again or create a new code on the PC.");
          }
        });
  }

  private void offer() {
    if (stopped) return;
    try {
      long now = System.currentTimeMillis() / 1000;
      if (now >= expires) {
        listener.state("Pairing timed out. Create a fresh code on the PC.");
        stop();
        return;
      }
      JSONObject p =
          new JSONObject()
              .put("v", 2)
              .put("kind", "guardian_offer")
              .put("id", id)
              .put("guardian", guardian)
              .put("public_code", publicCode)
              .put("issued_at", now)
              .put("expires_at", expires);
      Relay.publish(channel, EnrollmentProtocol.seal(pair, p, "offer"));
      if (!stopped)
        listener.state("Keys exchanged. Ask the PC user to approve this guardian connection.");
    } catch (Exception e) {
      if (!stopped) listener.state("Pairing connection interrupted. Retrying automatically…");
    }
  }

  private void listen() {
    long delay = 1000;
    while (!stopped) {
      HttpURLConnection c = null;
      try {
        c =
            (HttpURLConnection)
                new URL("https://ntfy.sh/" + channel + "/json?since=10m").openConnection();
        stream = c;
        c.setInstanceFollowRedirects(false);
        c.setConnectTimeout(15000);
        c.setReadTimeout(60000);
        if (c.getResponseCode() != 200) throw new IOException();
        delay = 1000;
        try (Reader reader = new InputStreamReader(c.getInputStream(), StandardCharsets.UTF_8)) {
          StringBuilder line = new StringBuilder();
          int ch;
          while (!stopped && (ch = reader.read()) != -1) {
            if (ch == '\n') {
              accept(line.toString());
              line.setLength(0);
            } else {
              if (line.length() >= 16384) throw new IOException();
              line.append((char) ch);
            }
          }
        }
      } catch (Exception ignored) {
      } finally {
        if (c != null) c.disconnect();
      }
      if (!stopped)
        try {
          Thread.sleep(delay);
          delay = Math.min(15000, delay * 2);
        } catch (InterruptedException e) {
          Thread.currentThread().interrupt();
          return;
        }
    }
  }

  private synchronized void accept(String line) {
    try {
      if (stopped || System.currentTimeMillis() / 1000 >= expires) return;
      JSONObject record = new JSONObject(line);
      if (!"message".equals(record.optString("event"))
          || !channel.equals(record.optString("topic"))) return;
      JSONObject ack =
          EnrollmentProtocol.open(
              pair, record.getString("message"), "ack", System.currentTimeMillis() / 1000);
      if (!"pc_ack".equals(ack.optString("kind"))
          || !id.equals(ack.optString("id"))
          || !publicFingerprint.equals(ack.optString("public_fingerprint"))) return;
      JSONObject bundle = GuardianKeys.decryptEnrollment(pair, ack.getString("rsa"));
      if (bundle.getInt("v") != 2
          || !"pair_keys".equals(bundle.getString("kind"))
          || !id.equals(bundle.getString("id"))
          || bundle.getLong("issued_at") != ack.getLong("issued_at")
          || bundle.getLong("expires_at") != ack.getLong("expires_at")) return;
      JSONObject finalPair = bundle.getJSONObject("pair");
      Protocol.fingerprint(finalPair);
      finalPair.put("guardian_key_id", Protocol.fingerprint(pair));
      String profileId = PairStore.saveNamed(context, finalPair, ack.getString("name"));
      stop();
      listener.complete(profileId);
    } catch (Exception ignored) {
    }
  }

  synchronized void stop() {
    stopped = true;
    if (stream != null) stream.disconnect();
    threads.shutdownNow();
  }
}
