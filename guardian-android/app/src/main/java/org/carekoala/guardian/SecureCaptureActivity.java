package org.carekoala.guardian;

public final class SecureCaptureActivity extends com.journeyapps.barcodescanner.CaptureActivity {
  @Override
  public void onCreate(android.os.Bundle state) {
    super.onCreate(state);
    getWindow().addFlags(android.view.WindowManager.LayoutParams.FLAG_SECURE);
  }
}
