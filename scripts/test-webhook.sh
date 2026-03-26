#!/bin/bash
set -euo pipefail
source "$(dirname "$0")/../.env"

TIMESTAMP=$(date +%s)
BODY="{\"event\":\"sms:received\",\"id\":\"test-1\",\"payload\":{\"messageId\":\"msg-001\",\"message\":\"hello claude\",\"sender\":\"${ALLOWED_PHONE_NUMBERS}\",\"recipient\":\"${ALLOWED_PHONE_NUMBERS}\",\"simNumber\":1,\"receivedAt\":\"2026-03-26T10:00:00Z\"}}"

if [ -n "${WEBHOOK_SIGNING_KEY:-}" ]; then
  SIGNATURE=$(echo -n "${BODY}${TIMESTAMP}" | openssl dgst -sha256 -hmac "${WEBHOOK_SIGNING_KEY}" | awk '{print $2}')
  echo "Signing with HMAC (timestamp=${TIMESTAMP})"
  curl -s -w "\nHTTP %{http_code}\n" \
    -X POST \
    -H "Content-Type: application/json" \
    -H "X-Signature: ${SIGNATURE}" \
    -H "X-Timestamp: ${TIMESTAMP}" \
    -d "${BODY}" \
    "${WEBHOOK_URL}"
else
  echo "No WEBHOOK_SIGNING_KEY set, sending unsigned"
  curl -s -w "\nHTTP %{http_code}\n" \
    -X POST \
    -H "Content-Type: application/json" \
    -d "${BODY}" \
    "${WEBHOOK_URL}"
fi
