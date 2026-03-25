export interface Config {
  gateway: {
    baseUrl: string
    login: string
    password: string
  }
  webhookUrl: string
  webhookPort: number
  allowedPhoneNumbers: Set<string>
}

function required(key: string): string {
  const val = process.env[key]
  if (!val) throw new Error(`Missing required env var: ${key}`)
  const trimmed = val.trim()
  if (!trimmed) throw new Error(`Missing required env var: ${key}`)
  return trimmed
}

export function loadConfig(): Config {
  const webhookUrl = required('WEBHOOK_URL')

  let webhookPort: number
  const portRaw = process.env.WEBHOOK_PORT
  if (portRaw) {
    const parsed = parseInt(portRaw, 10)
    if (isNaN(parsed)) throw new Error(`WEBHOOK_PORT must be a number, got: "${portRaw}"`)
    if (parsed < 1 || parsed > 65535) throw new Error('WEBHOOK_PORT must be between 1 and 65535')
    webhookPort = parsed
  } else {
    const portFromUrl = new URL(webhookUrl).port
    if (!portFromUrl) throw new Error('WEBHOOK_PORT must be set (could not derive port from WEBHOOK_URL)')
    webhookPort = parseInt(portFromUrl, 10)
  }

  return {
    gateway: {
      baseUrl: required('GATEWAY_BASE_URL'),
      login: required('GATEWAY_LOGIN'),
      password: required('GATEWAY_PASSWORD'),
    },
    webhookUrl,
    webhookPort,
    allowedPhoneNumbers: new Set(
      required('ALLOWED_PHONE_NUMBERS').split(',').map(n => n.trim()).filter(n => n.length > 0)
    ),
  }
}
