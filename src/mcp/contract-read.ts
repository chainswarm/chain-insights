/**
 * The Contract read of the facts layer: what one contract is, and what its
 * code lets its owner do, by its address.
 *
 *   USE facts MATCH (c:Contract {address: "0x…"}) RETURN c.capabilities, …
 *
 * No tool of its own: `graph_query` and `graph_query_batch` carry it. This file
 * is the one source of what the package says about the read. Three places
 * teach it: the `graph_query` and `graph_query_batch` descriptions and the
 * graph hints of the MCP proxy (src/mcp/proxy.ts), the `chain-insights-cypher`
 * skill and docs/graph-tools.md. A host that loads no skill (Claude Desktop
 * chat) reads only the tool description, so the rule of the read rides on it.
 * tests/contract-read.test.ts holds the three to this file, and the read
 * itself to the words of the graph server.
 */

/** The address of the examples: USDG on robinhood, a proxy. */
export const CONTRACT_READ_ADDRESS = '0x5fc5360d0400a0fd4f2af552add042d716f1d168'

/** The nine properties the read serves, in the server's order. The first five lists arrive as JSON lists of strings. */
export const CONTRACT_READ_PROPERTIES = [
  'contract_address',
  'capabilities',
  'observed',
  'standards',
  'roles',
  'listings',
  'implementation_address',
  'beacon_address',
  'created_block',
] as const

/** The properties that arrive as lists of words. An empty list is `[]`. */
export const CONTRACT_READ_LISTS = [
  'capabilities',
  'observed',
  'standards',
  'roles',
  'listings',
] as const

/** What the code lets its owner do. */
export const CONTRACT_CAPABILITY_WORDS = [
  'owner_mint',
  'blacklist',
  'pause',
  'fee_set',
  'max_tx_set',
  'upgradeable',
  'self_destruct',
  'owner_withdraw',
  'trading_switch',
  'self_destruct_unproven',
] as const

/** What the chain shows the contract did. */
export const CONTRACT_OBSERVED_WORDS = [
  'owner_minted',
  'issuer_froze',
  'taxed_transfer',
  'traded_as_pool',
] as const

/** The words of `listings`. */
export const CONTRACT_LISTING_WORDS = [
  'dex_venue',
  'bridge',
  'bridge_token',
  'mixer',
  'smart_account',
] as const

/** The read in full, with every property it serves. The server gives the same text as the example of a refusal. */
export const CONTRACT_READ_EXAMPLE =
  `USE facts MATCH (c:Contract {address: "${CONTRACT_READ_ADDRESS}"}) RETURN c.contract_address AS contract, c.capabilities AS capabilities, ` +
  'c.observed AS observed, c.standards AS standards, c.roles AS roles, c.listings AS listings, ' +
  'c.implementation_address AS implementation, c.beacon_address AS beacon, c.created_block AS created_block'

/** The short read of the tool text. The server's own description shows the same one. */
export const CONTRACT_READ_SHORT = `USE facts MATCH (c:Contract {address: "${CONTRACT_READ_ADDRESS}"}) RETURN c.capabilities AS capabilities, c.observed AS observed, c.implementation_address AS implementation`

/** What the read answers, in the server's words. */
export const CONTRACT_READ_MEANING =
  'capabilities is what the code lets its owner do, observed is what was seen on the chain, and zero rows means the contract is not classified yet, never that it is safe; it states what the bytecode allows and is never a verdict'

/** The plain words of the three capabilities an answer names first. A column name or a capability word is never printed. */
export const CONTRACT_PLAIN_WORDS =
  'owner_mint: the owner can create new tokens. blacklist: the owner can block an address from moving the token. upgradeable: the code behind the address can be replaced.'

/**
 * The one sentence of the `graph_query` and `graph_query_batch` descriptions.
 * It carries the routing rule, the read, the meaning of can against did, zero
 * rows and the answer rule, so a host that loads no skill follows them too.
 */
export const GRAPH_QUERY_CONTRACT_READ_SENTENCE =
  `"What is this contract" and "what can its owner do", for one contract address, is a USE facts Contract read: ${CONTRACT_READ_SHORT}. ` +
  `It ${CONTRACT_READ_MEANING.replace(/^capabilities is/, 'answers one row: capabilities is')}. ` +
  'The address is the only key: no WHERE, no search by capability, role or implementation. ' +
  `Say it in plain words, never the word itself and never "scam", "rug pull", "safe" or a score: ${CONTRACT_PLAIN_WORDS}`

/** The graph hint of the read: its key, its properties, its words and how to answer from them. */
export const CONTRACT_READ_HINT =
  `- One contract by its address on USE facts, with a RETURN of c.<property> items: ${CONTRACT_READ_EXAMPLE}. ` +
  'One node, no relationship, no day, no WHERE and no $parameter; the address is a 42-character literal in either case, and LIMIT is optional and only 1. One row or none. ' +
  `Properties: ${CONTRACT_READ_PROPERTIES.join(', ')}. ${CONTRACT_READ_LISTS.join(', ')} are lists of words, [] when empty. ` +
  `capabilities is what the code lets its owner do: ${CONTRACT_CAPABILITY_WORDS.join(', ')}. For a proxy it already holds what the implementation allows. ` +
  "observed is what the chain shows happened: owner_minted (the contract's creator minted new supply after its creation day), issuer_froze (the issuer froze or wiped a holder), taxed_transfer (the token is proven as taxed from its transfers), traded_as_pool (the contract is the pool of a trade). " +
  `standards holds words such as erc20, erc4626 and eip1967_proxy, roles words such as pair_pool, vault and router, listings ${CONTRACT_LISTING_WORDS.join(', ')}. ` +
  'Can is not did: a capability says the code allows it, an observed word says it happened. Zero rows means the contract is not classified yet, never that it has no capability and never that it is safe. ' +
  'Any other form is refused with facts_no_anchor, and its example is the read above: the address is the only key. Each word of a list is one billed element. ' +
  `Answer with what the bytecode allows, in plain words, never a verdict: no "scam", "rug pull", "safe" or score from these words, and upgradeable is a capability like every other. ${CONTRACT_PLAIN_WORDS}`
