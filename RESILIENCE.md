# Resilience Setup

Tasks to complete before the 30-day unattended period.

## Status

| Component | Resilient | Notes |
|---|---|---|
| ngrok service | ✅ | systemd auto-restarts |
| Android background activity | ✅ | Background activity + autostart enabled in app settings |
| UTM starts on Mac boot | ✅ | Added to Login Items |
| VM auto-starts when UTM launches | ✅ | ~/start-vm.sh added to Login Items |
| VM auto-restarts on crash | ✅ | launchd watchdog checks every 60s |
| Claude Code auto-restarts on crash | ✅ | systemd service + tmux session (attach: bun run attach) |
| Mac auto-restarts after power outage | ✅ | MacBook battery handles this automatically |
| Android static IP | ✅ | DHCP reservation set in router |
| Android daily reboot | N/A | Skipped — phone managed manually |
| Claude Code headless auth | ✅ | Auth token persisted in ~/.claude/.credentials.json, expires ~1 year from setup |

---

## Remaining Tasks

### 1. VM auto-start when UTM launches

UTM doesn't have a built-in "start on launch" option for QEMU VMs. Use `utmctl` via a login item script instead:

```bash
# Create ~/start-vm.sh
#!/bin/bash
sleep 10  # wait for UTM to fully launch
/Applications/UTM.app/Contents/MacOS/utmctl start "Refutr Development VM"
```

Add `start-vm.sh` to Login Items (System Settings → General → Login Items) after UTM.

### 2. VM auto-restart on crash

Use `utmctl` in a launchd plist on the Mac to monitor and restart the VM if it stops:

```xml
<!-- ~/Library/LaunchAgents/com.refutr.vm-watchdog.plist -->
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.refutr.vm-watchdog</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>-c</string>
        <string>while true; do STATUS=$(/Applications/UTM.app/Contents/MacOS/utmctl status "Refutr Development VM" 2>/dev/null); if [ "$STATUS" != "started" ]; then /Applications/UTM.app/Contents/MacOS/utmctl start "Refutr Development VM"; fi; sleep 60; done</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
</dict>
</plist>
```

Load it with:
```bash
launchctl load ~/Library/LaunchAgents/com.refutr.vm-watchdog.plist
```

### 3. Claude Code auto-restart on crash

Inside the VM, create a systemd service that keeps Claude Code running:

```ini
# /etc/systemd/system/claude-sms.service
[Unit]
Description=Claude Code SMS channel
After=network.target

[Service]
Type=simple
User=yvz
WorkingDirectory=/home/yvz/refutr
ExecStart=/bin/bash -c 'claude --dangerously-load-development-channels server:sms --allowedTools "Read,Write,Edit,Glob,Grep,MultiEdit,mcp__sms__sms_reply"'
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Enable with:
```bash
sudo systemctl enable claude-sms
sudo systemctl start claude-sms
```

### 4. Mac auto-restart after power outage

System Settings → Energy → Enable "Start up automatically after a power failure".

### 5. Android static IP

In your router's DHCP settings, reserve a static local IP for the Android device using its MAC address. This ensures the webhook URL registered in SMSGate always resolves correctly after reboots or DHCP lease renewals.

### 6. Android daily reboot

Install MacroDroid (or similar) on the Android device and create a trigger:

- **Trigger:** Time of day — 04:00 AM, every day
- **Action 1:** Force-stop SMSGate
- **Action 2:** Reboot device

This clears stale network state that can cause SMSGate's HTTP server to stop accepting connections without crashing.

### 7. Claude Code headless auth

Verify that Claude Code starts without requiring a browser-based login. On the VM:

```bash
# Test that claude starts without interactive auth
claude --dangerously-load-development-channels server:sms --allowedTools "Read" &
sleep 5
kill %1
```

If it prompts for browser auth, run `claude` interactively once to complete auth, then confirm the session token is persisted in `~/.claude/` so automated restarts work unattended.

---

## Testing Checklist

Before leaving for 30 days, simulate failures:

- [x] Restart the Mac — verify UTM starts, VM boots, Claude comes up automatically
- [x] Kill the Claude process on the VM — verify it restarts within 10 seconds
- [x] Stop the ngrok service — verify it restarts automatically
- [x] Reboot the Android device — verify SMSGate comes back and the webhook is reachable
- [x] Simulate DHCP lease renewal — verify the Android's IP stays fixed at the reserved address
- [x] Send an SMS after each test — verify end-to-end pipeline still works
