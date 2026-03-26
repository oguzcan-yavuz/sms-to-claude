#!/bin/bash
source "$(dirname "$0")/../.env"

curl -s -w "\nHTTP %{http_code}\n" \
  -X POST \
  -u "sms:UjSzm5BEY2X3qH73W9Wn" \
  -H "Content-Type: application/json" \
  -d "{\"event\":\"sms:received\",\"id\":\"test-1\",\"payload\":{\"messageId\":\"msg-001\",\"message\":\"hello\",\"sender\":\"${ALLOWED_PHONE_NUMBERS}\",\"recipient\":\"${ALLOWED_PHONE_NUMBERS}\",\"simNumber\":1,\"receivedAt\":\"2026-03-26T10:00:00Z\"}}" \
  "${WEBHOOK_URL}"
