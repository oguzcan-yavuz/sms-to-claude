import Client, { type HttpClient } from 'android-sms-gateway'
import { loadConfig } from '../src/config'

const config = loadConfig()

const httpClient: HttpClient = {
  get: async (url, headers) => {
    const res = await fetch(url, { headers })
    return res.json()
  },
  post: async (url, body, headers) => {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) })
    return res.json()
  },
  put: async (url, body, headers) => {
    const res = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) })
    return res.json()
  },
  patch: async (url, body, headers) => {
    const res = await fetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) })
    return res.json()
  },
  delete: async (url, headers) => {
    const res = await fetch(url, { method: 'DELETE', headers })
    return res.json()
  },
}

const client = new Client(config.gateway.login, config.gateway.password, httpClient, config.gateway.baseUrl)
const settings = await client.getSettings()
console.log(JSON.stringify(settings, null, 2))
