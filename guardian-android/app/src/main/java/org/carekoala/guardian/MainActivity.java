package org.carekoala.guardian;

import android.Manifest;
import android.app.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.graphics.Typeface;
import android.os.*;
import android.view.*;
import android.widget.*;
import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;
import androidx.appcompat.app.AppCompatDelegate;
import androidx.core.content.ContextCompat;
import androidx.lifecycle.ViewModelProvider;
import com.google.android.material.appbar.MaterialToolbar;
import com.google.android.material.bottomnavigation.BottomNavigationView;
import com.google.android.material.button.MaterialButton;
import com.google.android.material.dialog.MaterialAlertDialogBuilder;
import com.google.android.material.textfield.TextInputEditText;
import com.google.android.material.textfield.TextInputLayout;
import com.google.zxing.integration.android.IntentIntegrator;
import com.google.zxing.integration.android.IntentResult;
import org.json.*;

public final class MainActivity extends AppCompatActivity {
  private static final int PEOPLE = 1, ADD = 2, SETTINGS = 3, REVEAL = 22, SEND = 23;
  private LinearLayout content;
  private ScrollView scroll;
  private String renderedKey = "";
  private BottomNavigationView nav;
  private TextView pageStatus;
  private EditText code, guardianName;
  private GuardianState ui;
  private SharedPreferences.OnSharedPreferenceChangeListener changes;
  private boolean refreshQueued;

  private int dp(int n) {
    return Math.round(n * getResources().getDisplayMetrics().density);
  }

  @Override
  public void onCreate(Bundle state) {
    AppCompatDelegate.setDefaultNightMode(
        getSharedPreferences("appearance", 0)
            .getInt("night_mode", AppCompatDelegate.MODE_NIGHT_FOLLOW_SYSTEM));
    super.onCreate(state);
    ui = new ViewModelProvider(this).get(GuardianState.class);
    getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
    if (!ui.initialized && state != null) {
      ui.authProfile = state.getString("authProfile", "");
      ui.authEvent = state.getString("authEvent", "");
      ui.detail = state.getString("detail", "");
      ui.page = state.getInt("page", PEOPLE);
    }
    ui.initialized = true;
    LinearLayout root = new LinearLayout(this);
    root.setOrientation(LinearLayout.VERTICAL);
    root.setBackgroundColor(color(R.color.ck_background));
    MaterialToolbar toolbar = new MaterialToolbar(this);
    toolbar.setTitle("CareKoala Guardian");
    toolbar.setPadding(dp(12), 0, dp(12), 0);
    boolean dark =
        (getResources().getConfiguration().uiMode
                & android.content.res.Configuration.UI_MODE_NIGHT_MASK)
            == android.content.res.Configuration.UI_MODE_NIGHT_YES;
    new androidx.core.view.WindowInsetsControllerCompat(getWindow(), getWindow().getDecorView())
        .setAppearanceLightNavigationBars(!dark);
    toolbar
        .getMenu()
        .add(0, 4, 0, dark ? R.string.theme_light : R.string.theme_dark)
        .setIcon(dark ? R.drawable.ic_theme_light : R.drawable.ic_theme_dark)
        .setShowAsAction(MenuItem.SHOW_AS_ACTION_ALWAYS);
    toolbar.setOnMenuItemClickListener(
        item -> {
          if (item.getItemId() != 4) return false;
          captureDraft();
          int mode = dark ? AppCompatDelegate.MODE_NIGHT_NO : AppCompatDelegate.MODE_NIGHT_YES;
          getSharedPreferences("appearance", 0).edit().putInt("night_mode", mode).apply();
          AppCompatDelegate.setDefaultNightMode(mode);
          return true;
        });
    root.addView(toolbar, new LinearLayout.LayoutParams(-1, dp(56)));
    scroll = new ScrollView(this);
    scroll.setFillViewport(true);
    content = new LinearLayout(this);
    content.setOrientation(LinearLayout.VERTICAL);
    content.setPadding(dp(16), dp(8), dp(16), dp(20));
    scroll.addView(content);
    root.addView(scroll, new LinearLayout.LayoutParams(-1, 0, 1));
    nav = new BottomNavigationView(this);
    nav.setBackgroundColor(color(R.color.ck_surface));
    nav.getMenu().add(0, PEOPLE, 0, "People").setIcon(android.R.drawable.ic_menu_myplaces);
    nav.getMenu().add(0, ADD, 1, "Add person").setIcon(android.R.drawable.ic_input_add);
    nav.getMenu().add(0, SETTINGS, 2, "Settings").setIcon(android.R.drawable.ic_menu_manage);
    root.addView(nav);
    setContentView(root);
    root.setOnApplyWindowInsetsListener(
        (v, insets) -> {
          v.setPadding(
              insets.getSystemWindowInsetLeft(),
              insets.getSystemWindowInsetTop(),
              insets.getSystemWindowInsetRight(),
              insets.getSystemWindowInsetBottom());
          return insets;
        });
    nav.setSelectedItemId(ui.page);
    nav.setOnItemSelectedListener(
        item -> {
          if (ui.isPairing() && item.getItemId() != ADD) {
            new MaterialAlertDialogBuilder(this)
                .setTitle("Cancel pairing?")
                .setMessage("Saved connections will be retained.")
                .setNegativeButton("Continue pairing", null)
                .setPositiveButton(
                    "Cancel pairing",
                    (d, w) -> {
                      ui.cancelEnrollment();
                      nav.setSelectedItemId(item.getItemId());
                    })
                .show();
            return false;
          }
          ui.page = item.getItemId();
          ui.detail = "";
          render();
          return true;
        });
    changes =
        (prefs, key) -> {
          if (ui.page == PEOPLE && !refreshQueued) {
            refreshQueued = true;
            content.post(
                () -> {
                  refreshQueued = false;
                  if (ui.page == PEOPLE && !isFinishing()) render();
                });
          }
        };
    getSharedPreferences("receiver", 0).registerOnSharedPreferenceChangeListener(changes);
    openNotification(getIntent());
    render();
    ui.updates()
        .observe(
            this,
            update -> {
              if (update == null || !ui.isCurrent(update)) return;
              if (!update.profileId.isEmpty()) {
                ui.consumeUpdate();
                act(
                    () -> {
                      ReceiverState.enabled(this, true);
                      enableReceiver();
                      ui.detail = update.profileId;
                      nav.setSelectedItemId(PEOPLE);
                      ui.detail = update.profileId;
                      render();
                      Toast.makeText(this, "Pairing saved", Toast.LENGTH_SHORT).show();
                    });
              } else if (ui.page == ADD && pageStatus != null) pageStatus.setText(update.message);
            });
  }

  @Override
  protected void onResume() {
    super.onResume();
    ReceiverState.resume(this);
    if (content != null && ui.page == PEOPLE) render();
  }

  @Override
  protected void onNewIntent(Intent intent) {
    super.onNewIntent(intent);
    setIntent(intent);
    openNotification(intent);
    render();
  }

  private void openNotification(Intent intent) {
    String id = intent.getStringExtra("profile_id");
    if (id == null) return;
    try {
      PairStore.profile(this, id);
    } catch (Exception e) {
      return;
    }
    if (ui.isPairing()) {
      new MaterialAlertDialogBuilder(this)
          .setTitle("Open this check-in?")
          .setMessage("Your current pairing attempt will close. Existing people stay connected.")
          .setNegativeButton("Keep pairing", null)
          .setPositiveButton(
              "Open check-in",
              (d, w) -> {
                ui.cancelEnrollment();
                openNotification(intent);
                render();
              })
          .show();
      return;
    }
    try {
      PairStore.select(this, id);
      ui.detail = id;
      ui.page = PEOPLE;
      nav.setSelectedItemId(PEOPLE);
      ui.detail = id;
    } catch (Exception ignored) {
    }
  }

  @Override
  protected void onSaveInstanceState(Bundle out) {
    captureDraft();
    super.onSaveInstanceState(out);
    out.putString("authProfile", ui.authProfile);
    out.putString("authEvent", ui.authEvent);
    out.putString("detail", ui.detail);
    out.putInt("page", ui.page);
  }

  @Override
  protected void onDestroy() {
    getSharedPreferences("receiver", 0).unregisterOnSharedPreferenceChangeListener(changes);
    super.onDestroy();
  }

  private void render() {
    String key = ui.page + ":" + ui.detail;
    int y = key.equals(renderedKey) ? scroll.getScrollY() : 0;
    renderedKey = key;
    content.removeAllViews();
    pageStatus = null;
    try {
      if (ui.page == ADD) addPage();
      else if (ui.page == SETTINGS) settingsPage();
      else if (!ui.detail.isEmpty()) personPage(ui.detail);
      else peoplePage();
    } catch (Exception e) {
      message(e.getMessage());
      button(
          content,
          "Back to people",
          () -> {
            ui.detail = "";
            ui.page = PEOPLE;
            nav.setSelectedItemId(PEOPLE);
            render();
          },
          true);
    }
    scroll.post(() -> scroll.scrollTo(0, y));
  }

  private void peoplePage() throws Exception {
    text(content, "People", 22, true);
    JSONArray profiles = PairStore.list(this);
    LinearLayout summary = card(content);
    if (profiles.length() > 0)
      text(
          summary,
          profiles.length() + (profiles.length() == 1 ? " paired PC" : " paired PCs"),
          16,
          true);
    if (!ReceiverState.enabled(this) && profiles.length() > 0)
      text(summary, "All alerts paused", 14, false);
    if (profiles.length() > 0)
      button(
          summary,
          ReceiverState.enabled(this) ? "Pause all alerts" : "Resume all alerts",
          () -> {
            if (ReceiverState.enabled(this)) {
              ReceiverState.enabled(this, false);
              stopService(new Intent(this, GuardianService.class));
            } else enableReceiver();
            render();
          },
          false);
    else button(summary, "Add a person", () -> nav.setSelectedItemId(ADD), true);
    for (int i = 0; i < profiles.length(); i++) {
      JSONObject p = profiles.getJSONObject(i);
      String id = p.getString("id"), name = p.getString("name");
      LinearLayout item = card(content);
      text(item, name, 18, true);
      String connection =
          !ReceiverState.enabled(this)
              ? "All alerts paused"
              : !p.getBoolean("enabled")
                  ? "Paused for this person"
                  : ReceiverState.personStatus(this, id);
      text(item, connection, 14, false);
      if (p.getBoolean("hasLockdown")) text(item, "Unlock request received", 14, true);
      button(
          item,
          p.getBoolean("hasLockdown") ? "Review check-in" : "View person",
          () -> {
            PairStore.select(this, id);
            ui.detail = id;
            render();
          },
          p.getBoolean("hasLockdown"));
    }
  }

  private void personPage(String id) throws Exception {
    JSONObject profile = PairStore.profile(this, id);
    String name = profile.getString("name");
    button(
        content,
        "‹  All people",
        () -> {
          ui.detail = "";
          render();
        },
        false);
    text(content, name, 22, true);
    LinearLayout connection = card(content);
    text(connection, "Connection", 20, true);
    text(
        connection,
        !ReceiverState.enabled(this)
            ? "Receiving is paused for everyone"
            : !profile.optBoolean("enabled", true)
                ? "Paused for this person"
                : ReceiverState.personStatus(this, id),
        16,
        false);
    button(
        connection,
        profile.optBoolean("enabled", true)
            ? "Pause alerts for " + name
            : "Resume alerts for " + name,
        () -> {
          boolean enable = !profile.optBoolean("enabled", true);
          PairStore.enabled(this, id, enable);
          if (enable) enableReceiver();
          else ReceiverState.resume(this);
          render();
        },
        false);
    LinearLayout request = card(content);
    text(request, "Guardian check-in", 22, true);
    JSONObject event = PairStore.lockdown(this, id);
    if (event == null)
      text(
          request,
          profile.has("unlock_confirmed")
              ? "PC unlocked. No pending unlock request."
              : "No unlock request received. You can use the demo button on this person's PC to"
                    + " test the connection.",
          16,
          false);
    else {
      text(
          request,
          (event.optBoolean("test") ? "Demo request" : "Latest unlock request")
              + " · "
              + new java.text.SimpleDateFormat("d MMM, h:mm a", java.util.Locale.getDefault())
                  .format(new java.util.Date(event.getLong("issued_at") * 1000)),
          16,
          false);
      text(request, "Check in with " + name + " before unlocking their PC.", 16, false);
      boolean sent = event.getString("id").equals(profile.optString("unlock_sent"));
      button(
          request,
          sent ? "Send unlock again" : "Unlock " + name + "'s PC",
          () -> confirmIdentity(id, SEND),
          true);
      button(request, "Read key instead", () -> confirmIdentity(id, REVEAL), false);
      if (event.getString("id").equals(profile.optString("unlock_sent")))
        text(request, "Unlock sent. Delivery to the PC is not yet confirmed.", 14, false);
      text(
          request,
          "Both actions require your phone PIN or biometric. The key stays private.",
          14,
          false);
    }
    LinearLayout manage = card(content);
    text(manage, "Manage person", 20, true);
    button(manage, "Rename", () -> rename(id, name), false);
    button(
        manage,
        "Connection details",
        () ->
            new MaterialAlertDialogBuilder(this)
                .setTitle("Connection details")
                .setMessage(
                    "Pairing fingerprint\n"
                        + id
                        + "\n\n"
                        + "Public key and alert encryption are set up on this device. Your private"
                        + " key stays in Android Keystore.")
                .setPositiveButton("Done", null)
                .show(),
        false);
    button(
        manage,
        "Remove person",
        () ->
            new MaterialAlertDialogBuilder(this)
                .setTitle("Remove " + name + "?")
                .setMessage(
                    "This phone will stop receiving their alerts. Other people stay connected."
                        + " Their PC may still need its guardian pairing removed.")
                .setNegativeButton("Keep", null)
                .setPositiveButton(
                    "Remove",
                    (d, w) ->
                        act(
                            () -> {
                              PairStore.remove(this, id);
                              ReceiverState.resume(this);
                              ui.detail = "";
                              render();
                            }))
                .show(),
        false);
  }

  private void rename(String id, String name) {
    EditText field = new EditText(this);
    field.setText(name);
    field.setSingleLine(true);
    new MaterialAlertDialogBuilder(this)
        .setTitle("Name this person")
        .setView(field)
        .setNegativeButton("Cancel", null)
        .setPositiveButton(
            "Save",
            (d, w) ->
                act(
                    () -> {
                      PairStore.rename(this, id, field.getText().toString());
                      render();
                    }))
        .show();
  }

  private void addPage() throws Exception {
    text(content, "Add person", 22, true);
    text(
        content,
        "One code connects alerts and guardian unlock. No separate key or fingerprint copying.",
        16,
        false);
    LinearLayout setup = card(content);
    text(setup, "1  Open CareKoala on their PC", 20, true);
    text(setup, "Go to Guardian and choose Connect guardian. Keep that PC screen open.", 16, false);
    guardianName =
        field(
            setup,
            "Guardian name",
            ui.draftGuardian.isEmpty()
                ? getSharedPreferences("receiver", 0).getString("guardian_name", "Guardian")
                : ui.draftGuardian);
    text(setup, "2  Scan or enter the code", 20, true);
    button(
        setup,
        "Scan PC QR code",
        () ->
            new IntentIntegrator(this)
                .setDesiredBarcodeFormats(IntentIntegrator.QR_CODE)
                .setPrompt("Scan the CareKoala pairing QR shown on the PC")
                .setOrientationLocked(true)
                .setBeepEnabled(false)
                .setCaptureActivity(SecureCaptureActivity.class)
                .initiateScan(),
        true);
    code = field(setup, "Pairing code (CK2-…)", ui.draftCode);
    code.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS);
    button(setup, "Connect using code", () -> beginEnrollment(code.getText().toString()), false);
    pageStatus =
        text(
            setup,
            "The code works remotely too. Share it privately, and ask the PC user to approve your"
                + " connection. It expires after 10 minutes.",
            16,
            false);
    pageStatus.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
    button(
        setup,
        "Cancel pairing",
        () -> {
          if (ui.isPairing()) {
            ui.cancelEnrollment();
          }
          code.setText("");
          pageStatus.setText("Pairing closed. Existing people are unchanged.");
        },
        false);
    text(
        content,
        "The camera is optional. QR scanning happens on this phone; images are not uploaded.",
        14,
        false);
  }

  private void beginEnrollment(String value) throws Exception {
    if (PairStore.list(this).length() >= Profiles.MAX)
      throw new IllegalStateException("Maximum 10 people. Remove a profile before adding another.");
    String name = Profiles.cleanName(guardianName.getText().toString());
    getSharedPreferences("receiver", 0).edit().putString("guardian_name", name).apply();
    ui.draftCode = "";
    ui.draftGuardian = name;
    ui.beginEnrollment(value, name);
    code.setText("");
    pageStatus.setText("Generating guardian key…");
  }

  private void settingsPage() {
    text(content, "Settings", 22, true);
    LinearLayout card = card(content);
    text(card, "Notifications", 22, true);
    text(
        card,
        "Keep notifications allowed so you can respond to check-ins. Background recovery also"
            + " depends on Android's battery settings.",
        16,
        false);
    button(
        card,
        "Notification settings",
        () ->
            startActivity(
                new Intent(android.provider.Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                    .putExtra(android.provider.Settings.EXTRA_APP_PACKAGE, getPackageName())),
        false);
    button(card, "Test this phone's notification", () -> testNotification(), false);
    LinearLayout privacy = card(content);
    text(
        privacy,
        "Each person has separate encryption keys and alert history. Screen content stays on their"
            + " PC. Only encrypted messages pass through ntfy.sh.",
        16,
        false);
    text(
        privacy,
        "Force stop can pause background delivery until you reopen Guardian. A sent unlock message"
            + " does not confirm that the PC received it.",
        14,
        false);
    text(content, "CareKoala Guardian 0.4.2", 12, false);
  }

  private void confirmIdentity(String id, int request) throws Exception {
    JSONObject event = PairStore.lockdown(this, id);
    if (event == null)
      throw new IllegalStateException("No unlock request is available for this person");
    KeyguardManager km = getSystemService(KeyguardManager.class);
    if (!km.isDeviceSecure())
      throw new IllegalStateException("Set a phone screen-lock PIN, password or pattern first");
    Intent confirm =
        km.createConfirmDeviceCredentialIntent(
            "CareKoala guardian unlock",
            "Verify it is you before unlocking "
                + PairStore.profile(this, id).getString("name")
                + "'s PC");
    if (confirm == null) throw new IllegalStateException("Device verification is unavailable");
    ui.authProfile = id;
    ui.authEvent = event.getString("id");
    startActivityForResult(confirm, request);
  }

  @Override
  protected void onActivityResult(int request, int result, Intent data) {
    super.onActivityResult(request, result, data);
    IntentResult scan = IntentIntegrator.parseActivityResult(request, result, data);
    if (scan != null) {
      if (scan.getContents() != null)
        act(
            () -> {
              if (ui.page != ADD) {
                ui.page = ADD;
                render();
              }
              beginEnrollment(scan.getContents());
            });
      else message("Camera scanning closed. You can enter the single code instead.");
      return;
    }
    if (request != REVEAL && request != SEND) return;
    if (result != RESULT_OK) {
      message("Verification cancelled. Nothing was sent.");
      return;
    }
    final String id = ui.authProfile, eventId = ui.authEvent;
    ui.authProfile = "";
    ui.authEvent = "";
    act(
        () -> {
          JSONObject event = PairStore.lockdown(this, id);
          if (event == null || !eventId.equals(event.getString("id")))
            throw new IllegalStateException("A newer request arrived. Review it and verify again.");
          if (request == REVEAL) {
            AlertDialog dialog =
                new MaterialAlertDialogBuilder(this)
                    .setTitle("Unlock key for " + PairStore.profile(this, id).getString("name"))
                    .setMessage(
                        event.getString("key")
                            + "\n\n"
                            + "Use only for this person's latest request. A replacement key"
                            + " invalidates it.")
                    .setPositiveButton("Done", null)
                    .create();
            dialog.getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
            dialog.show();
          } else sendUnlock(id, event);
        });
  }

  private void sendUnlock(String id, JSONObject event) {
    message("Sending encrypted unlock key…");
    new Thread(
            () -> {
              try {
                JSONObject pair = PairStore.profile(this, id).getJSONObject("pair");
                Relay.publish(
                    Protocol.unlockTopic(pair),
                    Protocol.sealUnlock(pair, event, System.currentTimeMillis() / 1000));
                PairStore.sent(this, id, event.getString("id"));
                runOnUiThread(
                    () -> {
                      render();
                      message("Unlock sent. The PC will unlock when it receives the key.");
                    });
              } catch (Exception e) {
                runOnUiThread(
                    () ->
                        message("Could not send. Check your connection, or use Read key instead."));
              }
            })
        .start();
  }

  private void enableReceiver() throws Exception {
    if (PairStore.list(this).length() == 0) return;
    ReceiverState.enabled(this, true);
    if (Build.VERSION.SDK_INT >= 33
        && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
            != PackageManager.PERMISSION_GRANTED) {
      requestPermissions(new String[] {Manifest.permission.POST_NOTIFICATIONS}, 11);
      return;
    }
    if (!getSystemService(NotificationManager.class).areNotificationsEnabled())
      throw new IllegalStateException("Enable Guardian notifications in Android settings");
    ReceiverState.resume(this);
  }

  @Override
  public void onRequestPermissionsResult(int request, String[] permissions, int[] grants) {
    super.onRequestPermissionsResult(request, permissions, grants);
    if (request == 11 || request == 10) {
      if (grants.length > 0 && grants[0] == PackageManager.PERMISSION_GRANTED)
        act(
            () -> {
              if (request == 10) testNotification();
              else ReceiverState.resume(this);
            });
      else message("Allow notifications in Settings to receive check-ins.");
    }
  }

  private void testNotification() throws Exception {
    if (Build.VERSION.SDK_INT >= 33
        && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
            != PackageManager.PERMISSION_GRANTED) {
      requestPermissions(new String[] {Manifest.permission.POST_NOTIFICATIONS}, 10);
      return;
    }
    NotificationManager nm = getSystemService(NotificationManager.class);
    if (!nm.areNotificationsEnabled())
      throw new IllegalStateException("Enable notifications in Android settings first");
    nm.createNotificationChannel(
        new NotificationChannel(
            "checkins", "Guardian check-in requests", NotificationManager.IMPORTANCE_HIGH));
    nm.notify(
        2,
        new Notification.Builder(this, "checkins")
            .setSmallIcon(R.drawable.ic_guardian)
            .setContentTitle("CareKoala notification test")
            .setContentText("Phone notifications work. Test remote delivery from a paired PC.")
            .setAutoCancel(true)
            .build());
    message("Test notification posted.");
  }

  private int color(int resource) {
    return ContextCompat.getColor(this, resource);
  }

  private void captureDraft() {
    if (ui != null && ui.page == ADD && code != null && guardianName != null) {
      ui.draftCode = code.getText().toString();
      ui.draftGuardian = guardianName.getText().toString();
    }
  }

  private LinearLayout card(LinearLayout parent) {
    LinearLayout body = new LinearLayout(this);
    body.setOrientation(LinearLayout.VERTICAL);
    body.setPadding(dp(12), dp(12), dp(12), dp(8));
    body.setBackgroundColor(color(R.color.ck_surface));
    LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-1, -2);
    lp.bottomMargin = dp(12);
    parent.addView(body, lp);
    View border = new View(this);
    border.setBackgroundColor(color(R.color.ck_border));
    parent.addView(border, new LinearLayout.LayoutParams(-1, dp(1)));
    return body;
  }

  private TextView text(LinearLayout parent, String value, int size, boolean bold) {
    TextView v = new TextView(this);
    v.setText(value);
    v.setTextSize(size);
    v.setTextColor(color(R.color.ck_text));
    v.setLineSpacing(dp(3), 1);
    if (bold) v.setTypeface(null, Typeface.BOLD);
    LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-1, -2);
    lp.bottomMargin = dp(8);
    parent.addView(v, lp);
    return v;
  }

  private EditText field(LinearLayout parent, String label, String value) {
    TextInputLayout layout = new TextInputLayout(this);
    layout.setHint(label);
    layout.setBoxBackgroundMode(TextInputLayout.BOX_BACKGROUND_OUTLINE);
    layout.setBoxCornerRadii(dp(12), dp(12), dp(12), dp(12));
    TextInputEditText edit = new TextInputEditText(layout.getContext());
    edit.setText(value);
    edit.setTextSize(16);
    edit.setSingleLine(true);
    edit.setInputType(
        android.text.InputType.TYPE_CLASS_TEXT
            | android.text.InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS);
    layout.addView(edit);
    LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-1, -2);
    lp.bottomMargin = dp(16);
    parent.addView(layout, lp);
    return edit;
  }

  interface Action {
    void run() throws Exception;
  }

  private void act(Action action) {
    try {
      action.run();
    } catch (Exception e) {
      message(
          e.getMessage() == null
              ? "Could not complete that action. Please try again."
              : e.getMessage());
    }
  }

  private MaterialButton button(LinearLayout parent, String label, Action action, boolean primary) {
    MaterialButton b =
        new MaterialButton(
            this,
            null,
            primary
                ? com.google.android.material.R.attr.materialButtonStyle
                : com.google.android.material.R.attr.materialButtonOutlinedStyle);
    b.setText(label);
    b.setAllCaps(false);
    b.setTextSize(14);
    b.setMinHeight(dp(44));
    b.setCornerRadius(dp(6));
    LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-1, -2);
    lp.bottomMargin = dp(8);
    parent.addView(b, lp);
    b.setOnClickListener(v -> act(action));
    return b;
  }

  private void message(String text) {
    if (pageStatus != null) pageStatus.setText(text);
    else new MaterialAlertDialogBuilder(this).setMessage(text).setPositiveButton("OK", null).show();
  }
}
