// Shared coercion helpers for the operator `--param key=value` bag (DetectorParams).
// Every detector resolves its own config the same way: a per-network default
// table, then operator overrides layered on top, with unset/invalid values
// falling back to the default. Keeping the coercions here means one tested
// place for the string→number/list parsing every detector needs.
import type { DetectorParams } from './runtime.js'

// numParam reads a non-negative number; a missing or malformed value yields the
// fallback (an operator typo never silently zeroes a threshold).
export function numParam(params: DetectorParams, key: string, fallback: number): number {
  const raw = params[key]
  if (raw === undefined) return fallback
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? n : fallback
}

// strParam reads a trimmed non-empty string, else the fallback.
export function strParam(params: DetectorParams, key: string, fallback: string): string {
  const raw = params[key]
  const trimmed = raw?.trim()
  return trimmed ? trimmed : fallback
}

// listParam reads a comma-separated, lowercased, de-blanked list, else the
// fallback list.
export function listParam(params: DetectorParams, key: string, fallback: string[]): string[] {
  const raw = params[key]
  if (raw === undefined) return fallback
  const items = raw
    .split(',')
    .map((k) => k.trim().toLowerCase())
    .filter(Boolean)
  return items.length > 0 ? items : fallback
}
