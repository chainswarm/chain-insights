/**
 * The columns the Chain Insights view reads from a graph_query row to draw a
 * graph. The view (Chain Insights UI, apps/claude-view/pick.ts, graphFromRows)
 * reads them by name; the proxy's picture hint names them to the model, and
 * every FLOWS_TO recipe this package teaches must return all of them, or the
 * drawn link panel shows "Unavailable" for the column the recipe forgot
 * (0.54.2: first_seen_timestamp). tests/graph-row-columns.test.ts holds the
 * three sides together: the bundled view, the hint and the recipes.
 */

/** A row draws a link only with both of these. */
export const GRAPH_REQUIRED_COLUMNS = Object.freeze(['from_address', 'to_address'] as const)

/** What a FLOWS_TO link carries: the link panel of the view shows each one. */
export const GRAPH_LINK_COLUMNS = Object.freeze([
  'amount_usd_sum',
  'tx_count',
  'first_seen_timestamp',
  'last_seen_timestamp',
] as const)

/** What the two addresses of a link carry: labels and the exchange mark on the node. */
export const GRAPH_NODE_COLUMNS = Object.freeze([
  'from_labels',
  'to_labels',
  'from_is_exchange',
  'to_is_exchange',
] as const)

/** The kind of a link, when a query joins several link types. */
export const GRAPH_KIND_COLUMNS = Object.freeze(['link_kind'] as const)

/** Every optional column, in the order the hint names them. */
export const GRAPH_OPTIONAL_COLUMNS = Object.freeze([
  ...GRAPH_LINK_COLUMNS,
  ...GRAPH_KIND_COLUMNS,
  ...GRAPH_NODE_COLUMNS,
])

/** The columns a FLOWS_TO recipe must return beside from_address and to_address. */
export const FLOWS_RECIPE_COLUMNS = Object.freeze([...GRAPH_LINK_COLUMNS, ...GRAPH_NODE_COLUMNS])

/** The `RETURN` tail of a FLOWS_TO recipe over link `f` between `from` and `to`. */
export function flowsRecipeReturn(from: string, to: string, link = 'f'): string {
  return (
    `${from}.address AS from_address, ${to}.address AS to_address, ` +
    `${link}.amount_usd_sum AS amount_usd_sum, ${link}.tx_count AS tx_count, ` +
    `${link}.first_seen_timestamp AS first_seen_timestamp, ${link}.last_seen_timestamp AS last_seen_timestamp, ` +
    `${from}.labels AS from_labels, ${to}.labels AS to_labels, ` +
    `${from}.is_exchange AS from_is_exchange, ${to}.is_exchange AS to_is_exchange`
  )
}

/** The `AS name` columns a query returns. */
export function returnedColumns(query: string): string[] {
  return [...query.matchAll(/\bAS\s+([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1])
}

/** A query that draws a graph of FLOWS_TO links: it matches the link and returns both addresses. */
export function isFlowsGraphQuery(query: string): boolean {
  const columns = new Set(returnedColumns(query))
  return /\[\w+:FLOWS_TO\]/.test(query) && GRAPH_REQUIRED_COLUMNS.every((c) => columns.has(c))
}
