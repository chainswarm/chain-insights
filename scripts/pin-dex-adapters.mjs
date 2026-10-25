#!/usr/bin/env node
// Pins the adapter list of the DEX indexer registry into
// tests/fixtures/dex-adapters.json, so tests/dex-coverage.test.ts can hold every
// adapter the indexer reads to an exchange row, a trail-type skill and a name-only
// eval, without a checkout of the registry at test time.
//
//   node scripts/pin-dex-adapters.mjs <registry.json>
//       prints the pinned JSON on stdout
//   node scripts/pin-dex-adapters.mjs <registry.json> --write
//       writes tests/fixtures/dex-adapters.json (or the file named by --out)
//   node scripts/pin-dex-adapters.mjs <registry.json> --check <file>
//       prints nothing and exits 0 when <file> is what a fresh pin gives,
//       otherwise names the difference on stderr and exits 1
//
// The input is the indexer's network registry (format dex-registry-v2). The
// output keeps the registry version and, per adapter, its id, its discovery
// kind (factory, custody, emitter or launch) and its anchors: the discovery
// factories, else the discovery address (the custody contract of a custody
// adapter, the pool manager whose Initialize a launch adapter reads), else none
// (an emitter adapter is found by its event alone). A launch adapter is a
// generic rule: its factories are found on the chain, never named in the
// registry. Everything else in the registry (profiles, deployments, event
// signatures, code profiles) is dropped.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const DEFAULT_OUT = join(repoRoot, 'tests/fixtures/dex-adapters.json')
const ADDRESS = /^0x[0-9a-f]{40}$/

function fail(message) {
  console.error(`pin-dex-adapters: ${message}`)
  process.exit(1)
}

function parseArgs(argv) {
  const args = { registry: undefined, write: false, out: DEFAULT_OUT, check: undefined }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--write') args.write = true
    else if (arg === '--out' || arg === '--check') {
      const value = argv[i + 1]
      if (value === undefined || value.startsWith('--')) fail(`${arg} needs a value`)
      args[arg.slice(2)] = value
      i += 1
    } else if (arg.startsWith('--')) fail(`unknown argument ${arg}`)
    else if (args.registry === undefined) args.registry = arg
    else fail(`unexpected argument ${arg}`)
  }
  if (!args.registry)
    fail('usage: pin-dex-adapters.mjs <registry.json> [--write [--out <file>] | --check <file>]')
  return args
}

const lower = (address) => String(address).toLowerCase()

function anchorsOf(id, discovery) {
  const factories = (discovery.factories ?? []).filter((a) => a !== '').map(lower)
  const address = discovery.address ? [lower(discovery.address)] : []
  const anchors = factories.length > 0 ? factories : address
  for (const anchor of anchors) {
    if (!ADDRESS.test(anchor)) fail(`${id}: anchor ${anchor} is not a full address`)
  }
  return anchors
}

export function pinDexAdapters(registryText) {
  const registry = JSON.parse(registryText)
  if (!Number.isInteger(registry.version)) fail('the registry holds no integer "version"')
  if (!Array.isArray(registry.adapters)) fail('the registry holds no "adapters" list')
  const adapters = registry.adapters.map((adapter) => {
    if (!adapter.id) fail('an adapter has no id')
    const discovery = adapter.discovery ?? {}
    if (!['factory', 'custody', 'emitter', 'launch'].includes(discovery.kind)) {
      fail(
        `${adapter.id}: discovery kind ${String(discovery.kind)} is not factory, custody, emitter or launch`
      )
    }
    return {
      id: adapter.id,
      discovery_kind: discovery.kind,
      anchors: anchorsOf(adapter.id, discovery),
    }
  })
  adapters.sort((a, b) => a.id.localeCompare(b.id))
  const ids = new Set(adapters.map((a) => a.id))
  if (ids.size !== adapters.length) fail('an adapter id is listed twice')
  return { registry_version: registry.version, network: registry.network ?? '', adapters }
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const pinned = `${JSON.stringify(pinDexAdapters(readFileSync(args.registry, 'utf8')), null, 2)}\n`
  if (args.check) {
    const current = readFileSync(args.check, 'utf8')
    if (current !== pinned) {
      console.error(`pin-dex-adapters: ${args.check} differs from a fresh pin of ${args.registry}`)
      process.exit(1)
    }
    return
  }
  if (args.write) {
    writeFileSync(args.out, pinned)
    console.error(`wrote ${args.out}`)
    return
  }
  process.stdout.write(pinned)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main()
