import { readFileSync } from 'node:fs'
import { appendFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { ContentBlock, GetPromptResult } from '@modelcontextprotocol/sdk/types.js'
import * as z from 'zod'
import type { InvestigatorConfig } from '../config/schema.js'
import { PACKAGE_VERSION } from '../version.js'
import type { McpTool } from './schema-cache.js'
import { rateLimitedResult, withRateLimitRetry } from './rate-limit.js'
import {
  HIDDEN_REMOTE_TOOL_NAMES,
  PUBLIC_MCP_TOOL_ALLOWED_ARGS,
  PUBLIC_MCP_TOOL_REQUIRED_ARGS,
  isAppOnlyTool,
} from './tool-visibility.js'
import { PaymentRequiredError } from './client.js'
import { primitiveBackendUsageStatus } from './usage-status.js'
import { unavailableSubscriptionStatus } from './subscription-status.js'
import { mirrorGraphNetworkCapabilities } from './capabilities.js'
import { ROUTING_NOT_SERVED, routingHead, routingHintLines } from './layer-routing.js'
import {
  GraphSchemaError,
  META_SCHEMA_DESCRIPTION,
  META_SCHEMA_TITLE,
  handleMetaSchema,
  type GraphSchemaDependencies,
} from './graph-schema.js'
import { actionLogSignalsFromResult, appendActionLog } from './action-log.js'
import {
  FLOWS_MAX_OFFSET,
  GRAPH_EXPAND_DESCRIPTION,
  GRAPH_EXPAND_TITLE,
  GRAPH_EXPAND_TOOL,
  handleGraphExpand,
  type FlowsDependencies,
  type GraphQueryAnswer,
} from './flows.js'

const LOCAL_TOOL_NAMES = new Set([
  'meta_network_capabilities',
  'meta_schema',
  'meta_usage_status',
  'meta_subscription_status',
  'meta_help',
  'wallet_balance',
  'wallet_topup',
  GRAPH_EXPAND_TOOL,
])
// Local tools only the view calls (visibility ["app"]): never named to the model.
const APP_ONLY_LOCAL_TOOL_NAMES = new Set([GRAPH_EXPAND_TOOL])
const GRAPH_ARRAY_KEYS = ['nodes', 'edges', 'flows', 'edge_anchors'] as const

// The Chain Insights view: one HTML file, served by this proxy and by nothing
// else. The graph endpoint serves no view; a view, a ui:// resource or a
// _meta.ui it advertises is never forwarded. The tool result says which view
// the file draws: a graph, a chart or a table from the columns of a graph_query
// answer, the balance (meta_usage_status, meta_subscription_status), or the
// answer of a click (graph_expand). The metadata below is the wire contract of
// the Claude views, character for character.
export const CLAUDE_VIEW_URI = 'ui://chain-insights/view'
export const MCP_APP_MIME_TYPE = 'text/html;profile=mcp-app'
// A tool whose answer the view draws: the resource under the current key and
// the legacy flat key hosts still read.
const VIEW_TOOL_META = {
  ui: { resourceUri: CLAUDE_VIEW_URI },
  'ui/resourceUri': CLAUDE_VIEW_URI,
}
// A tool only the view calls: the host keeps it away from the model.
const APP_ONLY_TOOL_META = { ui: { resourceUri: CLAUDE_VIEW_URI, visibility: ['app'] } }
const VIEW_RESOURCE_META = {
  ui: { prefersBorder: false, csp: { resourceDomains: ['https://assets.claude.ai'] } },
}
const VIEW_TOOL_ANNOTATIONS = { readOnlyHint: true }
const CLAUDE_VIEW_FILE = 'claude-view.html'

let claudeViewHtml: string | undefined

/**
 * The view file shipped in the package: dist/apps/claude-view.html next to the
 * built proxy, or src/mcp/apps/claude-view.html when run from source. Read once.
 */
export function readClaudeViewHtml(): string {
  if (claudeViewHtml !== undefined) return claudeViewHtml
  const here = path.dirname(fileURLToPath(import.meta.url))
  const candidates = [
    path.join(here, 'apps', CLAUDE_VIEW_FILE),
    path.join(here, '..', 'src', 'mcp', 'apps', CLAUDE_VIEW_FILE),
  ]
  for (const candidate of candidates) {
    try {
      claudeViewHtml = readFileSync(candidate, 'utf8')
      return claudeViewHtml
    } catch {
      /* try the next place */
    }
  }
  throw new Error(`The Chain Insights view file ${CLAUDE_VIEW_FILE} is missing from the package`)
}

export type McpProxyMode = 'workspace' | 'stateless'

export function resolveMcpProxyMode(env: NodeJS.ProcessEnv = process.env): McpProxyMode {
  const raw = env['CHAIN_INSIGHTS_MCP_PROXY_MODE']?.trim().toLowerCase()
  if (!raw || raw === 'stateless') return 'stateless'
  if (raw === 'workspace') return 'workspace'
  if (raw === 'no-workspace' || raw === 'workspace-less') return 'stateless'
  throw new Error(`CHAIN_INSIGHTS_MCP_PROXY_MODE must be workspace or stateless; got "${raw}"`)
}

const GRAPH_LAYERS_TEXT =
  "Use USE topology for topology (address/FLOWS_TO/OPERATED_BY/LINKED graph with SWAPPED, ADDED_LIQUIDITY, REMOVED_LIQUIDITY, BRIDGED and the Pool label, unified recent+historical) and USE facts for bounded TRANSFER, SWAP, LIQUIDITY_ADD, LIQUIDITY_REMOVE and BRIDGE_CROSSING rows and enrichment, and USE chain for the chain node's own record of one known transaction, block, address or the head."

const KNOWN_PUBLIC_TOOL_DESCRIPTIONS: Record<string, string> = {
  meta_network_capabilities:
    'Return the current Chain Insights network and tool support matrix. Takes no arguments: send {}.',
  meta_schema: META_SCHEMA_DESCRIPTION,
  meta_usage_status: "Return the caller's public free graph_query quota for the current UTC day.",
  meta_subscription_status:
    "Return the caller's CIA subscription window end, daily allowance, consumption, and tier.",
  meta_help: 'Show a short guide to Chain Insights tools and workflow.',
  wallet_balance:
    'Show the local Chain Insights payment wallet address, payment network, token, and amount.',
  graph_query: `Run a read-only GQL/Cypher query through the Chain Insights graph endpoint. ${GRAPH_LAYERS_TEXT} ${ROUTING_NOT_SERVED} Preserve full addresses exactly.`,
  graph_query_batch:
    'Run multiple read-only GQL/Cypher queries through the Chain Insights graph endpoint in one paid batch. Prefer this for related topology/facts reads.',
}
// Titles for proxied tools whose graph endpoint definition carries none.
const KNOWN_PUBLIC_TOOL_TITLES: Record<string, string> = {
  graph_query: 'Graph Query',
  graph_query_batch: 'Graph Query Batch',
}
const FALLBACK_GRAPH_PRIMITIVE_TOOL_NAMES = ['graph_query', 'graph_query_batch'] as const

type ToolInputShape = Record<string, z.ZodTypeAny>
type ToolHandler = (args: unknown, extra?: unknown) => Promise<unknown> | unknown
type ToolRegistrationConfig = Parameters<McpServer['registerTool']>[1]
type ToolCallInput = { name: string; arguments?: Record<string, unknown> }
type RemoteToolCaller = {
  callTool: Client['callTool']
}
const NETWORK_DESCRIPTION =
  'Network to query: robinhood, the one public network. CIA does not pick a default network, so always pass it. meta_network_capabilities (no arguments) lists the live networks.'
const NETWORK_SCHEMA = z.string().min(1).describe(NETWORK_DESCRIPTION)

const EMPTY_INPUT_SCHEMA = z.strictObject({})
const REMOTE_GRAPH_TOOL_REQUEST_TIMEOUT_MS = 15 * 60 * 1000

// What the Chain Insights view draws from a graph_query answer, told by column
// name. The same rules are in skills/chain-insights-cypher/SKILL.md.
const PICTURE_RULES = [
  'Pictures: hosts that draw views, such as Claude Desktop, draw a graph_query answer from its column names. No other tool is needed.',
  '- Rows with from_address and to_address columns draw a graph of at most 60 addresses. Optional columns: amount_usd_sum, tx_count, first_seen_timestamp, last_seen_timestamp, link_kind, from_labels, to_labels. Example: USE topology MATCH (a:Address {address: $addr})-[f:FLOWS_TO]->(b:Address) WHERE NOT a:Pool RETURN a.address AS from_address, b.address AS to_address, f.amount_usd_sum AS amount_usd_sum, f.tx_count AS tx_count, f.last_seen_timestamp AS last_seen_timestamp ORDER BY f.last_seen_timestamp DESC LIMIT 25',
  '- Rows with a day, date or *_timestamp column and number columns draw a chart. Example, the transfers of a known pair on one day: USE facts MATCH (a:Address {address: $from})-[t:TRANSFER]->(b:Address {address: $to}) WHERE t.block_date = "YYYY-MM-DD" RETURN t.block_timestamp AS block_timestamp, t.amount_usd AS amount_usd LIMIT 200',
  '- Any other rows draw a table.',
].join('\n')

// The same rule in one sentence, for meta_help.
const PICTURE_HELP_LINE =
  'In hosts that draw views, a graph_query answer with from_address and to_address columns draws a graph, a day or time column with numbers draws a chart, and any other rows draw a table.'

const CHAIN_INSIGHTS_WORKFLOW = [
  'Workflow:',
  '1. Do not call investigation tools until required arguments are known. Network is required; use meta_network_capabilities to check supported networks and available tools, or ask the user if missing.',
  '2. Use graph_query(_batch) for every question about addresses, money flow and transactions.',
  '3. Preserve tool summaries and structured facts as returned. Keep full blockchain addresses intact.',
].join('\n')

const GRAPH_SCHEMA_HINTS = [
  'Graph query hints:',
  '- Pass network=robinhood, the one public network, on every graph tool call. CIA does not pick a default network. meta_network_capabilities takes no arguments (send {}); call it only to check which tools and layers are live.',
  ...routingHintLines(),
  '- Coverage is per kind of data. coverage.complete_through_block is the floor of USE facts: below it every raw relationship is indexed. graph_progress.complete_through_block is the floor of USE topology, and graph_progress.layers gives each link kind its own height. An empty answer above the floor may mean not indexed yet, not absent on chain. An absent chain_tip_block means the indexers are catching up: read freshness.max_data_age_seconds for the lag.',
  "- The graph is address-grain. The only topology money node label is Address, keyed by the raw chain-native H160 address on EVM networks, for example 0x1874a43d7c6d888f9eda3d22a3a49704e3cadb24. There is no separate identity key. network is the query's network on every node and relationship, never stored, except on :Chain, where it names the remote chain.",
  '- An Address carries a kind from chain facts. topology carries :Account or :Contract as a second label on an Address (:Contract:SmartAccount for a contract wallet), with is_contract kept beside :Contract, and an address that only received has none. facts serves no kind, and a facts read that names :Account or :Contract is refused: ask USE topology or USE chain. chain Address returns is_contract, nonce and delegated_to at the newest block, or at the block named by at_block. block_timestamp is epoch milliseconds on every layer.',
  '- Address nodes carry address, network, labels, and the role flags is_exchange, is_scam, is_victim and is_sanctioned. (:Address)-[:LINKED]-(:Address) is an undirected ownership-overlay edge (basis derived/associated, plus confidence, source_event, declared_owner, owner_state) asserting the two addresses are controlled by the same actor. LINKED is served on the topology graph only. Enumerate LINKED neighbors with MATCH (a:Address {address: $addr})-[l:LINKED]-(b:Address) RETURN b.address, b.network, l.basis, l.confidence LIMIT 25.',
  '- Labels hold role words, never detector names: Exchange (plus the exchange name), Scam, Victim and Sanctioned (plus the entity name). Each role is also a node label and a flag on the Address: :Exchange and is_exchange follow the exchange label, :Scam and is_scam the risk label, :Victim and is_victim the protection label, :Sanctioned and is_sanctioned the sanctioned label. Each flag is present only when true and absent otherwise, never false: test IS NOT NULL or IS NULL, not = false. A withdrawn label removes its node label and its flag.',
  '- Address nodes carry base activity rollups: degree_in/degree_out/degree_total (distinct counterparty addresses), tx_in_count/tx_out_count/tx_total_count, total_in_usd/total_out_usd/total_volume_usd, net_flow_usd (in minus out; positive = net receiver) — all computed from external flows only — and first_activity_timestamp/last_activity_timestamp/activity_span_days, which include all flows (self-loops included). FLOWS_TO edges carry exactly tx_count, amount_usd_sum (total money flow, token and native value merged), first_seen_timestamp, last_seen_timestamp. Lifetime aggregates are the only serving window. Averages are computed inline (amount_usd_sum / toFloat(tx_count)). tx_count counts token and native transfers plus internal native transfers (a contract sending ETH during a call), and amount_usd_sum prices them all. USE facts TRANSFER lists all three, so the rows of a pair are the transfers its link counts, up to the height the link was built to. A link covers all time and a USE facts read covers one day: read the transfers of a pair one day at a time. A transaction anchor of a pair resolves through USE facts, on the UTC day of the first_seen_timestamp or last_seen_timestamp of the link: MATCH (a:Address {address: $from})-[t:TRANSFER]->(b:Address {address: $to}) WHERE t.block_date = "YYYY-MM-DD" RETURN t.tx_id, t.block_timestamp LIMIT 1.',
  '- For actor-level exposure (AC11), UNION FLOWS_TO and SWAPPED reachability over one visible LINKED hop instead of expanding through the LINKED edge itself: MATCH (a:Address {address: $addr})-[:LINKED]-(owned:Address)-[r:FLOWS_TO|SWAPPED]-(b:Address) WHERE NOT a:Pool AND NOT owned:Pool AND owned.address <> b.address AND a.address <> b.address RETURN owned.address, b.address, type(r), coalesce(r.amount_usd_sum, r.bought_usd) LIMIT 50.',
  '- Labels and per-label risk live on the address node: the labels array plus three parallel lists, label_risk_labels, label_risk_levels and label_risk_updated_timestamps, where entry i of each list is one label row. No overall risk score is served. USE facts serves bounded single-event rows (TRANSFER, SWAP, LIQUIDITY_ADD, LIQUIDITY_REMOVE and BRIDGE_CROSSING edges) only; lifetime address metrics (degrees, totals, activity window) are node properties on USE topology.',
  '- (from:Address)-[t:TRANSFER]->(to:Address) on USE facts returns individual transfer rows, not aggregates, with properties amount, amount_usd, asset_symbol, asset_contract, tx_id, block_height, block_timestamp, event_index, edge_index, kind, price_usd, and price_missing. Every TRANSFER row has a kind: token, native or internal. An internal row is ETH a contract sends while it runs a call, such as the ETH leg of a wrap. Add t.kind = "internal" to the pair and the day to read only the internal rows. A facts read names an address pair with one day, whether it is a TRANSFER row-select or a count()/sum() aggregate: both endpoint addresses as {address: "..."} on from and to, with WHERE t.block_date = "YYYY-MM-DD". A transaction is read on USE chain by its tx_id, not on facts. t.block_timestamp bounds in epoch milliseconds may narrow the day to a time window. One address, a day alone, a window of days, a block range or a bare LIMIT is not enough. A facts read holds at most 200 rows in a reply, has one relationship and no hop, and takes no ORDER BY: sort the page yourself.',
  '- Facts graph labels include Address; the TRANSFER, SWAP, LIQUIDITY_ADD, LIQUIDITY_REMOVE and BRIDGE_CROSSING relationships each connect two Address nodes. Facts address keys match topology address values exactly.',
  '- Topology relationships include FLOWS_TO, SWAPPED, OPERATED_BY, LINKED, and RISK_PROXIMITY between Address nodes, ADDED_LIQUIDITY and REMOVED_LIQUIDITY to and from Pool nodes, and BRIDGED to and from Chain nodes.',
  "- (:Address)-[:OPERATED_BY]->(:Address) is the directed owner-to-operator edge: the transaction sender that moved the owner's tokens (ERC-20/721), or the event operator (ERC-1155); not the approved spender. Aggregate properties: tx_count, amount_usd_sum, first_seen_timestamp, last_seen_timestamp, and optional token_standard (ERC20/ERC721/ERC1155; absent when the pair is mixed-standard). Valuation fields: valuation_tracked_count, valued_count and the reason counters missing_valuation_price_count, unknown_quantity_count, unrepresentable_quantity_count and usd_range_count. valuation_complete is true when valued_count equals valuation_tracked_count, valuation_coverage_ratio is valued_count divided by valuation_tracked_count, and amount_usd_sum counts a transfer with no USD value as 0, so it is a floor unless valuation_complete is true. One edge per owner/operator pair; direct transfers with no operator create none; an owner never operates for itself. Topology-only, and a topology fact — not a risk label. Probe: MATCH (owner:Address)-[operation:OPERATED_BY]->(operator:Address {address: $addr}) RETURN owner.address AS owner, operation.tx_count AS tx_count ORDER BY operation.tx_count DESC LIMIT 10.",
  '- FLOWS_TO properties are tx_count, amount_usd_sum, first_seen_timestamp, last_seen_timestamp. pair_key and synced_through_height are internal sync bookkeeping, not to be queried. synced_through_height is also on the other summed links (SWAPPED, OPERATED_BY, ADDED_LIQUIDITY, REMOVED_LIQUIDITY, BRIDGED, APPROVED, SPONSORED, BUNDLED, SIGNED_FOR) and pair_key on SWAPPED: bookkeeping there too. Tx ids of every transfer, internal ones included, come from USE facts TRANSFER. Averages come from inline arithmetic. FLOWS_TO into and out of pools is kept; the pool trace rule below governs a trace that reaches one.',
  '- Swaps, liquidity and bridges on USE topology are lifetime totals per pair; single events are USE facts rows. (:Address)-[:SWAPPED]->(:Address) joins a swap payer to a different recipient, one edge per payer, recipient, sold_asset and bought_asset, with swap_count, sold_amount_raw, bought_amount_raw, sold_usd, bought_usd, pools, families, strength, first_seen_height and last_seen_height. sold_usd and bought_usd sum the routes on the edge at the day price: a route side with no price adds 0, so 0 can mean no price. Do not read 0 as worth nothing. The USE facts SWAP row says which side had no price (sold_price_missing, bought_price_missing). strength is swap (the whole route is proven: payer, recipient, assets, exact raw amounts and conservation) or swap_like (the shape is a swap but the pool code is not proven). Today no route is swap: the swap reader reads transaction receipts only, with no execution trace, so every served route is swap_like, with reason unknown_pool_code and families unknown. A Uniswap V2 or V3 swap reads this way, and unknown does not mean the protocol is unsupported. A filter on strength = "swap" or on a known family matches nothing. A route that could not be paired (swap_unsplit) is never served: it has no payer, recipient or pool, makes no SWAPPED edge and no SWAP row, and exists in the warehouse only. Every Uniswap v4 swap is swap_unsplit today, by design, so v4 swaps are hidden. A self swap makes no edge, and a missing SWAPPED edge is not proof that no swap happened. Swap attribution is read from SWAPPED, the aggregate (strength, pools, families), or from the USE facts SWAP row, one route. FLOWS_TO carries value only.',
  "- Pool is a second label on an Address: the pool of a swap route or liquidity event, with liquidity_added_usd, liquidity_removed_usd, liquidity_net_usd, provider_count and receiver_count. (:Address)-[:ADDED_LIQUIDITY]->(:Pool) and (:Pool)-[:REMOVED_LIQUIDITY]->(:Address) join named providers and receivers to the pool, with event_count, totals_raw, usd, unpriced_count, first_seen_height and last_seen_height; REMOVED_LIQUIDITY adds fees_raw, receiver_added_usd (USD the receiver itself added to the same pool) and receiver_provided. A receiver's profit from a pool is usd minus receiver_added_usd: receiver_provided false is a drain by a stranger, true with a large profit is the creator's rug pull.",
  '- (:Address)-[:BRIDGED]->(:Chain) is outbound bridge use and (:Chain)-[:BRIDGED]->(:Address) inbound, with kinds, events, totals_raw, first_height, last_height and last_bridge_event_id. A Chain node (network, address) is the remote bridge endpoint, never an Address, so no FLOWS_TO walk passes through it.',
  '- Pool trace rule, for every trace: 1. Enter a `:Pool` on any edge. 2. Leave a `:Pool` only on `REMOVED_LIQUIDITY`, to the address the liquidity was paid to. 3. Never leave a `:Pool` on `FLOWS_TO`. 4. Across a swap, follow `SWAPPED` from payer to recipient, between two different addresses. Do not walk through the pool. Rug-pull probe: MATCH (victim:Address {address: $addr})-[paid:FLOWS_TO]->(pool:Pool)-[removal:REMOVED_LIQUIDITY]->(receiver:Address) WHERE NOT victim:Pool AND receiver.address <> victim.address RETURN pool.address AS pool_address, receiver.address AS receiver_address, removal.usd AS removed_usd, removal.receiver_added_usd AS receiver_added_usd, removal.receiver_provided AS receiver_provided LIMIT 25.',
  '- USE facts serves the single events. (payer:Address)-[s:SWAP]->(recipient:Address) is one row per swap route, self swaps included, with strength, reason, route_id and the sold_ and bought_ asset, amount and usd columns. (provider:Address)-[:LIQUIDITY_ADD]->(pool:Address) and (pool:Address)-[:LIQUIDITY_REMOVE]->(receiver:Address) are one row per liquidity event, with party_state and evidence_state. (sender:Address)-[c:BRIDGE_CROSSING]->(recipient:Address) is one row per bridge event. SWAP, LIQUIDITY_* and BRIDGE_CROSSING take the same rule as TRANSFER: an address pair with one day. USD comes from the daily price services, never from a swap: with no price, USD is empty and the matching price_missing column is true (price_missing on TRANSFER, sold_price_missing and bought_price_missing on SWAP, amount0_price_missing and amount1_price_missing on LIQUIDITY_*). block_timestamp on TRANSFER, SWAP and LIQUIDITY_* rows is epoch milliseconds, in filters and in results; BRIDGE_CROSSING has none.',
  '- A USE facts SWAP row carries no route: it has no pools and no families column. A read that names one of them, to return it, to filter on it or to order by it, is refused. The route of a swap stays a topology question. For the pools of the swaps of an address, read SWAPPED.pools and SWAPPED.families on USE topology, anchored on the payer or the recipient. SWAPPED has one link per payer, recipient, sold asset and bought asset, so its pools cover every route on the link, not one route.',
  '- Traversal rule: for BFS, fixed-hop fallback, shortest-path, or manual FLOWS_TO traversal, exchange hot wallets are terminal endpoints only. Do not expand from, through, or classify exchange nodes as deposit, suspect, or intermediate candidates; filter every non-terminal node with is_exchange IS NULL. is_exchange is absent unless true, so a labelled node with no is_exchange is walked through, and is_scam, is_victim and is_sanctioned do not end a walk. At a Pool, follow the pool trace rule above.',
  '- Pool guard: a trace walks FLOWS_TO and SWAPPED, so it crosses a swap from payer to recipient without passing through the pool. A walk may end at a Pool, but never starts at one or passes through one: its start and every address in its middle stay off a Pool. A fixed-hop walk adds WHERE NOT src:Pool AND NOT mid:Pool, each its own AND term, never inside an OR. A quantified or shortest-path walk puts the guards inside the path pattern, on the start and on up to 4 guarded hops before one last hop: MATCH p = SHORTEST 1 (a:Address {address: $from} WHERE NOT a:Pool) (()-[:FLOWS_TO|SWAPPED]-(via:Address) WHERE NOT via:Pool){0,4} ()-[:FLOWS_TO|SWAPPED]-(b:Address {address: $to}) RETURN [n IN nodes(p) | n.address] AS route LIMIT 5. ANY SHORTEST takes the same pattern. A route search asks for one path. An open target from one address: MATCH SHORTEST 1 (a:Address {address: $addr} WHERE NOT a:Pool) (()-[:FLOWS_TO|SWAPPED]-(via:Address) WHERE NOT via:Pool){0,4} ()-[:FLOWS_TO|SWAPPED]-(b:Address) RETURN b.address LIMIT 50. Use these shapes as written, changing only the addresses and the RETURN. A WHERE placed after a SHORTEST pattern runs after the shortest route is chosen, so it drops a route that crosses a pool instead of finding the route that avoids it.',
  '- Call meta_schema {network} first when you need field names; it is cached for 24 hours. The two discovery reads below are the fallback.',
  '- Start schema discovery with endpoint-safe property reads: MATCH (n:Address) RETURN n.address AS address, n.network AS network, n.labels AS labels, n.last_activity_timestamp AS last_activity_timestamp LIMIT 20',
  '- Relationship discovery: MATCH (:Address)-[r:FLOWS_TO]->(:Address) RETURN r.amount_usd_sum AS amount_usd_sum, r.tx_count AS tx_count LIMIT 20',
  "- Anchor every topology read that filters on a link property: put an address in its pattern. Without one, a read starts from every link of the type it names, and you should not count on the filter to narrow that: WHERE x.strength = 'swap' on SWAPPED checks every SWAPPED link, LIMIT stops the read only after enough rows match, and a filter that matches few or none can run to the 60 s topology limit and fail with query_timeout. Example: MATCH (a:Address {address: $addr})-[x:SWAPPED]->(b:Address) WHERE x.swap_count >= 2 RETURN b.address, x.swap_count LIMIT 25. Pick an address with few links: degree_out and degree_in are a rough guide, because they count neighbours, not links, and an address with hundreds of thousands of neighbours can fail the same way. Discovery probes with LIMIT and no filter stay valid. The queries of one batch share a 100 s budget; USE facts queries stop at 30 s.",
  '- graph_query uses the active Chain Insights graph endpoint. Select the graph with USE topology for topology (address/FLOWS_TO/OPERATED_BY/LINKED graph with SWAPPED, ADDED_LIQUIDITY, REMOVED_LIQUIDITY, BRIDGED and the Pool label, unified recent+historical) and USE facts for bounded TRANSFER, SWAP, LIQUIDITY_ADD, LIQUIDITY_REMOVE and BRIDGE_CROSSING rows and enrichment, and USE chain for one keyed lookup on the chain node: a transaction by tx_id, a block by block_height or block_hash, an address at one block, or the head. On topology, address is the node grain, not the topology name.',
  '- All graph_query calls are read-only. Never use CREATE, INSERT, MERGE, SET, DELETE, REMOVE, DROP, DETACH, ADD, CONNECT, DISCONNECT, ALTER, TRUNCATE, GRANT, or REVOKE.',
  '- Use USE facts graph patterns for fact and enrichment reads. Do not query internal table namespaces directly.',
].join('\n')

// The routing paragraph comes first: a host that keeps only the start of the
// instructions must still show where each kind of question goes.
const ROUTING_HEAD = routingHead()

const SERVER_INSTRUCTIONS = [
  'Chain Insights is an AML and graph-analysis MCP server for AI agents.',
  CHAIN_INSIGHTS_WORKFLOW,
  ROUTING_HEAD,
  PICTURE_RULES,
  GRAPH_SCHEMA_HINTS,
  'Presentation rules: preserve tool summaries as returned; never truncate blockchain addresses or identity_resolution audit mappings.',
].join('\n\n')

const STATELESS_SERVER_INSTRUCTIONS = [
  'Chain Insights is running as a stateless AML proxy for a host application.',
  'Call graph_query or graph_query_batch with network=robinhood. meta_network_capabilities takes no arguments (send {}); call it only to check which tools and layers are live.',
  ROUTING_HEAD,
  PICTURE_RULES,
  'Use wallet_balance to inspect the local payment wallet when payment setup is needed.',
  GRAPH_SCHEMA_HINTS,
  'Presentation rules: preserve tool summaries as returned; never truncate blockchain addresses or identity_resolution audit mappings.',
].join('\n\n')

// Exported so a test can prove, for EVERY public tool, that each declared
// schema argument also appears in PUBLIC_MCP_TOOL_ALLOWED_ARGS. An argument
// present here but missing there is silently stripped by
// normalizeRemoteToolArguments and the caller never learns their override was
// ignored — the failure mode that shipped with `time_scope`.
export function knownPublicToolInputSchema(toolName: string): ToolInputShape | null {
  switch (toolName) {
    case 'graph_query':
      return {
        query: z.string().min(1).describe(`Read-only GQL/Cypher query. ${GRAPH_LAYERS_TEXT}`),
        network: NETWORK_SCHEMA,
      }
    case 'graph_query_batch':
      return {
        network: NETWORK_SCHEMA,
        queries: z
          .array(
            z.object({
              id: z.string().optional(),
              query: z.string().min(1).describe('Read-only GQL/Cypher query'),
            })
          )
          .min(1)
          .max(20),
        per_query_timeout_seconds: z.number().int().min(1).max(600).optional(),
      }
    default:
      return null
  }
}

function fallbackGraphPrimitiveTools(): McpTool[] {
  return FALLBACK_GRAPH_PRIMITIVE_TOOL_NAMES.map((name) => ({
    name,
    description: KNOWN_PUBLIC_TOOL_DESCRIPTIONS[name],
  }))
}

/**
 * Local payment wallet address for tools that address the caller on the
 * server (subscription_status). Returns null — never throws — when no wallet
 * is configured; callers degrade to an unavailable-shape result.
 */
/**
 * Local payment wallet address for the top-up view: null when no wallet file
 * exists, and an error when the file exists but cannot be read. Reads the
 * address only; nothing is signed or sent.
 */
async function localTopupWalletAddress(): Promise<string | null> {
  const { isWalletConfigured } = await import('../wallet/index.js')
  if (!(await isWalletConfigured())) return null
  const { getWalletAccount } = await import('../wallet/tools.js')
  return (await getWalletAccount()).address
}

async function localSubscriptionWalletAddress(): Promise<string | null> {
  try {
    const { getWalletAccount } = await import('../wallet/tools.js')
    const account = await getWalletAccount()
    return account.address
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function redactLogValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactLogValue)
  if (!isRecord(value)) return value
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => {
      if (/token|secret|password|private.?key|authorization/i.test(key)) return [key, '[redacted]']
      return [key, redactLogValue(entry)]
    })
  )
}

function errorForLog(err: unknown): Record<string, unknown> {
  const error = err as Error
  return {
    name: error.name ?? 'Error',
    message: error.message ?? String(err),
  }
}

function sanitizeCypher(query: string): string {
  return query.replace(/\s+/g, ' ').trim()
}

function cypherLogPayload(tool: string, args: unknown): Record<string, unknown> | null {
  if (!isRecord(args)) return null
  if (tool === 'graph_query') {
    return {
      network: args.network,
      queries: [
        {
          id: tool,
          query: typeof args.query === 'string' ? sanitizeCypher(args.query) : args.query,
        },
      ],
    }
  }
  if (tool === 'graph_query_batch') {
    const queries = Array.isArray(args.queries) ? args.queries : []
    return {
      network: args.network,
      per_query_timeout_seconds: args.per_query_timeout_seconds,
      query_count: queries.length,
      queries: queries.map((entry, index) =>
        isRecord(entry)
          ? {
              id: typeof entry.id === 'string' ? entry.id : `q${index + 1}`,
              query: typeof entry.query === 'string' ? sanitizeCypher(entry.query) : entry.query,
            }
          : { id: `q${index + 1}`, query: entry }
      ),
    }
  }
  return null
}

function createMcpLogger(config: Pick<InvestigatorConfig, 'dataDir'>) {
  const disabled = process.env.CHAIN_INSIGHTS_MCP_LOG === '0'
  const filePath =
    process.env.CHAIN_INSIGHTS_MCP_LOG_PATH?.trim() ||
    path.join(config.dataDir, '.chain-insights', 'runtime', 'logs', 'mcp-proxy.jsonl')

  async function write(
    level: 'info' | 'error',
    event: string,
    fields: Record<string, unknown> = {}
  ): Promise<void> {
    if (disabled) return
    try {
      await mkdir(path.dirname(filePath), { recursive: true })
      await appendFile(
        filePath,
        JSON.stringify({
          ts: new Date().toISOString(),
          level,
          event,
          pid: process.pid,
          ...fields,
        }) + '\n',
        { mode: 0o600 }
      )
    } catch {
      // Logging must never break the stdio MCP server.
    }
  }

  return {
    filePath,
    info: (event: string, fields?: Record<string, unknown>) => write('info', event, fields),
    error: (event: string, fields?: Record<string, unknown>) => write('error', event, fields),
  }
}

function installToolLogging(server: McpServer, logger: ReturnType<typeof createMcpLogger>): void {
  const existingRegisterTool = server.registerTool
  const originalRegisterTool = existingRegisterTool.bind(server)
  const wrappedRegisterTool = ((
    name: string,
    config: ToolRegistrationConfig,
    handler: ToolHandler
  ) => {
    const wrapped: ToolHandler = async (args, extra) => {
      const startedAt = Date.now()
      await logger.info('tool.start', {
        tool: name,
        args: redactLogValue(args),
      })
      try {
        const result = await handler(args, extra)
        const isError = isRecord(result) && result.isError === true
        await logger.info('tool.end', {
          tool: name,
          duration_ms: Date.now() - startedAt,
          is_error: isError,
        })
        return result
      } catch (err) {
        await logger.error('tool.throw', {
          tool: name,
          duration_ms: Date.now() - startedAt,
          error: errorForLog(err),
        })
        throw err
      }
    }
    return originalRegisterTool(name, config, wrapped as never)
  }) as typeof server.registerTool
  Object.assign(wrappedRegisterTool, existingRegisterTool)
  server.registerTool = wrappedRegisterTool
}

function installRemoteCypherLogging(
  remoteClient: RemoteToolCaller,
  logger: ReturnType<typeof createMcpLogger>
): void {
  const existingCallTool = remoteClient.callTool
  const originalCallTool = existingCallTool.bind(remoteClient)
  const wrappedCallTool = (async (...args: Parameters<Client['callTool']>) => {
    const input = args[0] as ToolCallInput
    const queryPayload = cypherLogPayload(input.name, input.arguments)
    const toolArgs = input.arguments ?? {}
    const startedAt = Date.now()
    if (queryPayload) {
      await logger.info('topology.start', {
        tool: input.name,
        ...queryPayload,
      })
    }
    try {
      const result = await originalCallTool(...args)
      if (queryPayload) {
        await logger.info('topology.end', {
          tool: input.name,
          duration_ms: Date.now() - startedAt,
          is_error: isRecord(result) && result.isError === true,
        })
      }
      const { warnings, search_limits } = actionLogSignalsFromResult(result)
      await appendActionLog({
        timestamp: startedAt,
        tool: input.name,
        args: toolArgs,
        outcome: 'ok',
        duration_ms: Date.now() - startedAt,
        warnings,
        search_limits,
      })
      return result
    } catch (err) {
      if (queryPayload) {
        await logger.error('cypher.throw', {
          tool: input.name,
          duration_ms: Date.now() - startedAt,
          error: errorForLog(err),
        })
      }
      await appendActionLog({
        timestamp: startedAt,
        tool: input.name,
        args: toolArgs,
        outcome: 'error',
        duration_ms: Date.now() - startedAt,
        error: (err as Error).message,
      })
      throw err
    }
  }) as typeof remoteClient.callTool
  Object.assign(wrappedCallTool, existingCallTool)
  remoteClient.callTool = wrappedCallTool
}

function remoteToolRequestOptions(toolName: string): Parameters<Client['callTool']>[2] | undefined {
  if (toolName === 'graph_query' || toolName === 'graph_query_batch') {
    return {
      timeout: REMOTE_GRAPH_TOOL_REQUEST_TIMEOUT_MS,
      maxTotalTimeout: REMOTE_GRAPH_TOOL_REQUEST_TIMEOUT_MS,
    }
  }
  return undefined
}

function isBlankArgument(value: unknown): boolean {
  if (value === undefined || value === null) return true
  if (typeof value === 'string') return value.trim() === ''
  if (Array.isArray(value)) return value.length === 0 || value.every(isBlankArgument)
  return false
}

function normalizeRemoteToolArguments(toolName: string, args: unknown): Record<string, unknown> {
  const normalized = isRecord(args) ? { ...args } : {}
  if (!(toolName in PUBLIC_MCP_TOOL_REQUIRED_ARGS)) return normalized

  const allowedArgs = PUBLIC_MCP_TOOL_ALLOWED_ARGS[toolName]
  if (!allowedArgs) return normalized
  return Object.fromEntries(Object.entries(normalized).filter(([key]) => allowedArgs.includes(key)))
}

function validateKnownPublicToolArguments(
  toolName: string,
  args: Record<string, unknown>
): string | null {
  const requiredArgs = PUBLIC_MCP_TOOL_REQUIRED_ARGS[toolName]
  if (!requiredArgs) return null

  for (const argName of requiredArgs) {
    if (isBlankArgument(args[argName])) {
      return `Missing required argument: ${argName}`
    }
  }

  return null
}

function claudeFacingToolDescription(tool: McpTool): string {
  const baseDescription = KNOWN_PUBLIC_TOOL_DESCRIPTIONS[tool.name] ?? tool.description ?? tool.name
  const requiredArgs = PUBLIC_MCP_TOOL_REQUIRED_ARGS[tool.name]
  if (!requiredArgs) return baseDescription
  return [
    baseDescription,
    '',
    `Required arguments: ${requiredArgs.join(', ')}.`,
    'If the user did not provide the network, ask for it before calling this tool. Do not guess a default network.',
  ].join('\n')
}

function knownPublicToolAnnotations(toolName: string): Record<string, boolean> | undefined {
  if (
    toolName === 'graph_query' ||
    toolName === 'graph_query_batch' ||
    toolName.startsWith('aml_')
  ) {
    return {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    }
  }
  return undefined
}

type RemoteToolResult = {
  content?: ContentBlock[]
  structuredContent?: Record<string, unknown>
  _meta?: Record<string, unknown>
  isError?: boolean
}

/**
 * The text a call to the graph endpoint answers with when it throws: payment
 * guidance for a payment failure, the error otherwise. Shared by every proxied
 * tool and by the money-flow reads.
 */
function remoteCallFailureText(toolName: string, err: unknown): string {
  if (err instanceof PaymentRequiredError) return err.message
  const msg = (err as Error).message ?? String(err)
  if (/\b402\b/.test(msg) || msg.toLowerCase().includes('payment')) {
    return (
      `Payment required for ${toolName}. This tool costs USDC on Base via x402 micropayments. ` +
      'Next steps: run `cia wallet ready` to check funding and finish one-time payment setup, ' +
      'run `cia wallet topup` if it says the wallet needs USDC, ' +
      'or `cia access-key set <key>` if you have been given test access.'
    )
  }
  return `MCP call failed: ${msg}`
}

function promptResult(text: string, description?: string): GetPromptResult {
  return {
    description,
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text,
        },
      },
    ],
  }
}

function registerLocalPrompts(server: McpServer): void {
  server.registerPrompt(
    'meta-network-capabilities',
    {
      title: 'Network Capabilities',
      description: 'Inspect supported networks and available tools before selecting a network.',
      argsSchema: {},
    },
    async () =>
      promptResult(
        'Use Chain Insights meta_network_capabilities. Report only the supported networks and available tools exactly as returned; do not infer unsupported networks.',
        'Network capabilities'
      )
  )

  server.registerPrompt(
    'meta-schema',
    {
      title: 'Graph Schema',
      description: 'Read the live graph schema of one network before writing a query.',
      argsSchema: { network: NETWORK_SCHEMA },
    },
    async ({ network }) =>
      promptResult(
        `Use Chain Insights meta_schema with network ${network}. Report the labels, link types and fields exactly as returned; do not invent fields.`,
        'Graph schema'
      )
  )

  server.registerPrompt(
    'meta-usage-status',
    {
      title: 'Usage Status',
      description: "Check the caller's public free graph_query quota.",
      argsSchema: {},
    },
    async () =>
      promptResult(
        'Use Chain Insights meta_usage_status. Report the quota fields exactly as returned.',
        'Usage status'
      )
  )

  server.registerPrompt(
    'meta-subscription-status',
    {
      title: 'Subscription Status',
      description: "Check the caller's CIA subscription window, daily allowance, and tier.",
      argsSchema: {},
    },
    async () =>
      promptResult(
        'Use Chain Insights meta_subscription_status. Report the subscription facts exactly as returned.',
        'Subscription status'
      )
  )

  server.registerPrompt(
    'graph-query',
    {
      title: 'Graph Query',
      description: 'Run a read-only GQL/Cypher query through the Chain Insights graph endpoint.',
      argsSchema: {
        network: NETWORK_SCHEMA,
        query: z.string().describe('Read-only GQL/Cypher query'),
      },
    },
    async ({ network, query }) =>
      promptResult(
        [
          `Use Chain Insights graph_query on ${network} with this read-only GQL/Cypher query:`,
          '',
          '```gql',
          query,
          '```',
          '',
          `${GRAPH_LAYERS_TEXT} If you need schema context, first run small discovery queries such as MATCH (a:Address) RETURN a.address AS address, keys(a) AS address_properties LIMIT 5 and MATCH (:Address)-[r:FLOWS_TO]->(:Address) RETURN keys(r) AS flow_properties LIMIT 5. Return the full address when available; never shorten addresses with ellipses.`,
        ].join('\n'),
        'Graph query'
      )
  )

  server.registerPrompt(
    'graph-query-batch',
    {
      title: 'Graph Query Batch',
      description:
        'Run related read-only GQL/Cypher queries through the Chain Insights graph endpoint in one paid batch.',
      argsSchema: {
        network: NETWORK_SCHEMA,
        queries: z
          .string()
          .describe('JSON array of query objects with optional id and required query fields'),
        per_query_timeout_seconds: z
          .string()
          .optional()
          .describe('Optional integer timeout per query, 1-600 seconds'),
      },
    },
    async ({ network, queries, per_query_timeout_seconds }) =>
      promptResult(
        [
          `Use Chain Insights graph_query_batch on ${network} with these read-only GQL/Cypher queries:`,
          '',
          '```json',
          queries,
          '```',
          per_query_timeout_seconds
            ? `per_query_timeout_seconds: ${per_query_timeout_seconds}`
            : '',
          '',
          `${GRAPH_LAYERS_TEXT} If you need schema context, first run small discovery queries such as MATCH (a:Address) RETURN a.address AS address, keys(a) AS address_properties LIMIT 5 and MATCH (:Address)-[r:FLOWS_TO]->(:Address) RETURN keys(r) AS flow_properties LIMIT 5. Return the full address when available; never shorten addresses with ellipses.`,
        ]
          .filter(Boolean)
          .join('\n'),
        'Graph query batch'
      )
  )

  server.registerPrompt(
    'wallet-balance',
    {
      title: 'Wallet Balance',
      description:
        'Show the local Chain Insights payment wallet address, payment network, token, and amount.',
      argsSchema: {},
    },
    async () =>
      promptResult(
        'Use Chain Insights wallet_balance. Show the wallet address, payment network, token, and amount exactly as returned.',
        'Wallet balance'
      )
  )

  server.registerPrompt(
    'meta-help',
    {
      title: 'Chain Insights Help',
      description: 'Show available Chain Insights tools and workflow guidance.',
      argsSchema: {},
    },
    async () =>
      promptResult(
        'Use Chain Insights meta_help. Summarize the available tools and workflow guidance without inventing capabilities.',
        'Chain Insights help'
      )
  )
}

function sanitizeStructuredContentForGraphPayload(
  structuredContent: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (!structuredContent) return undefined
  return sanitizeStructuredValue(structuredContent) as Record<string, unknown>
}

function sanitizeStructuredValue(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value

  const sanitized: Record<string, unknown> = {}
  for (const [key, childValue] of Object.entries(value)) {
    if (key === 'app_data') continue
    if (
      GRAPH_ARRAY_KEYS.includes(key as (typeof GRAPH_ARRAY_KEYS)[number]) &&
      Array.isArray(childValue)
    ) {
      continue
    }
    sanitized[key] = sanitizeStructuredValue(childValue)
  }

  return sanitized
}

// The remote result _meta passes through, MCP Apps keys (ui, ui/resourceUri)
// included. Only the old graph-report envelope (chainInsights.graph) is dropped.
function sanitizeRemoteMeta(metaValue: RemoteToolResult['_meta']): RemoteToolResult['_meta'] {
  if (!metaValue || typeof metaValue !== 'object' || Array.isArray(metaValue)) return undefined

  const meta = { ...metaValue } as Record<string, unknown>

  const chainInsights = meta.chainInsights
  if (chainInsights && typeof chainInsights === 'object' && !Array.isArray(chainInsights)) {
    const { graph: _graph, ...withoutGraph } = chainInsights as Record<string, unknown>
    if (Object.keys(withoutGraph).length > 0) meta.chainInsights = withoutGraph
    else delete meta.chainInsights
  }

  return Object.keys(meta).length > 0 ? (meta as RemoteToolResult['_meta']) : undefined
}

// Raw graph arrays and app_data are stripped from the aml_* answers only, the
// graph-report tools of the old viewer. Every other answer (graph_query,
// graph_query_batch) keeps its structuredContent exactly as the hosted server
// returned it: the views read it.
function stripsGraphPayload(toolName: string): boolean {
  return toolName.startsWith('aml_')
}

function normalizeRemoteToolResult(toolName: string, result: RemoteToolResult) {
  return {
    content: result.content ?? [],
    structuredContent: stripsGraphPayload(toolName)
      ? sanitizeStructuredContentForGraphPayload(result.structuredContent)
      : result.structuredContent,
    _meta: sanitizeRemoteMeta(result._meta),
    isError: result.isError,
  }
}

function cleanNetworkCapabilities(value: unknown) {
  const structuredContent = isRecord(value) ? value.structuredContent : undefined
  const facts = isRecord(structuredContent) ? structuredContent.facts : undefined
  const capabilities = isRecord(facts) ? facts.capabilities : undefined
  const networks =
    isRecord(capabilities) && Array.isArray(capabilities.networks) ? capabilities.networks : []

  return {
    schema: 'chain-insights.result.v1' as const,
    tool: 'meta_network_capabilities',
    hint: null,
    facts: {
      capabilities: mirrorGraphNetworkCapabilities({ networks }),
    },
  }
}

function jsonTextResult(structuredContent: Record<string, unknown>) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(structuredContent, null, 2) }],
    structuredContent,
    isError: false,
  }
}

/**
 * Core proxy logic — exported so tests can inject dependencies directly.
 * The IIFE at the bottom calls this with real dependencies.
 *
 * stdout purity: NEVER write to stdout in this file. Use console.error() or process.stderr.write() only.
 * All diagnostic output goes to console.error() or process.stderr.write().
 */
export async function createProxy(): Promise<void> {
  // Lazy imports to avoid module-load side effects (critical for stdio proxy)
  const { loadConfig } = await import('../config/index.js')
  const { activeDataDir, findActiveWorkspace } = await import('../workspace/active.js')
  const { createConfiguredGraphMcpFetch, resolveGraphMcpEndpoint } = await import('./client.js')
  const { loadSchema, saveSchema } = await import('./schema-cache.js')

  const proxyMode = resolveMcpProxyMode()
  const workspaceArtifactsEnabled = proxyMode === 'workspace'
  const loadedConfig = await loadConfig()
  const activeWorkspace = workspaceArtifactsEnabled ? findActiveWorkspace() : null
  const config = {
    ...loadedConfig,
    dataDir: workspaceArtifactsEnabled ? activeDataDir(loadedConfig.dataDir) : loadedConfig.dataDir,
  }
  const logger = createMcpLogger(config)
  await logger.info('proxy.start', {
    data_dir: config.dataDir,
    workspace_root: activeWorkspace?.root,
    proxy_mode: proxyMode,
    graph_mcp_mode: config.graphMcpMode,
    graph_mcp_endpoint: resolveGraphMcpEndpoint(config),
    log_path: logger.filePath,
  })
  const graphMcpEndpoint = resolveGraphMcpEndpoint(config)

  // Build remote MCP client. The local Chain Insights MCP surface must still
  // start when the graph endpoint is temporarily unavailable so agents can use
  // help and wallet tools.
  const remoteClient = new Client({ name: 'chain-insights-proxy-client', version: PACKAGE_VERSION })
  let remoteConnected = false
  let remoteUnavailableMessage: string | undefined
  let mcpFetch: typeof fetch | undefined

  try {
    mcpFetch = await createConfiguredGraphMcpFetch(config)
  } catch (err) {
    await logger.error('remote.fetch_setup_failed', {
      endpoint: graphMcpEndpoint,
      error: errorForLog(err),
    })
    remoteUnavailableMessage = `Chain Insights Graph setup unavailable at ${graphMcpEndpoint}: ${(err as Error).message}`
    process.stderr.write(
      `Chain Insights MCP graph tools unavailable: ${remoteUnavailableMessage}. Local Chain Insights tools are still available.\n`
    )
  }

  if (mcpFetch) {
    try {
      await remoteClient.connect(
        new StreamableHTTPClientTransport(new URL(graphMcpEndpoint), { fetch: mcpFetch })
      )
      remoteConnected = true
      await logger.info('remote.connect', {
        transport: 'streamable_http',
        endpoint: graphMcpEndpoint,
      })
    } catch {
      await logger.error('remote.connect_failed', {
        transport: 'streamable_http',
        endpoint: graphMcpEndpoint,
      })
      // StreamableHTTP failed — try SSE fallback (assumption A1 from RESEARCH.md)
      try {
        const { SSEClientTransport } = await import('@modelcontextprotocol/sdk/client/sse.js')
        await remoteClient.connect(
          new SSEClientTransport(new URL(graphMcpEndpoint), { fetch: mcpFetch })
        )
        remoteConnected = true
        await logger.info('remote.connect', {
          transport: 'sse',
          endpoint: graphMcpEndpoint,
        })
      } catch (err2) {
        await logger.error('remote.connect_failed', {
          transport: 'sse',
          endpoint: graphMcpEndpoint,
          error: errorForLog(err2),
        })
        remoteUnavailableMessage = `Chain Insights Graph unreachable at ${graphMcpEndpoint}: ${(err2 as Error).message}`
        process.stderr.write(
          `Chain Insights MCP graph tools unavailable: ${remoteUnavailableMessage}. Local Chain Insights tools are still available.\n`
        )
      }
    }
  }
  if (remoteConnected)
    installRemoteCypherLogging(remoteClient as unknown as RemoteToolCaller, logger)

  // Schema cache check — skip remote listTools call on cache hit
  let tools: McpTool[] | null = await loadSchema(graphMcpEndpoint)

  if (!tools && remoteConnected) {
    // Cache miss — fetch tools from remote (client is already connected above)
    const result = await remoteClient.listTools()
    tools = result.tools as McpTool[]
    await saveSchema(tools, graphMcpEndpoint)
    await logger.info('schema.tools_loaded', {
      source: 'remote',
      count: tools.length,
    })
  } else if (tools) {
    await logger.info('schema.tools_loaded', {
      source: 'cache',
      count: tools.length,
    })
  } else {
    tools = fallbackGraphPrimitiveTools()
    await logger.info('schema.tools_loaded', {
      source: 'unavailable',
      count: tools.length,
    })
  }
  const remoteToolNames = new Set((tools ?? []).map((tool) => tool.name))

  // Build local stdio proxy server
  const server = new McpServer(
    { name: 'chain-insights', version: PACKAGE_VERSION },
    {
      instructions: workspaceArtifactsEnabled ? SERVER_INSTRUCTIONS : STATELESS_SERVER_INSTRUCTIONS,
    }
  )
  installToolLogging(server, logger)

  if (remoteConnected) {
    try {
      await remoteClient.listPrompts()
    } catch (err) {
      await logger.error('remote.prompts_failed', {
        endpoint: graphMcpEndpoint,
        error: errorForLog(err),
      })
      process.stderr.write(
        `Chain Insights MCP remote prompt metadata unavailable at ${graphMcpEndpoint}: ${(err as Error).message}\n`
      )
    }
  }

  registerLocalPrompts(server)

  server.registerTool(
    'meta_network_capabilities',
    {
      title: 'Network Capabilities',
      description: KNOWN_PUBLIC_TOOL_DESCRIPTIONS.meta_network_capabilities,
      inputSchema: EMPTY_INPUT_SCHEMA,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      if (remoteConnected && remoteToolNames.has('network_capabilities')) {
        try {
          const result = await remoteClient.callTool({
            name: 'network_capabilities',
            arguments: {},
          })
          return jsonTextResult(cleanNetworkCapabilities(result))
        } catch (err) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Network capabilities failed: ${(err as Error).message}`,
              },
            ],
            isError: true,
          }
        }
      }
      return jsonTextResult(cleanNetworkCapabilities(undefined))
    }
  )

  // meta_schema: the live graph schema of one network, built from the catalog
  // statements of the graph endpoint and kept on disk for 24 hours. A build reads
  // through the proxy's one remote session; a cache hit reads nothing.
  const schemaDependencies: GraphSchemaDependencies = {
    endpoint: graphMcpEndpoint,
    withClient: async (fn) => {
      if (!remoteConnected) {
        throw new GraphSchemaError(
          `${remoteUnavailableMessage ?? `Chain Insights Graph is not connected at ${graphMcpEndpoint}`}. Restart the Chain Insights MCP proxy after the endpoint is reachable.`
        )
      }
      return fn(remoteClient)
    },
    describeFailure: (err) => remoteCallFailureText('meta_schema', err),
  }
  server.registerTool(
    'meta_schema',
    {
      title: META_SCHEMA_TITLE,
      description: KNOWN_PUBLIC_TOOL_DESCRIPTIONS.meta_schema,
      inputSchema: {
        network: NETWORK_SCHEMA,
        refresh: z
          .boolean()
          .optional()
          .describe('Rebuild the schema now instead of reading the 24 hour cache.'),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (args) => handleMetaSchema(args, schemaDependencies)
  )

  server.registerTool(
    'meta_usage_status',
    {
      title: 'Usage Status',
      description: KNOWN_PUBLIC_TOOL_DESCRIPTIONS.meta_usage_status,
      inputSchema: EMPTY_INPUT_SCHEMA,
      _meta: VIEW_TOOL_META,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async () => {
      try {
        if (!remoteConnected) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `${remoteUnavailableMessage ?? `Chain Insights Graph is not connected at ${graphMcpEndpoint}`}. Restart the Chain Insights MCP proxy after the endpoint is reachable.`,
              },
            ],
            isError: true,
          }
        }
        if (!remoteToolNames.has('usage_status')) {
          return jsonTextResult(primitiveBackendUsageStatus(graphMcpEndpoint))
        }
        const result = (await remoteClient.callTool({
          name: 'usage_status',
          arguments: {},
        })) as RemoteToolResult
        const structuredContent = isRecord(result.structuredContent)
          ? { ...result.structuredContent, tool: 'meta_usage_status' }
          : undefined
        return {
          content: structuredContent
            ? [{ type: 'text' as const, text: JSON.stringify(structuredContent, null, 2) }]
            : (result.content ?? []),
          structuredContent,
          _meta: result._meta,
          isError: result.isError,
        }
      } catch (err) {
        return {
          content: [
            { type: 'text' as const, text: `Usage status failed: ${(err as Error).message}` },
          ],
          isError: true,
        }
      }
    }
  )

  server.registerTool(
    'meta_subscription_status',
    {
      title: 'Subscription Status',
      description: KNOWN_PUBLIC_TOOL_DESCRIPTIONS.meta_subscription_status,
      inputSchema: EMPTY_INPUT_SCHEMA,
      _meta: VIEW_TOOL_META,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async () => {
      // Local proxy shape discipline: the tool is always present and never
      // throws. When the server tool is absent or errors, the facts explain
      // the unavailability.
      try {
        if (!remoteConnected) {
          return jsonTextResult(
            unavailableSubscriptionStatus(
              graphMcpEndpoint,
              remoteUnavailableMessage ??
                `Chain Insights Graph is not connected at ${graphMcpEndpoint}`
            )
          )
        }
        if (!remoteToolNames.has('subscription_status')) {
          return jsonTextResult(
            unavailableSubscriptionStatus(
              graphMcpEndpoint,
              'The graph backend exposes primitive graph tools but no subscription_status tool.'
            )
          )
        }
        const walletAddress = await localSubscriptionWalletAddress()
        if (!walletAddress) {
          return jsonTextResult(
            unavailableSubscriptionStatus(
              graphMcpEndpoint,
              'No local payment wallet is configured; run `cia wallet create` or `cia wallet import` first.'
            )
          )
        }
        const result = (await remoteClient.callTool({
          name: 'subscription_status',
          arguments: { wallet: walletAddress },
        })) as RemoteToolResult
        if (result.isError === true) {
          const firstText = Array.isArray(result.content)
            ? result.content.find(
                (block): block is Extract<ContentBlock, { type: 'text' }> =>
                  block.type === 'text' && typeof block.text === 'string'
              )
            : undefined
          const reason = firstText?.text
            ? `subscription_status failed: ${firstText.text}`
            : 'subscription_status failed: the server returned an error'
          return jsonTextResult(unavailableSubscriptionStatus(graphMcpEndpoint, reason))
        }
        const structuredContent = isRecord(result.structuredContent)
          ? { ...result.structuredContent, tool: 'meta_subscription_status' }
          : undefined
        return {
          content: structuredContent
            ? [{ type: 'text' as const, text: JSON.stringify(structuredContent, null, 2) }]
            : (result.content ?? []),
          structuredContent,
          _meta: result._meta,
          isError: result.isError,
        }
      } catch (err) {
        return jsonTextResult(
          unavailableSubscriptionStatus(
            graphMcpEndpoint,
            `subscription_status failed: ${(err as Error).message}`
          )
        )
      }
    }
  )

  server.registerTool(
    'wallet_balance',
    {
      title: 'Wallet Balance',
      description: KNOWN_PUBLIC_TOOL_DESCRIPTIONS.wallet_balance,
      inputSchema: EMPTY_INPUT_SCHEMA,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async () => {
      try {
        const { formatWalletBalanceResult, getWalletAccount, getWalletBalanceResult } =
          await import('../wallet/tools.js')
        const account = await getWalletAccount()
        const structuredContent = await getWalletBalanceResult(account)
        return {
          content: [{ type: 'text' as const, text: formatWalletBalanceResult(structuredContent) }],
          structuredContent: structuredContent as unknown as Record<string, unknown>,
          isError: false,
        }
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Balance failed: ${(err as Error).message}` }],
          isError: true,
        }
      }
    }
  )
  // graph_expand, the one dedicated tool, for the view only (visibility
  // ["app"]): a node click is three anchored topology graph_query reads, a link
  // click one facts graph_query read, all sent through the remote client, the
  // path and payment wrapping a graph_query call takes, so each read is billed
  // as a graph query.
  const flowsDependencies: FlowsDependencies = {
    graphQuery: async (args) => {
      const options = remoteToolRequestOptions('graph_query')
      return (await withRateLimitRetry(() =>
        remoteClient.callTool({ name: 'graph_query', arguments: args }, undefined, options)
      )) as GraphQueryAnswer
    },
    describeFailure: (err) => remoteCallFailureText('graph_query', err),
    unavailable: () =>
      remoteConnected
        ? undefined
        : `${remoteUnavailableMessage ?? `Chain Insights Graph is not connected at ${graphMcpEndpoint}`}. Restart the Chain Insights MCP proxy after the endpoint is reachable.`,
  }
  server.registerTool(
    GRAPH_EXPAND_TOOL,
    {
      title: GRAPH_EXPAND_TITLE,
      description: GRAPH_EXPAND_DESCRIPTION,
      inputSchema: {
        network: z.string(),
        address: z.string().optional(),
        in_offset: z.number().int().min(0).max(FLOWS_MAX_OFFSET).optional(),
        out_offset: z.number().int().min(0).max(FLOWS_MAX_OFFSET).optional(),
        from: z.string().optional(),
        to: z.string().optional(),
        day: z.string().optional(),
      },
      annotations: VIEW_TOOL_ANNOTATIONS,
      _meta: APP_ONLY_TOOL_META,
    },
    async (args) => handleGraphExpand(args, flowsDependencies)
  )

  server.registerTool(
    'meta_help',
    {
      title: 'Chain Insights Help',
      description: KNOWN_PUBLIC_TOOL_DESCRIPTIONS.meta_help,
      inputSchema: EMPTY_INPUT_SCHEMA,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => ({
      content: [
        {
          type: 'text' as const,
          text: workspaceArtifactsEnabled
            ? [
                'Chain Insights helps AI agents run AML investigation workflows.',
                '',
                CHAIN_INSIGHTS_WORKFLOW,
                '',
                'Investigation tools:',
                '- meta_network_capabilities: supported networks and available tools. Takes no arguments.',
                '- meta_schema: read the live graph schema of one network: labels, link types and field names. Cached for 24 hours.',
                '- meta_usage_status: check the caller public free graph_query quota.',
                '- meta_subscription_status: check the caller CIA subscription window end, daily allowance, consumption, and tier.',
                '- graph_query: run read-only GQL/Cypher through the universal graph endpoint. Use USE topology or USE facts.',
                '- graph_query_batch: run related read-only graph-language queries through one paid graph call.',
                '',
                PICTURE_HELP_LINE,
                '',
                'Wallet tools:',
                '- wallet_balance: show the local payment wallet address, payment network, token, and amount.',
                '- meta_help: show this overview.',
              ].join('\n')
            : [
                'Chain Insights stateless AML proxy for host applications.',
                '',
                'Available graph-backed tools:',
                '- meta_network_capabilities: supported networks and available tools. Takes no arguments.',
                '- meta_schema: read the live graph schema of one network: labels, link types and field names. Cached for 24 hours.',
                '- meta_usage_status: check the caller public free graph_query quota.',
                '- meta_subscription_status: check the caller CIA subscription window end, daily allowance, consumption, and tier.',
                '- graph_query: run read-only GQL/Cypher through the universal graph endpoint. Use USE topology or USE facts.',
                '- graph_query_batch: run related read-only graph-language queries through one paid graph call.',
                '',
                PICTURE_HELP_LINE,
              ].join('\n'),
        },
      ],
      isError: false,
    })
  )

  // Register each remote tool locally — passthrough proxy pattern
  for (const tool of tools ?? []) {
    if (HIDDEN_REMOTE_TOOL_NAMES.has(tool.name)) continue
    if (LOCAL_TOOL_NAMES.has(tool.name)) continue
    // A tool only a view of the graph endpoint may call has no view here.
    if (isAppOnlyTool(tool)) continue
    const inputSchema = knownPublicToolInputSchema(tool.name) ?? z.object({}).passthrough()
    const handler = async (args: unknown) => {
      try {
        if (!remoteConnected) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `${remoteUnavailableMessage ?? `Chain Insights Graph is not connected at ${graphMcpEndpoint}`}. Restart the Chain Insights MCP proxy after the endpoint is reachable.`,
              },
            ],
            isError: true,
          }
        }
        const normalizedArgs = normalizeRemoteToolArguments(tool.name, args)
        const validationError = validateKnownPublicToolArguments(tool.name, normalizedArgs)
        if (validationError) {
          return {
            content: [{ type: 'text' as const, text: validationError }],
            isError: true,
          }
        }
        const request = {
          name: tool.name,
          arguments: normalizedArgs,
        }
        const requestOptions = remoteToolRequestOptions(tool.name)
        const result = await withRateLimitRetry(() =>
          requestOptions
            ? remoteClient.callTool(request, undefined, requestOptions)
            : remoteClient.callTool(request)
        )
        return normalizeRemoteToolResult(tool.name, result as RemoteToolResult)
      } catch (err) {
        const limited = rateLimitedResult(tool.name, err)
        if (limited) return limited
        return {
          content: [{ type: 'text' as const, text: remoteCallFailureText(tool.name, err) }],
          isError: true,
        }
      }
    }
    // The graph endpoint's own MCP Apps metadata (_meta.ui, ui/resourceUri)
    // is never forwarded: the proxy is the only source of views. graph_query
    // gets the view the proxy serves.
    const annotations = knownPublicToolAnnotations(tool.name)
    const drawsView = tool.name === 'graph_query'
    const toolConfig = {
      title: tool.title ?? KNOWN_PUBLIC_TOOL_TITLES[tool.name],
      description: claudeFacingToolDescription(tool),
      inputSchema,
      ...(annotations ? { annotations } : {}),
      ...(drawsView ? { _meta: VIEW_TOOL_META } : {}),
    }

    server.registerTool(tool.name, toolConfig, handler)
  }

  // The local top-up view (wallet address and QR code). It stays in the local
  // proxy: the wallet it funds is a local file, and the hosted connector never
  // offers it (ruling 2026-10-05).
  const { registerTopupView, TOPUP_VIEW_URI } = await import('../wallet/mcp-proxy/topup-server.js')
  await registerTopupView(server, { walletAddress: localTopupWalletAddress })

  // ui://chain-insights/view, read from the package. Nothing is fetched.
  server.registerResource(
    'Chain Insights view',
    CLAUDE_VIEW_URI,
    {
      title: 'Chain Insights view',
      description:
        'The Chain Insights view for hosts that draw MCP apps: money flows, query results and balance, in light and dark.',
      mimeType: MCP_APP_MIME_TYPE,
      _meta: VIEW_RESOURCE_META,
    },
    async () => ({
      contents: [
        {
          uri: CLAUDE_VIEW_URI,
          mimeType: MCP_APP_MIME_TYPE,
          text: readClaudeViewHtml(),
          _meta: VIEW_RESOURCE_META,
        },
      ],
    })
  )

  // Connect to stdio transport — after this line, stdout belongs to MCP
  const transport = new StdioServerTransport()
  await server.connect(transport)
  await logger.info('proxy.ready', {
    tools: [
      ...[...LOCAL_TOOL_NAMES].filter((name) => !APP_ONLY_LOCAL_TOOL_NAMES.has(name)),
      ...(tools ?? [])
        .filter((tool) => !isAppOnlyTool(tool))
        .map((tool) => tool.name)
        .filter((name) => !HIDDEN_REMOTE_TOOL_NAMES.has(name) && !LOCAL_TOOL_NAMES.has(name)),
    ].length,
    ui_resources: [CLAUDE_VIEW_URI, TOPUP_VIEW_URI],
  })

  // Signal handling — clean shutdown
  const shutdown = async () => {
    await logger.info('proxy.shutdown')
    transport.close()
    process.exit(0)
  }
  process.on('SIGINT', () => {
    void shutdown()
  })
  process.on('SIGTERM', () => {
    void shutdown()
  })
}

// Entry point — only execute when run as the main module (not when imported by tests)
// Using process.argv check to detect direct execution vs import
if (process.argv[1] && import.meta.url.includes(process.argv[1].replace(/\\/g, '/'))) {
  createProxy().catch((err) => {
    process.stderr.write(`Chain Insights MCP proxy startup failed: ${(err as Error).message}\n`)
    process.exit(1)
  })
}
