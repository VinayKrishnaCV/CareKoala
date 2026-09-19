# Connection recovery

Desktop pairing secrets remain encrypted locally. Starting real mode saves its
enabled state; Quit preserves it. On the next normal app launch it reconnects
using the same pairing and resumes monitoring in the tray. Explicit Pause or
Forget pairing clears the enabled state. Mock launch does not resume monitoring.
Screen lock/sleep temporarily suspends capture; unlock/wake resumes enabled mode.
Windows sign-in launch remains opt-in through the existing startup checkbox.

Android 0.1.5 saves receiver enablement separately from Keystore-protected pairing.
App launch, BOOT_COMPLETED and app update restart an enabled listener. START_STICKY
requests recovery after ordinary OS process termination. Pausing from the app or
notification disables recovery; forgetting pairing does too. The receiver retries
network failures and rejects duplicate/expired cached alerts after reconnecting.

Android Force stop, revoked notification permission, device battery restrictions,
offline periods and relay availability can prevent automatic delivery. Reopening
a force-stopped app resumes an enabled receiver. Alerts expire after five minutes;
restart recovery cannot recover alerts whose authenticated lifetime has expired.

Validation: desktop was launched as three distinct Electron processes using an
isolated profile. Pairing survived; active monitoring resumed after restart; an
explicit pause remained off after the next restart. Capture/publication were
stubbed in this lifecycle test. On the connected Android phone, installation
preserved pairing, Pause survived a process restart, and an enabled receiver
reconnected to ntfy.sh after reopening without a Start tap. The local notification
test passed. The connection dashboard was inspected through the device's UI
hierarchy. Actual phone reboot recovery was not exercised. Six Android protocol
tests passed and lint reported no errors (seven non-blocking warnings).
