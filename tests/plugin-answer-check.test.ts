import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const hook = require('../plugin/hooks/answer-check.cjs') as {
  answerProblems: (text: string) => string[]
  lastAnswer: (path: string) => string
}
const HOOK = join(process.cwd(), 'plugin', 'hooks', 'answer-check.cjs')

const transcript = (answers: string[]) => {
  const dir = mkdtempSync(join(tmpdir(), 'cia-hook-'))
  const path = join(dir, 'session.jsonl')
  const lines = [
    JSON.stringify({ type: 'user', message: { content: [{ type: 'text', text: 'Who sent to 0xabc?' }] } }),
    ...answers.map((text) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text }] } })),
  ]
  writeFileSync(path, lines.join('\n') + '\n')
  return path
}

describe('the Stop hook that reads the last answer', () => {
  it('names the two loop breaks and nothing else', () => {
    expect(hook.answerProblems('0xd4a91e5023406903aff83225186e1d1ed18ca587 sent tokens worth about 183 USD on 2026-10-06.')).toEqual([])
    expect(hook.answerProblems('It sent about 25,931 USD in tokens to the vault.')).toHaveLength(1)
    expect(hook.answerProblems('The 0xcfa062… and 0xe3f614… pair has no link.')[0]).toContain('shortened address')
    expect(hook.answerProblems('Lifetime: $183 moved.')[0]).toContain('"$" figure')
    expect(hook.answerProblems('Tokens worth (USD): 1,000. The USDG token.')).toEqual([])
  })

  it('reads the last assistant text of a transcript', () => {
    const path = transcript(['first answer, fine', 'second answer sent about 5 USD'])
    expect(hook.lastAnswer(path)).toBe('second answer sent about 5 USD')
    expect(hook.lastAnswer('/nonexistent/path.jsonl')).toBe('')
  })

  it('blocks once with the sentence to fix, and lets a stop that follows a block through', () => {
    const path = transcript(['It received about 42 USD today.'])
    const out = execFileSync('node', [HOOK], { input: JSON.stringify({ transcript_path: path }) }).toString()
    expect(JSON.parse(out)).toMatchObject({ decision: 'block' })
    expect(JSON.parse(out).reason).toContain('tokens worth about N USD')
    const again = execFileSync('node', [HOOK], { input: JSON.stringify({ transcript_path: path, stop_hook_active: true }) }).toString()
    expect(again).toBe('')
    const fine = execFileSync('node', [HOOK], { input: JSON.stringify({ transcript_path: transcript(['tokens worth about 42 USD']) }) }).toString()
    expect(fine).toBe('')
  })
})
