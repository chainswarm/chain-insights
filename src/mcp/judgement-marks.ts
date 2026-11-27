/**
 * The judgement marks of the graph and the claims lists beside them.
 *
 * The labels layer marks an address with a node label (`:Malicious`,
 * `:Victim`) and a flag (`is_malicious`, `is_victim`), and writes why in a
 * sorted list on the node: `malicious_claims`, `victim_claims`, and
 * `suspect_labels` for a warning or a record that accuses nobody (a mixer
 * withdrawal, a token that copies a listed token's name). Every judged address
 * also carries `categories` (malicious, suspect, victim) and
 * `case_judgements`, one `category|type|role|case` entry per case: a sanctions
 * listing is a malicious case of type `sanctioned`, and a mule (role `mule`)
 * carries a case and no claim. This is the card of card_version 4, the one the
 * served graph holds. The codes in those lists are for the query. The answer
 * says what they mean in plain words.
 *
 * `FAKE_TOKEN` sits in two lists. In `malicious_claims`, beside `:Malicious`,
 * it is a fake token with a proven act: it was sent to holders of the real
 * token, or used as poisoning bait. In `suspect_labels`, with no mark, it is a
 * copied name and nothing more. A fake-token list asks both.
 *
 * An older card (card_version below 4) wrote other marks and lists; the tools
 * still read it (card-marks.ts), and the description names it in one fallback
 * sentence only.
 *
 * Claude Desktop chat loads no skill and calls no meta_rules, so the
 * graph_query description carries the vocabulary below.
 */

export type ClaimsProperty = 'malicious_claims' | 'victim_claims' | 'suspect_labels'

export type JudgementClaim = {
  /** The value code the labels layer writes into the list. */
  readonly value: string
  readonly property: ClaimsProperty
  /** The node label that stands beside the value, or null when no mark does. */
  readonly mark: 'Malicious' | 'Victim' | null
  /** What the value means, in words the user reads. No code, no property name. */
  readonly plain: string
}

const PHANTOM =
  'a contract that writes fake transfer events, claiming a transfer that never happened'

/** The claims of a card of card_version 4, the card the served graph holds. */
export const JUDGEMENT_CLAIMS: readonly JudgementClaim[] = Object.freeze([
  {
    value: 'FAKE_TOKEN',
    property: 'malicious_claims',
    mark: 'Malicious',
    plain:
      'a fake-token scam: a token that copies a listed token and was sent to holders of the real token, or used as poisoning bait',
  },
  {
    value: 'FAKE_TOKEN_DEPLOYER',
    property: 'malicious_claims',
    mark: 'Malicious',
    plain: 'the sender of the transaction that created a fake-token scam, even through a factory',
  },
  {
    value: 'FAKE_TOKEN_LP',
    property: 'malicious_claims',
    mark: 'Malicious',
    plain:
      "the wallet that seeded a fake token's pool and pulled its liquidity after the buyers paid",
  },
  {
    value: 'FAKE_TOKEN_MASS_SENDER',
    property: 'malicious_claims',
    mark: 'Malicious',
    plain: 'the signer of the transactions that sent a fake token to many wallets',
  },
  {
    value: 'ADDRESS_POISONING',
    property: 'malicious_claims',
    mark: 'Malicious',
    plain:
      'a poisoner: a look-alike address that sent worthless dust so the target copies it from its history',
  },
  {
    value: 'INBOUND_IMPERSONATION',
    property: 'malicious_claims',
    mark: 'Malicious',
    plain: 'a look-alike address that paid the target to get into its history',
  },
  { value: 'PHANTOM_TRANSFER', property: 'malicious_claims', mark: 'Malicious', plain: PHANTOM },
  {
    value: 'PHANTOM_TRANSFER_EMITTER',
    property: 'malicious_claims',
    mark: 'Malicious',
    plain: PHANTOM,
  },
  { value: 'PHANTOM_ENTRYPOINT', property: 'malicious_claims', mark: 'Malicious', plain: PHANTOM },
  {
    value: 'SWEEPER_DELEGATE',
    property: 'malicious_claims',
    mark: 'Malicious',
    plain: 'a sweeper: an EIP-7702 delegate that empties the accounts that delegate to it',
  },
  {
    value: 'SWEEP_BENEFICIARY',
    property: 'malicious_claims',
    mark: 'Malicious',
    plain: 'where a sweeper sends the funds it takes',
  },
  {
    value: 'APPROVAL_DRAINER',
    property: 'malicious_claims',
    mark: 'Malicious',
    plain:
      "an approval drainer: a spender that moved at least three owners' tokens with their approval or Permit2 within 72 hours of the grant, and paid nothing back",
  },
  {
    value: 'VICTIM',
    property: 'victim_claims',
    mark: 'Victim',
    plain:
      'a victim: it lost money to a scam the evidence walk traced, because it paid the accused, was swept, or was drained after the attempt',
  },
  {
    value: 'FAKE_TOKEN',
    property: 'suspect_labels',
    mark: null,
    plain:
      'a copied name: a token that copies the name of a listed token, a record that accuses nobody and is no scam',
  },
  {
    value: 'FAKE_TOKEN_LP',
    property: 'suspect_labels',
    mark: null,
    plain:
      'it opened a pool for a copied-name token, and no buyer is proven to have lost money there',
  },
  {
    value: 'MIXER_WITHDRAWER',
    property: 'suspect_labels',
    mark: null,
    plain: 'it took money out of a mixer pool, a warning and not a theft',
  },
])

/** The case_judgements prefix of a sanctions listing. */
export const SANCTIONED_CASE_PREFIX = 'malicious|sanctioned|'

/** The marks and lists of an older card, which the served graph no longer holds. */
export const OLDER_CARD_MARKS = Object.freeze([':Scam', ':Poisoned', ':Sanctioned', ':Targeted', ':OnMoneyTrail'])
export const OLDER_CARD_LISTS = Object.freeze(['risk_claims', 'protection_claims', 'traced_claims'])

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
 * The fallback for an older card: one sentence, after the marks the graph
 * serves.
 */
export const OLDER_CARD_SENTENCE =
  'An older card (card_version below 4) wrote :Scam (is_scam), :Poisoned and :Sanctioned (is_sanctioned) with risk_claims, :Victim and :Targeted with protection_claims, and :OnMoneyTrail with traced_claims; the served graph holds none of them, so never ask by them.'

/**
 * The one paragraph of the graph_query description: where a judgement sits,
 * how to ask for it, and that the answer says it in plain words.
 */
export const GRAPH_QUERY_JUDGEMENT_MARKS_SENTENCE = [
  'A risk question (is this a scam, a fake token, a poisoner, a drainer, a sweeper, a victim, sanctioned, on a laundering trail) is answered from the judgement marks and the claims list beside each, never volunteered on a flow question.',
  ':Malicious (is_malicious) carries malicious_claims, :Victim (is_victim) victim_claims, and a warning or a record that accuses nobody suspect_labels, with no mark.',
  'Every judged address also carries categories (malicious, suspect, victim) and case_judgements, one category|type|role|case entry per case. The type is the kind of malicious case: fake-token, poisoning, inbound-impersonation, phantom-transfer, permission-abuse, approval-drainer or sanctioned. The role is what the address did in it, such as scammer, deployer or mule. A mule received the accused\'s money along the walk: it holds it, moved it on or paid it into a mixer pool, and carries no claim, only its case. A suspect case accuses nobody.',
  'FAKE_TOKEN on :Malicious, in malicious_claims, is a fake token with a proven act: it was sent to holders of the real token, or used as poisoning bait. FAKE_TOKEN in suspect_labels is a copied name: it accuses nobody, has no :Malicious and no is_malicious, and is never called a scam.',
  'Ask by mark (fake-token scams: USE topology MATCH (a:Malicious) WHERE \"FAKE_TOKEN\" IN a.malicious_claims RETURN a.address AS address, a.malicious_claims AS malicious_claims LIMIT 25. Sanctioned addresses: USE topology MATCH (a:Malicious) WHERE any(j IN a.case_judgements WHERE j STARTS WITH \"' + SANCTIONED_CASE_PREFIX + '\") RETURN a.address AS address, a.malicious_claims AS malicious_claims LIMIT 25), or anchor on the full address.',
  'A fake-token list asks both lists and keeps them apart: the scams above, then the copied names (USE topology MATCH (a:Token) WHERE \"FAKE_TOKEN\" IN a.suspect_labels RETURN a.address AS address, a.suspect_labels AS suspect_labels LIMIT 25). The mark is the anchor, and a WHERE on its own properties is allowed; a WHERE with no mark and no address is refused.',
  `malicious_claims: ${gloss('malicious_claims')}. On a sanctioned address it holds the name of the listed entity, not a code.`,
  `victim_claims: ${gloss('victim_claims')}. Receiving a fake token or dust never makes a victim.`,
  `suspect_labels: ${gloss('suspect_labels')}.`,
  'The graph holds no link from an accused address to its victims: answer per address.',
  `Say what a claim means in plain words, such as "${JUDGEMENT_ANSWER_EXAMPLES[0]}" or "${JUDGEMENT_ANSWER_EXAMPLES[1]}", never the list name or the code.`,
  OLDER_CARD_SENTENCE,
].join(' ')
