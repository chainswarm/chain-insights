import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CLI = path.join(__dirname, '..', 'bin', 'cli.js')

describe('CLI deferred local features', () => {
  it.each(['init', 'serve', 'viz'])('%s is unavailable in the first release', (command) => {
    const result = spawnSync(process.execPath, [CLI, command], { encoding: 'utf8' })
    expect(result.status).not.toBe(0)
    expect(`${result.stdout}\n${result.stderr}`).toMatch(/unknown command/i)
  })
})
