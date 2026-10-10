/**
 * A graph_query_batch member that reads the chain node costs several node
 * calls (an Address read costs four), and the graph server caps node calls
 * per caller per second. Three chain reads in one batch come back as one
 * answer and two `chain_busy` refusals: "this caller used its share of node
 * calls this second. Retry after a short wait." A refused member is not
 * billed and every read is safe to repeat, so the proxy waits and resends
 * only the busy members, up to MAX_ROUNDS times, and merges the answers back
 * into the batch under their ids. The model never sees a `chain_busy` unless
 * the server stays busy for every round.
 */

const BUSY_CODE = 'chain_busy'
export const BUSY_WAIT_MS = 1_100
export const MAX_ROUNDS = 3

type Member = Record<string, unknown>
type Query = { id?: string; query: string }

export type BatchResult = {
  content?: unknown[]
  structuredContent?: unknown
  isError?: boolean
  _meta?: unknown
}

type CallBatch = (args: Record<string, unknown>) => Promise<BatchResult>
type Sleep = (ms: number) => Promise<void>

const defaultSleep: Sleep = (ms) => new Promise((done) => setTimeout(done, ms))

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function membersOf(result: BatchResult): Member[] | null {
  const facts = isRecord(result.structuredContent) ? result.structuredContent.facts : undefined
  const queries = isRecord(facts) ? facts.queries : undefined
  return Array.isArray(queries) && queries.every(isRecord) ? (queries as Member[]) : null
}

export function isBusyMember(member: Member): boolean {
  const detail = member.error_detail
  return isRecord(detail) && detail.code === BUSY_CODE
}

/** The ids of the members the server refused as chain_busy. */
export function busyMemberIds(result: BatchResult): string[] {
  const members = membersOf(result)
  if (!members) return []
  return members.filter(isBusyMember).map((m) => String(m.id))
}

function recount(batch: Record<string, unknown>, members: Member[]): Record<string, unknown> {
  const completed = members.filter((m) => m.ok === true).length
  const billable = members.reduce(
    (sum, m) => sum + (typeof m.billable_units === 'number' ? m.billable_units : 0),
    0
  )
  return { ...batch, completed, failed: members.length - completed, billable_units: billable }
}

/**
 * Replaces the busy members of `first` with the answers `again` carries for
 * the same ids, and recounts the batch envelope. The text block is rebuilt
 * from the structured content so the two never disagree.
 */
export function mergeBatchAnswers(first: BatchResult, again: BatchResult): BatchResult {
  const members = membersOf(first)
  const fresh = membersOf(again)
  if (!members || !fresh) return first
  const byId = new Map(fresh.map((m) => [String(m.id), m]))
  const merged = members.map((m) => (isBusyMember(m) && byId.has(String(m.id)) ? byId.get(String(m.id))! : m))
  const structured = first.structuredContent as Record<string, unknown>
  const facts = structured.facts as Record<string, unknown>
  const batch = isRecord(facts.batch) ? recount(facts.batch, merged) : facts.batch
  const nextStructured = { ...structured, facts: { ...facts, queries: merged, batch } }
  return {
    ...first,
    structuredContent: nextStructured,
    content: [{ type: 'text', text: JSON.stringify(nextStructured) }],
    isError: merged.some((m) => m.ok !== true) ? first.isError : false,
  }
}

/**
 * Runs the batch, then resends only its chain_busy members after a short wait,
 * up to MAX_ROUNDS times, merging each answer back under its id.
 */
export async function withBusyMemberRetry(
  args: Record<string, unknown>,
  call: CallBatch,
  sleep: Sleep = defaultSleep
): Promise<BatchResult> {
  let result = await call(args)
  const queries = Array.isArray(args.queries) ? (args.queries as Query[]) : []
  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const busy = new Set(busyMemberIds(result))
    if (busy.size === 0) break
    const resend = queries.filter((q, index) => busy.has(String(q.id ?? `q${index + 1}`)))
    if (resend.length === 0) break
    await sleep(BUSY_WAIT_MS)
    const again = await call({ ...args, queries: resend })
    result = mergeBatchAnswers(result, again)
  }
  return result
}

/** A single graph_query refused as chain_busy: an error result whose text starts with the code. */
export function isBusyResult(result: BatchResult): boolean {
  if (!result.isError) return false
  const first = Array.isArray(result.content) ? result.content[0] : undefined
  const text = isRecord(first) && typeof first.text === 'string' ? first.text : ''
  return /^(Query execution failed: )?chain_busy\b/.test(text.trim())
}

/**
 * Runs a single graph_query and, when the server refuses it as chain_busy,
 * waits and sends it again, up to MAX_ROUNDS times. Seven of 100 loop rounds
 * on prompt set v2 showed a model giving up on the first such refusal.
 */
export async function withBusyRetry(
  args: Record<string, unknown>,
  call: CallBatch,
  sleep: Sleep = defaultSleep
): Promise<BatchResult> {
  let result = await call(args)
  for (let round = 0; round < MAX_ROUNDS && isBusyResult(result); round += 1) {
    await sleep(BUSY_WAIT_MS)
    result = await call(args)
  }
  return result
}
