#!/usr/bin/env bash
# Creates the service account n8n uses to reach Drive and Sheets.
#
# Why this exists: the current Drive credential is an OAuth "Testing" app, so
# its refresh token dies every 7 days and daily posting breaks weekly. A
# service account has no consent screen, no test users, and no expiry.
#
# Run once:   bash setup-service-account.sh
# Safe to re-run — every step is idempotent.

set -euo pipefail

PROJECT="n8nn-501607"
SA_NAME="n8n-social"
SA_EMAIL="${SA_NAME}@${PROJECT}.iam.gserviceaccount.com"
KEY_FILE="n8n-social-key.json"

echo "==> Project: $PROJECT"

echo "==> 1/4  Enabling Drive + Sheets APIs"
gcloud services enable drive.googleapis.com sheets.googleapis.com \
  --project="$PROJECT"

echo "==> 2/4  Creating service account (skipped if it exists)"
if gcloud iam service-accounts describe "$SA_EMAIL" --project="$PROJECT" >/dev/null 2>&1; then
  echo "     already exists: $SA_EMAIL"
else
  gcloud iam service-accounts create "$SA_NAME" \
    --project="$PROJECT" \
    --display-name="n8n Social Posting" \
    --description="Drive + Sheets access for the Tengo Sed posting engine"
  echo "     created: $SA_EMAIL"
fi

echo "==> 3/4  Creating a JSON key"
if [ -f "$KEY_FILE" ]; then
  echo "     $KEY_FILE already present — not creating a second key."
  echo "     Delete it first if you want a fresh one."
else
  gcloud iam service-accounts keys create "$KEY_FILE" \
    --iam-account="$SA_EMAIL" \
    --project="$PROJECT"
  echo "     wrote $KEY_FILE"
fi

echo "==> 4/4  Guarding the key from git"
if [ -f .gitignore ] && grep -qxF "$KEY_FILE" .gitignore 2>/dev/null; then
  echo "     .gitignore already covers it"
else
  echo "$KEY_FILE" >> .gitignore
  echo "     added $KEY_FILE to .gitignore"
fi

cat <<EOF

--------------------------------------------------------------------
DONE. The service account is:

  $SA_EMAIL

Next: that account cannot see anything yet. Tell Claude it is ready and
it will share the Drive folder and the queue sheet with that address
(same as sharing with a person). Then you paste $KEY_FILE
into n8n as a "Google Service Account" credential, once, and Drive
never expires again.

Treat $KEY_FILE like a password. It is already gitignored.
--------------------------------------------------------------------
EOF
