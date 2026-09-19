package org.carekoala.guardian;
import android.content.Context;
import android.content.Intent;
import android.app.NotificationManager;

final class ReceiverState {
 static boolean enabled(Context c){return c.getSharedPreferences("receiver",0).getBoolean("enabled",c.getSharedPreferences("guardian",0).contains("sealed_pair"));}
 static void enabled(Context c,boolean enabled){
  if(!c.getSharedPreferences("receiver",0).edit().putBoolean("enabled",enabled).commit())throw new IllegalStateException("Could not save receiver preference");
 }
 static void status(Context c,String status){c.getSharedPreferences("receiver",0).edit().putString("status",status).apply();}
 static String status(Context c){return c.getSharedPreferences("receiver",0).getString("status","Ready to connect");}
 static void resume(Context c){
  if(!enabled(c))return;
  try{
   PairStore.load(c);
   if(!c.getSystemService(NotificationManager.class).areNotificationsEnabled()){status(c,"Notifications disabled. Allow them in Android settings to reconnect.");return;}
   c.startForegroundService(new Intent(c,GuardianService.class));
  }catch(Exception e){status(c,"Could not resume receiver. Open the app to check pairing and permissions.");}
 }
}
