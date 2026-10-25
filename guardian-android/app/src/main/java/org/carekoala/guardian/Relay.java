package org.carekoala.guardian;

import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;

final class Relay {
  static void publish(String topic, String envelope) throws Exception {
    if (!topic.matches("ck-[A-Za-z0-9_-]{43}"))
      throw new IllegalArgumentException("Invalid relay channel");
    HttpURLConnection c = (HttpURLConnection) new URL("https://ntfy.sh/" + topic).openConnection();
    try {
      c.setInstanceFollowRedirects(false);
      c.setConnectTimeout(15000);
      c.setReadTimeout(20000);
      c.setRequestMethod("POST");
      c.setDoOutput(true);
      c.setRequestProperty("Content-Type", "text/plain; charset=utf-8");
      c.setRequestProperty("X-Firebase", "no");
      byte[] body = envelope.getBytes(StandardCharsets.UTF_8);
      c.setFixedLengthStreamingMode(body.length);
      try (OutputStream out = c.getOutputStream()) {
        out.write(body);
      }
      if (c.getResponseCode() != 200) throw new IOException("Relay unavailable");
      c.getInputStream().close();
    } finally {
      c.disconnect();
    }
  }
}
