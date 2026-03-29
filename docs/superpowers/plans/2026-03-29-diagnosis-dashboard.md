# Diagnosis Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local web-based diagnosis dashboard for troubleshooting the sms-to-claude pipeline.

**Architecture:** Single-file Bun server serving a single-file HTML/JS UI. Backend executes shell scripts and SSH commands to gather status and perform actions.

**Tech Stack:** Bun, TypeScript, Vanilla HTML/CSS/JS.

---

### Task 1: Create Frontend (diagnosis-ui.html)

**Files:**
- Create: `src/diagnosis-ui.html`

- [ ] **Step 1: Write the HTML/CSS/JS**

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Claude SMS Diagnosis</title>
    <style>
        body { font-family: -apple-system, system-ui, sans-serif; line-height: 1.5; max-width: 800px; margin: 0 auto; padding: 20px; background: #f4f4f7; color: #333; }
        .card { background: white; border-radius: 8px; padding: 20px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.05); }
        .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
        .status-dot { display: inline-block; width: 12px; height: 12px; border-radius: 50%; margin-right: 8px; }
        .status-ok { background: #28a745; }
        .status-fail { background: #dc3545; }
        .status-warn { background: #ffc107; }
        .status-unknown { background: #6c757d; }
        .actions { display: flex; gap: 10px; margin-top: 10px; }
        button { padding: 8px 16px; border-radius: 4px; border: 1px solid #ddd; background: #fff; cursor: pointer; font-size: 14px; }
        button:hover { background: #f0f0f0; }
        button:active { background: #e0e0e0; }
        pre { background: #222; color: #eee; padding: 15px; border-radius: 4px; overflow-x: auto; font-size: 13px; max-height: 300px; }
        .usage-link { display: inline-block; background: #007AFF; color: white; text-decoration: none; padding: 10px 20px; border-radius: 6px; font-weight: 600; margin-top: 10px; }
        .loading { opacity: 0.5; pointer-events: none; }
    </style>
</head>
<body>
    <div class="header">
        <h1>SMS-to-Claude Status</h1>
        <button onclick="refreshStatus()">Refresh Now</button>
    </div>

    <div id="status-container">
        <!-- Status cards will be injected here -->
    </div>

    <div class="card">
        <h3>Claude Usage</h3>
        <p>If Claude isn't responding, check if we've hit the daily message limit on your account.</p>
        <a href="https://claude.ai/settings/usage" target="_blank" class="usage-link">Check Claude.ai Usage</a>
    </div>

    <div id="log-card" class="card" style="display: none;">
        <h3 id="log-title">Action Log</h3>
        <pre id="log-content"></pre>
    </div>

    <script>
        async function refreshStatus() {
            const container = document.getElementById('status-container');
            container.classList.add('loading');
            try {
                const res = await fetch('/api/status');
                const data = await res.json();
                renderStatus(data);
            } catch (err) {
                console.error('Failed to fetch status:', err);
            } finally {
                container.classList.remove('loading');
            }
        }

        function renderStatus(data) {
            const container = document.getElementById('status-container');
            container.innerHTML = data.components.map(c => `
                <div class="card">
                    <div style="display: flex; justify-content: space-between;">
                        <strong>${c.name}</strong>
                        <span><span class="status-dot ${getStatusClass(c.status)}"></span>${c.label}</span>
                    </div>
                    <p style="font-size: 0.9em; color: #666; margin: 5px 0;">${c.description}</p>
                    <div class="actions">
                        ${c.actions.map(a => `<button onclick="runAction('${a.id}', '${a.name}')">${a.name}</button>`).join('')}
                    </div>
                </div>
            `).join('');
        }

        function getStatusClass(status) {
            if (status === 'OK') return 'status-ok';
            if (status === 'FAIL') return 'status-fail';
            if (status === 'WARN') return 'status-warn';
            return 'status-unknown';
        }

        async function runAction(id, name) {
            const logCard = document.getElementById('log-card');
            const logTitle = document.getElementById('log-title');
            const logContent = document.getElementById('log-content');
            
            logCard.style.display = 'block';
            logTitle.innerText = 'Running: ' + name;
            logContent.innerText = 'Starting...';
            
            try {
                const res = await fetch('/api/action', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: id })
                });
                const data = await res.json();
                logContent.innerText = data.output || 'No output';
                refreshStatus();
            } catch (err) {
                logContent.innerText = 'Error: ' + err.message;
            }
        }

        // Initial load
        refreshStatus();
        // Poll every 30s
        setInterval(refreshStatus, 30000);
    </script>
</body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git add src/diagnosis-ui.html
git commit -m "feat: add diagnosis dashboard frontend"
```

---

### Task 2: Create Backend (diagnosis-server.ts)

**Files:**
- Create: `src/diagnosis-server.ts`

- [ ] **Step 1: Write the server code**

```typescript
import { spawn } from 'child_process'
import { join } from 'path'
import { readFileSync } from 'fs'

const PORT = 8082
const UI_PATH = join(import.meta.dirname, 'diagnosis-ui.html')
const VM_SSH = "ssh yvz@192.168.1.8"

async function runCommand(cmd: string): Promise<string> {
  return new Promise((resolve) => {
    const proc = spawn('bash', ['-c', cmd])
    let output = ''
    proc.stdout.on('data', (data) => output += data.toString())
    proc.stderr.on('data', (data) => output += data.toString())
    proc.on('close', () => resolve(output.trim()))
  })
}

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url)

    // Serve UI
    if (url.pathname === '/') {
      return new Response(readFileSync(UI_PATH), {
        headers: { 'Content-Type': 'text/html' }
      })
    }

    // API: Status
    if (url.pathname === '/api/status') {
      const diagOutput = await runCommand(`npm run diagnose --silent`)
      
      // Parse diagnosis output (very naive parsing of diagnose.sh format)
      const components = [
        {
          id: 'claude',
          name: 'Claude Service (VM)',
          description: 'Main AI channel process in the VM.',
          status: diagOutput.includes('1. Claude service ... [OK]') ? 'OK' : 'FAIL',
          label: diagOutput.includes('1. Claude service ... [OK]') ? 'Running' : 'Offline',
          actions: [{ id: 'restart-claude', name: 'Restart Service' }]
        },
        {
          id: 'gateway',
          name: 'Android Gateway',
          description: 'Connection to the physical phone.',
          status: diagOutput.includes('5. Android gateway ... [OK]') ? 'OK' : 'FAIL',
          label: diagOutput.includes('5. Android gateway ... [OK]') ? 'Reachable' : 'Unreachable',
          actions: [{ id: 'test-sms', name: 'Send Test SMS' }]
        },
        {
          id: 'ngrok',
          name: 'ngrok Tunnel',
          description: 'Public URL for inbound messages.',
          status: diagOutput.includes('6. ngrok tunnel ... [OK]') ? 'OK' : 'FAIL',
          label: diagOutput.includes('6. ngrok tunnel ... [OK]') ? 'Active' : 'Down',
          actions: [{ id: 'test-webhook', name: 'Test Webhook' }]
        }
      ]

      return Response.json({ components, raw: diagOutput })
    }

    // API: Action
    if (url.pathname === '/api/action' && req.method === 'POST') {
      const { action } = await req.json() as { action: string }
      let cmd = ''
      
      switch (action) {
        case 'restart-claude':
          cmd = `${VM_SSH} 'sudo systemctl restart claude-sms'`
          break
        case 'test-sms':
          cmd = `bun scripts/test-sms.ts`
          break
        case 'test-webhook':
          cmd = `bash scripts/test-webhook.sh`
          break
        case 'reset-network':
          cmd = `ssh yvz@192.168.1.8 'sudo ~/sms-to-claude/scripts/vm-network-watchdog.sh'`
          break
        default:
          return new Response('Unknown action', { status: 400 })
      }

      const output = await runCommand(cmd)
      return Response.json({ success: true, output })
    }

    return new Response('Not Found', { status: 404 })
  }
})

console.log(`Diagnosis server running at http://localhost:${PORT}`)
```

- [ ] **Step 2: Add "diagnosis" script to package.json**

```json
{
  "scripts": {
    "diagnosis-server": "bun run src/diagnosis-server.ts"
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/diagnosis-server.ts package.json
git commit -m "feat: add diagnosis server backend"
```

---

### Task 3: Verification

- [ ] **Step 1: Start the server**

Run: `bun run diagnosis-server`
Expected: "Diagnosis server running at http://localhost:8082"

- [ ] **Step 2: Open browser and check status**

Navigate to `http://localhost:8082`.
Expected: Dashboard loads, status icons turn Green/Red after a few seconds.

- [ ] **Step 3: Test an action**

Click "Send Test SMS".
Expected: Log area appears, shows output of `test-sms.ts`.
