import type {
  TerminalSmokeConfig,
  TerminalSmokeResult,
} from './terminal-smoke-contract'

export const terminalSmokeTestConfig: TerminalSmokeConfig = {
  loadBytes: 8_388_608,
  initialCols: 80,
  initialRows: 24,
  targetCols: 97,
  targetRows: 31,
  timeoutMs: 180_000,
  rounds: 10,
  reconnectRequired: false,
  ssh: {
    host: '127.0.0.1',
    port: 42_222,
    username: 'terminal-smoke',
    authMode: 'key',
    privateKey:
      '-----BEGIN OPENSSH PRIVATE KEY-----\nfixture\n-----END OPENSSH PRIVATE KEY-----\n',
    password: null,
    certificate: null,
    jump: null,
    expectedHostKey: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIfixture',
  },
}

export const terminalSmokeRoundResult: TerminalSmokeResult = {
  ok: true,
  stage: 'complete',
  error: null,
  loadBytes: terminalSmokeTestConfig.loadBytes,
  roundsCompleted: 1,
  uniqueSessionCount: 1,
  resourcesRecovered: false,
  durationMs: 25,
  terminalCols: terminalSmokeTestConfig.targetCols,
  terminalRows: terminalSmokeTestConfig.targetRows,
  loadEndVisible: true,
  afterLoadVisible: true,
  resizedSizeVisible: true,
  reconnectObserved: false,
  staleOutputRejected: false,
  firstConnectionMs: 1_234,
}

export const frontendResourceBaseline = {
  recordTabIds: ['preexisting-tab'],
  sessionMappings: [
    { sessionId: 'preexisting-session', tabId: 'preexisting-tab' },
  ],
}
export const backendResourceBaseline = {
  managerSessions: ['preexisting-session'],
  metadata: ['preexisting-session'],
  channels: ['preexisting-session'],
  sshPool: ['preexisting-pool'],
  sshRegistry: ['preexisting-registry'],
  outputControls: ['preexisting-session'],
}

function changedFrontendResources(tag: string) {
  return {
    recordTabIds: [`changed-tab-${tag}`],
    sessionMappings: [
      { sessionId: `changed-session-${tag}`, tabId: `changed-tab-${tag}` },
    ],
  }
}

function changedBackendResources(tag: string): typeof backendResourceBaseline {
  return Object.fromEntries(
    Object.keys(backendResourceBaseline).map(key => [
      key,
      [`changed-${key}-${tag}`],
    ]),
  ) as typeof backendResourceBaseline
}

export function terminalSmokeResourceSequences(rounds: number) {
  const frontend = [
    changedFrontendResources('initial'),
    frontendResourceBaseline,
    frontendResourceBaseline,
  ]
  const backend = [
    changedBackendResources('initial'),
    backendResourceBaseline,
    backendResourceBaseline,
  ]
  for (let round = 1; round <= rounds; round += 1) {
    frontend.push(
      changedFrontendResources(`${round}-a`),
      frontendResourceBaseline,
      changedFrontendResources(`${round}-b`),
      frontendResourceBaseline,
      frontendResourceBaseline,
    )
    backend.push(
      changedBackendResources(`${round}-a`),
      backendResourceBaseline,
      changedBackendResources(`${round}-b`),
      backendResourceBaseline,
      backendResourceBaseline,
    )
  }
  return { frontend, backend }
}
