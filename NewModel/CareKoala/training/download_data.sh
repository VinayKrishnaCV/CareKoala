#!/usr/bin/env bash
# Downloads every raw dataset used to train the CareKoala danger scorer (~40 MB total).
# Resumable; safe to re-run.
set -euo pipefail
cd "$(dirname "$0")/../data/raw"
HF=https://huggingface.co/datasets
get() { [ -s "$2" ] && return 0; curl -fsSL --retry 20 --retry-delay 5 --retry-all-errors -C - -o "$2.part" "$1" && mv "$2.part" "$2" && echo "ok  $2"; }

# Hate speech / harassment (hatespeechdata.com + Vidgen & Derczynski, PLOS ONE 2020)
get "$HF/ucberkeley-dlab/measuring-hate-speech/resolve/main/measuring-hate-speech.parquet" measuring_hate_speech.parquet &
get "$HF/surrey-nlp/Cyberbullying-Detection-CB1/resolve/main/data/train-00000-of-00001.parquet" cyberbullying_train.parquet &
get "$HF/surrey-nlp/Cyberbullying-Detection-CB1/resolve/main/data/test-00000-of-00001.parquet" cyberbullying_test.parquet &
# Hindi-English code-mixed hate speech (Mendeley snc7mxpj6t, CC BY 4.0)
get "https://data.mendeley.com/public-files/datasets/snc7mxpj6t/files/815ee747-0762-45e0-9a65-f35cc19ab073/file_downloaded" indo_hatespeech.xlsx &
get "https://data.mendeley.com/public-files/datasets/snc7mxpj6t/files/3d990bb8-7d38-4939-b254-e755841b687a/file_downloaded" indo_hatespeech_readme.pdf &
wait
# Suicide / self-harm risk (graded C-SSRS levels + binary SuicideWatch)
get "https://zenodo.org/api/records/2667859/files/500_Reddit_users_posts_labels.csv/content" reddit_cssrs_500users.csv &
get "$HF/av9ash/CSSR-S_labelled_suicidewatch_posts_reddit/resolve/main/labeled_rSuicidewatch_posts.csv" cssrs_suicidewatch_posts.csv &
get "$HF/vibhorag101/suicide_prediction_dataset_phr/resolve/main/data/test-00000-of-00001-a1bf8c09fedae1d2.parquet" suicide_prediction.parquet &
# Emotional distress vs. everyday sadness
get "$HF/dair-ai/emotion/resolve/main/split/train-00000-of-00001.parquet" emotion_train.parquet &
wait
# v2: self-injury posts (Reddit; no licence stated by the uploader) - 206 MB, used by self_injury()
get "$HF/sivasothy-Tharsi/self-harm-detection/resolve/main/data/train-00000-of-00001.parquet" selfharm_detection.parquet
# Benign screen-like text (news, encyclopedic articles)
get "$HF/fancyzhx/ag_news/resolve/main/data/test-00000-of-00001.parquet" ag_news_test.parquet &
get "$HF/Salesforce/wikitext/resolve/main/wikitext-2-raw-v1/test-00000-of-00001.parquet" wikitext2_test.parquet &
get "$HF/Salesforce/wikitext/resolve/main/wikitext-2-raw-v1/validation-00000-of-00001.parquet" wikitext2_val.parquet &
wait
echo "DATA DOWNLOAD COMPLETE"; ls -la
