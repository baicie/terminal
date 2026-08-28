import { spawnSync } from 'node:child_process'
import process from 'node:process'

const groups = {
  frontend: [
    ['pnpm', ['--filter=@terminal/frontend', 'lint']],
    ['pnpm', ['--filter=@terminal/frontend', 'typecheck']],
    ['pnpm', ['--filter=@terminal/frontend', 'test']],
    ['pnpm', ['--filter=@terminal/frontend', 'build:budget']],
  ],
  'team-server': [
    ['pnpm', ['--filter=team-server', 'exec', 'prisma', 'validate']],
    ['pnpm', ['--filter=team-server', 'lint']],
    ['pnpm', ['--filter=team-server', 'typecheck']],
    ['pnpm', ['--filter=team-server', 'test']],
    ['pnpm', ['--filter=team-server', 'build']],
  ],
  rust: [
    ['cargo', ['fmt', '--manifest-path', 'src-tauri/Cargo.toml', '--check']],
    [
      'cargo',
      [
        'check',
        '--manifest-path',
        'src-tauri/Cargo.toml',
        '--locked',
        '--all-targets',
        '--all-features',
      ],
    ],
    [
      'cargo',
      [
        'clippy',
        '--manifest-path',
        'src-tauri/Cargo.toml',
        '--locked',
        '--all-targets',
        '--all-features',
        '--',
        '-D',
        'warnings',
      ],
    ],
    [
      'cargo',
      [
        'test',
        '--manifest-path',
        'src-tauri/Cargo.toml',
        '--locked',
        '--all-targets',
        '--all-features',
      ],
    ],
  ],
  scripts: [
    [
      'node',
      [
        '--test',
        'scripts/run-terminal-smoke.test.mjs',
        'scripts/terminal-smoke-sshd.test.mjs',
        'scripts/run-input-probe.test.mjs',
      ],
    ],
  ],
  source: [['node', ['scripts/check-source-size.mjs']]],
}

const requestedGroup = process.argv[2] ?? 'all'
const selectedGroups =
  requestedGroup === 'all' ? Object.keys(groups) : [requestedGroup]

if (selectedGroups.some(group => !(group in groups))) {
  console.error(
    `Unknown verification group: ${requestedGroup}. Expected all, ${Object.keys(groups).join(', ')}.`,
  )
  process.exit(2)
}

for (const group of selectedGroups) {
  console.log(`\n[verify] ${group}`)
  for (const [command, args] of groups[group]) {
    console.log(`$ ${command} ${args.join(' ')}`)
    const result = spawnSync(command, args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    })

    if (result.error) {
      console.error(result.error.message)
      process.exit(1)
    }
    if (result.status !== 0) process.exit(result.status ?? 1)
  }
}

console.log('\nAll requested verification groups passed.')
