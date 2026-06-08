import { describe, it, expect } from 'vitest'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CLI = path.join(__dirname, '..', 'bin', 'cli.js')

describe('CLI viz command (VIZ-03)', () => {
  it('--help includes viz command', () => {
    const out = execSync(`node ${CLI} --help`, { encoding: 'utf8' })
    expect(out).toContain('viz')
    expect(out).toContain('Generate a workspace visualization')
  })

  it('viz --help shows --data option', () => {
    const out = execSync(`node ${CLI} viz --help`, { encoding: 'utf8' })
    expect(out).toContain('--data')
    expect(out).toContain('Raw transaction JSON file')
    expect(out).toContain('Workspace graph report ID to render')
  })

  it('viz without arguments exits with error', () => {
    try {
      execSync(`node ${CLI} viz`, { encoding: 'utf8', stdio: 'pipe' })
      expect.unreachable('should have thrown')
    } catch (err: unknown) {
      const e = err as { stderr?: string; status?: number }
      // Either exit code 1 or stderr contains error message
      expect(e.status).not.toBe(0)
    }
  })

  it('viz --data with nonexistent file exits with error', () => {
    try {
      execSync(`node ${CLI} viz --data /tmp/nonexistent_viz_test_file.json`, { encoding: 'utf8', stdio: 'pipe' })
      expect.unreachable('should have thrown')
    } catch (err: unknown) {
      const e = err as { status?: number }
      expect(e.status).not.toBe(0)
    }
  })
})
