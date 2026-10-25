package org.carekoala.guardian;
import org.junit.Test;
import static org.junit.Assert.*;
import org.json.JSONObject;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

public class UnlockProtocolTest {
 private static final String KEY="0123456789abcdefghijklmnopqrstuv",ID="aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
 private JSONObject pair()throws Exception{return new JSONObject(new String(getClass().getResourceAsStream("/protocol-vector.json").readAllBytes(),StandardCharsets.UTF_8)).getJSONObject("pair");}
 private JSONObject event()throws Exception{return new JSONObject().put("v",1).put("kind","lockdown").put("key",KEY).put("id",ID).put("issued_at",1000).put("expires_at",1300).put("test",true);}
 private JSONObject open(JSONObject pair,String envelope,String aad)throws Exception{
  JSONObject outer=new JSONObject(envelope);
  Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");
  cipher.init(Cipher.DECRYPT_MODE,new SecretKeySpec(Base64.getDecoder().decode(pair.getString("key")),"AES"),new GCMParameterSpec(128,Base64.getDecoder().decode(outer.getString("nonce"))));
  cipher.updateAAD(aad.getBytes(StandardCharsets.UTF_8));
  return new JSONObject(new String(cipher.doFinal(Base64.getDecoder().decode(outer.getString("ciphertext"))),StandardCharsets.UTF_8));
 }
 @Test public void unlockTopicMatchesDesktopAndDiffersFromAlerts()throws Exception{
  // Expected value derived independently by the desktop (Node) implementation.
  assertEquals("ck-FtOFKVJCIWTJnkcqmAX2NxmBXf2KTmuQEgVTzyvsBoE",Protocol.unlockTopic(pair()));
  assertNotEquals(Protocol.topic(pair()),Protocol.unlockTopic(pair()));
 }
 @Test public void sealsOnlyTheCurrentEventKeyWithBoundedLifetime()throws Exception{
  String envelope=Protocol.sealUnlock(pair(),event(),5000);
  assertFalse(envelope.contains(KEY));
  JSONObject p=open(pair(),envelope,"CareKoala guardian unlock v1");
  assertEquals(1,p.getInt("v"));assertEquals("unlock",p.getString("kind"));assertEquals(ID,p.getString("id"));assertEquals(KEY,p.getString("key"));
  assertEquals(5000,p.getLong("issued_at"));assertEquals(5300,p.getLong("expires_at"));
  assertEquals(6,p.length());
  assertNotEquals(envelope,Protocol.sealUnlock(pair(),event(),5000));
 }
 @Test public void unlockAndAlertChannelsCannotBeConfused()throws Exception{
  JSONObject pair=pair();String envelope=Protocol.sealUnlock(pair,event(),1000);
  assertThrows(Exception.class,()->Protocol.open(pair,envelope,1100));
  assertThrows(Exception.class,()->open(pair,envelope,"CareKoala guardian check-in v1"));
  assertThrows(Exception.class,()->Protocol.sealUnlock(pair,event().put("kind","guardian_check_in"),1000));
  assertThrows(Exception.class,()->Protocol.sealUnlock(pair,event().put("key","short"),1000));
  assertThrows(Exception.class,()->Protocol.sealUnlock(pair,event().put("id","not-a-uuid"),1000));
 }
}
