import { describe, expect, it } from 'vitest'
import {
  changelogHasVersionEntry,
  committedPackageTarballs,
  compareSemver,
  missingPackageEntrypoints,
  packageEntrypointPaths,
  parseSemver,
} from '../scripts/check-release-gate.mjs'

describe('release gate helpers', () => {
  it('parses plain semver versions', () => {
    expect(parseSemver('0.2.0')).toMatchObject({ major: 0, minor: 2, patch: 0 })
  })

  it('rejects non-semver versions', () => {
    expect(() => parseSemver('0.2')).toThrow(/Invalid semver/)
    expect(() => parseSemver('v0.2.0')).toThrow(/Invalid semver/)
  })

  it('orders semver versions', () => {
    expect(compareSemver('0.2.0', '0.1.9')).toBe(1)
    expect(compareSemver('0.2.0', '0.2.0')).toBe(0)
    expect(compareSemver('0.2.0-alpha.1', '0.2.0')).toBe(-1)
  })

  it('finds a matching changelog version heading', () => {
    expect(changelogHasVersionEntry('## [0.2.0] - 2026-05-18\n', '0.2.0')).toBe(true)
    expect(changelogHasVersionEntry('## 0.2.0\n', '0.2.0')).toBe(true)
    expect(changelogHasVersionEntry('## [0.1.0] - 2026-05-18\n', '0.2.0')).toBe(false)
  })

  it('collects package entrypoint paths from main, module, and exports', () => {
    expect(packageEntrypointPaths({
      main: './dist/index.cjs',
      module: './dist/index.mjs',
      exports: {
        '.': {
          import: './dist/index.mjs',
          require: './dist/index.cjs',
        },
        './cli': './dist/cli.mjs',
      },
    })).toEqual(['dist/cli.mjs', 'dist/index.cjs', 'dist/index.mjs'])
  })

  it('reports missing package entrypoints', () => {
    expect(missingPackageEntrypoints({
      main: './dist/index.cjs',
      module: './dist/index.mjs',
    }, (path: string) => path === 'dist/index.cjs')).toEqual(['dist/index.mjs'])
  })

  it('finds committed npm package tarballs', () => {
    expect(committedPackageTarballs([
      'chain-insights-0.2.17.tgz',
      'docs/archive.tgz',
      'package-lock.json',
    ])).toEqual(['chain-insights-0.2.17.tgz', 'docs/archive.tgz'])
  })
})
