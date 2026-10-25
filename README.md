# CareKoala

CareKoala checks screen text on a Windows PC and sends encrypted check-in requests to a guardian's Android phone. EasyOCR and the classification model run on the PC. Android receives alerts and holds the guardian's private key.

Current application version: **0.4.2**. The Windows and Android source are both public in this repository. Model weights, signing keys, personal settings and compiled applications are excluded.

## Download 0.4.2

- [Windows x64 installer](https://github.com/VinayKrishnaCV/CareKoala/releases/download/v0.4.2/CareKoala-Setup-0.4.2-x64.exe)
- [Android Guardian APK](https://github.com/VinayKrishnaCV/CareKoala/releases/download/v0.4.2/CareKoala-Guardian-0.4.2.apk)
- [Release notes and SHA-256 checksums](https://github.com/VinayKrishnaCV/CareKoala/releases/tag/v0.4.2)

## Monitoring

Real mode captures the entire screen and processes one stage at a time: capture, OCR, OCR exit, local inference, model release, then policy. The next cycle starts when processing finishes. Unchanged text skips repeated inference, and a continuing concern does not repeatedly notify the guardian.

| Score | Real-mode action |
| --- | --- |
| 0-5 | Continue without an automatic alert |
| 6-7 | Send an encrypted guardian check-in |
| 8-10 | Pause monitoring, cover each display with an unlock screen and send an encrypted one-time key to the guardian |

Personal trigger words can request a check-in independently of the score. An escalation to 8 or higher still opens the overlay after an earlier notification. Manual review is separate: capture or load an image, correct OCR text and analyze it. Sending a guardian message from manual review requires a click. Mock mode is an explicit development option.

Scores describe visible text, not a person's diagnosis or safety. OCR errors, quotations and missing context can change the result. CareKoala is not an emergency service.

## Pair a guardian

1. On the PC, open **Guardian**, name the person or PC and create a pairing QR and code.
2. On Android, choose **Add person**. Scan the QR or type the single `CK2-` code displayed below it. The code can also be shared privately with a remote guardian.
3. Check the guardian name on the PC and choose **Approve guardian**. Invitations expire after ten minutes.
4. Allow Android notifications and keep receiving enabled.
5. Send a test notification, then test the lockdown overlay before using real mode.

Pairing configures alert encryption and guardian unlock together. There is no gateway field, relay account or manually entered topic. Guardian supports ten people with separate keys, histories, requests and receiving preferences.

After checking in, the guardian authenticates on the phone and sends the current unlock key, or reads it for the PC user to type. The PC confirms a successful unlock through an encrypted receipt. Guardian then shows **PC unlocked**, removes that request's controls and saves completion across restart. Sending a key alone is not proof of an unlock.

## PC controls

- **Overview:** start or pause real mode and review the score policy.
- **Guardian:** pair a phone, check the connection, send a test notification or test the overlay.
- **Protection:** edit trigger words, manage domain blocking and choose Windows sign-in startup.
- **Check screen text:** capture, correct OCR and analyze manually.

Closing the window leaves the app in the system tray. Pairing and monitoring preferences persist locally. Optional sign-in startup resumes configured real mode. A guardian unlock leaves monitoring paused until the PC user restarts it.

Both apps offer persistent light/dark themes with compact controls. Android retains enrollment and form drafts during theme changes. The PC overlay accepts mouse movement, button clicks and typing without opening the Start menu.

Domain protection is an optional Windows hosts sinkhole using the StevenBlack list. It preserves custom hosts entries and installs a daily updater through an elevated helper. It blocks listed names, not direct IP traffic or every new scam.

## Source and setup

| Directory | Guide |
| --- | --- |
| `boundary-ml 5/` | [PC setup, Python API and workers](<boundary-ml 5/README.md>) |
| `boundary-ml 5/electron-app/` | [Electron interface, tray, pairing and overlay](<boundary-ml 5/electron-app/README.md>) |
| `guardian-android/` | [Android interface, keys and receiver](guardian-android/README.md) |
| `NewModel/CareKoala/` | [Model runtime and training source](NewModel/CareKoala/README.md) |
| `website/` | [Static download page and release metadata](website/README.md) |

Real inference requires the Q4_K_M Llama base, the trained CareKoala v2 adapter and llama.cpp b11036. The downloader retrieves the base, OCR weights and runtime; the trained adapter must be supplied separately. Missing assets produce an error rather than an untrained or fabricated safe result.

## Privacy and security

Screenshots, OCR text, scores and trigger words stay on the PC. `ntfy.sh` carries AES-256-GCM authenticated ciphertext. The relay can observe routing, timing and network metadata; remote alerts and unlocks require internet access.

Android generates its RSA private key in Keystore and never sends it to the PC. The PC generates the one-time unlock key and encrypts its timestamped bundle with the guardian's public key. Unlock replies use a separate authenticated channel. Completion receipts are bound to request IDs, so an old receipt cannot clear a newer request or another person's PC.

The overlay is application-level protection, not an OS kiosk. Windows security controls remain available. No alternate recovery password or offline recovery-code feature has been implemented.

## Validation and releases

Version 0.4.2 passed 49 desktop tests, 15 Android tests and Android lint. Device checks covered overlay mouse/keyboard input, encrypted unlock confirmation, phone restart and isolation between people. These checks do not establish model accuracy or guaranteed delivery under every Android battery policy.

See [CHANGELOG.md](CHANGELOG.md) for this version's changes. Packaging an installer or APK is a separate release step. Third-party terms remain applicable; the model integration is Built with Llama.
