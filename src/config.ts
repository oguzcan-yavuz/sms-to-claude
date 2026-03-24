export interface Config {
  twilio: {
    accountSid: string
    authToken: string
    phoneNumber: string
  }
  allowedPhoneNumbers: Set<string>
  pollIntervalMs: number
}

function required(key: string): string {
  const val = process.env[key]
  if (!val) throw new Error(`Missing required env var: ${key}`)
  return val
}

export function loadConfig(): Config {
  return {
    twilio: {
      accountSid: required('TWILIO_ACCOUNT_SID'),
      authToken: required('TWILIO_AUTH_TOKEN'),
      phoneNumber: required('TWILIO_PHONE_NUMBER'),
    },
    allowedPhoneNumbers: new Set(
      required('ALLOWED_PHONE_NUMBERS').split(',').map(n => n.trim())
    ),
    pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS ?? '5000', 10),
  }
}
