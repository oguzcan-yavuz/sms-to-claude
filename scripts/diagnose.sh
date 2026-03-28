#!/bin/bash

# Diagnosis script for sms-to-claude
# Run this and read the output back to Oguzcan

OK="[OK]"
FAIL="[FAIL]"
WARN="[WARN]"

echo "==============================="
echo "  SMS-to-Claude Diagnostics"
echo "==============================="
echo ""

# 1. Claude service
echo -n "1. Claude service ... "
if systemctl is-active --quiet claude-sms; then
  echo "$OK running"
else
  STATUS=$(systemctl show claude-sms --property=ActiveState --value)
  echo "$FAIL not running (state: $STATUS)"
fi

# 2. ngrok service
echo -n "2. ngrok service ... "
if systemctl is-active --quiet ngrok; then
  echo "$OK running"
else
  echo "$FAIL not running"
fi

# 3. tmux session
echo -n "3. tmux session ... "
if [ -S /tmp/claude-sms-tmux ]; then
  SESSION=$(tmux -S /tmp/claude-sms-tmux ls 2>/dev/null)
  if [ -n "$SESSION" ]; then
    echo "$OK active"
  else
    echo "$WARN socket exists but no session"
  fi
else
  echo "$WARN no tmux socket (running via systemd only)"
fi

# 4. Claude auth
echo -n "4. Claude auth ... "
CREDS=~/.claude/.credentials.json
if [ -f "$CREDS" ]; then
  echo "$OK credentials file exists"
else
  echo "$FAIL credentials file missing — Claude needs to log in"
fi

# 5. Android gateway reachable
echo -n "5. Android gateway ... "
GATEWAY_IP=$(grep GATEWAY_BASE_URL ~/sms-to-claude/.env 2>/dev/null | cut -d= -f2 | sed 's|http://||' | cut -d: -f1)
if [ -n "$GATEWAY_IP" ]; then
  if ping -c 1 -W 2 "$GATEWAY_IP" &>/dev/null; then
    echo "$OK reachable at $GATEWAY_IP"
  else
    echo "$FAIL cannot reach $GATEWAY_IP (phone off or wrong network?)"
  fi
else
  echo "$WARN could not read gateway IP from .env"
fi

# 6. ngrok tunnel URL
echo -n "6. ngrok tunnel ... "
NGROK_URL=$(curl -s http://localhost:4040/api/tunnels 2>/dev/null | grep -o '"public_url":"[^"]*"' | head -1 | cut -d'"' -f4)
if [ -n "$NGROK_URL" ]; then
  echo "$OK $NGROK_URL"
else
  echo "$FAIL ngrok tunnel not found"
fi

echo ""
echo "==============================="
echo "Done. Read everything above."
echo "==============================="
