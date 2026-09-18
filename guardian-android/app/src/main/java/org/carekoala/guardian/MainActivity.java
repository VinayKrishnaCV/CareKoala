package org.carekoala.guardian;
import android.Manifest;
import android.app.Activity;
import android.app.NotificationManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.view.WindowManager;
import android.widget.*;
import org.json.JSONObject;

public final class MainActivity extends Activity {
 private TextView status,fingerprint;private EditText code;private JSONObject inspected;
 @Override public void onCreate(Bundle state){super.onCreate(state);
  getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
  LinearLayout body=new LinearLayout(this);body.setOrientation(LinearLayout.VERTICAL);int pad=24;body.setPadding(pad,pad,pad,pad);
  ScrollView scroll=new ScrollView(this);scroll.addView(body);setContentView(scroll);
  TextView title=new TextView(this);title.setText("CareKoala Guardian");title.setTextSize(26);body.addView(title);
  TextView intro=new TextView(this);intro.setText("Receive encrypted check-in requests through ntfy.sh. No server or topic setup needed. The relay receives ciphertext and routing metadata, never your screenshots or conversation text. Keep the receiver running; Android battery restrictions can delay delivery.");body.addView(intro);
  TextView setup=new TextView(this);setup.setText("1. Paste and inspect the PC pairing code. 2. Compare fingerprints and save on both devices. 3. Start receiving. A persistent notification shows connection status.");body.addView(setup);
  code=new EditText(this);code.setHint("Private CK1 pairing code from your PC");code.setMinLines(3);body.addView(code);
  fingerprint=new TextView(this);body.addView(fingerprint);status=new TextView(this);body.addView(status);
  button(body,"Inspect pairing code",()->{inspected=Protocol.pairing(code.getText().toString().trim());fingerprint.setText("Compare on your PC:\n"+Protocol.fingerprint(inspected));});
  button(body,"Fingerprints match — save pairing",()->{
   if(inspected==null)throw new IllegalStateException("Inspect and compare the fingerprint first");
   JSONObject current=Protocol.pairing(code.getText().toString().trim());
   if(!Protocol.fingerprint(current).equals(Protocol.fingerprint(inspected)))throw new IllegalStateException("The code changed. Tap Inspect pairing code again and compare the new fingerprint.");
   stopService(new Intent(this,GuardianService.class));PairStore.save(this,inspected);code.setText("");
   fingerprint.setText("Saved fingerprint: "+Protocol.fingerprint(inspected));inspected=null;
   status.setText("Pairing saved on this phone. Verify the matching fingerprint on your PC too, then tap Start receiving. ntfy.sh is configured automatically.");
  });
  button(body,"Test phone notification",()->{
   if(Build.VERSION.SDK_INT>=33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED){requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS},10);status.setText("Grant permission, then tap Test phone notification again.");return;}
   NotificationManager nm=getSystemService(NotificationManager.class);
   if(!nm.areNotificationsEnabled())throw new IllegalStateException("Enable notifications in Android settings first");
   nm.createNotificationChannel(new NotificationChannel("checkins","Guardian check-in requests",NotificationManager.IMPORTANCE_HIGH));
   nm.notify(2,new Notification.Builder(this,"checkins").setSmallIcon(R.drawable.ic_guardian).setContentTitle("CareKoala notification test").setContentText("Phone notifications work. This is a local test, not a desktop alert.").setAutoCancel(true).build());
   status.setText("Local test notification posted. This does not test ntfy or desktop delivery.");
  });
  button(body,"Start receiving",()->{
   PairStore.load(this);
   if(Build.VERSION.SDK_INT>=33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED){requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS},10);status.setText("Grant notification permission, then tap Start receiving again.");return;}
   if(!getSystemService(NotificationManager.class).areNotificationsEnabled())throw new IllegalStateException("Enable notifications in Android settings first");
   startForegroundService(new Intent(this,GuardianService.class));status.setText("Listener starting. Connection status is shown in the persistent notification.");
  });
  button(body,"Stop receiving",()->{stopService(new Intent(this,GuardianService.class));status.setText("Stopped");});
  button(body,"Forget pairing",()->{stopService(new Intent(this,GuardianService.class));PairStore.clear(this);inspected=null;fingerprint.setText("");status.setText("Pairing removed from this phone. Revoke it on the PC too.");});
  try{JSONObject saved=PairStore.load(this);fingerprint.setText("Saved fingerprint: "+Protocol.fingerprint(saved.getJSONObject("pair")));status.setText("Pairing saved. Tap Start receiving to connect automatically to ntfy.sh.");}catch(Exception ignored){status.setText("No pairing saved on this phone. Paste the PC's private code, inspect it, compare fingerprints, then save pairing.");}
 }
 interface Action{void run()throws Exception;}
 private void button(LinearLayout body,String text,Action action){Button b=new Button(this);b.setText(text);body.addView(b);b.setOnClickListener(v->{try{action.run();}catch(Exception e){status.setText(e.getMessage()==null?"Operation failed":e.getMessage());}});}
}
