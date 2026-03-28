#!/usr/bin/env bun
// Stop hook — sends Claude's text response via SMS if sms_reply/sms_update wasn't called.
// Registered in ~/.claude/settings.json on the VM.

import { existsSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

// --- Parse stdin ---
const raw = await new Response(Bun.stdin.stream()).text()
import { writeFileSync } from 'fs'
writeFileSync('/tmp/sms-hook-debug.json', raw) // temporary debug — remove after confirming format
let input: unknown
try {
  input = JSON.parse(raw)
} catch {
  process.exit(0)
}

// --- Find last assistant turn ---
const transcript: unknown[] = (input as any).transcript ?? (input as any).messages ?? []
const lastAssistant = [...transcript].reverse().find((m: any) => m.role === 'assistant')
if (!lastAssistant) process.exit(0)

const content: unknown[] = Array.isArray((lastAssistant as any).content)
  ? (lastAssistant as any).content
  : [{ type: 'text', text: String((lastAssistant as any).content ?? '') }]

// --- Skip if sms_reply or sms_update was already called ---
const smsSent = content.some(
  (b: any) => b.type === 'tool_use' && b.name === 'sms_reply'
)
if (smsSent) process.exit(0)

// --- Extract text ---
const text = content
  .filter((b: any) => b.type === 'text')
  .map((b: any) => String(b.text ?? ''))
  .join('\n')
  .trim()

if (!text) process.exit(0)

// --- Load credentials from .env ---
const envPath = join(homedir(), 'sms-to-claude', '.env')
if (!existsSync(envPath)) process.exit(0)

const env: Record<string, string> = {}
for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
  const eq = line.indexOf('=')
  if (eq > 0) env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim()
}

const { GATEWAY_BASE_URL, GATEWAY_LOGIN, GATEWAY_PASSWORD, ALLOWED_PHONE_NUMBERS } = env
const to = ALLOWED_PHONE_NUMBERS?.split(',')[0]?.trim()
if (!GATEWAY_BASE_URL || !GATEWAY_LOGIN || !GATEWAY_PASSWORD || !to) process.exit(0)

// --- Send SMS ---
const MAX = 1600
const body = text.length > MAX ? text.slice(0, MAX - 12) + ' [truncated]' : text

await fetch(`${GATEWAY_BASE_URL}/v1/message`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: 'Basic ' + btoa(`${GATEWAY_LOGIN}:${GATEWAY_PASSWORD}`),
  },
  body: JSON.stringify({ message: body, phoneNumbers: [to] }),
}).catch(() => {}) // best-effort, don't crash the hook
