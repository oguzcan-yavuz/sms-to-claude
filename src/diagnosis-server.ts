import { spawn } from 'child_process'
import { join } from 'path'
import { readFileSync } from 'fs'

const PORT = 8082
const UI_PATH = join(import.meta.dirname, 'diagnosis-ui.html')
const VM_SSH = "ssh -o ConnectTimeout=5 yvz@192.168.1.8"

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
  hostname: '127.0.0.1',
  idleTimeout: 30,
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
        },
        {
          id: 'network',
          name: 'VM Network',
          description: 'Internal network bridge for the VM.',
          status: diagOutput.includes('5. Android gateway ... [OK]') ? 'OK' : 'FAIL',
          label: diagOutput.includes('5. Android gateway ... [OK]') ? 'Connected' : 'Disconnected',
          actions: [{ id: 'reset-network', name: 'Reset Network' }]
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
          cmd = `${VM_SSH} 'sudo ~/sms-to-claude/scripts/vm-network-watchdog.sh'`
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
