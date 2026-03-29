# Diagnosis Dashboard Design Spec

A simple, local web dashboard for non-technical users to troubleshoot the `sms-to-claude` pipeline while the owner is away.

## Goals
- Provide a clear "Green/Red" status for all critical components.
- Allow manual triggering of existing "auto-heal" and diagnostic scripts.
- Provide instructions and links for checking Claude.ai usage limits.
- Host locally on the Mac (host machine) via PM2.

## Architecture

### Backend: `src/diagnosis-server.ts`
- **Runtime:** Bun (`Bun.serve`)
- **Port:** 8082 (to avoid conflict with Webhook Receiver on 8081)
- **Responsibilities:**
  - Serve the single-page HTML dashboard.
  - API endpoint `GET /api/status`: Runs `scripts/diagnose.sh` via SSH to the VM and returns parsed JSON.
  - API endpoint `POST /api/action`: Executes specific local or remote scripts based on user input.
- **Security:** Since it's local-only and for trusted home users, no auth is required, but it will only listen on `localhost` or a specific local IP.

### Frontend: `src/diagnosis-ui.html`
- **Tech:** Vanilla HTML/CSS/JS (no build step).
- **Features:**
  - Auto-polling (every 30s) to update status indicators.
  - Action buttons that show real-time console output in a log area.
  - Links to external resources (Claude usage settings).

## Component Mapping

| Component | Status Check (via `diagnose.sh`) | Troubleshooting Action |
|---|---|---|
| **Claude Service** | `systemctl is-active claude-sms` | `ssh ... sudo systemctl restart claude-sms` |
| **Android Gateway** | `ping` + `GATEWAY_BASE_URL` check | `bun scripts/test-sms.ts` |
| **ngrok Tunnel** | `curl localhost:4040/api/tunnels` | `scripts/test-webhook.sh` |
| **VM Network** | `ping` gateway from VM | `scripts/vm-network-watchdog.sh` |

## Data Flow
1. User opens `http://localhost:8082`.
2. UI fetches `/api/status`.
3. Server runs `ssh yvz@192.168.1.8 '~/sms-to-claude/scripts/diagnose.sh'`.
4. Server parses the text output of `diagnose.sh` into JSON.
5. UI updates indicators based on the JSON.
6. User clicks "Restart Claude".
7. UI POSTs to `/api/action` with `{ "action": "restart-claude" }`.
8. Server executes the SSH command and streams back the output.

## Error Handling
- If the VM is unreachable via SSH, the dashboard should show all VM-based components as "OFFLINE" and provide a "Check Mac/VM status" hint.
- Script failures should be captured and displayed in the UI's log area.
