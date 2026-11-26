/**
 * The role word the graph may write beside today's marks, and that no answer
 * shows yet (agent name: held role word).
 *
 * The graph may write `Malicious` as a node label, in the node's `labels` list
 * and in `label_risk_labels`, beside the marks `Scam`, `Poisoned`,
 * `Sanctioned`, `OnMoneyTrail` and `Victim` it writes today. Every answer that
 * passes these lists on drops it, so the answer reads as it does on a graph
 * that holds only today's marks.
 */
export const HELD_ROLE_WORD = 'Malicious'

/** True for the held role word, in any case and with spaces around it. */
export function isHeldRoleWord(value: string): boolean {
  return value.trim().toLowerCase() === HELD_ROLE_WORD.toLowerCase()
}

/** The list without the held role word. */
export function withoutHeldRoleWord(values: readonly string[]): string[] {
  return values.filter((value) => !isHeldRoleWord(value))
}
