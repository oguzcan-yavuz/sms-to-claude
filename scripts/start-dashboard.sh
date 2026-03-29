#!/bin/bash
# scripts/start-dashboard.sh
# Starts the diagnosis dashboard using PM2

APP_NAME="claude-diagnosis-dashboard"

# Check if pm2 is available
if ! command -v pm2 &> /dev/null; then
    echo "[FAIL] pm2 is not installed or not in PATH."
    exit 1
fi

echo "Starting Diagnosis Dashboard with PM2..."
pm2 start src/diagnosis-server.ts --name "$APP_NAME" --interpreter bun

echo "------------------------------------------------"
pm2 status "$APP_NAME"
echo "------------------------------------------------"
echo "Dashboard is running at http://localhost:8082"
echo "Use 'pm2 logs $APP_NAME' to see logs."
echo "Use 'pm2 stop $APP_NAME' to stop the dashboard."
