import { describe, expect, it } from 'vitest'
import { changelogHasVersionEntry, compareSemver, parseSemver } from '../scripts/check-release-gate.mjs'

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
})
