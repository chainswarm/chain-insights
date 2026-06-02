import { describe, expect, it, vi } from 'vitest'
import type { Readable, Writable } from 'node:stream'
import {
  buildPackageLatestUrl,
  checkForUpdate,
  compareSemverVersions,
  resolveNpmUpdateInvocation,
  resolveUpdateRegistryUrl,
  shouldPromptForUpdate,
} from '../src/update.js'

describe('CLI update checks', () => {
  it('compares semver core versions', () => {
    expect(compareSemverVersions('0.3.9', '0.3.8')).toBe(1)
    expect(compareSemverVersions('0.3.8', '0.3.8')).toBe(0)
    expect(compareSemverVersions('0.3.7', '0.3.8')).toBe(-1)
    expect(compareSemverVersions('1.0.0-beta.1', '0.9.9')).toBe(1)
  })

  it('defaults to the public npmjs registry', () => {
    expect(resolveUpdateRegistryUrl({})).toBe('https://registry.npmjs.org')
    expect(resolveUpdateRegistryUrl({ CHAIN_INSIGHTS_NPM_REGISTRY_URL: 'https://registry.example.test' })).toBe(
      'https://registry.example.test',
    )
  })

  it('builds npm latest URLs with encoded package names', () => {
    expect(buildPackageLatestUrl('chain-insights', 'https://registry.npmjs.org/')).toBe(
      'https://registry.npmjs.org/chain-insights/latest',
    )
    expect(buildPackageLatestUrl('@scope/pkg', 'https://registry.example.test')).toBe(
      'https://registry.example.test/%40scope%2Fpkg/latest',
    )
  })

  it('reports an available update from npmjs metadata', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ version: '0.3.9' }), {
      headers: { 'content-type': 'application/json' },
      status: 200,
    })) as unknown as typeof fetch

    const result = await checkForUpdate({
      packageName: 'chain-insights',
      currentVersion: '0.3.8',
      registryUrl: 'https://registry.example.test/',
      fetchImpl,
    })

    expect(result).toMatchObject({
      packageName: 'chain-insights',
      currentVersion: '0.3.8',
      latestVersion: '0.3.9',
      updateAvailable: true,
      updateCommand: 'npm install -g chain-insights@latest',
    })
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://registry.example.test/chain-insights/latest',
      expect.objectContaining({
        headers: expect.objectContaining({ accept: 'application/json' }),
      }),
    )
  })

  it('turns registry failures into non-throwing check results', async () => {
    const fetchImpl = vi.fn(async () => new Response('missing', { status: 404 })) as unknown as typeof fetch

    const result = await checkForUpdate({
      packageName: 'chain-insights',
      currentVersion: '0.3.8',
      fetchImpl,
    })

    expect(result.updateAvailable).toBe(false)
    expect(result.error).toContain('npmjs registry returned 404')
  })

  it('resolves npm update invocation through npm_execpath when available', () => {
    const result = resolveNpmUpdateInvocation('chain-insights', {
      npm_execpath: '/opt/npm/bin/npm-cli.js',
    })

    expect(result.command).toBe(process.execPath)
    expect(result.args).toEqual(['/opt/npm/bin/npm-cli.js', 'install', '-g', 'chain-insights@latest'])
    expect(result.displayCommand).toBe('npm install -g chain-insights@latest')
  })

  it('prompts only in interactive terminals', () => {
    const input = { isTTY: true } as NodeJS.ReadStream & Readable
    const output = { isTTY: true } as NodeJS.WriteStream & Writable

    expect(shouldPromptForUpdate({ input, output, env: {} })).toBe(true)
    expect(shouldPromptForUpdate({ input, output, env: { CI: 'true' } })).toBe(false)
    expect(shouldPromptForUpdate({ input, output, env: { CHAIN_INSIGHTS_SKIP_UPDATE_CHECK: '1' } })).toBe(false)
    expect(shouldPromptForUpdate({
      input: { isTTY: false } as NodeJS.ReadStream & Readable,
      output,
      env: {},
    })).toBe(false)
  })
})
