/**
 * The judgement marks of the graph and the claims lists beside them.
 *
 * The labels layer marks an address with a node label (`:Scam`, `:Victim`,
 * `:Poisoned`, `:Targeted`, `:OnMoneyTrail`, `:Sanctioned`) and writes why in
 * a sorted list on the node: `risk_claims`, `protection_claims`,
 * `traced_claims`, and `suspect_labels` for a warning or a record that accuses
 * nobody (a mixer user, a token that copies a listed token's name). The codes
 * in those lists are for the query. The answer says what they mean in plain
 * words.
 *
 * `FAKE_TOKEN` sits in two lists. In `risk_claims`, beside `:Scam`, it is a
 * fake token with a proven act: it was sent to holders of the real token, or
 * used as poisoning bait. In `suspect_labels`, with no mark, it is a copied
 * name and nothing more. A fake-token list asks both.
 *
 * Claude Desktop chat loads no skill and calls no meta_rules, so the
 * graph_query description carries the vocabulary below.
 */

export type ClaimsProperty =
  'risk_claims' | 'protection_claims' | 'traced_claims' | 'suspect_labels'

export type JudgementClaim = {
  /** The value code the labels layer writes into the list. */
  readonly value: string
  readonly property: ClaimsProperty
  /** The node label that stands beside the value, or null when no mark does. */
  readonly mark: string | null
  /** What the value means, in words the user reads. No code, no property name. */
  readonly plain: string
}

export const JUDGEMENT_CLAIMS: readonly JudgementClaim[] = Object.freeze([
  {
    value: 'FAKE_TOKEN',
    property: 'risk_claims',
    mark: 'Scam',
    plain:
      'a fake-token scam: a token that copies a listed token and was sent to holders of the real token, or used as poisoning bait',
  },
  {
    value: 'FAKE_TOKEN_DEPLOYER',
    property: 'risk_claims',
    mark: 'Scam',
    plain: 'the sender of the transaction that created a fake-token scam, even through a factory',
  },
  {
    value: 'FAKE_TOKEN_LP',
    property: 'risk_claims',
    mark: 'Scam',
    plain:
      "the wallet that seeded a fake token's pool and pulled its liquidity after the buyers paid",
  },
  {
    value: 'ADDRESS_POISONING',
    property: 'risk_claims',
    mark: 'Poisoned',
    plain:
      'a poisoner: a look-alike address that sent worthless dust so the target copies it from its history',
  },
  {
    value: 'INBOUND_IMPERSONATION',
    property: 'risk_claims',
    mark: 'Scam',
    plain: 'a look-alike address that paid the target to get into its history',
  },
  {
    value: 'PHANTOM_TRANSFER',
    property: 'risk_claims',
    mark: 'Scam',
    plain:
      'a contract that writes fake transfer events, claiming a transfer from a look-alike that never happened',
  },
  {
    value: 'PHANTOM_TRANSFER_EMITTER',
    property: 'risk_claims',
    mark: 'Scam',
    plain:
      'a contract that writes fake transfer events, claiming a transfer from a look-alike that never happened',
  },
  {
    value: 'PHANTOM_ENTRYPOINT',
    property: 'risk_claims',
    mark: 'Scam',
    plain:
      'a contract that writes fake transfer events, claiming a transfer from a look-alike that never happened',
  },
  {
    value: 'SWEEPER_DELEGATE',
    property: 'risk_claims',
    mark: 'Scam',
    plain: 'a sweeper: an EIP-7702 delegate that empties the accounts that delegate to it',
  },
  {
    value: 'SWEEP_BENEFICIARY',
    property: 'risk_claims',
    mark: 'Scam',
    plain: 'where a sweeper sends the funds it takes',
  },
  {
    value: 'UNSAFE_DELEGATE',
    property: 'risk_claims',
    mark: 'Scam',
    plain: 'an unsafe delegate: any caller can use it to empty the account',
  },
  {
    value: 'APPROVAL_DRAINER',
    property: 'risk_claims',
    mark: 'Scam',
    plain:
      "an approval drainer: a spender that moved at least three owners' tokens with their approval or Permit2 within 72 hours of the grant, and paid nothing back",
  },
  {
    value: 'APPROVAL_DRAIN_BENEFICIARY',
    property: 'risk_claims',
    mark: 'Scam',
    plain: "the receiver of an approval drainer's takings",
  },
  {
    value: 'SANCTIONED',
    property: 'risk_claims',
    mark: 'Sanctioned',
    plain: 'on a sanctions list',
  },
  {
    value: 'VICTIM',
    property: 'protection_claims',
    mark: 'Victim',
    plain:
      'a victim: it lost money to a scam the evidence walk traced, because it paid the accused, was swept, or was drained after the attempt',
  },
  {
    value: 'ADDRESS_POISONING_TARGET',
    property: 'protection_claims',
    mark: 'Targeted',
    plain: 'a poisoning target: the walk has not proven it lost money, so it is no victim',
  },
  {
    value: 'LAUNDERED',
    property: 'traced_claims',
    mark: 'OnMoneyTrail',
    plain: "it received the accused's money along the walk and moved it on",
  },
  {
    value: 'RECEIVED',
    property: 'traced_claims',
    mark: 'OnMoneyTrail',
    plain: 'it received that money and still holds it; it becomes laundered when it forwards it',
  },
  {
    value: 'FUNDER',
    property: 'traced_claims',
    mark: 'OnMoneyTrail',
    plain: 'it funded the accused address',
  },
  {
    value: 'MIXED',
    property: 'traced_claims',
    mark: 'OnMoneyTrail',
    plain: 'it received that money and paid it into a mixer pool, where the walk ends',
  },
  {
    value: 'FAKE_TOKEN',
    property: 'suspect_labels',
    mark: null,
    plain:
      'a copied name: a token that copies the name of a listed token, a record that accuses nobody and is no scam',
  },
  {
    value: 'MIXER_DEPOSITOR',
    property: 'suspect_labels',
    mark: null,
    plain: 'it put money into a mixer pool, a warning and not a theft',
  },
  {
    value: 'MIXER_WITHDRAWER',
    property: 'suspect_labels',
    mark: null,
    plain: 'it took money out of a mixer pool, a warning and not a theft',
  },
])

/** The example answer phrases the rule shows. They hold no code and no property name. */
export const JUDGEMENT_ANSWER_EXAMPLES = Object.freeze([
  'a fake-token scam',
  'it lost money to a scam',
  'a look-alike address that sent worthless dust',
])

function gloss(property: ClaimsProperty): string {
  const seen = new Set<string>()
  const parts: string[] = []
  for (const claim of JUDGEMENT_CLAIMS.filter((c) => c.property === property)) {
    const sameAsLast = parts.length > 0 && seen.has(claim.plain)
    seen.add(claim.plain)
    if (sameAsLast) {
      parts[parts.length - 1] = parts[parts.length - 1]!.replace(/ \(/, `, ${claim.value} (`)
      continue
    }
    parts.push(`${claim.value} (${claim.plain})`)
  }
  return parts.join('; ')
}

/**
 * The one paragraph of the graph_query description: where a judgement sits,
 * how to ask for it, and that the answer says it in plain words.
 */
export const GRAPH_QUERY_JUDGEMENT_MARKS_SENTENCE = [
  'A risk question (is this a scam, a fake token, a poisoner, a drainer, a sweeper, a victim, on a laundering trail) is answered from the judgement marks and the claims list beside each, never volunteered on a flow question.',
  ':Scam, :Poisoned and :Sanctioned carry risk_claims, :Victim and :Targeted protection_claims, :OnMoneyTrail traced_claims, and a warning or a record that accuses nobody suspect_labels, with no mark.',
  'FAKE_TOKEN on :Scam, in risk_claims, is a fake token with a proven act: it was sent to holders of the real token, or used as poisoning bait. FAKE_TOKEN in suspect_labels is a copied name: it accuses nobody, has no :Scam and no is_scam, and is never called a scam.',
  'Ask by mark (fake-token scams: USE topology MATCH (a:Scam) WHERE \"FAKE_TOKEN\" IN a.risk_claims RETURN a.address AS address, a.risk_claims AS risk_claims LIMIT 25), or anchor on the full address.',
  'A fake-token list asks both lists and keeps them apart: the scams above, then the copied names (USE topology MATCH (a:Token) WHERE \"FAKE_TOKEN\" IN a.suspect_labels RETURN a.address AS address, a.suspect_labels AS suspect_labels LIMIT 25). The mark is the anchor, and a WHERE on its own properties is allowed; a WHERE with no mark and no address is refused.',
  `risk_claims: ${gloss('risk_claims')}.`,
  `protection_claims: ${gloss('protection_claims')}. Receiving a fake token or dust never makes a victim.`,
  `traced_claims: ${gloss('traced_claims')}.`,
  `suspect_labels: ${gloss('suspect_labels')}.`,
  'The graph holds no link from an accused address to its victims: answer per address.',
  `Say what a claim means in plain words, such as "${JUDGEMENT_ANSWER_EXAMPLES[0]}" or "${JUDGEMENT_ANSWER_EXAMPLES[1]}", never the list name or the code.`,
].join(' ')
