# CareKoala Guardian for Android — ntfy edition

Android 8+ receiver using ntfy.sh automatically. No gateway, account, domain, or
manually entered topic is needed. The PC publishes only the existing AES-256-GCM
envelope over HTTPS. The phone verifies and decrypts locally before notifying.

The topic is ck- plus unpadded base64url HMAC-SHA256(route secret,
"carekoala/ntfy/v1"). The route secret is already random and shared in the CK1
pairing code. Both devices derive the same topic; changing pairing changes it.
Keep the pairing code private. The relay sees ciphertext, topic, IP/timing
metadata, and may cache ciphertext. It cannot decrypt or generate a valid new
alert without the AES key. Alert expiry remains five minutes, and accepted IDs
are persisted to reject replay. Existing saved pairing remains compatible;
obsolete gateway settings are ignored.

1. Install APK 0.1.4 and restart the updated desktop app via tray Quit.
2. If already paired on both devices with matching fingerprints, keep the pairing.
   Otherwise desktop: Guardian pairing -> Create new pairing code.
3. Phone: paste the whole CK1 code -> Inspect pairing code.
4. Compare fingerprints. Phone: Fingerprints match — save pairing.
   Desktop: Fingerprints match — verify guardian.
5. Phone: Start receiving. Allow notification permission and tap again if prompted.
6. Wait for the persistent notification: Listening via ntfy.sh for encrypted
   check-in requests.
7. Desktop: Send test warning to Android. Confirm CareKoala test warning appears.
   Android's Test phone notification tests only local notifications.
8. Keep the receiver active for real-mode alerts. Stop receiving stops it.

Transport uses POST https://ntfy.sh/<derived-topic> and a streaming GET to
https://ntfy.sh/<derived-topic>/json?since=5m. Reconnects replay cached messages
within the acceptance window; authenticated expiry and persisted replay checks
still apply. Redirects are disabled. No keys, plaintext alerts, screenshots,
chat, concern labels, or model output are published.

This custom app uses a visible foreground streaming service, not the official
ntfy app's FCM integration. Android battery restrictions, force-stop, offline
periods, relay failures and rate limits can delay or prevent delivery. For the
demo keep the receiver notification active; allow background use in phone
settings if the OS restricts it. After reboot/force-stop open the app and tap
Start receiving again. There is no phone receipt acknowledgement.

Verified: 23 Python tests, 11 Electron tests, 6 Android JVM tests, signed APK build,
desktop button integration with stubbed transport, and a live ntfy.sh encrypted
publish/retrieve/decrypt test with disposable secrets. Real phone display remains
to be tested by the user.

Build: JDK 17+, SDK 35, Gradle 8.13:
gradle :app:assembleDebug :app:testDebugUnitTest

API references: https://docs.ntfy.sh/publish/ and
https://docs.ntfy.sh/subscribe/api/
