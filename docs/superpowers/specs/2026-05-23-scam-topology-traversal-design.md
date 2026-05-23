# Scam Topology Traversal Design

## Context

The current `scam_topology` implementation is useful as a first pass, but its
seed semantics and topology boundaries are not strict enough for analyst-grade
label discovery.

Two problems need correction:

- Archive topology currently returns more rows than live topology for the same
  victim-adjacent query because archive exposes duplicate rollup granularities.
  Default topology traversal must use the existing GraphRAG pair-collapsed money
  flow view, not a new view and not a raw daily/monthly/yearly union.
- Victim inbound transfers were included as infrastructure context. For a
  victim-only input, inbound transfers are funding/context and must not be
  treated as scam infrastructure.

The tool's purpose is to discover laundering infrastructure from known scam
ground truth, capture all reachable intermediaries within bounded traversal, and
emit reviewable label candidates and investigation hints. It should help an
analyst decide what to flag, what to inspect next, and where the topology
naturally stops.

## Goals

- Expand directed money-flow topology level by level until a natural stop point.
- Preserve all intermediaries discovered within configured depth and row limits.
- Treat `exchange` as the only hard-coded domain-specific terminal class.
- Keep all other labels, roles, and entity context generic in the algorithm.
- Support a full-history topology scope and a post-incident topology scope.
- Allow later comparison/merge of both result sets.
- Keep victim/source safety strict: victim inbound transfers are not scam
  infrastructure and do not create risky labels.
- Use existing GraphRAG/StarRocks serving views for archive topology; do not
  introduce a new source view.

## Non-Goals

- Do not write labels directly to StarRocks or Memgraph.
- Do not hard-code miner, validator, subnet, hotkey, IP address, or chain-specific
  entity semantics in the traversal algorithm.
- Do not assume every reachable address is risky.
- Do not use Go-side local hash joins for topology/fact federation.
- Do not make exact incident-period amount accounting a prerequisite for
  topology traversal.

## Archive Topology Source Contract

Default `archive_topology` traversal should expose one logical `FLOWS_TO` edge
per `(from_address, to_address)` pair.

The backing source must be the existing GraphRAG pair-collapsed money-flow view:

```text
core_money_flows_graphrag_view
```

This view already derives from the overlap-safe serving view:

```text
core_money_flows_graph_serving_view
```

MemGQL mapping currently points `(:Address)-[:FLOWS_TO]->(:Address)` at the
StarRocks table/view name `archive_topology_edges_view`. That mapped name may
remain stable so the MemGQL JSON mapping does not need a new table name. The SQL
definition behind that name must change to select from
`core_money_flows_graphrag_view`.

Until that SQL definition changes, all archive traversal queries that touch
`archive_topology_edges_view` can duplicate logical edges because the current
view is a `UNION ALL` over current, daily, monthly, and yearly rollup views.

No new source view should be introduced for this fix.

Period-level rows remain useful for exact forensic accounting, but they are not
the default graph traversal surface because they can multiply paths across
daily, monthly, yearly, and current granularities.

## Traversal Inputs

`scam_topology` accepts:

- `victim_addresses`: trusted victim/source addresses.
- `scammer_addresses`: known scammer/attacker seed addresses.
- `network`: required.
- `max_hops`: bounded expansion depth.
- `per_address_limit`: bounded fan-out/fan-in per expansion.
- `min_amount_sum`: optional edge threshold.
- `since_timestamp_ms`: optional incident timestamp lower bound.
- `scope`: one of `history`, `incident`, or `compare`.

When `since_timestamp_ms` is provided, `incident` scope is available. When it is
absent, `history` is the only valid traversal scope.

## Scope Semantics

### History

`history` uses one-edge-per-pair topology without a time lower bound. It is best
for finding prior and long-lived infrastructure around the scam path.

Default graph:

```gql
USE archive_topology
```

### Incident

`incident` uses directed topology after the earliest known scam timestamp.
For pair-collapsed graph edges, the traversal predicate is:

```gql
r.last_seen_timestamp >= since_timestamp_ms
```

This means the edge had activity after the incident time. The edge amount may
still be pair-level aggregate data, depending on the selected topology graph.
Exact post-incident amount attribution should be handled as an evidence
enrichment step over period rows, not by duplicating topology edges.

Default graph:

```gql
USE live_topology
```

If the incident timestamp falls outside the live topology window, the tool should
use `archive_topology` with the same timestamp predicate.

### Compare

`compare` runs both `history` and `incident`, then classifies graph elements:

- `incident_only`: seen only after the scam timestamp.
- `history_only`: historical context not active in the incident window.
- `overlap`: present in both result sets.

`overlap` is the strongest infrastructure evidence. `history_only` is context,
not a risky label by itself.

## Seed Semantics

### Victim Seeds

Victim seeds are protected case roles.

Initial frontier:

```gql
MATCH (victim:Address {address: "..."} )-[r:FLOWS_TO]->(dst:Address)
```

Victim inbound transfers are excluded from scam infrastructure traversal. They
may be emitted separately as `victim_context` when requested, but they do not
become risky label candidates.

The first-hop recipients of victim outgoing flows are suspected infrastructure
anchors. Expansion continues from those recipients.

### Scammer Seeds

Known scammer seeds are ground-truth risky inputs provided by the operator.

Initial frontier:

```gql
MATCH (seed:Address {address: "..."} )-[r:FLOWS_TO]->(dst:Address)
```

Incoming flows to scammer seeds are funding/context unless the same source also
appears in laundering paths or shared infrastructure. They should not be
promoted automatically.

## Expansion Algorithm

The tool performs directed breadth-first expansion:

1. Build initial frontier from seed semantics.
2. For each frontier address, query outgoing `FLOWS_TO` edges.
3. Add unseen destination addresses as intermediaries.
4. Stop expanding through natural stop points.
5. Record stop hints for the analyst.
6. Continue until all frontiers are exhausted or `max_hops` is reached.

The traversal must retain every discovered intermediate edge and address within
configured limits, even if the address is not a label candidate.

Generic expansion query:

```gql
USE live_topology
MATCH (src:Address)-[r:FLOWS_TO]->(dst:Address)
WHERE src.address IN [...]
  AND src.address <> dst.address
  AND r.amount_sum >= min_amount_sum
RETURN src.address AS src,
       dst.address AS dst,
       dst.labels AS dst_labels,
       dst.is_exchange AS dst_is_exchange,
       r.amount_sum AS amount_sum,
       r.amount_usd_sum AS amount_usd_sum,
       r.tx_count AS tx_count,
       r.first_seen_timestamp AS first_seen_timestamp,
       r.last_seen_timestamp AS last_seen_timestamp,
       r.first_tx_id AS first_tx_id,
       r.last_tx_id AS last_tx_id
ORDER BY r.amount_sum DESC
LIMIT per_address_limit
```

When `since_timestamp_ms` is active, add:

```gql
AND r.last_seen_timestamp >= since_timestamp_ms
```

## Stop Policy

Only `exchange` is a special terminal domain class.

Stop reasons:

- `exchange_terminal`: destination is an exchange or exchange deposit candidate.
- `labeled_entity_context`: destination has labels or entity context that should
  be reviewed before expanding further.
- `high_degree_context`: destination exceeds configured degree guardrails.
- `dead_end`: destination has no outgoing edges in the selected topology scope.
- `depth_limit`: traversal reached `max_hops`.
- `row_limit`: expansion hit `per_address_limit`.

All non-exchange labels are payload only. The algorithm must not branch on
chain-specific names such as miner, validator, subnet, hotkey, or IP address.

The stop policy should be configurable later with an `expand_context` option.
Default behavior is conservative: stop at labeled context and emit a hint.

## Investigation Hints

Hints are generic and machine-readable.

Examples:

- `found_terminal_exchange`
- `review_labeled_entity`
- `continue_from_address`
- `expand_context_boundary`
- `compare_incident_and_history`
- `increase_depth_or_limit`
- `inspect_period_evidence`

Hints include the address, source role, hop, stop reason, labels/properties, and
the query scope that produced them.

## Label Candidate Policy

Label candidates are emitted for analyst review. They are not writes.

Candidate classes:

- Known scammer seed: high-confidence candidate from explicit operator ground
  truth.
- Victim outgoing first-hop recipient: suspected infrastructure candidate.
- Multi-hop intermediary: suspected laundering intermediary candidate.
- Exchange deposit candidate: terminal endpoint candidate, not necessarily the
  exchange itself.
- Shared infrastructure node: candidate when it touches multiple anchors or
  appears in both history and incident result sets.

Non-candidates:

- Victim seed.
- Victim inbound sender.
- Generic labeled entity reached at a stop boundary, unless also present in
  laundering paths under candidate rules.
- Exchange entity node itself.

Every candidate carries `review_required`.

## Result Model

Structured result facts:

- `case_roles`: victims, known scammers, protected seeds.
- `graph_scope`: `history`, `incident`, or `compare`.
- `topology_nodes`: all addresses/entities discovered.
- `topology_edges`: all traversed flow edges.
- `intermediaries`: non-terminal addresses on laundering paths.
- `terminal_points`: exchange terminals and other stop points.
- `label_candidates`: review-required candidates.
- `investigation_hints`: next-step hints.
- `safety_decisions`: why a node was not promoted.

Graph report roles should stay generic:

- `seed`
- `victim`
- `known_scammer`
- `suspected_anchor`
- `intermediary`
- `terminal_exchange`
- `context_boundary`
- `candidate`

## Query Strategy

Use `graph_query_batch` only. Keep each query within one topology graph.

For each expansion level:

1. Run one batched outgoing query over the current frontier.
2. Run a terminal/context classification projection in the same query where
   available from topology node properties.
3. Run optional fact enrichment separately through `USE facts` when labels or
   entity context need more detail.

Do not depend on cross-backend correlated joins until MemGQL behavior is fixed
upstream.

## Verification Plan

Unit tests:

- Victim inbound flows are excluded from scam infrastructure.
- Victim outgoing first-hop recipients become anchors.
- Expansion keeps all intermediaries until a stop point.
- Only exchange is hard-coded as a special terminal class.
- Non-exchange labels produce generic context hints.
- `history`, `incident`, and `compare` classify result membership correctly.

Integration/UAT:

- Run `scam_topology` for the known Bittensor victim address.
- Confirm initial scam path starts from victim outgoing flow, not inbound victim
  funding.
- Confirm all returned candidate labels are `review_required`.
- Confirm archive and live topology no longer disagree because of rollup
  duplication after archive mapping is moved to the existing GraphRAG view.
- Run final CIA CLI UAT through the real local stack, not only unit tests:
  - `cia mcp call graph_query_batch` against `USE live_topology` and
    `USE archive_topology` for the known victim adjacent-edge count; expected
    unique logical edge counts must match for this case.
  - `cia mcp scam-topology --network bittensor --victim-addresses <address>`
    and verify victim inbound transfers are absent from scam infrastructure.
  - `cia mcp call scam_topology ... include_attachments=true` through the MCP
    proxy and verify graph report metadata plus canonical graph JSON.
