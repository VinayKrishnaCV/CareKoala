package org.carekoala.guardian;
import org.json.JSONObject;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Base64;
import java.util.UUID;
import javax.crypto.Cipher;
import javax.crypto.Mac;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

public final class Protocol {
 public static final long TTL=300;
 public static final String TEST_MESSAGE="This is a test warning from your paired CareKoala desktop. Please check in. No real concern was detected.";
 private static byte[] key(JSONObject pair,String field)throws Exception {
  if(pair.getInt("v")!=1)throw new IllegalArgumentException("Unsupported pairing version");
  byte[] key=Base64.getDecoder().decode(pair.getString(field));
  if(key.length!=32)throw new IllegalArgumentException("Invalid pairing key");return key;
 }
 public static JSONObject pairing(String code)throws Exception {
  if(!code.startsWith("CK1.") || code.length()>2048)throw new IllegalArgumentException("Use a CareKoala CK1 pairing code");
  JSONObject pair=new JSONObject(new String(Base64.getUrlDecoder().decode(code.substring(4)),StandardCharsets.UTF_8));
  key(pair,"key");key(pair,"route");return pair;
 }
 public static String hex(byte[] value){StringBuilder b=new StringBuilder();for(byte x:value)b.append(String.format("%02x",x&255));return b.toString();}
 public static String fingerprint(JSONObject pair)throws Exception {
  MessageDigest d=MessageDigest.getInstance("SHA-256");d.update(key(pair,"key"));d.update(key(pair,"route"));
  String h=hex(d.digest()).substring(0,24);return h.replaceAll("(.{4})(?!$)","$1-");
 }
 public static String route(JSONObject pair,long epochSeconds)throws Exception {
  Mac mac=Mac.getInstance("HmacSHA256");mac.init(new SecretKeySpec(key(pair,"route"),"HmacSHA256"));
  byte[] hash=mac.doFinal(("carekoala/route/v1/"+(epochSeconds/TTL)).getBytes(StandardCharsets.UTF_8));
  return hex(MessageDigest.getInstance("SHA-1").digest(hash));
 }
 public static String topic(JSONObject pair)throws Exception {
  Mac mac=Mac.getInstance("HmacSHA256");mac.init(new SecretKeySpec(key(pair,"route"),"HmacSHA256"));
  return "ck-"+Base64.getUrlEncoder().withoutPadding().encodeToString(mac.doFinal("carekoala/ntfy/v1".getBytes(StandardCharsets.UTF_8)));
 }
 public static JSONObject ntfyAlert(JSONObject pair,String record,long now)throws Exception {
  if(record.length()>16384)throw new IllegalArgumentException("Oversized relay record");
  JSONObject value=new JSONObject(record);
  if(!"message".equals(value.optString("event")))return null;
  if(!topic(pair).equals(value.optString("topic")))throw new IllegalArgumentException("Wrong topic");
  return open(pair,value.getString("message"),now);
 }
 public static JSONObject open(JSONObject pair,String envelope,long now)throws Exception {
  if(envelope.length()>4096)throw new IllegalArgumentException("Oversized alert");
  JSONObject outer=new JSONObject(envelope);
  if(outer.getInt("v")!=1)throw new IllegalArgumentException("Unknown alert version");
  byte[] nonce=Base64.getDecoder().decode(outer.getString("nonce"));if(nonce.length!=12)throw new IllegalArgumentException("Bad nonce");
  Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");
  cipher.init(Cipher.DECRYPT_MODE,new SecretKeySpec(key(pair,"key"),"AES"),new GCMParameterSpec(128,nonce));
  cipher.updateAAD("CareKoala guardian check-in v1".getBytes(StandardCharsets.UTF_8));
  JSONObject p=new JSONObject(new String(cipher.doFinal(Base64.getDecoder().decode(outer.getString("ciphertext"))),StandardCharsets.UTF_8));
  long issued=p.getLong("issued_at"),expires=p.getLong("expires_at");
  if(issued>now+30 || now>=expires || expires<=issued || expires-issued>TTL)throw new IllegalArgumentException("Expired or invalid alert");
  if(p.getInt("v")!=1 || !p.getString("kind").equals("guardian_check_in") || !Boolean.TRUE.equals(p.get("contact_guardian")))throw new IllegalArgumentException("Unknown message");
  UUID.fromString(p.getString("id"));
  if(p.has("test") && !(p.get("test") instanceof Boolean))throw new IllegalArgumentException("Invalid test marker");
  if(p.optBoolean("test",false) && !TEST_MESSAGE.equals(p.optString("message")))throw new IllegalArgumentException("Invalid sample text");
  return p;
 }
}
