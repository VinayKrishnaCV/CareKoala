# Guardian unlock protocol

## Setup and policy

New connections use the PC's QR or single `CK2-` invitation code. Android scans or types it, and the PC approves the displayed guardian name. The ten-minute enrollment configures final alert encryption and guardian public-key setup together. The older CK1/CKR1 import controls remain for compatibility.

Android generates a 3072-bit RSA identity in Keystore. Its private key is non-exportable and never reaches the PC. Enrollment delivers independently generated final alert keys RSA-encrypted to the phone. Keep every person's identity and state separate.

Real mode sends a check-in at scores 6-7 and opens the overlay at 8-10. The demo button tests the same unlock flow without classifying a concern. Manual analysis keeps its explicit send controls.

## PC to guardian lockdown event

The PC generates a random 192-bit key encoded as 32 base64url characters, a UUID, issue timestamp, five-minute delivery expiry and demo flag. It encrypts the bundle with the guardian public key using RSA-OAEP, SHA-256 and MGF1-SHA1 for Android Keystore compatibility.

RSA ciphertext and matching metadata travel inside the paired AES-256-GCM envelope. The PC POSTs only ciphertext to its HMAC-derived ntfy topic. It saves the key's SHA-256 verifier and encrypted event, not the plaintext key.

Android authenticates the envelope, checks freshness, decrypts RSA locally, verifies inner/outer metadata and persists IDs against replay. The latest event is encrypted in app-private storage with a Keystore AES key. Notifications and logs do not expose the key. Sending or reading the key requires the phone's device credential.

## Guardian to PC unlock

After authentication, Android sends this encrypted payload:

```text
{v:1, kind:"unlock", id, key, issued_at, expires_at}
```

It uses the current event's ID, one-time key and a five-minute lifetime. AES-GCM uses a fresh 12-byte nonce and AAD `CareKoala guardian unlock v1`. The reply topic is `ck-` plus unpadded base64url HMAC-SHA256 of the route secret and label `carekoala/ntfy/unlock/v1`.

The PC listens on that separate topic only while locked, using `/json?since=5m` with reconnect backoff. It requires authentication, the current UUID, valid time bounds and a key matching the stored verifier. A typed key uses the same verifier and release path.

The separate topic and AAD prevent an alert being reflected back as an unlock. Android does not create a replacement key or upload its RSA private key.

## PC completion receipt

After a successful unlock, the PC saves its released state and a pending receipt, then closes the overlay. The receipt uses the normal authenticated alert channel and contains:

```text
{v:1, kind:"lockdown_resolved", id, issued_at, expires_at, contact_guardian:false}
```

It never includes an unlock key. Guardian verifies authentication and freshness, resolves only the matching request, removes its stored key and unlock controls and cancels that notification. Resolved IDs stop out-of-order cached alerts reopening a completed request. Old receipts cannot clear a new request or another person's state.

Completion persists across phone restart. Until a receipt arrives, Guardian offers **Send unlock again** and reports that delivery is unconfirmed. The PC persists pending receipts and retries relay failures within five minutes. A replaced pairing cannot receive the old pairing's confirmation.

## Overlay, recovery and limits

The pending verifier and event survive a PC app restart. **Send key again** retries a fresh event; after delivery expiry it replaces the event and key. A received key remains valid locally until used or replaced. Monitoring remains paused after unlock.

Overlay windows cover each display with frameless bounds. They appear after rendering is ready and focus the display under the cursor, avoiding native-fullscreen mouse/focus conflicts. Mouse movement, clicking and typing work without a Windows-key workaround.

The overlay rejects its own Escape, F11 and Alt-F4 actions but is not Windows kiosk security. Windows security controls, administrative tools and forced process termination remain available. No alternate recovery password or offline recovery-code system has been implemented.

Remote delivery depends on connectivity, relay availability and Android background behavior. The relay observes routing and network metadata. A compromised PC can access material it generated and its own pairing credentials; keeping the guardian private key off that PC does not make the entire endpoint tamper-proof.

See the [Android guide](../../guardian-android/README.md) and [release notes](../../CHANGELOG.md).
