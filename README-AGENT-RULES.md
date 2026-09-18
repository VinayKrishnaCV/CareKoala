# Rules for AI agents working on CareKoala

Read this file before editing anything under C:\CareKoala.

- Never add yourself, an AI service, or a bot as a Git collaborator, author, co-author, or contributor. Never insert AI attribution or Co-authored-by trailers into commits or pull requests. Preserve the human user's Git identity. Do not commit or push unless requested.
- Use fewer tokens through optimization: inspect targeted files, batch independent reads, avoid repeated context/output, keep explanations concise, and run only relevant tests. Do not sacrifice correctness or omit required validation to save tokens.
- Preserve existing user work and the local-first privacy model. Never commit keys, credentials, screenshots, model weights, virtual environments, or build caches.
- Keep OCR and model inference sequential, with heavy process memory released between stages. Background monitoring must have visible status and a Stop control.
- Follow the user's current authorization for automatic capture and guardian notifications. Use verified pairing, encrypted authenticated alerts, expiry and replay protection; never publish raw screen/chat content.
- Verify changes with appropriate tests. Distinguish implemented functionality, mocked tests, and real device verification. Do not claim delivery without evidence.
- Do not migrate to the future fine-tuned model or invent its 1-10 policy. Wait until the user provides the model and directs you to read handoff.md.
