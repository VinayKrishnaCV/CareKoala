# CareKoala Guardian for Android

Guardian receives encrypted alerts, stores guardian keys in Android Keystore and lets a guardian unlock a paired PC after phone authentication. It does not capture the phone's screen or run EasyOCR or the classification model.

Version **0.4.2**, version code **12**. The app supports Android 8.0 and newer, with compile/target SDK 35. Java source, resources and tests are public here. APKs, signing keys and personal device state are excluded.

## Download 0.4.2

[Download the signed Android APK](https://github.com/VinayKrishnaCV/CareKoala/releases/download/v0.4.2/CareKoala-Guardian-0.4.2.apk). Verify it against [SHA256SUMS.txt](https://github.com/VinayKrishnaCV/CareKoala/releases/download/v0.4.2/SHA256SUMS.txt). Updates require the same CareKoala signing identity as the installed app.

## Add a person

1. On the PC, open **Guardian**, name the person or PC and create a pairing QR/code.
2. On Android, choose **Add person** and enter the guardian name.
3. Scan the QR or type the single `CK2-` code beneath it. Camera use is optional; the same code works for private remote setup.
4. Check the guardian name on the PC and select **Approve guardian** within ten minutes.
5. Allow notifications and wait for receiving to start.
6. Send a test notification from the PC, then test its lockdown overlay.

The flow exchanges alert encryption and guardian public-key setup together. New connections need no separate public-key copying, fingerprint entry, gateway address or manual ntfy topic. Existing connection records migrate when the app is updated.

## People and receiving

Guardian supports ten people. Each profile has independent alert keys, RSA identity, replay tracking, pending unlock and receiving preference. Notifications open the matching person. Renaming or removing one person does not change the others.

**People** lists paired PCs and requests. Open a person to respond, pause their alerts, rename them or inspect public connection fingerprints. The global pause control pauses all receiving.

Pairings and enabled preferences are stored locally. Enabled receiving resumes on app launch and supported boot/update events. The custom app uses a visible foreground streaming service, not the official ntfy app's push integration. Android force-stop prevents normal recovery until Guardian opens again. Battery restrictions, offline periods and relay failures can delay delivery.

## Respond to lockdown

The PC's real-mode policy sends a check-in at scores 6-7 and opens its overlay at 8-10. Personal trigger words can also request a check-in. Notifications do not include screen text, scores or categories.

1. Open the person's request and check in with them.
2. Tap **Unlock [person]'s PC** and authenticate with the phone's screen-lock credential.
3. Guardian sends the current one-time key over an authenticated, encrypted reply channel.
4. Wait for **PC unlocked**. The PC sends a completion receipt after saving its released state.

After confirmation, the unlock controls disappear, the stored one-time key is removed and that event's notification is cancelled. Completion survives restarting Guardian. An old receipt cannot clear a newer request or another person's PC.

If a key was sent but the PC has not confirmed it, the action reads **Send unlock again**. A successful relay POST does not establish an unlock. **Read key instead** is available after authentication when a remote reply cannot reach the PC. Typed unlocks return the same encrypted completion receipt.

The 0.4.2 PC overlay permits mouse movement, clicking and typing without a Windows-key workaround. Monitoring remains paused after unlock until the PC user restarts it.

## Appearance and state

Material 3 layouts use compact controls and light/dark resources. The toolbar's sun/moon action saves the theme. Changing theme preserves the selected page, form draft and pending enrollment. Enrollment retains application context rather than an activity.

Key-bearing views restrict screenshots and backup. Unlock authorization remains tied to the selected person and request; a changed request must be reviewed again.

## Encryption and relay

Android creates a 3072-bit RSA key in Keystore. The private key is non-exportable and never goes to the PC. The PC generates a one-time key and timestamp, encrypts the bundle to the phone's public key and sends it inside an AES-256-GCM envelope. Guardian verifies authentication, time bounds and replay state before accepting it.

Alerts and completion receipts use the guardian topic. Unlock replies use a separately derived topic and authenticated-data label. Topics are derived with HMAC from random pairing material. ntfy.sh sees ciphertext and routing/network metadata, not screen content, plaintext keys or model output.

Pairing and request data are encrypted locally with a Keystore-protected wrapping key. Resolved-request markers stop cached alerts reopening a completed request. The PC retains pending confirmations and retries within five minutes; Android/network restrictions still apply.

## Open and test the source

Open this directory in Android Studio and install Android SDK 35. Verification used JDK 21 and Gradle 8.13; Java source compatibility is 17. Configure `ANDROID_HOME` or an untracked `local.properties` file. This checkout has no Gradle wrapper; use the configured Gradle installation.

```powershell
gradle :app:testDebugUnitTest :app:lintDebug
```

Version 0.4.2 passed 15 unit tests and lint. Live checks covered encrypted enrollment, receipt-driven removal of unlock controls, persistence after restart and isolation from other people. The temporary test person was removed afterward.

For a later release build, signing comes from `CAREKOALA_SIGNING_PROPERTIES` or `~/.carekoala/signing/keystore.properties`. Keep the keystore and passwords outside the repository. Updates must use the same signing identity to preserve an existing installation; a differently signed debug APK cannot replace a signed release APK.

See the [project overview](../README.md), [PC interface](<../boundary-ml 5/electron-app/README.md>) and [release notes](../CHANGELOG.md).
