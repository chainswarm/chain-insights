/**
 * The behaviour kind of a busy account, and its operator group.
 *
 * The labels layer writes two properties on `:Address`:
 *
 *   behaviour_kind   how a busy account behaves, from a rule over one week of
 *                    its own on-chain counts: an account with 200 or more
 *                    payers plus receivers in the week that no other label
 *                    names. Absent on every other address, and withdrawn when
 *                    the account goes quiet.
 *   behaviour_group  `<behaviour_kind>:<first payer address>`: the accounts of
 *                    one kind whose first ever payer is the same address, 3 or
 *                    more of them. Absent when the account is in no group.
 *
 * A behaviour kind is a fact about how the account behaves, counted by a rule.
 * It is not a risk, not an accusation and not a model's guess: it gives no
 * node label, no word in `labels`, no flag, no claim and no risk level.
 *
 * Neither property is indexed and neither is a mark, so the graph server reads
 * them only beside an anchor: one address, or the first payer of a group.
 *
 * Claude Desktop chat loads no skill and calls no meta_rules, so the
 * graph_query description carries the words below; the cypher skill repeats
 * them (tests/behaviour-kinds.test.ts).
 */

export type BehaviourKind = {
  /** The value the labels layer writes into `behaviour_kind`. */
  readonly value: string
  /** What the kind means, in words the user reads. No code, no property name. */
  readonly plain: string
}

export const BEHAVIOUR_KINDS: readonly BehaviourKind[] = Object.freeze([
  {
    value: 'SWAP_BOT_FARM_WALLET',
    plain:
      'one wallet of a swap-bot farm: takes funds from hundreds of brand-new wallets, swaps through a router, pays hundreds of other brand-new wallets',
  },
  {
    value: 'DEX_TRADER_BOT',
    plain:
      'an automated trader: most of its transfers touch pools or routers and it swaps hundreds of times a week',
  },
  {
    value: 'VOLUME_RING_HUB',
    plain: 'the hub of a volume ring: pays a standing set of its own wallets, which pay it back',
  },
  {
    value: 'WALLET_FARM_CONTROLLER',
    plain: 'funds hundreds of brand-new wallets in a burst and sweeps them back',
  },
  {
    value: 'FIXED_AMOUNT_DISTRIBUTOR',
    plain: 'pays one fixed amount to hundreds of wallets that never pay back',
  },
  {
    value: 'MIXER_LOOP_HUB',
    plain:
      'collects from wallets that withdrew from a mixer and pays wallets that deposit into one',
  },
  {
    value: 'PAYOUT_DESK',
    plain:
      'payers and receivers are different people, active almost every hour of the week: the shape of a payment desk',
  },
])

/** The rule every host follows, word for word in the graph_query description and in the skill. */
export const BEHAVIOUR_RULE =
  'A behaviour kind describes automation or volume, it is not a risk signal by itself; say so, and never present it as an accusation.'

/** The node properties, in the order a read returns them. */
export const BEHAVIOUR_PROPERTIES = ['behaviour_kind', 'behaviour_group'] as const

function kindGloss(): string {
  return BEHAVIOUR_KINDS.map((kind) => `${kind.value} (${kind.plain})`).join('; ')
}

/**
 * The one paragraph of the graph_query description: what the two properties
 * hold, each kind in plain words, how to read them and how to say them.
 */
export const GRAPH_QUERY_BEHAVIOUR_SENTENCE = [
  "behaviour_kind on an :Address says how a busy account behaves: a rule over one week of its own on-chain counts, for an account with 200 or more payers plus receivers in the week that no other label names. It is absent on every other address and goes when the account goes quiet. It is a counted fact, not a model's guess: never call it inferred.",
  `Its values: ${kindGloss()}.`,
  "behaviour_group is <behaviour_kind>:<first payer address>: 3 or more accounts of one kind whose first ever payer is that address, one operator's wallets. It is absent when the account is in no group. When that first payer is an exchange wallet, a :Pool or a :Protocol contract, the group is the accounts it funded first, not one operator: say that.",
  'Neither is a mark or a word in labels, so read them anchored on the full address: USE topology MATCH (a:Address {address: $addr}) RETURN a.address AS address, a.behaviour_kind AS behaviour_kind, a.behaviour_group AS behaviour_group LIMIT 1. Read the members of a group anchored on its first payer, never with a WHERE on behaviour_kind or behaviour_group alone.',
  `${BEHAVIOUR_RULE} MIXER_LOOP_HUB is a pattern of payments around a mixer, not proof of laundering. Say the kind in its plain words, never the constant alone.`,
].join(' ')

/** The served hint line (the server instructions of hosts that read them). */
export const BEHAVIOUR_HINT = `- ${GRAPH_QUERY_BEHAVIOUR_SENTENCE}`

/** The note meta_schema adds when the lane serves behaviour_kind. */
export const BEHAVIOUR_SCHEMA_NOTE =
  `behaviour_kind on an :Address is how a busy account behaves, counted by a rule over one week: ${BEHAVIOUR_KINDS.map((kind) => kind.value).join(', ')}. ` +
  'behaviour_group is <behaviour_kind>:<first payer address>, 3 or more accounts of one kind with the same first payer. ' +
  `Read both anchored on an address. ${BEHAVIOUR_RULE}`
