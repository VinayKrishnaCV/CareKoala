package org.carekoala.guardian;
import org.junit.Test;
import static org.junit.Assert.*;
import org.json.JSONObject;
import java.nio.charset.StandardCharsets;
import java.util.Base64;

public class ProtocolTest {
 @Test public void ntfyTopicMatchesPythonAndRejectsWrongRoute()throws Exception{
  JSONObject v=vector(),pair=v.getJSONObject("pair");
  assertEquals("ck-1Zcfjm3PjyQfQbXM2J4k3BMOPwUnPvcE0_p7L7TgzWc",Protocol.topic(pair));
  JSONObject record=new JSONObject().put("event","message").put("topic",Protocol.topic(pair)).put("message",v.getString("envelope"));
  assertTrue(Protocol.ntfyAlert(pair,record.toString(),1100).getBoolean("contact_guardian"));
  record.put("topic","wrong");
  assertThrows(Exception.class,()->Protocol.ntfyAlert(pair,record.toString(),1100));
 }
 @Test public void ntfyIgnoresControlEventsAndRejectsPlaintextAndExpiry()throws Exception{
  JSONObject v=vector(),pair=v.getJSONObject("pair");
  assertNull(Protocol.ntfyAlert(pair,"{\"event\":\"keepalive\"}",1100));
  assertNull(Protocol.ntfyAlert(pair,"{\"event\":\"open\"}",1100));
  JSONObject record=new JSONObject().put("event","message").put("topic",Protocol.topic(pair)).put("message","Please check in");
  assertThrows(Exception.class,()->Protocol.ntfyAlert(pair,record.toString(),1100));
  record.put("message",v.getString("envelope"));
  assertThrows(Exception.class,()->Protocol.ntfyAlert(pair,record.toString(),1300));
 }
 @Test public void decryptsPythonTestWarning()throws Exception{
  JSONObject v=new JSONObject(new String(getClass().getResourceAsStream("/test-warning-vector.json").readAllBytes(),StandardCharsets.UTF_8));
  JSONObject alert=Protocol.open(v.getJSONObject("pair"),v.getString("envelope"),1100);
  assertTrue(alert.getBoolean("test"));
  assertEquals(Protocol.TEST_MESSAGE,alert.getString("message"));
  assertThrows(Exception.class,()->Protocol.open(v.getJSONObject("pair"),v.getString("envelope"),1300));
 }
 private JSONObject vector()throws Exception{return new JSONObject(new String(getClass().getResourceAsStream("/protocol-vector.json").readAllBytes(),StandardCharsets.UTF_8));}
 @Test public void decryptsPythonEnvelopeAndMatchesRoute()throws Exception{
  JSONObject v=vector(),pair=v.getJSONObject("pair");
  assertEquals(v.getString("route"),Protocol.route(pair,v.getLong("now")));
  assertTrue(Protocol.open(pair,v.getString("envelope"),1100).getBoolean("contact_guardian"));
  assertEquals(29,Protocol.fingerprint(pair).length());
 }
 @Test public void rejectsTamperingExpiryAndWrongKey()throws Exception{
  JSONObject v=vector(),pair=v.getJSONObject("pair"),outer=new JSONObject(v.getString("envelope"));
  assertThrows(Exception.class,()->Protocol.open(pair,v.getString("envelope"),1300));
  byte[] bytes=Base64.getDecoder().decode(outer.getString("ciphertext"));bytes[0]^=1;
  outer.put("ciphertext",Base64.getEncoder().encodeToString(bytes));
  assertThrows(Exception.class,()->Protocol.open(pair,outer.toString(),1100));
  pair.put("key",Base64.getEncoder().encodeToString(new byte[32]));
  assertThrows(Exception.class,()->Protocol.open(pair,v.getString("envelope"),1100));
 }
 @Test public void acceptsPrivateCodeAndRotatesRouting()throws Exception{
  JSONObject p=vector().getJSONObject("pair");
  String code="CK1."+Base64.getUrlEncoder().withoutPadding().encodeToString(p.toString().getBytes(StandardCharsets.UTF_8));
  assertEquals(Protocol.fingerprint(p),Protocol.fingerprint(Protocol.pairing(code)));
  assertNotEquals(Protocol.route(p,1199),Protocol.route(p,1200));
 }
}
