// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
import { getEnv } from '@shared/env'
// [INPUT]: Browser origin and local Worker API request path.
// [OUTPUT]: Read-only local API CORS decisions and response headers.
// [POS]: Worker browser trust boundary shared by preview, production, and local development consoles.

import type http from 'node:http'

const READABLE_LOCAL_API_CORS_PATHS = new Set(['/health', '/api/health', '/api/status', '/api/doctor', '/api/local-access/identity'])
const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

const normalizeHostname = (hostname: string) => hostname.trim().toLowerCase().replace(/^\[|\]$/g, '')

export const isReadableLocalApiCorsPath = (pathname: string) => READABLE_LOCAL_API_CORS_PATHS.has(pathname)

export const isAllowedReadableLocalApiCorsOrigin = (origin?: string) => {
  const trimmed = origin?.trim()
  if (!trimmed) {
    return false
  }

  const configuredOrigins = (getEnv('OXMUX_WORKER_LOCAL_API_CORS_ORIGINS') ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
  if (configuredOrigins.includes(trimmed)) {
    return true
  }

  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false
    }

    const hostname = normalizeHostname(parsed.hostname)
    if (LOOPBACK_HOSTNAMES.has(hostname)) {
      return true
    }

    return hostname === 'vibemux.xyz'
      || hostname.endsWith('.oxmux.xyz')
      || hostname === 'oxmux.xyz'
      || hostname.endsWith('.oxmux.xyz')
      || hostname === 'vibemux.com'
      || hostname.endsWith('.oxmux.com')
      || hostname === 'oxmux.ai'
      || hostname.endsWith('.oxmux.ai')
      || hostname === 'app.oxmux.localtest.me'
      || hostname === 'app.oxmux.localtest.me'
  } catch {
    return false
  }
}

export const isAllowedLocalTerminalDirectOrigin = isAllowedReadableLocalApiCorsOrigin

export const applyReadableLocalApiCorsHeaders = (
  request: http.IncomingMessage,
  response: http.ServerResponse,
  pathname: string,
) => {
  const origin = Array.isArray(request.headers.origin) ? request.headers.origin[0] : request.headers.origin
  if (!isReadableLocalApiCorsPath(pathname) || !isAllowedReadableLocalApiCorsOrigin(origin)) {
    return false
  }

  response.setHeader('Access-Control-Allow-Origin', origin)
  response.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  response.setHeader('Access-Control-Max-Age', '600')
  response.setHeader('Vary', 'Origin')
  if (request.headers['access-control-request-private-network'] === 'true') {
    response.setHeader('Access-Control-Allow-Private-Network', 'true')
  }

  return true
}
