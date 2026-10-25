# Release notes

## 0.4.2 - 2026-10-25

### Guardian unlock completion

The PC now confirms a successful unlock to Android through an authenticated, encrypted completion receipt. Both phone replies and keys typed on the PC use the same release path.

Guardian shows **PC unlocked**, removes the matching request's unlock controls, deletes its stored one-time key and cancels that notification. Completion is saved across app restart. Until the PC confirms, the action reads **Send unlock again**.

Receipts are bound to a request ID. Late receipts cannot clear a newer request or another person's PC. Resolved-request markers prevent out-of-order cached alerts from reopening a completed request. The PC persists pending receipts, retries relay failures within five minutes and drops receipts belonging to a replaced pairing. Confirmation messages never contain an unlock key.

### Overlay input

Replaced native Windows fullscreen transitions with frameless windows sized to each display. Windows appear after rendering is ready, and focus goes to the display under the cursor. Mouse movement, fact-button clicks, key-field clicks and typing work without opening and closing the Start menu.

Escape, F11 and Alt-F4 still do not dismiss the overlay. Windows security controls remain available. Monitoring stays paused after a guardian unlock.

### Pairing, people and restart recovery

New enrollment uses a desktop QR or one typed `CK2-` code. The PC approves the guardian name before final key exchange; invitations expire after ten minutes. Alert encryption and guardian public-key setup are configured together. No gateway address or manual three-key setup is required.

Android supports ten independent people with separate keys, replay state, unlock requests and receiving preferences. Notifications open the matching person. Existing pairing records migrate on update.

Desktop preferences and phone connections persist locally. Enabled receiving recovers after supported app, boot and update events. Enrollment and form drafts survive Android theme recreation through retained state and generation-checked callbacks.

### Interface and local protection

Reworked both interfaces with compact layouts, direct labels and persistent light/dark themes. Removed decorative taglines, generic backend health badges and oversized cards. Theme contrast is checked for text, controls and focus indicators.

The PC keeps separate monitoring, Guardian, Protection and screen-review pages. Guardian uses Material 3 resources and a toolbar theme action. The download site uses the same theme behavior and current setup instructions.

Real mode captures the entire screen and runs OCR and inference sequentially. Each cycle follows completion of the previous one. Unchanged text skips inference, repeated concerns are deduplicated and escalation to 8+ still locks after a notification. Real mode always uses trained inference; mock mode remains explicit.

Personal trigger words can request encrypted check-ins independently of the score. Optional domain protection uses the StevenBlack list through a marked Windows hosts block, preserving custom entries and retaining the last valid list after an update failure. Optional Windows sign-in startup uses the saved monitoring preference.

### Source and setup documentation

Replaced project READMEs with current setup, component roles, feature behavior and limitations. Added an Electron source guide and model cards. Corrected stale alert thresholds and older OpenDHT setup references. Removed the unused OpenDHT dependency from desktop OCR requirements; current notifications use ntfy.sh.

Both desktop and Android source are included. Local credentials, device settings, model binaries and compiled apps are excluded from the source publication. Existing dependency licenses and third-party documentation are retained.

### Validation

- 30 Python backend and worker tests passed.
- 49 desktop tests passed, covering policy, bounded OCR batches, encrypted channel separation, receipts, retries, themes and multi-display focus.
- 15 Android tests and lint passed, including cross-language receipt decryption, persisted completion and request/person isolation.
- Native Windows mouse movement, clicking and keyboard typing were tested on the overlay without the Windows-key workaround.
- A live encrypted test pairing verified request delivery, completion-driven removal of unlock controls and persistence after restarting Guardian. The temporary test person was removed and both existing people were retained.
- The download interface was checked over local HTTP at desktop and narrow widths.

These checks do not establish clinical model accuracy, guaranteed network delivery or behavior under every Android battery policy. Android force-stop and offline periods can interrupt receiving. The hosts sinkhole is not a packet firewall. No alternate guardian-recovery password or offline recovery-code feature has been implemented.

Source publication and installer/APK packaging are separate release steps.
