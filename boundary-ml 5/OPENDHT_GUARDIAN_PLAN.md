# CareKoala guardian protocol v1

The current user request authorizes user-enabled background capture and automatic guardian
check-in requests in real mode. Manual/demo mode retains explicit sending. No 1–10 score
mapping is defined until the future trained model and handoff.md are provided.

## Transport and privacy

Desktop: native OpenDHT 4.0.0, bootstrap.jami.net:4222. Android: native Android UI and
foreground service using the OpenDHT HTTPS proxy streaming API `/key/:hash/listen`.
A reachable, operator-supplied HTTPS gateway is required; the UDP bootstrap is not a gateway.
No media/calling stack, Jami application, cloud model, screenshot upload or chat upload.

Pairing consists of independent 32-byte encryption and routing secrets, exported once
as CK1.base64url(JSON). Transfer privately and compare the 24-hex-digit SHA-256 fingerprint
on both devices. Windows protects the secrets with Electron safeStorage/DPAPI; Android wraps
them using an Android Keystore AES-GCM key. Rotate/forget pairing on both sides to revoke it.
This is a shared-secret pairing protocol: possession authenticates membership in the pair;
it is not asymmetric proof distinguishing the PC from the guardian itself.

AES-256-GCM, fresh 12-byte nonce, 128-bit tag, AAD `CareKoala guardian check-in v1`.
The authenticated plaintext contains only version, random alert UUID, kind guardian_check_in,
issued_at, expires_at, and contact_guardian=true. The outer envelope holds version, nonce,
and ciphertext (standard base64). The OpenDHT data field contains only this encrypted envelope.
We use native put of an already encrypted envelope, not the old untested putEncrypted call.
There is no plaintext fallback. No model explanation or stable personal identifier is published.

Routing: slot=floor(unix_seconds/300); hash=SHA1(HMAC-SHA256(route_secret,
UTF8("carekoala/route/v1/"+slot))). Android listens to current and previous slots.
Receivers enforce a maximum 300-second lifetime, reject future-issued timestamps beyond
30 seconds, authenticate before processing, and persist seen UUIDs until expiry.
Native publication is non-permanent. Default network values expire after about ten minutes;
application acceptance expires after five. No claim is made that copies on arbitrary peers
can be forcibly deleted. DHT/gateway observers can see ciphertext size and routing metadata.

The desktop waits for the publication callback. “Published” is not “delivered”; no Android
receipt acknowledgement exists yet. A failed publication pauses real mode instead of sending
repeatedly. A positive streak alerts once until a negative decision; restart re-arms detection.

## Verification boundaries

Use synthetic data on loopback for native transport and Python/Java vectors for encryption.
Do not bootstrap public DHT tests or send real alerts until the user supplies a test pairing.
No two-device receipt or Android notification claim is valid until tested on a phone.

Primary API sources:
- https://github.com/savoirfairelinux/opendht/blob/master/python/opendht.pyx
- https://github.com/savoirfairelinux/opendht/blob/master/src/dht_proxy_server.cpp
- https://github.com/savoirfairelinux/opendht/blob/master/src/value.cpp
- https://developer.android.com/develop/background-work/services/fgs/service-types
