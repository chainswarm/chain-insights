#!/usr/bin/env node
// The risk golden runner: asks the risk tools about every case of one golden
// set, against a live graph, and says which answers meet their case.
//
//   RISK_GOLDEN_TOKEN_FILE=<file> npx tsx scripts/risk-golden.mjs <address|pool|token> [--min N] [--json]
//
// Runs under tsx: it imports the TypeScript sources of the tools directly
// (src/mcp/address-risk.ts, src/mcp/token-risk.ts), so no build is needed.
// `address` cases go to handleAmlAddressRisk, `pool` and `token` cases to
// handleAmlTokenRisk, with the packaged registries of registry/.
//
// - Data: scripts/risk-golden.json, `{ network, address: [...], pool: [...], token: [...] }`.
//   Each case is `{ address, note, expect }`; only the expect keys present are
//   compared (scripts/risk-golden-compare.mjs).
// - Graph: every graph_query_batch is a JSON-RPC `tools/call` POST to
//   RISK_GOLDEN_ENDPOINT (default https://mcp-staging.chain-insights.ai/mcp),
//   with `Authorization: Bearer <token>`. The token is read from the file named
//   in RISK_GOLDEN_TOKEN_FILE and never printed; the runner refuses to start
//   without it.
// - Output: one line per case, `ok|FAIL <address> word=<got> expected=<…> ms=<…>`,
//   the rows read under it, then `N of M`. With --json the lines go to stderr
//   and the full results to stdout, for the evidence file.
// - Exit 1 when a case fails, or the set holds fewer cases than --min
//   (default 20 address, 10 pool, 20 token).
//
// Not part of T1 and not in the npm package (package.json `files` holds no
// scripts/). Its pure part has a unit test: tests/risk-golden-compare.test.ts.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  DEFAULT_MIN,
  compareCase,
  dataProblem,
  resultLine,
  rowsLine,
  valuesOf,
} from './risk-golden-compare.mjs'

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const readJson = (...parts) => JSON.parse(readFileSync(join(repoRoot, ...parts), 'utf8'))

function argValue(name) {
  const index = process.argv.indexOf(name)
  return index === -1 ? undefined : process.argv[index + 1]
}

function fail(text) {
  console.error(`risk-golden: ${text}`)
  process.exit(2)
}

const kind = process.argv[2]
const json = process.argv.includes('--json')
const data = readJson('scripts', 'risk-golden.json')
const problem = dataProblem(data, kind)
if (problem) fail(problem)
const minText = argValue('--min')
const min = minText === undefined ? DEFAULT_MIN[kind] : Number(minText)
if (!Number.isInteger(min) || min < 0) fail('--min is a whole number')

const tokenFile = process.env['RISK_GOLDEN_TOKEN_FILE']
if (!tokenFile) fail('RISK_GOLDEN_TOKEN_FILE names no file: no read is sent without a token')
let bearer
try {
  bearer = readFileSync(tokenFile, 'utf8').trim()
} catch (err) {
  fail(`the token file did not read (${err.code ?? 'error'})`)
}
if (!bearer) fail('the token file is empty')
const endpoint = process.env['RISK_GOLDEN_ENDPOINT'] ?? 'https://mcp-staging.chain-insights.ai/mcp'

const { handleAmlAddressRisk } = await import(join(repoRoot, 'src/mcp/address-risk.ts'))
const { handleAmlTokenRisk } = await import(join(repoRoot, 'src/mcp/token-risk.ts'))

const card = { document: readJson('registry', 'address-card.json'), source: 'packaged' }
const exchanges = { document: readJson('registry', 'exchanges', `${data.network}.json`), source: 'packaged' }
const dex = { document: readJson('registry', `${data.network}.json`), source: 'packaged', loaded_at_ms: 0 }

let requestId = 0
/** One graph_query_batch over JSON-RPC; an SSE reply is read from its data line. */
async function graphQueryBatch(args) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${bearer}`,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: ++requestId,
      method: 'tools/call',
      params: { name: 'graph_query_batch', arguments: args },
    }),
  })
  const text = await response.text()
  const line = text.trimStart().startsWith('{')
    ? text
    : (text.split('\n').find((row) => row.startsWith('data:')) ?? '').slice('data:'.length)
  let reply
  try {
    reply = JSON.parse(line)
  } catch {
    throw new Error(`http ${response.status}: the reply is not JSON-RPC`)
  }
  if (reply.result) return reply.result
  return { isError: true, content: [{ type: 'text', text: JSON.stringify(reply.error ?? { http: response.status }) }] }
}

const deps = {
  loadAddressCard: async () => card,
  loadExchangeRegistry: async () => exchanges,
  loadDexRegistry: async () => dex,
  graphQueryBatch,
  describeFailure: (err) => (err instanceof Error ? err.message : String(err)),
}

const say = json ? (text) => console.error(text) : (text) => console.log(text)
const cases = data[kind]
const results = []
for (const entry of cases) {
  const started = Date.now()
  const tool = kind === 'address' ? handleAmlAddressRisk : handleAmlTokenRisk
  const answer = await tool({ network: data.network, address: entry.address }, deps)
  const ms = Date.now() - started
  const structured = answer.isError ? null : answer.structuredContent
  const compared = structured
    ? compareCase(kind, entry.expect, structured)
    : { ok: false, mismatches: [{ key: 'answer', got: answer.content?.[0]?.text ?? 'error', expected: 'an answer' }] }
  const values = valuesOf(kind, structured)
  say(resultLine(entry.address, compared, values, ms, entry.expect))
  say(structured ? rowsLine(kind, values) : `  error: ${answer.content?.[0]?.text ?? ''}`)
  results.push({ ...entry, ok: compared.ok, mismatches: compared.mismatches, ms, answer: structured })
}
const passed = results.filter((result) => result.ok).length
say(`${passed} of ${results.length}`)
if (results.length < min) say(`the ${kind} set holds ${results.length} cases, fewer than --min ${min}`)
if (json) {
  console.log(
    JSON.stringify({ kind, network: data.network, endpoint, min, passed, total: results.length, results }, null, 2)
  )
}
process.exit(passed === results.length && results.length >= min ? 0 : 1)
