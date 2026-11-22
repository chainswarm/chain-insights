// The pure part of the risk golden runner (scripts/risk-golden.mjs): what one
// answer of aml_address_risk or aml_token_risk says, and whether it meets the
// expect block of its golden case. No read, no network: the unit test
// tests/risk-golden-compare.test.ts holds it.

/** The three kinds of a golden set, and the tool each one asks. */
export const GOLDEN_KINDS = /** @type {const} */ (['address', 'pool', 'token'])

/** The fewest cases a set must hold before a run counts, by kind. */
export const DEFAULT_MIN = { address: 20, pool: 10, token: 20 }

/** The expect keys each kind may name; a key not listed here is a mistake in the data file. */
export const EXPECT_KEYS = {
  address: ['word', 'set_by', 'rules_word', 'model_word', 'reasons', 'kind'],
  pool: ['asked_as', 'word', 'set_by', 'is_manager', 'providers_min'],
  token: ['asked_as', 'word', 'set_by', 'raised_by', 'founder', 'factory_name', 'pools_found', 'pools_found_min'],
}

/**
 * The values one answer gives for the expect keys of its kind, and the rows
 * shown beside the result line: card risk, label kinds, model level and score.
 *
 * @param {'address' | 'pool' | 'token'} kind
 * @param {Record<string, any>} answer the structured answer of the tool
 */
export function valuesOf(kind, answer) {
  const risk = answer?.risk ?? {}
  if (kind === 'address') {
    return {
      word: risk.word ?? null,
      set_by: risk.set_by ?? null,
      rules_word: risk.rules_word ?? null,
      model_word: risk.model_word ?? null,
      reasons: (risk.reasons ?? []).map((reason) => reason.word),
      kind: answer?.kind ?? null,
      score: risk.score ?? null,
    }
  }
  const own = risk.own ?? {}
  const pool = (answer?.pools ?? [])[0] ?? null
  return {
    asked_as: answer?.asked_as ?? null,
    word: risk.word ?? null,
    set_by: risk.set_by ?? null,
    raised_by: risk.raised_by ?? null,
    founder: answer?.founder?.address ?? null,
    factory_name: answer?.factory?.name ?? null,
    pools_found: answer?.pools_found ?? null,
    is_manager: pool ? pool.is_manager : null,
    providers: pool ? pool.providers : null,
    rules_word: own.rules_word ?? null,
    model_word: own.model_word ?? null,
    reasons: (own.reasons ?? []).map((reason) => reason.word),
    score: own.score ?? null,
  }
}

/**
 * Compares one answer with the expect block of its case. Only the keys the
 * block names are compared: `reasons` passes when every listed word is among
 * the answer's reason words, a `*_min` key when the value is at least the
 * number, any other key when the value is equal (null included).
 *
 * @returns {{ ok: boolean, mismatches: Array<{ key: string, got: unknown, expected: unknown }> }}
 */
export function compareCase(kind, expect, answer) {
  const values = valuesOf(kind, answer)
  const mismatches = []
  for (const [key, expected] of Object.entries(expect ?? {})) {
    if (!EXPECT_KEYS[kind].includes(key)) {
      mismatches.push({ key, got: undefined, expected })
      continue
    }
    if (key === 'reasons') {
      const missing = (expected ?? []).filter((word) => !values.reasons.includes(word))
      if (missing.length > 0) mismatches.push({ key, got: values.reasons, expected })
      continue
    }
    if (key.endsWith('_min')) {
      const got = values[key.slice(0, -'_min'.length)]
      if (typeof got !== 'number' || got < expected) mismatches.push({ key, got, expected })
      continue
    }
    const got = values[key]
    if (got !== expected) mismatches.push({ key, got, expected })
  }
  return { ok: mismatches.length === 0, mismatches }
}

/**
 * The result line of one case: `ok|FAIL <address> word=<got> expected=<…> ms=<…>`.
 * `expected` is the expected word when the case names one, else the keys it
 * compares (`{asked_as:pool,is_manager:true}`), else `-`. A failed case adds
 * the keys that did not match, with what came back.
 */
export function resultLine(address, result, values, ms, expect = {}) {
  const keys = Object.entries(expect ?? {})
  const expected =
    'word' in (expect ?? {})
      ? String(expect.word)
      : keys.length
        ? `{${keys.map(([key, value]) => `${key}:${Array.isArray(value) ? value.join('|') : value}`).join(',')}}`
        : '-'
  const failed = result.mismatches.length
    ? ` failed=${result.mismatches.map(({ key, got }) => `${key}:${JSON.stringify(got)}`).join(',')}`
    : ''
  return `${result.ok ? 'ok' : 'FAIL'} ${address} word=${values.word} expected=${expected} ms=${ms}${failed}`
}

/** The rows read, shown under the result line. */
export function rowsLine(kind, values) {
  const base =
    `  card=${values.rules_word} reasons=${values.reasons.join('|') || '-'} ` +
    `model=${values.model_word} score=${values.score}`
  if (kind === 'address') return `${base} kind=${values.kind}`
  return (
    `${base} asked_as=${values.asked_as} founder=${values.founder} ` +
    `factory=${values.factory_name} pools_found=${values.pools_found}`
  )
}

/**
 * Why a data file cannot run, or null: an unknown kind, a case with no full
 * address, or an expect key its kind does not know.
 */
export function dataProblem(data, kind) {
  if (!GOLDEN_KINDS.includes(kind)) return `kind must be one of ${GOLDEN_KINDS.join(', ')}`
  if (typeof data?.network !== 'string' || data.network === '') return 'the data file names no network'
  const cases = data[kind]
  if (!Array.isArray(cases)) return `the data file has no "${kind}" list`
  for (const [index, entry] of cases.entries()) {
    if (typeof entry?.address !== 'string' || !/^0x[0-9a-f]{40}$/.test(entry.address)) {
      return `${kind}[${index}]: address is not a lowercase 0x address`
    }
    for (const key of Object.keys(entry.expect ?? {})) {
      if (!EXPECT_KEYS[kind].includes(key)) return `${kind}[${index}]: expect key ${key} is not one of ${kind}`
    }
  }
  return null
}
