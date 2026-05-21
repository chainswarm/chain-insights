# PuppyGraph Archival Cypher Fallback Plan

## Reader And Goal

Reader: internal ChainSwarm engineer working on Chain Insights, GraphRAG MCP, and StarRocks-backed money-flow rollups.

Post-read action: implement and validate a PuppyGraph alternative topology path over StarRocks rollups, then compare `track_funds` probe quality against the current Memgraph-backed path.

## Why This Exists

Memgraph remains the low-latency online topology store. The problem is archival coverage: keeping every historical money-flow edge in Memgraph competes directly with RAM. StarRocks already stores daily, monthly, and yearly rollups on disk. PuppyGraph is worth testing because it can expose a graph query surface over relational data, which gives us a possible Cypher-compatible path over archival rollups without loading all history into Memgraph.

Official docs confirm the basic fit:

- PuppyGraph connects to StarRocks through the MySQL-compatible JDBC path.
- PuppyGraph supports openCypher and Bolt clients.
- PuppyGraph has a StarRocks graph tutorial showing a Docker deployment next to StarRocks.

References:

- PuppyGraph StarRocks connector docs: https://docs.puppygraph.com/connecting/connecting-to-starrocks/
- PuppyGraph openCypher docs: https://docs.puppygraph.com/querying/querying-using-opencypher/
- PuppyGraph StarRocks tutorial: https://docs.puppygraph.com/getting-started/querying-starrocks-data-as-a-graph/

## Working Hypothesis

PuppyGraph will not beat Memgraph for hot, low-latency traversal. It might be good enough for archival `track_funds` queries where the alternative is no graph traversal at all after old edges have rolled out of Memgraph.

Success means:

- Memgraph remains the default topology backend for hot windows.
- StarRocks remains the system of record for rollups and detailed facts.
- PuppyGraph becomes an explicit archival topology backend for rolled periods.
- Chain Insights probes can compare both paths without changing public probe names.

## Current Baseline

Current probe flow:

```text
Chain Insights tool
  |
  | address_risk / track_funds local recipe
  v
GraphRAG MCP
  |
  | topology_query / topology_query_batch
  v
Memgraph hot topology

Chain Insights tool
  |
  | fact_query / fact_query_batch
  v
StarRocks facts_*_view
```

Target fallback flow:

```text
Chain Insights tool
  |
  | same probe name, provider selected by test/config
  v
GraphRAG MCP
  |
  | topology_query / topology_query_batch
  v
PuppyGraph over StarRocks rollup views
  |
  | JDBC read-only access
  v
StarRocks facts_*_view
```

No public fallback magic for the first implementation. The comparison must be explicit so we can see quality differences and avoid hidden behavior drift.

## Data Model To Test

PuppyGraph should only see read-only StarRocks views, not base tables.

Required graph shape:

```text
(:Address {network, address})
  -[:FLOW_TO {
      network,
      period_granularity,
      period_start_date,
      asset_contract,
      asset_symbol,
      tx_count,
      amount_sum,
      amount_usd_sum,
      first_seen_timestamp,
      last_seen_timestamp
    }]->
(:Address {network, address})
```

Supporting fact lookups remain SQL-backed:

```text
facts_money_flows_current_view
facts_money_flows_daily_view
facts_money_flows_monthly_view
facts_money_flows_yearly_view
facts_transfers_view
facts_address_labels_view
facts_address_features_view
facts_assets_view
facts_risk_scores_view
```

If PuppyGraph schema requires separate vertex views, add StarRocks views such as:

```text
facts_topology_addresses_view
facts_topology_edges_current_view
facts_topology_edges_monthly_view
facts_topology_edges_yearly_view
```

Those views should be granted to `mcp_readonly` only.

## Implementation Phases

### Phase 1: Local PuppyGraph Dev Stack

Add a disabled-by-default PuppyGraph service to the local dev compose stack.

Expected service shape:

```text
puppygraph
  image: puppygraph/puppygraph:stable
  ports:
    8081: Web UI
    7687: Bolt/openCypher
  connects to:
    dev-starrocks:9030 via JDBC
```

Acceptance:

- PuppyGraph starts locally next to StarRocks.
- It connects using `mcp_readonly`.
- It cannot read non-facts views or base tables.
- It can run a simple Cypher count over money-flow edges.

### Phase 2: StarRocks View Contract

Create the minimum extra views needed to model vertices and edges cleanly. Prefer deriving address vertices from existing rollup views, not duplicating persisted address rows.

Acceptance:

- Address vertices are unique per `(network, address)`.
- Flow edges are unique enough for traversal and reporting.
- Period granularity is explicit: `current`, `daily`, `monthly`, `yearly`.
- Edge amount and USD fields match StarRocks facts for sampled rows.

### Phase 3: GraphRAG Backend Adapter

Add an internal topology backend abstraction in GraphRAG MCP:

```text
topology backend = memgraph | puppygraph
```

Public tools stay the same:

```text
network_capabilities
topology_query
topology_query_batch
fact_query
fact_query_batch
```

Acceptance:

- The backend can be selected explicitly in dev/test configuration.
- `network_capabilities` reports which topology backend is serving a network.
- Existing Memgraph behavior remains unchanged.
- PuppyGraph query errors are surfaced as explicit backend errors, not silently retried through Memgraph.

### Phase 4: Chain Insights Probe Harness

Build a comparison harness for `track_funds`.

Inputs:

```text
network
trusted/source addresses
known scammer/untrusted addresses
max_hops
min_amount_sum
time window
granularity preference
backend = memgraph | puppygraph
```

Outputs:

```text
paths_found
terminal_exchange_candidates
unique_intermediaries
total_usd_traced
first_seen_timestamp
last_seen_timestamp
labels_attached
evidence_tx_anchors_available
runtime_ms
result_size
backend_errors
```

The harness should write JSON and a Markdown comparison table so results can be reviewed without rerunning the probe.

### Phase 5: Final Probe Comparison

Run `track_funds` on the same seeds against:

| Backend | Data Window | Expected Strength | Expected Weakness |
| --- | --- | --- | --- |
| Memgraph hot topology + StarRocks facts | Hot retained window | Fast traversal, best for current cases | Limited archival depth by RAM |
| PuppyGraph over monthly/yearly rollups | Archived rollup window | Broader historical reach without Memgraph RAM | Approximate paths, fewer tx anchors inline |
| StarRocks fact query only | Any available fact window | Exact aggregates and anchors | No native graph traversal |

The comparison is a probe-quality test, not a database benchmark. We care about whether an investigator gets the same useful leads and the same evidence boundaries.

Use this result shape:

```text
track_funds_comparison
  seed:
    network
    source_addresses
    untrusted_addresses
    max_hops
    min_amount_sum
    window_start
    window_end
  memgraph_hot:
    paths
    exchange_candidates
    labels
    anchors
    evidence_grade
    runtime_ms
    errors
  puppygraph_archive:
    paths
    exchange_candidates
    labels
    anchors_loaded_from_facts
    evidence_grade
    runtime_ms
    errors
  fact_only_control:
    direct_counterparties
    aggregate_amounts
    labels
    anchors
    evidence_grade
    runtime_ms
    errors
```

Comparison questions:

- Does PuppyGraph find the same first-hop and second-hop candidates as Memgraph for overlapping windows?
- Does monthly/yearly aggregation create false positives by collapsing paths that were not temporally adjacent?
- Can `track_funds` still produce investigator-ready evidence when tx anchors are loaded from `facts_transfers_view` after traversal?
- Is runtime acceptable for 2-hop, 3-hop, and 5-hop searches?
- Does query cost remain bounded when a high-degree address appears?

Required output table:

| Metric | Memgraph Hot | PuppyGraph Archive | Fact-Only Control | Decision Signal |
| --- | --- | --- | --- | --- |
| Paths found | count | count | not applicable | PuppyGraph should match direct and short-hop hot paths in overlapping windows |
| Terminal exchange candidates | addresses + labels | addresses + labels | direct only | Candidate set should not drift without explanation |
| Unique intermediaries | count | count | not applicable | Large inflation means rollup false positives |
| Total USD traced | exact or daily aggregate | monthly/yearly aggregate | exact aggregate | Delta must be explained by granularity |
| First/last activity | timestamps | period starts/ends | timestamps | Archive reports must disclose period precision |
| Tx anchors | inline or fetched | fetched from facts when available | fetched from facts | Missing anchors downgrade evidence grade |
| Runtime | milliseconds | milliseconds | milliseconds | PuppyGraph is allowed slower archival runtime, but must be bounded |
| Backend errors | list | list | list | No silent backend swap or hidden retry |

Pass condition:

- PuppyGraph is acceptable only if it gives additional archival reach and keeps candidate drift explainable.
- PuppyGraph is not acceptable if monthly/yearly rollups create noisy paths that cannot be filtered by time window, amount threshold, labels, or degree caps.
- Fact-only remains the control path. If PuppyGraph finds a path, the report must be able to rehydrate supporting labels, amounts, and available tx anchors from facts views.

Recommended first comparison seed:

```text
network: bittensor
window: one overlap window covered by Memgraph and monthly/yearly rollups
source set: addresses with known multi-hop flow and labels
max_hops: 2, then 3, then 5
min_amount_sum: start high enough to avoid dust edges
```

After Bittensor works, repeat on Ethereum/Base because high-degree addresses and larger pair counts are the real stress case.

## Funds Tracking Semantics

`track_funds` should not treat monthly rollups as equivalent to transaction-level flow. The result must disclose the evidence grade.

Evidence grades:

| Grade | Source | Meaning |
| --- | --- | --- |
| Exact | transfer rows or daily facts with tx anchors | Good enough for concrete report claims |
| Strong aggregate | daily rollups with full price coverage | Good for prioritizing paths and estimating amounts |
| Archival aggregate | monthly/yearly rollups | Good for leads, not final attribution without drill-down |

For PuppyGraph, traversal can identify candidate paths, but report generation should still fetch supporting facts from StarRocks:

```text
PuppyGraph path
  -> addresses and edge periods
  -> StarRocks fact_query for amounts, labels, tx anchors, price coverage
  -> Chain Insights report
```

## Main Risks

| Risk | Mitigation |
| --- | --- |
| Monthly/yearly rollups imply paths that never happened in sequence | Require period-aware path scoring and disclose evidence grade |
| High-degree nodes explode traversal cost | Hard caps on degree, hops, rows, runtime, and result size |
| PuppyGraph schema requires awkward edge IDs over aggregate rows | Add purpose-built StarRocks topology views |
| Agents confuse topology and facts | Keep public tool descriptions strict and keep high-level probes responsible for combining both |
| Read-only boundary leaks base tables | Grant only `SELECT` on `facts_*_view` and topology views to `mcp_readonly` |

## First Test Case

Use Bittensor first because the local stack already has:

- hot Memgraph topology
- StarRocks daily/monthly/yearly rollups
- local price coverage for historical periods
- Chain Insights `fact_query` and `topology_query`

Then repeat on Ethereum/Base after confirming the Bittensor harness.

## Done Definition

This spike is complete when:

- PuppyGraph runs locally against StarRocks with a read-only facts schema.
- A `track_funds` comparison report exists for Memgraph vs PuppyGraph over the same seed set.
- The report includes path counts, candidate exchange destinations, amount deltas, runtime, and evidence grades.
- We have a clear decision: keep PuppyGraph as archival fallback, reject it, or keep it only as an analyst-only experimental backend.
