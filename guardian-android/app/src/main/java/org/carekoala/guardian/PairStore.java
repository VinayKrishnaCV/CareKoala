package org.carekoala.guardian;
import android.content.Context;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import org.json.JSONObject;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.Base64;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

final class PairStore {
 private static SecretKey key()throws Exception {
  KeyStore ks=KeyStore.getInstance("AndroidKeyStore");ks.load(null);
  if(!ks.containsAlias("carekoala-pair-wrap")) {
   KeyGenerator g=KeyGenerator.getInstance("AES","AndroidKeyStore");
   g.init(new KeyGenParameterSpec.Builder("carekoala-pair-wrap",KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setKeySize(256).build());g.generateKey();
  }
  return (SecretKey)ks.getKey("carekoala-pair-wrap",null);
 }
 static void save(Context c,JSONObject pair)throws Exception {
  Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,key());
  JSONObject payload=new JSONObject().put("pair",pair);
  String data=Base64.getEncoder().encodeToString(cipher.getIV())+":"+Base64.getEncoder().encodeToString(cipher.doFinal(payload.toString().getBytes(StandardCharsets.UTF_8)));
  if(!c.getSharedPreferences("guardian",0).edit().putString("sealed_pair",data).commit())throw new IllegalStateException("Could not save pairing");
 }
 static JSONObject load(Context c)throws Exception {
  String data=c.getSharedPreferences("guardian",0).getString("sealed_pair",null);if(data==null)throw new IllegalStateException("No pairing saved on this phone. Paste the PC pairing code, tap Inspect pairing code, compare fingerprints, then tap Fingerprints match — save pairing. Desktop verification alone does not save it here.");
  String[] parts=data.split(":");Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");
  cipher.init(Cipher.DECRYPT_MODE,key(),new GCMParameterSpec(128,Base64.getDecoder().decode(parts[0])));
  return new JSONObject(new String(cipher.doFinal(Base64.getDecoder().decode(parts[1])),StandardCharsets.UTF_8));
 }
 static void clear(Context c){c.getSharedPreferences("guardian",0).edit().clear().commit();}
}
