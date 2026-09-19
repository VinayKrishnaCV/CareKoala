package org.carekoala.guardian;
import android.app.*;
import android.content.*;
import android.os.IBinder;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;
import org.json.JSONObject;

public final class GuardianService extends Service {
 private volatile boolean running;private volatile int generation;private ExecutorService workers;
 private final Set<HttpURLConnection> connections=ConcurrentHashMap.newKeySet();
 @Override public IBinder onBind(Intent i){return null;}
 private Notification notice(String text){
  PendingIntent open=PendingIntent.getActivity(this,0,new Intent(this,MainActivity.class),PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
  PendingIntent stop=PendingIntent.getService(this,1,new Intent(this,GuardianService.class).setAction("STOP"),PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
  return new Notification.Builder(this,"listener").setSmallIcon(R.drawable.ic_guardian).setContentTitle("CareKoala Guardian").setContentText(text).setOngoing(true).setContentIntent(open).addAction(new Notification.Action.Builder(null,"Stop",stop).build()).build();
 }
 private void status(String text){ReceiverState.status(this,text);getSystemService(NotificationManager.class).notify(1,notice(text));}
 @Override public int onStartCommand(Intent intent,int flags,int id){
  if(intent!=null && "STOP".equals(intent.getAction())){ReceiverState.enabled(this,false);ReceiverState.status(this,"Paused by you");stopSelf();return START_NOT_STICKY;}
  if(!ReceiverState.enabled(this)){stopSelf();return START_NOT_STICKY;}
  NotificationManager nm=getSystemService(NotificationManager.class);
  nm.createNotificationChannel(new NotificationChannel("listener","Receiver status",NotificationManager.IMPORTANCE_LOW));
  nm.createNotificationChannel(new NotificationChannel("checkins","Guardian check-in requests",NotificationManager.IMPORTANCE_HIGH));
  startForeground(1,notice("Connecting to ntfy.sh…"));
  ReceiverState.status(this,"Connecting to ntfy.sh…");
  try {
   JSONObject pair=PairStore.load(this).getJSONObject("pair");
   halt();final int session=generation;
   running=true;workers=Executors.newSingleThreadExecutor();
   workers.submit(()->listen(pair,session));
  }catch(Exception e){status("Pairing unavailable — open the app");stopSelf();return START_NOT_STICKY;}
  return START_STICKY;
 }
 private void listen(JSONObject pair,int session){
  long retryMillis=1000;
  while(running && generation==session){HttpURLConnection connection=null;
   try{
    URL url=new URL("https://ntfy.sh/"+Protocol.topic(pair)+"/json?since=5m");
    connection=(HttpURLConnection)url.openConnection();connections.add(connection);
    connection.setInstanceFollowRedirects(false);connection.setConnectTimeout(15000);connection.setReadTimeout(60000);connection.setRequestProperty("Accept","application/json");
    if(connection.getResponseCode()!=200)throw new IOException("Relay unavailable");
    if(!running || generation!=session)break;
    status("Listening via ntfy.sh for encrypted check-in requests");retryMillis=1000;
    try(Reader reader=new InputStreamReader(connection.getInputStream(),StandardCharsets.UTF_8)){
     StringBuilder line=new StringBuilder();int ch;
     while(running && generation==session && (ch=reader.read())!=-1){
      if(ch=='\n'){accept(pair,line.toString(),session);line.setLength(0);}
      else{if(line.length()>=16384)throw new IOException("Oversized network record");line.append((char)ch);}
     }
    }
    if(running)throw new IOException("Relay disconnected");
   }catch(java.net.SocketTimeoutException expected){/* Rotate/reconnect; no data is not a delivery failure. */}
   catch(Exception error){if(running && generation==session)status("Disconnected — retrying ntfy.sh connection");}
   finally{if(connection!=null){connections.remove(connection);connection.disconnect();}}
   if(running && generation==session){try{Thread.sleep(retryMillis);}catch(InterruptedException e){Thread.currentThread().interrupt();break;}retryMillis=Math.min(30000,retryMillis*2);}
  }
 }
 private synchronized void accept(JSONObject pair,String record,int session){
  try{
   if(!running || generation!=session || record.trim().isEmpty())return;
   long now=System.currentTimeMillis()/1000;JSONObject alert=Protocol.ntfyAlert(pair,record,now);
   if(alert==null)return;
   SharedPreferences prefs=getSharedPreferences("guardian",0);
   JSONObject seen=new JSONObject(prefs.getString("seen","{}"));
   for(Iterator<String> it=seen.keys();it.hasNext();){String key=it.next();if(seen.getLong(key)<=now)it.remove();}
   String id=alert.getString("id");if(seen.has(id))return;
   if(seen.length()>=1000)return;
   seen.put(id,alert.getLong("expires_at"));
   if(!prefs.edit().putString("seen",seen.toString()).commit())return;
   PendingIntent open=PendingIntent.getActivity(this,0,new Intent(this,MainActivity.class),PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
   boolean test=alert.optBoolean("test",false);
   String text=test?Protocol.TEST_MESSAGE:"Please check in with the person paired with this device.";
   Notification n=new Notification.Builder(this,"checkins").setSmallIcon(R.drawable.ic_guardian).setContentTitle(test?"CareKoala test warning":"A check-in is recommended").setContentText(text).setStyle(new Notification.BigTextStyle().bigText(text)).setContentIntent(open).setAutoCancel(true).setVisibility(Notification.VISIBILITY_PRIVATE).build();
   getSystemService(NotificationManager.class).notify(id.hashCode() & 0x7fffffff,n);
  }catch(Exception ignored){/* Malformed, forged, expired and unrelated relay values are rejected. */}
 }
 private synchronized void halt(){running=false;generation++;for(HttpURLConnection c:connections)c.disconnect();if(workers!=null)workers.shutdownNow();}
 @Override public void onDestroy(){halt();stopForeground(STOP_FOREGROUND_REMOVE);super.onDestroy();}
}
