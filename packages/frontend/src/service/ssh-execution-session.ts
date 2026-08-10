import type { ConnectionResult } from '@/features/terminal/types'
import { sessionService } from '@/features/terminal/services'
import { getHostById } from '@/service/database/hosts'
import type { Host } from '@/types'

const terminalSize = { cols: 80, rows: 24 }

export async function createExecutionSession(
  host: Host,
): Promise<ConnectionResult> {
  if (host.jumpHostId) {
    const jumpHost = await getHostById(host.jumpHostId)
    if (!jumpHost) {
      return {
        success: false,
        message: 'Configured jump host could not be resolved',
      }
    }
    const jumpAuthType = host.jumpHostAuthType ?? jumpHost.authType
    if (host.authType === 'cert' || jumpAuthType === 'cert') {
      return {
        success: false,
        message:
          'Certificate authentication through a jump host is not supported yet',
      }
    }
    return sessionService.createSshJump({
      targetHost: host,
      jumpHost: {
        host: jumpHost.hostname,
        port: jumpHost.port,
        username: jumpHost.username,
        authType: jumpAuthType,
        password: jumpHost.password,
        privateKey: jumpHost.privateKey,
        certificate: jumpHost.certificate,
        targetAuthType: host.authType,
      },
      ...terminalSize,
    })
  }

  const options = { host, ...terminalSize }
  switch (host.authType) {
    case 'password':
      return sessionService.createSshPassword(options)
    case 'key':
      return sessionService.createSshKey(options)
    case 'agent':
      return sessionService.createSshAgent(options)
    case 'cert':
      return sessionService.createSshCert(options)
  }
}
