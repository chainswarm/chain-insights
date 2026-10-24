import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, mkdirSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import {
  DEX_REGISTRY_TTL_MS,
  dexRegistryCachePath,
  dexRegistryUrl,
  loadRegistry,
  registryFault,
} from '../src/mcp/dex-registry.js'
import { repoRoot } from './dex-registry.js'

// loadRegistry: the fresh cache, else the public file within 3 s, else the
// stale cache, else the packaged copy. The public file is served here by a
// local file server on 127.0.0.1 through CHAIN_INSIGHTS_DEX_REGISTRY_URL, the
// override the proxy offers tests and the lab; "offline" is a port nothing
// listens on. HOME points at a fresh directory, so the cache is this test's own.

const packaged = readFileSync(join(repoRoot, 'registry/robinhood.json'), 'utf8')
const served = { body: packaged, status: 200, hits: 0 }
let server: Server
let baseUrl = ''
let home = ''
const savedHome = process.env['HOME']
const lines: string[] = []
const log = (line: string) => lines.push(line)
const OFFLINE = 'http://127.0.0.1:1/{network}.json'

beforeAll(async () => {
  server = createServer((request, response) => {
    served.hits += 1
    if (request.url !== '/robinhood.json') {
      response.writeHead(404).end()
      return
    }
    response.writeHead(served.status, { 'content-type': 'application/json' }).end(served.body)
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`
})

afterAll(async () => {
  await new Promise<void>((done) => server.close(() => done()))
})

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'dex-registry-home-'))
  process.env['HOME'] = home
  served.body = packaged
  served.status = 200
  served.hits = 0
  lines.length = 0
})

afterEach(() => {
  process.env['HOME'] = savedHome
  rmSync(home, { recursive: true, force: true })
})

const env = (url: string) => ({ CHAIN_INSIGHTS_DEX_REGISTRY_URL: url })

function writeCache(fields: Record<string, unknown>): void {
  const path = dexRegistryCachePath('robinhood')
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, JSON.stringify({ ...JSON.parse(packaged), source: 'fetched', ...fields }))
}

describe('the URL of the served copy', () => {
  it('is the public file on main unless the override names another', () => {
    expect(dexRegistryUrl('robinhood', {})).toBe(
      'https://raw.githubusercontent.com/chainswarm/chain-insights/main/registry/robinhood.json'
    )
    expect(dexRegistryUrl('robinhood', env('http://127.0.0.1:9/{network}.json'))).toBe(
      'http://127.0.0.1:9/robinhood.json'
    )
    expect(dexRegistryUrl('robinhood', env('http://127.0.0.1:9/'))).toBe(
      'http://127.0.0.1:9/robinhood.json'
    )
  })
})

describe('loadRegistry', () => {
  it('answers from the packaged copy on an offline first start, and waits an hour before the next fetch', async () => {
    const started = Date.now()
    const first = await loadRegistry('robinhood', { env: env(OFFLINE), log })
    expect(Date.now() - started).toBeLessThan(3_000)
    expect(first.source).toBe('packaged')
    expect(first.document.registry_version).toBe(2)
    expect(first.document.rows).toHaveLength(29)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatch(/127\.0\.0\.1:1\/robinhood\.json unreachable/)
    // A second start within the hour sends no fetch and still says packaged.
    const again = await loadRegistry('robinhood', { env: env(baseUrl), log })
    expect(again.source).toBe('packaged')
    expect(served.hits).toBe(0)
  })

  it('fetches the served copy, writes the cache with mode 0600, and answers from it within the hour', async () => {
    const fetched = await loadRegistry('robinhood', { env: env(baseUrl), log })
    expect(fetched.source).toBe('fetched')
    expect(served.hits).toBe(1)
    expect(statSync(dexRegistryCachePath('robinhood')).mode & 0o777).toBe(0o600)
    const cached = await loadRegistry('robinhood', {
      env: env(baseUrl),
      log,
      now: () => Date.now() + 30 * 60 * 1000,
    })
    expect(cached.source).toBe('cached')
    expect(served.hits).toBe(1)
  })

  it('fetches again after an hour', async () => {
    writeCache({
      cached_at_ms: Date.now() - DEX_REGISTRY_TTL_MS - 1,
      checked_at_ms: Date.now() - DEX_REGISTRY_TTL_MS - 1,
    })
    const loaded = await loadRegistry('robinhood', { env: env(baseUrl), log })
    expect(loaded.source).toBe('fetched')
    expect(served.hits).toBe(1)
  })

  it('keeps the stale cache when the served file is malformed, and logs one line naming the fault', async () => {
    const stale = Date.now() - DEX_REGISTRY_TTL_MS - 1
    writeCache({ cached_at_ms: stale, checked_at_ms: stale })
    const bad = JSON.parse(packaged) as { rows: Array<{ factories: string[] }> }
    bad.rows[0]!.factories[0] = '0xC63D7338C178E805C544B8F897066BD3BBCBE136'
    served.body = JSON.stringify(bad)
    const loaded = await loadRegistry('robinhood', { env: env(baseUrl), log })
    expect(loaded.source).toBe('cached')
    expect(loaded.document.rows[0]!.factories[0]).toBe('0xc63d7338c178e805c544b8f897066bd3bbcbe136')
    expect(lines).toEqual([
      expect.stringMatching(
        /is malformed: .*0xC63D7338C178E805C544B8F897066BD3BBCBE136 is not lowercase 0x/
      ),
    ])
  })

  it('keeps the stale cache on a file of another schema and on an HTTP failure', async () => {
    const stale = Date.now() - DEX_REGISTRY_TTL_MS - 1
    writeCache({ cached_at_ms: stale, checked_at_ms: stale })
    served.body = JSON.stringify({ ...JSON.parse(packaged), schema: 'chain-insights.dex-table.v0' })
    expect((await loadRegistry('robinhood', { env: env(baseUrl), log })).source).toBe('cached')
    writeCache({ cached_at_ms: stale, checked_at_ms: stale })
    served.status = 503
    expect((await loadRegistry('robinhood', { env: env(baseUrl), log })).source).toBe('cached')
    expect(lines[0]).toMatch(/schema is "chain-insights.dex-table.v0"/)
    expect(lines[1]).toMatch(/answered HTTP 503/)
  })

  it('takes the packaged copy over an older cache, so an upgrade is never answered from an older file', async () => {
    writeCache({ registry_version: 1, cached_at_ms: Date.now(), checked_at_ms: Date.now() })
    const loaded = await loadRegistry('robinhood', { env: env(OFFLINE), log })
    expect(loaded.source).toBe('packaged')
    expect(loaded.document.registry_version).toBe(2)
  })

  it('shares one fetch between two calls at once', async () => {
    const [a, b] = await Promise.all([
      loadRegistry('robinhood', { env: env(baseUrl), log }),
      loadRegistry('robinhood', { env: env(baseUrl), log }),
    ])
    expect([a.source, b.source]).toEqual(['fetched', 'fetched'])
    expect(served.hits).toBe(1)
  })

  it('refuses a network the registry does not cover, naming it', async () => {
    await expect(loadRegistry('base', { env: env(OFFLINE), log })).rejects.toThrow(
      /network_not_covered: .*"base"/
    )
    await expect(loadRegistry('', { env: env(OFFLINE), log })).rejects.toThrow(/invalid_network/)
  })
})

describe('registryFault', () => {
  const good = () =>
    JSON.parse(packaged) as Record<string, unknown> & { rows: Array<Record<string, unknown>> }

  it('passes the packaged copy, and names the first fault of a broken one', () => {
    expect(registryFault(good(), 'robinhood')).toBeNull()
    expect(registryFault(good(), 'base')).toMatch(/network is "robinhood", not base/)
    const noFactory = good()
    noFactory.rows[0]!.factories = []
    expect(registryFault(noFactory, 'robinhood')).toMatch(/\(aero\) has no factory or manager/)
    const badTrail = good()
    badTrail.rows[0]!.trail_type = 'bridge'
    expect(registryFault(badTrail, 'robinhood')).toMatch(
      /trail_type bridge is not plain, vault, gauge or launchpad/
    )
    const badKey = good()
    badKey.rows[0]!.dex = 'Aero DEX'
    expect(registryFault(badKey, 'robinhood')).toMatch(/dex is not a key: Aero DEX/)
  })
})
