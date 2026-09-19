package org.carekoala.guardian;
import android.Manifest;
import android.app.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.widget.*;
import org.json.JSONObject;

public final class MainActivity extends Activity {
 private TextView status,fingerprint,inspectionFingerprint;private EditText code;private JSONObject inspected;
 private LinearLayout pairing;private Button start,stop;
 private SharedPreferences.OnSharedPreferenceChangeListener stateListener;
 private int dp(int value){return Math.round(value*getResources().getDisplayMetrics().density);}
 private GradientDrawable surface(int color,int radius){GradientDrawable shape=new GradientDrawable();shape.setColor(color);shape.setCornerRadius(dp(radius));return shape;}
 @Override public void onCreate(Bundle state){super.onCreate(state);
  getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
  getWindow().setStatusBarColor(Color.rgb(16,28,44));
  LinearLayout body=new LinearLayout(this);body.setOrientation(LinearLayout.VERTICAL);body.setPadding(dp(24),dp(24),dp(24),dp(32));
  ScrollView scroll=new ScrollView(this);scroll.setFillViewport(true);scroll.setBackgroundColor(Color.rgb(241,245,249));scroll.addView(body);setContentView(scroll);
  // Respect system bars on Android 15 edge-to-edge layouts.
  scroll.setOnApplyWindowInsetsListener((v,insets)->{v.setPadding(insets.getSystemWindowInsetLeft(),insets.getSystemWindowInsetTop(),insets.getSystemWindowInsetRight(),insets.getSystemWindowInsetBottom());return insets;});
  text(body,"CareKoala Guardian",28,true);
  text(body,"A private connection. A simple check-in.",16,false);
  LinearLayout connection=card(body);
  text(connection,"Connection",21,true);
  status=text(connection,"Checking saved connection…",16,false);status.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
  fingerprint=text(connection,"",14,false);
  start=button(connection,"Start receiving",()->enableReceiver(),true);
  stop=button(connection,"Pause receiving",()->{
   ReceiverState.enabled(this,false);stopService(new Intent(this,GuardianService.class));ReceiverState.status(this,"Paused by you");refresh();
  },false);
  text(connection,"When enabled, your connection resumes after app restart and phone reboot. Pause keeps it off until you start it again.",14,false);
  button(connection,"Test phone notification",()->testNotification(),false);

  LinearLayout setup=card(body);
  text(setup,"Paired desktop",21,true);
  button(setup,"Show or change pairing",()->pairing.setVisibility(pairing.getVisibility()==View.VISIBLE?View.GONE:View.VISIBLE),false);
  pairing=new LinearLayout(this);pairing.setOrientation(LinearLayout.VERTICAL);setup.addView(pairing);
  text(pairing,"Paste the private code from your PC, inspect it, and compare the fingerprints before saving.",14,false);
  code=new EditText(this);code.setHint("Private CK1 pairing code");code.setMinLines(3);code.setTextSize(16);code.setPadding(dp(12),dp(12),dp(12),dp(12));pairing.addView(code);
  inspectionFingerprint=text(pairing,"",14,false);
  button(pairing,"Inspect pairing code",()->{
   inspected=Protocol.pairing(code.getText().toString().trim());inspectionFingerprint.setText("Compare on your PC:\n"+Protocol.fingerprint(inspected));
  },false);
  button(pairing,"Fingerprints match — save pairing",()->{
   if(inspected==null)throw new IllegalStateException("Inspect and compare the fingerprint first");
   JSONObject current=Protocol.pairing(code.getText().toString().trim());
   if(!Protocol.fingerprint(current).equals(Protocol.fingerprint(inspected)))throw new IllegalStateException("The code changed. Inspect it again before saving.");
   // Keep one receiver instance and switch secrets within its own serialized lifecycle.
   PairStore.save(this,inspected);code.setText("");inspected=null;pairing.setVisibility(View.GONE);
   ReceiverState.enabled(this,true);
   enableReceiver();
  },true);
  button(pairing,"Forget pairing",()->{
   ReceiverState.enabled(this,false);stopService(new Intent(this,GuardianService.class));PairStore.clear(this);
   inspected=null;code.setText("");fingerprint.setText("");ReceiverState.status(this,"Pairing removed");refresh();pairing.setVisibility(View.VISIBLE);
  },false);
  LinearLayout privacy=card(body);text(privacy,"Encrypted on both devices",19,true);
  text(privacy,"Only encrypted alerts pass through ntfy.sh. Screenshots and conversation text stay on the PC. No account or server setup required.",14,false);
  text(privacy,"Keep notifications allowed. Android Force stop and device battery restrictions can prevent background recovery; reopening this app resumes an enabled connection.",14,false);
  try{PairStore.load(this);pairing.setVisibility(View.GONE);}catch(Exception e){pairing.setVisibility(View.VISIBLE);}
  stateListener=(prefs,key)->runOnUiThread(()->refresh());
  getSharedPreferences("receiver",0).registerOnSharedPreferenceChangeListener(stateListener);
  refresh();
 }
 @Override protected void onResume(){super.onResume();ReceiverState.resume(this);refresh();}
 @Override protected void onDestroy(){getSharedPreferences("receiver",0).unregisterOnSharedPreferenceChangeListener(stateListener);super.onDestroy();}
 private void refresh(){
  if(status==null)return;
  boolean paired=false;
  try{JSONObject saved=PairStore.load(this);fingerprint.setText("Saved fingerprint\n"+Protocol.fingerprint(saved.getJSONObject("pair")));paired=true;}catch(Exception e){fingerprint.setText("No desktop paired");}
  boolean enabled=ReceiverState.enabled(this);
  status.setText(!paired?"Pair your desktop to begin":enabled?ReceiverState.status(this):"Paused — automatic reconnect is off");
  start.setText(enabled?"Reconnect":"Start receiving");start.setEnabled(paired);stop.setEnabled(paired && enabled);
 }
 private void enableReceiver()throws Exception{
  PairStore.load(this);ReceiverState.enabled(this,true);
  if(Build.VERSION.SDK_INT>=33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED){
   requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS},11);status.setText("Allow notifications to finish connecting.");return;
  }
  if(!getSystemService(NotificationManager.class).areNotificationsEnabled())throw new IllegalStateException("Enable CareKoala notifications in Android settings.");
  ReceiverState.resume(this);refresh();
 }
 @Override public void onRequestPermissionsResult(int request,String[] permissions,int[] grants){
  super.onRequestPermissionsResult(request,permissions,grants);
  if(grants.length>0 && grants[0]==PackageManager.PERMISSION_GRANTED){
   if(request==11){ReceiverState.resume(this);refresh();}
   else if(request==10)try{testNotification();}catch(Exception e){status.setText(e.getMessage());}
  }else{ReceiverState.status(this,"Notification permission required. Allow it in Android settings.");refresh();}
 }
 private void testNotification()throws Exception{
  if(Build.VERSION.SDK_INT>=33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED){requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS},10);return;}
  NotificationManager nm=getSystemService(NotificationManager.class);
  if(!nm.areNotificationsEnabled())throw new IllegalStateException("Enable notifications in Android settings first");
  nm.createNotificationChannel(new NotificationChannel("checkins","Guardian check-in requests",NotificationManager.IMPORTANCE_HIGH));
  nm.notify(2,new Notification.Builder(this,"checkins").setSmallIcon(R.drawable.ic_guardian).setContentTitle("CareKoala notification test").setContentText("Phone notifications work. This is a local test, not a desktop alert.").setAutoCancel(true).build());
  status.setText("Local test posted. Use the PC test button to check remote delivery.");
 }
 private LinearLayout card(LinearLayout parent){
  LinearLayout card=new LinearLayout(this);card.setOrientation(LinearLayout.VERTICAL);card.setPadding(dp(20),dp(20),dp(20),dp(20));card.setBackground(surface(Color.WHITE,20));
  LinearLayout.LayoutParams lp=new LinearLayout.LayoutParams(-1,-2);lp.topMargin=dp(20);parent.addView(card,lp);return card;
 }
 private TextView text(LinearLayout parent,String value,int size,boolean bold){
  TextView v=new TextView(this);v.setText(value);v.setTextSize(size);v.setTextColor(Color.rgb(21,38,57));v.setLineSpacing(dp(3),1);if(bold)v.setTypeface(null,Typeface.BOLD);
  LinearLayout.LayoutParams lp=new LinearLayout.LayoutParams(-1,-2);lp.bottomMargin=dp(12);parent.addView(v,lp);return v;
 }
 interface Action{void run()throws Exception;}
 private Button button(LinearLayout parent,String label,Action action,boolean primary){
  Button b=new Button(this);b.setText(label);b.setAllCaps(false);b.setTextSize(16);b.setMinHeight(dp(48));b.setPadding(dp(16),dp(12),dp(16),dp(12));
  b.setTextColor(Color.rgb(14,43,49));b.setBackgroundTintList(null);b.setBackground(surface(primary?Color.rgb(95,224,195):Color.rgb(229,239,243),12));
  LinearLayout.LayoutParams lp=new LinearLayout.LayoutParams(-1,-2);lp.bottomMargin=dp(12);parent.addView(b,lp);
  b.setOnClickListener(v->{try{action.run();}catch(Exception e){status.setText(e.getMessage()==null?"Operation failed":e.getMessage());}});return b;
 }
}
