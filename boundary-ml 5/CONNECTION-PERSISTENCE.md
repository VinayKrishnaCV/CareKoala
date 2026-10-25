# Connection and request recovery

## Windows

Pairing material is encrypted with Windows-protected storage. Starting real mode saves its enabled state. A normal restart resumes configured monitoring with the same verified pairing; explicit pause or forgetting the pairing disables resumption. Mock launch does not resume monitoring. Screen lock or sleep suspends capture, and an enabled session resumes after wake/unlock. Windows sign-in startup is opt-in.

An active lockdown retains its verifier and encrypted event across restart. Reopening CareKoala restores the overlay. A successful unlock saves the released state before closing the windows and leaves monitoring paused.

Version 0.4.2 also saves pending encrypted completion receipts. Relay failures retry within five minutes. Receipts for a replaced pairing are discarded, rather than sent to another guardian.

## Android

Guardian stores up to ten people's keys, history and request state independently in Keystore-protected local storage. Enabled preferences are saved separately. App launch, supported boot and app-update events restore an enabled receiver; the foreground service also requests recovery after ordinary process termination.

Pausing all receiving or an individual person remains in effect until re-enabled. Android force-stop, revoked notification permission, battery restrictions, network loss and relay availability can prevent background delivery. Opening Guardian resumes an enabled receiver, but cannot recover an alert beyond its authenticated delivery window.

An authenticated completion receipt resolves only its matching request, removes the saved one-time key and cancels its notification. Completion survives restart. Tombstones prevent cached alerts reopening that request; older receipts do not clear a newer request.

Theme changes retain navigation, form drafts, authorization context and pending enrollment through a state holder using application context. Cancelled and completed enrollment sessions reject late status callbacks.

## Validation

The desktop lifecycle tests cover persistence, explicit pause, receipt retries and replacement-pairing isolation. Android tests cover request/person isolation and receipt authentication. A live temporary pairing verified encrypted completion, removal of unlock controls and continued completion after restarting Guardian. The temporary profile was removed afterward. Phone reboot recovery was not exercised in that check.

See [PC setup](README.md), [Android](../guardian-android/README.md) and [release notes](../CHANGELOG.md).
