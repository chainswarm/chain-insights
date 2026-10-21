/**
 * An ETH text twin beside every native balance column of a chain answer.
 *
 * `USE chain` serves `balance` as wei in decimal text, exact and 16 to 22
 * digits long. A host without a shell (Claude Desktop, 2026-10-21) printed
 * `10003752747799400` to the user as the balance. A model that divides by
 * 10^18 by head misplaces the point, so the proxy writes `<column>_eth`
 * next to each one, the same way `<column>_utc` sits beside a timestamp.
 */

const BALANCE_KEY = /(^|_)balance$/
const WEI_TEXT = /^[0-9]{1,78}$/
const WEI_PER_ETH = 10n ** 18n

/** `0.0100037527477994` for `10003752747799400` wei: exact, no exponent, no trailing zeros. */
export function ethText(wei: string): string {
  const value = BigInt(wei)
  const whole = value / WEI_PER_ETH
  const frac = (value % WEI_PER_ETH).toString().padStart(18, '0').replace(/0+$/, '')
  return frac === '' ? whole.toString() : `${whole}.${frac}`
}

function isWeiText(value: unknown): value is string {
  return typeof value === 'string' && WEI_TEXT.test(value)
}

/**
 * One row with a `<key>_eth` string after every wei balance column that has
 * no twin yet. A column the model itself named `*_eth` (an alias such as
 * `a.balance_eth AS held_eth`, see stripEthProperties) arrives as wei and is
 * rendered as ETH text in place: the model gets the column it asked for.
 */
export function addBalanceText(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(row)) {
    out[key] = key.endsWith('_eth') && isWeiText(value) ? ethText(value) : value
    if (BALANCE_KEY.test(key) && isWeiText(value) && !(`${key}_eth` in row)) out[`${key}_eth`] = ethText(value)
  }
  return out
}

/**
 * The `_eth` twin is added by the proxy; it is no chain property. A query
 * that names `a.balance_eth` is rewritten to `a.balance`, so the row comes
 * back and the twin is written beside it. An alias after AS stays as written.
 */
export function stripEthProperties(query: string): string {
  return query.replace(/\.((?:[A-Za-z_][A-Za-z0-9_]*_)?balance)_eth\b/g, '.$1')
}
