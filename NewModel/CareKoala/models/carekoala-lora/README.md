---
base_model: meta-llama/Llama-3.2-1B-Instruct
library_name: peft
pipeline_tag: text-generation
tags:
- lora
- carekoala
---

# carekoala-lora

Original comparison adapter; not the desktop default. The adapter maps screen text to a JSON score from 0 to 10 and a supported category. It supports a local guardian check-in workflow, not diagnosis or emergency response.

The saved configuration uses LoRA rank 16, alpha 32 and dropout 0.05 on attention and MLP projections in layers 6-15. Deployment loads the separate GGUF adapter alongside Llama-3.2-1B-Instruct Q4_K_M. Merging and requantizing it is not the tested runtime configuration.

## CareKoala 0.4.2 integration

The PC runs OCR and inference sequentially. Scores 6-7 request an encrypted check-in; 8-10 open the guardian unlock overlay. Personal trigger words can also request a check-in. Pairing uses a QR or one typed code, and Android keeps up to ten people independent.

Successful unlocks return an authenticated PC confirmation. Guardian removes completed unlock controls and saves completion across restart. The PC overlay permits mouse and keyboard input without a Start-menu workaround. Both apps have persistent light/dark themes.

The model does not implement transport, receiving or unlocking. Those controls live in the PC and Android source. Keep the shared prompt contract and training labels compatible. Model binaries and checkpoints are excluded from this source publication.

Built with Llama. The base and derivative distribution use the Llama 3.2 Community License. See the [model guide](../../README.md) for assets, training and limitations, and the [release notes](../../../../CHANGELOG.md) for application changes.
