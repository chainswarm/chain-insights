#!/usr/bin/env node
// Stop hook of the Chain Insights plugin: reads the last answer of the turn
// and, when it breaks an answer rule the skill already states, blocks the
// stop once with the sentence to fix. The rules are the skill's rule 1
// (full addresses) and rule 9 (tokens are not dollars): two hundred loop
// conversations showed both still slip through about one time in thirty on
// Claude Code, always in a long answer. A hook that reads the text is the
// only check that sees the answer itself.
//
// Input (stdin): the Stop hook JSON with transcript_path and stop_hook_active.
// Output: {"decision":"block","reason":...} when the answer must be rewritten;
// nothing when it is fine, or when this stop already follows a block.
'use strict'
const fs = require('fs')

const SHORT_ADDRESS = /0x[0-9a-fA-F]{2,12}(\.\.\.|…)[0-9a-fA-F]{0,8}/
const SENT_DOLLARS = /\b(sent|received|moved|transferred|paid|deposited|withdrew)\s+(about\s+|roughly\s+|~)?(\$\s?\d|\d[\d,\.]*\s*(USD|dollars)\b)/i
const BARE_DOLLAR = /(?<![A-Za-z])\$\s?\d/

/** The sentences a rewrite must fix, or an empty list. */
function answerProblems(text) {
  const problems = []
  const m1 = text.match(SHORT_ADDRESS)
  if (m1) problems.push(`"${m1[0]}" is a shortened address: write every address in full, all 42 characters, also when it repeats one named earlier (name it "Wallet A" and list the full address once if that reads better).`)
  const m2 = text.match(SENT_DOLLARS)
  if (m2) problems.push(`"${m2[0]}" reads as dollars sent: a transfer moves tokens, so write "tokens worth about N USD on DAY".`)
  else if (BARE_DOLLAR.test(text)) problems.push(`a "$" figure reads as dollars sent: write the unit as USD after the number, "tokens worth about N USD".`)
  return problems
}

/** The text of the last assistant message in a Claude Code transcript (JSONL). */
function lastAnswer(transcriptPath) {
  let lines
  try {
    lines = fs.readFileSync(transcriptPath, 'utf8').split('\n')
  } catch {
    return ''
  }
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i].trim()
    if (!line) continue
    let entry
    try {
      entry = JSON.parse(line)
    } catch {
      continue
    }
    if (entry.type !== 'assistant') continue
    const content = entry.message && entry.message.content
    if (!Array.isArray(content)) continue
    const text = content.filter((b) => b && b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n')
    if (text.trim()) return text
  }
  return ''
}

function main() {
  let input = {}
  try {
    input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}')
  } catch {
    input = {}
  }
  if (input.stop_hook_active) return
  const problems = answerProblems(lastAnswer(String(input.transcript_path || '')))
  if (problems.length === 0) return
  process.stdout.write(
    JSON.stringify({
      decision: 'block',
      reason: `Rewrite your last answer before you stop. ${problems.join(' ')} Keep everything else as it is.`,
    })
  )
}

module.exports = { answerProblems, lastAnswer }
if (require.main === module) main()
