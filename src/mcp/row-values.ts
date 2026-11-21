/**
 * The values of one graph answer row, read the same way by every risk tool:
 * a list of words, a number, a text, a full address, an epoch time as UTC
 * text, and the rows and refusal of one batch member. Pure: no read.
 */

import { isEpochMs, utcText } from './timestamp-text.js'
import { refusalOf, type Member } from './token-lookup.js'

const ADDRESS_INPUT = /^0x[0-9a-fA-F]{40}$/

/** The refusal codes a member's text may name anywhere in it. */
const NAMED_CODE = /\b(query_timeout|family_behind|anchor_missing)\b/

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/** The non-empty strings of a list, trimmed; [] for anything else. */
export const strings = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((v): v is string => typeof v === 'string' && v.trim() !== '').map((v) => v.trim())
    : []

/** A finite number, or a text that holds one; null for anything else. */
export const numberOrNull = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)))
    return Number(value)
  return null
}

export const textOrNull = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : null

/** A full 0x address in lowercase, or null. */
export const addressOrNull = (value: unknown): string | null =>
  typeof value === 'string' && ADDRESS_INPUT.test(value.trim()) ? value.trim().toLowerCase() : null

/** The UTC text of an epoch-millisecond time, or null. */
export const utcOrNull = (value: unknown): string | null => {
  const ms = numberOrNull(value)
  return isEpochMs(ms) ? utcText(ms) : null
}

export const memberAnswered = (member: Member | undefined): boolean =>
  member?.ok === true && Array.isArray(member.results)

export const memberRows = (member: Member | undefined): Array<Record<string, unknown>> =>
  memberAnswered(member) ? (member!.results as unknown[]).filter(isRecord) : []

/** Why a member did not answer: its code, as a refusal names it, and its text. */
export function memberRefusal(id: string, member: Member | undefined): { code: string; reason: string } {
  if (!member) return { code: 'not_answered', reason: `the ${id} read is missing from the batch answer` }
  const text = typeof member.error === 'string' ? member.error.trim() : ''
  if (text === '') return { code: 'not_answered', reason: `the ${id} read did not answer` }
  const refusal = refusalOf({ content: [{ type: 'text', text }] })
  // A member's text may name its code after a prefix ("read failed: query_timeout ..."):
  // the code it names wins over not_served.
  const named = refusal.code === 'not_served' ? NAMED_CODE.exec(text)?.[1] : undefined
  return { code: named ?? refusal.code, reason: refusal.text }
}
