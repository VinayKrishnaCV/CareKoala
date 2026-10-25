package org.carekoala.guardian;

import android.app.Application;
import androidx.annotation.NonNull;
import androidx.lifecycle.AndroidViewModel;
import androidx.lifecycle.LiveData;
import androidx.lifecycle.MutableLiveData;

public final class GuardianState extends AndroidViewModel {
  public int page = 1;
  public String detail = "";
  public String authProfile = "";
  public String authEvent = "";
  public String draftCode = "";
  public String draftGuardian = "";
  public boolean initialized;

  public static final class EnrollmentUpdate {
    public final String message;
    public final String profileId;
    final int session;

    EnrollmentUpdate(String message, String profileId, int session) {
      this.message = message;
      this.profileId = profileId;
      this.session = session;
    }
  }

  private final MutableLiveData<EnrollmentUpdate> updates = new MutableLiveData<>();
  private final Object lock = new Object();
  private volatile EnrollmentClient enrollment;
  private volatile int generation;

  public GuardianState(@NonNull Application application) {
    super(application);
  }

  public LiveData<EnrollmentUpdate> updates() {
    return updates;
  }

  public boolean isPairing() {
    return enrollment != null;
  }

  public boolean isCurrent(EnrollmentUpdate update) {
    return update.session == generation;
  }

  public void beginEnrollment(String code, String guardian) throws Exception {
    cancelEnrollment();
    final int session = generation;
    enrollment =
        new EnrollmentClient(
            getApplication(),
            code,
            guardian,
            new EnrollmentClient.Listener() {
              @Override
              public void state(String message) {
                synchronized (lock) {
                  if (generation != session || enrollment == null) return;
                  updates.postValue(new EnrollmentUpdate(message, "", session));
                }
              }

              @Override
              public void complete(String profileId) {
                synchronized (lock) {
                  if (generation != session) return;
                  enrollment = null;
                }
                updates.postValue(new EnrollmentUpdate("Pairing saved", profileId, session));
              }
            });
    enrollment.start();
  }

  public void consumeUpdate() {
    updates.setValue(null);
  }

  public void cancelEnrollment() {
    EnrollmentClient previous;
    synchronized (lock) {
      generation++;
      previous = enrollment;
      enrollment = null;
    }
    if (previous != null) previous.stop();
    updates.setValue(null);
  }

  @Override
  protected void onCleared() {
    EnrollmentClient previous;
    synchronized (lock) {
      generation++;
      previous = enrollment;
      enrollment = null;
    }
    if (previous != null) previous.stop();
  }
}
