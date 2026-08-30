import { spawnSync } from 'node:child_process'
import type { Readable, Writable } from 'node:stream'
import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import { PACKAGE_INFO, PACKAGE_VERSION } from './version.js'

const DEFAULT_REGISTRY_URL = 'https://registry.npmjs.org'
const DEFAULT_TIMEOUT_MS = 3000

export interface UpdateCheckOptions {
  packageName?: string
  currentVersion?: string
  registryUrl?: string
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

export interface UpdateCheckResult {
  packageName: string
  currentVersion: string
  latestVersion?: string
  updateAvailable: boolean
  updateCommand: string
  error?: string
}

export interface NpmInvocation {
  command: string
  args: string[]
  displayCommand: string
}

export interface UpdatePromptOptions extends UpdateCheckOptions {
  input?: NodeJS.ReadStream & Readable
  output?: NodeJS.WriteStream & Writable
  env?: NodeJS.ProcessEnv
}

export function compareSemverVersions(a: string, b: string): number {
  const left = parseSemverCore(a)
  const right = parseSemverCore(b)
  for (let i = 0; i < 3; i += 1) {
    if (left[i] > right[i]) return 1
    if (left[i] < right[i]) return -1
  }
  return 0
}

export function resolveUpdateRegistryUrl(env: NodeJS.ProcessEnv = process.env): string {
  return env['CHAIN_INSIGHTS_NPM_REGISTRY_URL']?.trim() || DEFAULT_REGISTRY_URL
}

export function buildPackageLatestUrl(
  packageName: string,
  registryUrl = DEFAULT_REGISTRY_URL
): string {
  const base = registryUrl.endsWith('/') ? registryUrl.slice(0, -1) : registryUrl
  return `${base}/${encodeURIComponent(packageName)}/latest`
}

export function resolveNpmUpdateInvocation(
  packageName = PACKAGE_INFO.name,
  env: NodeJS.ProcessEnv = process.env
): NpmInvocation {
  const packageSpec = `${packageName}@latest`
  const displayCommand = `npm install -g ${packageSpec}`
  const npmExecPath = env['npm_execpath']?.trim()
  if (npmExecPath) {
    return {
      command: process.execPath,
      args: [npmExecPath, 'install', '-g', packageSpec],
      displayCommand,
    }
  }
  return {
    command: process.platform === 'win32' ? 'npm.cmd' : 'npm',
    args: ['install', '-g', packageSpec],
    displayCommand,
  }
}

export async function fetchLatestPackageVersion(options: UpdateCheckOptions = {}): Promise<string> {
  const packageName = options.packageName ?? PACKAGE_INFO.name
  const registryUrl = options.registryUrl ?? resolveUpdateRegistryUrl()
  const fetchImpl = options.fetchImpl ?? fetch
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS)

  try {
    const response = await fetchImpl(buildPackageLatestUrl(packageName, registryUrl), {
      headers: {
        accept: 'application/json',
        'user-agent': `chain-insights/${PACKAGE_VERSION}`,
      },
      signal: controller.signal,
    })
    if (!response.ok) {
      throw new Error(`npmjs registry returned ${response.status}`)
    }
    const body = (await response.json()) as { version?: unknown }
    if (typeof body.version !== 'string' || !body.version.trim()) {
      throw new Error('npmjs registry response did not include a version')
    }
    return body.version.trim()
  } finally {
    clearTimeout(timeout)
  }
}

export async function checkForUpdate(options: UpdateCheckOptions = {}): Promise<UpdateCheckResult> {
  const packageName = options.packageName ?? PACKAGE_INFO.name
  const currentVersion = options.currentVersion ?? PACKAGE_VERSION
  const updateCommand = resolveNpmUpdateInvocation(packageName).displayCommand
  try {
    const latestVersion = await fetchLatestPackageVersion(options)
    return {
      packageName,
      currentVersion,
      latestVersion,
      updateAvailable: compareSemverVersions(latestVersion, currentVersion) > 0,
      updateCommand,
    }
  } catch (err) {
    return {
      packageName,
      currentVersion,
      updateAvailable: false,
      updateCommand,
      error: (err as Error).message,
    }
  }
}

export function runPackageUpdate(packageName = PACKAGE_INFO.name): void {
  const invocation = resolveNpmUpdateInvocation(packageName)
  const result = spawnSync(invocation.command, invocation.args, { stdio: 'inherit' })
  if (result.error) {
    throw result.error
  }
  if (result.status !== 0) {
    const detail = result.signal
      ? `signal ${result.signal}`
      : `exit code ${result.status ?? 'unknown'}`
    throw new Error(`Update failed with ${detail}`)
  }
}

export function shouldPromptForUpdate(options: UpdatePromptOptions = {}): boolean {
  const env = options.env ?? process.env
  if (env['CHAIN_INSIGHTS_SKIP_UPDATE_CHECK'] === '1') return false
  if (env['CI'] === 'true') return false
  const input = options.input ?? stdin
  const output = options.output ?? stdout
  return input.isTTY === true && output.isTTY === true
}

export async function maybePromptForUpdate(options: UpdatePromptOptions = {}): Promise<void> {
  if (!shouldPromptForUpdate(options)) return

  const check = await checkForUpdate(options)
  if (check.error || !check.updateAvailable || !check.latestVersion) return

  const output = options.output ?? stdout
  output.write(
    `\nChain Insights ${check.latestVersion} is available (current ${check.currentVersion}).\n`
  )
  output.write(`Update command: ${check.updateCommand}\n`)

  const rl = createInterface({
    input: options.input ?? stdin,
    output,
  })
  try {
    const answer = await rl.question('Update now? [Y/n] ')
    if (!answer.trim() || answer.trim().toLowerCase().startsWith('y')) {
      try {
        runPackageUpdate(check.packageName)
      } catch (err) {
        output.write(`Update failed: ${(err as Error).message}\n`)
        output.write('Workspace initialization is complete. Run `cia update` when ready.\n')
      }
    } else {
      output.write('Skipped update. Run `cia update` when ready.\n')
    }
  } finally {
    rl.close()
  }
}

function parseSemverCore(version: string): [number, number, number] {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:[-+].*)?$/.exec(version)
  if (!match) throw new Error(`Invalid semver version: ${version}`)
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}
