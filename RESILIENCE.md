# Resilience Setup

Tasks to complete before the 30-day unattended period.

## Status

| Component | Resilient | Notes |
|---|---|---|
| ngrok service | ✅ | systemd auto-restarts |
| Android background activity | ✅ | Enabled in app settings |
| UTM starts on Mac boot | ✅ | Added to Login Items |
| VM auto-starts when UTM launches | ❌ | No built-in option found — needs workaround |
| VM auto-restarts on crash | ❌ | Not configured |
| Claude Code auto-restarts on crash | ❌ | Not configured |
| Mac auto-restarts after power outage | ❌ | Not configured |

---

## Remaining Tasks

### 1. VM auto-start when UTM launches

UTM doesn't have a built-in "start on launch" option for QEMU VMs. Use `utmctl` via a login item script instead:

```bash
# Create ~/start-vm.sh
#!/bin/bash
sleep 10  # wait for UTM to fully launch
/Applications/UTM.app/Contents/MacOS/utmctl start "refutr-development"
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
        <string>while true; do STATUS=$(/Applications/UTM.app/Contents/MacOS/utmctl status "refutr-development" 2>/dev/null); if [ "$STATUS" != "started" ]; then /Applications/UTM.app/Contents/MacOS/utmctl start "refutr-development"; fi; sleep 60; done</string>
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

---

## Testing Checklist

Before leaving for 30 days, simulate failures:

- [ ] Restart the Mac — verify UTM starts, VM boots, Claude comes up automatically
- [ ] Kill the Claude process on the VM — verify it restarts within 10 seconds
- [ ] Stop the ngrok service — verify it restarts automatically
- [ ] Send an SMS after each test — verify end-to-end pipeline still works
