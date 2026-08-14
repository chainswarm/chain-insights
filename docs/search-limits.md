# Search Limits

Chain Insights bounds how far and how wide its tools search. The bound used
to be a constant compiled into the code; it is now a tunable knob with a
published default and a hard ceiling.

The remaining knob is the graph visualization limit. Trace/search depth
knobs were retired with the `aml_trace_*` tools in 0.18.7.

## Precedence

Highest wins:

1. **Per-call** — an argument on the MCP tool or a CLI flag.
2. **Config file, per network** — `networkLimits.<network>.<key>` in
   `~/.chain-insights/config.json`.
3. **Config file, all networks** — `limits.<key>`.
4. **Per-network default** — the built-in table for that network.
5. **Built-in default** — the value in the table below.

## Knobs

| Key | Bounds | Default | Ceiling | Per-call argument |
| --- | --- | --- | --- | --- |
| `viz_max_nodes` | nodes rendered before truncation | 100 | 2000 | `maxNodes` |

Defaults are exactly the values that used to be hardcoded, so an existing call
that passes no override behaves identically.

## Over-ceiling requests are rejected, not clamped

Asking for more than the ceiling returns a typed error naming the knob and its
limit. It does not quietly clamp:

```
viz_max_nodes must be an integer between 1 and 2000 (got 5000 from the
call). Nodes rendered in a generated graph view before truncation. The
ceiling is a hard bound and cannot be raised per call.
```

A silently clamped search returns a result that reads as exhaustive when it is
not — the same failure this whole surface exists to fix.

## Configuring

Per-call, through the visualization library (`truncateGraph(data, maxNodes)`):
the limit is resolved through the shared registry, so config still applies
when no explicit value is passed.

In `~/.chain-insights/config.json`:

```json
{
  "limits": { "viz_max_nodes": 200 },
  "networkLimits": {
    "robinhood": { "viz_max_nodes": 500 }
  }
}
```

Bad values fail at config load, not at render time. An unknown key is
rejected outright — a silently ignored knob is indistinguishable from one
that had no effect.

## Bounds that are deliberately NOT tunable

These are protocol or safety limits, not budget choices:

| Bound | Why it stays fixed |
| --- | --- |
| Max query text size (32 KiB) | A hard backend limit. Exceeding it fails the query; it is not a cost trade-off. |
| Queries per `graph_query_batch` (20) | The backend's protocol maximum. A larger batch is rejected server-side. |
| Per-query and per-request timeouts | Transport-level, not search breadth. |