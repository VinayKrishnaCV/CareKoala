package org.carekoala.guardian;
import org.junit.Test;
import static org.junit.Assert.*;
import org.json.JSONObject;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
public class EnrollmentProtocolTest {
 @Test public void phoneDecoderReadsDesktopQr()throws Exception{
  JSONObject vector=new JSONObject(new String(getClass().getResourceAsStream("/enrollment-vector.json").readAllBytes(),StandardCharsets.UTF_8));
  JSONObject qr=vector.getJSONObject("qr");int size=qr.getInt("size"),width=(size+8)*4,height=width;int[] pixels=new int[width*height];java.util.Arrays.fill(pixels,0xffffffff);
  for(int y=0;y<size;y++)for(int x=0;x<size;x++)if(qr.getJSONArray("bits").getInt(y*size+x)==1)for(int dy=0;dy<4;dy++)for(int dx=0;dx<4;dx++)pixels[((y+4)*4+dy)*width+(x+4)*4+dx]=0xff000000;
  com.google.zxing.BinaryBitmap bitmap=new com.google.zxing.BinaryBitmap(new com.google.zxing.common.HybridBinarizer(new com.google.zxing.RGBLuminanceSource(width,height,pixels)));
  assertEquals(vector.getString("code"),new com.google.zxing.qrcode.QRCodeReader().decode(bitmap).getText());
 }
 @Test public void nodeInvitationAndEncryptedOfferAreCompatible()throws Exception{
  JSONObject vector=new JSONObject(new String(getClass().getResourceAsStream("/enrollment-vector.json").readAllBytes(),StandardCharsets.UTF_8));
  JSONObject pair=EnrollmentProtocol.parse(vector.getString("code"));assertEquals(vector.getJSONObject("pair").getString("key"),pair.getString("key"));assertEquals(vector.getJSONObject("pair").getString("route"),pair.getString("route"));assertEquals(vector.getString("channel"),EnrollmentProtocol.channel(pair));
  JSONObject offer=EnrollmentProtocol.open(pair,vector.getString("offer"),"offer",1100);assertEquals("Fixture",offer.getString("guardian"));
  assertThrows(Exception.class,()->EnrollmentProtocol.open(pair,vector.getString("offer"),"ack",1100));assertThrows(Exception.class,()->EnrollmentProtocol.open(pair,vector.getString("offer"),"offer",1600));
  String formatted=vector.getString("code").toLowerCase().replace("-"," \n");assertEquals(pair.getString("key"),EnrollmentProtocol.parse(formatted).getString("key"));
  assertThrows(Exception.class,()->EnrollmentProtocol.parse("CK2-12345"));
 }
 @Test public void personRecordsAndHistoriesStayIndependent()throws Exception{
  JSONObject people=new JSONObject();JSONObject pair1=new JSONObject().put("v",1).put("key",Base64.getEncoder().encodeToString(new byte[32])).put("route",Base64.getEncoder().encodeToString(new byte[32]));
  byte[] other=new byte[32];other[0]=1;JSONObject pair2=new JSONObject(pair1.toString()).put("key",Base64.getEncoder().encodeToString(other));
  JSONObject first=Profiles.upsert(people,pair1,"Alex");first.put("lockdown",new JSONObject().put("id","alex-event")).put("enabled",false);
  JSONObject second=Profiles.upsert(people,pair2,"Sam");assertEquals(2,people.length());assertFalse(second.has("lockdown"));assertTrue(second.getBoolean("enabled"));
  Profiles.upsert(people,pair2,"Sam's PC");assertEquals(2,people.length());assertEquals("alex-event",first.getJSONObject("lockdown").getString("id"));assertFalse(first.getBoolean("enabled"));assertEquals(2,Profiles.summaries(people).length());
  Profiles.upsert(people,pair1,"Alex renamed");assertFalse(first.getBoolean("enabled"));assertEquals("alex-event",first.getJSONObject("lockdown").getString("id"));
 }
}
