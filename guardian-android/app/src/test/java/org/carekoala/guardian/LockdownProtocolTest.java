package org.carekoala.guardian;
import org.junit.Test;
import static org.junit.Assert.*;
import org.json.JSONObject;
import java.security.*;
import java.security.spec.MGF1ParameterSpec;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import javax.crypto.Cipher;
import javax.crypto.spec.OAEPParameterSpec;
import javax.crypto.spec.PSource;

public class LockdownProtocolTest {
 private JSONObject envelope(KeyPair pair)throws Exception{
  JSONObject event=new JSONObject().put("v",1).put("kind","lockdown").put("key","0123456789abcdefghijklmnopqrstuv").put("id","aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa").put("issued_at",1000).put("expires_at",1300).put("test",true);
  Cipher cipher=Cipher.getInstance("RSA/ECB/OAEPPadding");
  cipher.init(Cipher.ENCRYPT_MODE,pair.getPublic(),new OAEPParameterSpec("SHA-256","MGF1",MGF1ParameterSpec.SHA1,PSource.PSpecified.DEFAULT));
  byte[] bytes=cipher.doFinal(event.toString().getBytes(StandardCharsets.UTF_8));
  event.remove("key");event.put("rsa",Base64.getEncoder().encodeToString(bytes));return event;
 }
 @Test public void rsaDecryptValidatesLifetimeMetadataAndPrivateKey()throws Exception{
  KeyPairGenerator generator=KeyPairGenerator.getInstance("RSA");generator.initialize(3072);KeyPair pair=generator.generateKeyPair();
  JSONObject outer=envelope(pair);
  assertEquals("0123456789abcdefghijklmnopqrstuv",LockdownProtocol.decrypt(pair.getPrivate(),outer,1100).getString("key"));
  assertThrows(Exception.class,()->LockdownProtocol.decrypt(pair.getPrivate(),outer,1300));
  assertThrows(Exception.class,()->LockdownProtocol.decrypt(pair.getPrivate(),outer,900));
  JSONObject changed=new JSONObject(outer.toString()).put("id","bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb");
  assertThrows(Exception.class,()->LockdownProtocol.decrypt(pair.getPrivate(),changed,1100));
  KeyPair other=generator.generateKeyPair();
  assertThrows(Exception.class,()->LockdownProtocol.decrypt(other.getPrivate(),outer,1100));
  byte[] damaged=Base64.getDecoder().decode(outer.getString("rsa"));damaged[4]^=1;outer.put("rsa",Base64.getEncoder().encodeToString(damaged));
  assertThrows(Exception.class,()->LockdownProtocol.decrypt(pair.getPrivate(),outer,1100));
 }
}
