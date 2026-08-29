export function parseKnownHostsLine(line: string): {
  hostname: string
  port: number
  fingerprint: string
  key_type: string
} | null {
  try {
    if (line.trim().startsWith('#') || !line.trim()) return null
    const match = line.match(
      /^(?:\[([^\]]+)\]|(\S+))(?:\s+(\d+))?\s+(ssh-rsa|ssh-ed25519|ecdsa-sha2-nistp\d+)\s+([A-Za-z0-9+/=]+)/,
    )
    if (!match) return null
    const hostWithPort = match[1] || match[2]
    const port = match[3] ? Number.parseInt(match[3], 10) : 22
    const portMatch = hostWithPort.match(/^(.+):(\d+)$/)
    return {
      hostname: portMatch ? portMatch[1] : hostWithPort,
      port: portMatch ? Number.parseInt(portMatch[2], 10) : port,
      fingerprint: match[5],
      key_type: match[4],
    }
  } catch {
    return null
  }
}
