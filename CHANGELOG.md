
# Changelog

All notable changes to Chain Insights are recorded here.

## [0.52.0] - 2026-10-09 — fix: Claude Desktop draws the graph again, every time

### Fixed

- Claude Desktop chat runs its conversations on the Claude Code engine, which
  starts Chain Insights twice: the copy from Claude Desktop's own settings,
  which draws the graph and the time series, and the copy from the Claude Code
  settings, which answers in text. With both present the model could pick the
  copy that cannot draw. Inside Claude Desktop the Claude Code copy now lists
  no tools when the drawing copy is configured, so each tool appears once.
- `cia setup claude-code` replaces an existing `chain-insights-proxy` entry
  instead of leaving it: an entry from an old install or an old checkout kept
  running an old version. It starts the proxy with Node's absolute path, which
  Claude Desktop needs.
- The server instructions tell the model not to draw the answer a second time
  with another drawing tool: the host draws it from the answer.

### Added

- `cia setup chatgpt`: sets up the ChatGPT desktop app, whose Codex chats run
  Chain Insights, and says to ask in a Codex chat, not a ChatGPT chat.

## [0.51.0] - 2026-10-09 — fix: an upgrade brings the new skill to every host

### Fixed

- `npm i -g chain-insights@X` updated the server but left each host reading
  the skill of the release it was set up with, until `cia setup` ran again.
  The MCP proxy now refreshes, when it starts, every skill copy setup
  installed for Claude Code, Codex and Hermes. It installs nothing new, never
  touches a symlinked skill, and never replaces a copy a newer release wrote.
  Setup stamps each copy with its version for this.
- The time-series scale writes tiny token amounts, never 0 (Chain Insights UI
  `c5f72b3`).

## [0.50.0] - 2026-10-08 — feat: time series, and the answer rules reach every host

### Added

- The view (Chain Insights UI `290788b`) draws a time series: a summary line
  with each series' total and peak, a read-out on hover and by keyboard, drag
  to zoom, one toggle per series, light and dark. A series across days is a
  `graph_query_batch` of one-day totals with each query id the day: the view
  joins it into one line, and a refused day is a shaded gap.

### Changed

- The answer rules open the server instructions: every address in full, 42
  characters, in every sentence, list and summary; no query text or `Ref:`
  line; tokens worth X USD, never "sent X USD"; no graph drawn in text.
  Claude Desktop reads no skill, so it never saw them and shortened addresses.
  `graph_query` and `graph_query_batch` say the address rule too.
- The picture is chosen by the question: who sent to whom is a graph, a change
  over time is a time series, anything else a table. The skill and the server
  instructions teach both served time-series shapes.

## [0.49.1] - 2026-10-08 — fix: no GPU, no WebGL: the graph draws as SVG

### Fixed

- The view (Chain Insights UI `f7f3e90`) took WebGL even when the browser drew
  it on the CPU (Claude Desktop with hardware acceleration off, a remote
  desktop). That is slower than SVG: 66.6 ms a frame at 1,000 addresses
  against 33.3 ms. Such a browser now draws the graph as SVG.

## [0.49.0] - 2026-10-08 — feat: the money flow graph draws on the GPU, thousands of addresses

### Changed

- The Claude and Codex view (Chain Insights UI `b991448`) draws the graph
  with WebGL (sigma.js 3) whenever the browser gives a WebGL context, and as
  SVG when it gives none or loses it for 2 seconds. On a Radeon iGPU, 3,000
  addresses pan and zoom at 60 frames a second (16.7 ms a frame; 83 ms with
  SVG), the first draw takes under half a second, and folding a hub that
  loaded 4,500 of 5,000 addresses takes about 15 ms. Past 500 links, links
  are straight arrows.
- The picture holds up to 5,000 addresses (was 60). A page that would pass
  that is not loaded; the status line says how to make room.
- `graph_expand` loads up to 500 links of an address a page (was 24), read in
  chunks of 200 rows, at most five graph_query reads a page, and cut to fit
  140,000 characters: a busy address shows about 360 to 420 links a page. Each
  page carries `remaining`: the senders and receivers still not loaded. The
  side panel shows them and offers More flows.
- A hidden list of the drawn addresses takes the keyboard: Down and Up move
  and highlight, Enter shows the details, Shift+Enter expands or folds.

## [0.48.1] - 2026-10-08 — perf: the money flow graph pans, zooms and drags smoothly

### Fixed

- The graph (Chain Insights UI `15e3514`) re-routed every link around every
  address on each pan, zoom and drag step: 118 ms per step at 60 addresses,
  6.5 s at 200. Pan and zoom now move the view only (0.1 ms per step at any
  size measured), a drag moves only the dragged address and its links and
  routes once on release, and past 120 addresses links are drawn as plain
  curves. Measured in headless Chromium: 60 frames per second up to 200
  addresses, 30 at 1,000, 12 at 3,000.

## [0.48.0] - 2026-10-08 — feat: the money flow graph: details on click, expand on double click, Reset

### Changed

- The Claude and Codex view (Chain Insights UI `9f7ac50`): one click on an
  address shows its details in one side panel; a double click (or
  Shift+Enter) loads its senders and receivers and gives the address a ring in
  a colour no role uses, and a second double click folds them back. The panel
  has Expand or Collapse and, for an expanded address with more pages, More
  flows. A link click shows the link's details and its transfers in the same
  panel. Reset, next to Fit, returns to the first answer.
- The graph's title is "Money flow graph", and addresses outside the drawing
  are shown in full; the drawing keeps short labels.
- The inline card is up to 640 px tall (was 480), and Full screen is offered
  unless the host lists display modes without it.
- A failed expansion is marked "too busy" only when the graph was busy or
  timed out; any other failure, such as a host that blocks the call, shows its
  reason and can be tried again.

## [0.47.1] - 2026-10-08 — fix: no network argument on meta_network_capabilities; pairs keep the graph column names

### Fixed

- A Codex CLI run sent `meta_network_capabilities({network: "robinhood"})` and
  got "Input validation error: Unrecognized key". The served instructions told
  the model to call that tool first and pass a network everywhere, and never
  said the tool takes no arguments. Its description, the served instructions,
  the runtime notes and the `chain-insights-cypher` skill now say: pass
  `network=robinhood` on graph tools; `meta_network_capabilities` takes no
  arguments (send `{}`) and is needed only to check which tools and layers are
  live. The input schema stays strict.
- The same run named a sender and receiver pair `sender` and `receiver`, so a
  host that draws views would show a table. The skill now says any query whose
  rows are address pairs names them `from_address` and `to_address`.

## [0.47.0] - 2026-10-08 — feat: setup codex installs a Codex plugin, so Codex can draw the views

### Changed

- `cia setup codex` (and `cia --codex`) now installs the Chain Insights Codex
  plugin instead of a plain `[mcp_servers.chain-insights]` entry. The Codex app
  draws an MCP app view only for a server that a plugin provides: the tool call
  must carry both the view's `ui://chain-insights/view` address and a plugin
  id. Setup writes a local one-plugin marketplace under
  `~/.chain-insights/codex-marketplace`, registers it and the plugin
  `chain-insights@chain-insights` in `~/.codex/config.toml`, removes the plain
  entry earlier versions wrote, and keeps every other entry. With the `codex`
  command on `PATH` it also runs `codex plugin add`; otherwise it prints that
  command. The proxy starts with the installing Node's absolute path, as
  `setup claude-desktop` does. Skills still go to `~/.codex/skills`.

## [0.46.6] - 2026-10-07 — fix: a rate-limited call waits and is sent once more

### Fixed

- A call the graph endpoint refuses for its request limit ("too many requests
  from this address; retry after 3 seconds") was shown as "MCP call failed",
  with no class, so the agent could not tell it apart from an outage. The
  proxy now waits the time the endpoint names, from 1 to 10 seconds, and sends
  the call once more. Every proxied tool only reads, and a refused call is not
  billed, so the second send is safe. `graph_expand` reads do the same.
- When the second send is refused too, or the endpoint asks for a wait longer
  than 10 seconds, the reply carries the `capacity` envelope
  (`error_detail.code` `rate_limited`, `class` `capacity`, a `fix` naming the
  wait), as the graph server does for its other limits.

## [0.46.5] - 2026-10-07 — fix: answers keep full addresses, tokens are not dollars, no query text

### Changed

- `chain-insights-cypher`: answers write every address in full, 42 characters,
  in a table or a sentence too. Answers do not print the query, its `USE`
  line, its `LIMIT`, computed epoch numbers or a `Ref:` line. Answers do not
  draw the graph in ASCII or Mermaid: Claude Desktop draws it from the column
  names.
- `chain-insights-cypher`: a transfer moves tokens. Its `amount_usd` is the
  value at the day's average price, so an answer says "tokens worth about X
  USD on DAY". The assets of one day come from `USE facts`, and a row with
  `price_missing` says that no price exists.
- `chain-insights-cypher`: a row that names its ends `src`, `dst` or `address`
  draws no graph. Alias them `from_address` and `to_address`.

## [0.46.4] - 2026-10-07 — fix: three gaps a weak model fell into

### Changed

- `chain-insights-cypher`: the network is `robinhood`, used without asking;
  time bounds are literal epoch milliseconds (the server has no `now()`); a
  link's `amount_usd_sum` and `tx_count` are lifetime totals, so a time-bounded
  search reports "lifetime total of pairs active in the window", and one day's
  money is read on `USE facts`. Found by a Haiku 4.5 test against staging.

## [0.46.3] - 2026-10-07 — fix: whole-chain questions are topology searches

### Changed

- The `chain-insights-cypher` skill, the routing lines and the guide teach a
  whole-chain question (recent activity, the biggest senders, a top list) as a
  `USE topology` search bounded by `f.last_seen_timestamp`, with two checked
  examples. A server without search mode refuses it with `anchor_missing`, and
  the agent then says so in one line. The "not served today" advice is gone.

## [0.46.2] - 2026-10-06 — fix: the question picks the layer

### Changed

- Routing: the skill, the guide and the served hints now route by what the
  question names (an address, a pair with a day, a transaction, a block). The
  first rule no longer reads "I do not know the thing yet", which sent a weak
  model to an unanchored topology search that the server refuses.
- The `chain-insights-cypher` skill opens "Pick the layer first" with a table:
  what the user asks, the layer, and the first query. It gains the newest links
  of one address (receivers and senders) and the profile of one address (counts,
  volume and the active window, read from the node).
- A question about the whole chain (recent addresses, biggest senders, a top
  list) is served on no layer today. The skill says so in one line, gives the
  sentence to tell the user, and asks for an address, a pair with a day or a
  transaction hash. It sends no probe and no workaround query.
- The skill tells an MCP host to call the `graph_query` tool, not a shell, and
  asks to be loaded before the first graph query.

- The served MCP instructions open with the routing paragraph, and the
  `graph_query` description names the skill. Claude Code shows a model only the
  first ~2 KB of the instructions; the routing now sits inside that window
  (Haiku 4.5 test: refused calls 13 against 22 without it, 20 runs each).

## [0.46.1] - 2026-10-06 — fix: a transaction is a chain question

### Changed

- Routing: a transaction is read on `USE chain` by its `tx_id`. `USE facts`
  is taught for an address pair with one day only. The skill, the guide and
  the served hints say the same; the skill no longer shows a facts read by
  transaction hash.

## [0.46.0] - 2026-10-06 — feat: one address, one transaction and one name on topology, facts and chain

### Breaking

- `USE chain` renames its keys and properties to the names that facts and
  topology already use. A transaction is `Transaction {tx_id}` (was `hash`). A
  block is `Block {block_height}` or `Block {block_hash}` (was `height` and
  `hash`). The head serves `block_height` and `block_hash`. There are no
  aliases: the old names are refused like any key or property a label lacks
  (`chain_key_invalid` for a key, `chain_not_served` for a property). Saved
  queries with the old names are refused until they use the new ones.
- `block_timestamp` on chain is an integer number of epoch milliseconds (was
  datetime text), the same unit as facts and topology.
- Needs a graph server that serves the unified names. The `chain-insights-cypher`
  skill, the served hints, the routing lines and the query corpus teach the new
  names only.

### Added

- `USE chain MATCH (a:Address {address: "0x…"}) RETURN a.balance, a.nonce, a.is_contract`
  reads one address at one block: `balance`, `nonce`, `code_size`,
  `is_contract` and `delegated_to`. Add `at_block` to read a past block. A past
  block must be at least `chain_admission.at_block_min_depth` blocks below the
  tip, and a nearer one is refused with `chain_block_out_of_range` and the rule
  `at_block_near_tip`. A kind is no lookup label.
- `network` on every node and relationship of every layer. Its value is the
  query's `network`, it is never stored, and a `:Chain` node keeps its own, which
  names the remote chain.
- `:Account` and `:Contract` kind labels on `:Address` on topology, with
  `is_contract` kept beside `:Contract`. Facts serves no kind: a facts read that
  names `:Account` or `:Contract` is refused with `facts_no_anchor`.
- A chain lookup of an address in the documented recipes and in the query
  corpus. The corpus now holds the chain lookups beside the topology and facts
  queries.
- `at_block_min_depth` in the typed `chain_admission` block of the capabilities
  reply.

### Changed

- The routing lines name a transaction by `tx_id`, a block by `block_height` or
  `block_hash`, an address at one block, and the head. The line that said chain
  has no address lookup is replaced by one that offers the `Address` lookup.
- `chain-insights-cypher` gains "One name on every layer": one table of the
  address, the kind, the transaction, the block, the time and `network` on the
  three layers, the kind labels, and the summary links and event rows
  (`SWAPPED`, `ADDED_LIQUIDITY`, `REMOVED_LIQUIDITY` against `SWAP`,
  `LIQUIDITY_ADD`, `LIQUIDITY_REMOVE`). Its chain section teaches the renamed
  keys and the `Address` lookup with full addresses, and rule 2 says that
  timestamps are epoch milliseconds on every layer, chain included. The Claude
  plugin copy is synced.
- `meta_schema` needs no change. It reads the live graph, so on a server with
  the unified names it lists `Account` and `Contract` among the labels and
  `Address` among the chain lookups, and the keys of an address still hold
  `network`. A test holds the build to that answer.
- The guides and the README no longer say that `network` is a stored property of
  an address, and the unscoped sweep example drops its `network` predicate.
- The pins of the server's chain catalogue, facts columns and facts read
  contract carry the unified names, `network` and the three kind-label
  refusals.

## [0.45.0] - 2026-10-06 — feat: meta_schema, the live graph schema of a network

### Added

- `meta_schema`, a local MCP tool beside `meta_help` and
  `meta_network_capabilities`. It takes `network` (required) and `refresh`
  (optional) and returns the live graph schema of that network, read from the
  Chain Insights Graph instead of a hand-written skill: the labels, the link
  types, every property key, the indexes, the fields of an address and of each
  main link (`FLOWS_TO`, `OPERATED_BY`, `LINKED`, `SWAPPED`, `BRIDGED`,
  `ADDED_LIQUIDITY`, `REMOVED_LIQUIDITY`), the `USE facts` relationships with the
  `TRANSFER` columns, and the `USE chain` lookups. The model gets a compact text
  schema, and `structuredContent` holds `chain-insights.graph-schema.v1`. The tool
  is read-only, titled "Graph schema" and visible to the model.
- A build reads the catalog statements the graph serves on `USE topology`
  (`CALL db.labels()`, `CALL db.relationshipTypes()`, `CALL db.propertyKeys()`
  and `SHOW INDEXES`) and samples the keys of an address and of each main link
  through `graph_query`, with the network's published capabilities for the facts
  and chain layers. `CALL db.schema.visualization()` is not read: it bills 427
  units where the four above bill 13 to 133 each. The fields come from a sample,
  so the answer says a rare field may be missing. A build is 13 reads through one
  MCP session and bills about 1,000 units, measured on the default endpoint.
- The schema is cached on disk for 24 hours, one file for each network and
  endpoint (`~/.chain-insights/cache/schema-<network>-<endpoint hash>.json`).
  A cache hit sends no request. `refresh=true` rebuilds. A read that fails leaves
  its section empty and adds a note, and such a schema is kept for 10 minutes
  only. A rate limit of the endpoint stops the reads after it and says when to
  call again.
- `cia network <name> --schema` prints the same schema in the terminal, `--json`
  prints the structured form, and `--refresh` rebuilds it.
  `cia mcp call meta_schema network=robinhood` does the same. The `meta-schema`
  prompt names the tool.

### Changed

- The server instructions say "Call meta_schema {network} first when you need
  field names; it is cached for 24 hours", and `meta_help` lists the tool.
- `chain-insights-cypher` sends an agent to `meta_schema` first in "Find the
  fields". The two sampling reads stay as the fallback. The five catalog calls
  are named as served, and the skill tells an agent not to send them: `meta_schema`
  sends four of them through one session and keeps the answer. The Claude plugin
  copy is synced.
- `src/mcp/cache-location.ts` holds the home directory and the 24 hour lifetime
  that the tool list cache and the schema cache share.
- README, the MCP proxy guide, the graph tools guide, the architecture pages and
  the stability page name the tool. The public MCP surface is eight tools.

## [0.44.1] - 2026-10-06 — feat: graph searches in the cypher skill; the EVM schema skill is retired

### Added

- `chain-insights-cypher` has a "Graph searches" section with one query for
  each kind of search. Every query was run against the live Chain Insights
  Graph and returned rows: a route between two addresses (`SHORTEST 1`), several
  routes (up to 3 hops, no selector), where the money went and where it came
  from (guarded walks, up to 3 hops out and in), the counterparties two
  addresses share, an ownership cluster over `LINKED`, the operator view over
  `OPERATED_BY`, the swaps an address paid for (`SWAPPED`), the pool trace
  (`REMOVED_LIQUIDITY`) and the bridges an address used (`BRIDGED`). The server
  serves `SHORTEST 1` and `ANY SHORTEST`, one path each: a count above 1 and the
  match mode that asks for every shortest path are refused with
  `route_search_refused`, so the skill shows several routes without a selector.
- The skill states the topology limits once (at most 5,000 rows and 100 for a
  probe, 5 hops in a path, 8 in a query) and the units (integer milliseconds in
  UTC, `block_date` as a day, `*_usd` in US dollars, `*_raw` in the smallest unit
  of the token). `tests/fixtures/topology-admission-20261006.json` pins the four
  limits it states.
- "Find the fields": two sampling reads that the server admits today
  (`keys(a)` on addresses and `keys(r)` on a link), a line on how to read the
  keys of another link type, a line on the `TRANSFER` columns and their `kind`,
  and a line that names the catalog calls (`CALL db.labels()`,
  `CALL db.relationshipTypes()`, `CALL db.propertyKeys()`,
  `CALL db.schema.visualization()` and `SHOW INDEXES`) as being enabled on the
  server. The server refuses them today (`unsupported_topology_dialect`), so
  the skill tells agents not to send them yet.

### Removed

- The `chain-insights-schema-evm` skill, from `skills/` and from the Claude
  plugin. The labels and properties it listed go stale, and the sampling reads
  above read them from the graph itself. `cia setup` and `cia --claude` delete
  an installed copy, as they do for every retired skill. The pool trace rule,
  the units and the role-flag rule it held now live in `chain-insights-cypher`,
  which is the rule's one home.

### Changed

- The README, the plugin README, the guides and the workspace notes name the
  cypher skill alone. The corpus, the topology rule table and the routing table
  fixtures are regenerated from the one skill.
- `tests/skills-contract.test.ts` accepts three guarded walk shapes beside the
  route shapes (several routes, outward, inward) and holds the skill to one
  query for each kind of search, to full 42-character addresses, to the stated
  units and limits, and to the two sampling reads. The tests that pinned only
  the removed skill are gone.

## [0.44.0] - 2026-10-06 — fix: aml_address_risk hidden until its verdict is fixed; short ISO GQL skill; schema skill refreshed

### Removed

- `aml_address_risk` is hidden until its verdict is fixed. The MCP proxy does
  not list it, does not register a local copy when the Chain Insights Graph
  lacks it, and does not name it in the server instructions, in `meta_help` or
  in the prompts. A call to it through the proxy is refused as an unknown tool.
  `cia mcp call aml_address_risk` is refused too. The `aml-address-risk` MCP
  prompt is gone. `cia workflow aml-address-risk` stays in the CLI and is no
  longer advertised in the README, the docs or the workspace notes.
- The `chain-insights-address-risk` skill. `cia setup` and `cia --claude`
  delete an installed copy, as they do for every retired skill. The Claude
  plugin never carried it.

### Changed

- `chain-insights-cypher` is rewritten to standard ISO GQL only, in 197 lines
  instead of 513. It opens with the rules that stop the failures small models
  made: write every address in full and in lowercase, never shorten one;
  timestamps are integer milliseconds, never compared with an ISO string;
  `USE chain` returns ISO text for `block_timestamp`; a wrong address or an
  ISO string gives zero rows with no error; do not run a risk screen, write
  files or run `cia --help` unless asked; fix a refused query once, then tell
  the user what cannot be asked. It keeps the routing lines, the move by
  refusal class, and the picture column convention. It carries eight examples
  with full addresses, each admitted by the live endpoint: a route, one
  address, the newest receivers, a facts read of a pair and a day, a facts
  read of one transaction hash, and the three chain lookups. The table of
  every refusal code and the swap, kind and limit sections are gone: the
  refusal carries its own `fix` and `example`, and the schema skill holds the
  rest.
- `chain-insights-schema-evm` is refreshed against the live graph, in 541
  lines instead of 644. Units and the full-address rule open it. The risk
  verdict (`risk_score`, `risk_level`) and the ML pattern links are removed,
  because the risk layer is off (`layers.risk.enabled` is false). The labels
  `SmartAccount`, `Bundler`, `Paymaster`, `EntryPoint` and `Protocol`, the
  `token_standard` property and the properties of the three chain lookups are
  added. The dated swap statistics and the examples that only repeated the
  recipes are gone. Its examples use full 42-character addresses.
- README, `docs/`, the workspace notes and the plugin description no longer
  advertise `aml_address_risk`. The public tool list is seven tools.
- Test fixtures `tests/fixtures/topology-shape-cases.json` and
  `tests/fixtures/layer-routing.json` are regenerated from the new skill
  examples (`npm run corpus:generate`).

### Changed (Claude view)

- A chart is drawn only for 3 or more time points and no address column; a
  head lookup or a short series shows as a table.
- A refused query or an empty result draws one short line instead of a card.
- The server instructions no longer teach `risk_score` or `risk_level`: no
  overall risk score is served. Per-label risk lists stay.

## [0.43.1] - 2026-10-06 — fix: Claude Desktop setup warns while Claude Desktop runs

### Fixed

- `cia setup claude-desktop` warns when Claude Desktop is running. Claude
  Desktop writes its whole settings file back when it saves its settings, so
  an entry added while it runs can be lost. The warning names how to quit it
  on macOS, Windows and Linux.
- README: the Claude Desktop setup steps say to quit Claude Desktop fully
  first, for each operating system, and where the entry is written.

## [0.43.0] - 2026-10-06 — feat: pictures come from graph_query columns; money_flows withdrawn; graph_expand link clicks

### Removed

- `money_flows` is withdrawn: the MCP proxy no longer offers it, `cia mcp tools`
  no longer lists it, and `cia mcp call money_flows` is refused as an unknown
  tool. Ask for the senders and receivers of an address with your own
  `graph_query`. The picture now comes from the column names of the answer, not
  from a dedicated tool.

### Added

- `graph_expand`, the tool only the Claude view calls, takes a link form,
  `{network, from, to, day}`, beside the node form
  `{network, address, in_offset?, out_offset?}`. The link form lists the
  transfers from one address to another on one UTC day (`YYYY-MM-DD`), newest
  first, at most 50, with `truncated` set when the day holds more. It is one
  `USE facts` `graph_query` read, billed like any graph query. Both addresses
  and the day are checked before the read: a malformed one is refused and
  reaches no endpoint. A facts read takes no `ORDER BY`, so the proxy reads up
  to 200 rows of the day and sorts them itself.
- The answer is `chain-insights.transfers.v1`: `network`, `from`, `to`, `day`,
  `transfers` (each with `tx_id`, `block_timestamp`, `amount`, `asset_symbol`
  and `amount_usd`) and `truncated`, plus a short text summary. A refusal of the
  Chain Insights Graph (`query_timeout`, `topology_busy`, a facts limit) comes
  back as an error with its text.

### Changed

- The server instructions and the `chain-insights-cypher` skill teach the column
  convention. Rows with `from_address` and `to_address` columns draw a graph in
  Claude Desktop (optional `amount_usd_sum`, `tx_count`, `first_seen_timestamp`,
  `last_seen_timestamp`, `link_kind`, `from_labels`, `to_labels`). Rows with a
  `day`, `date` or `*_timestamp` column and number columns draw a chart. Any
  other rows draw a table. Each carries one example query.
- The text of a node answer of `graph_expand` no longer names a paging command.
  `cia mcp call graph_expand` is still refused and now points to
  `cia mcp call graph_query`.

## [0.42.2] - 2026-10-06 — fix: money_flows pages from the terminal and from Claude; dependency updates

### Changed

- The last lines of a `money_flows` answer say which senders and receivers it
  shows ("Showing senders 1 to 12 of 246 …") and how to read the next page:
  `money_flows` with `in_offset` and `out_offset`, the exact
  `cia mcp call money_flows … in_offset=… out_offset=…` command, or a click in
  the Claude Desktop picture. The old line "the view loads the next page on
  click" meant nothing in a terminal.
- `money_flows` accepts `in_offset` and `out_offset` (0 to 10,000) in the MCP
  proxy and in `cia mcp call`, so Claude and a terminal can page as the picture
  does.

### Dependencies

- `@modelcontextprotocol/sdk` 1.32, `@x402/evm` and `@x402/fetch` 2.28,
  `viem` 2.57, `zod` 4.6.5, `open` 11.0.4; tooling: vitest 5.0.3, oxlint,
  prettier, publint, tsx, `@types/node`. `@modelcontextprotocol/ext-apps`
  stays on 1.7.5: the Claude view targets the 1.x protocol client.
- GitHub Actions: `github/codeql-action` 4.38.2, `anchore/sbom-action` 0.24.3.

## [0.42.1] - 2026-10-06 — feat: cia config reset, and money_flows from the CLI

### Added

- `cia config reset` puts every setting back to its default: the production
  Chain Insights Graph endpoint, paid mode, no test access key. The wallet
  stays (`wallet.json` is not touched and its address is kept). The previous
  settings are saved to `config.json.bak`; both files are owner-only. It also
  replaces a settings file that is not valid JSON.
- `cia mcp call money_flows network=robinhood address=0x…` runs the same tool
  the MCP proxy gives Claude, and `cia mcp tools` lists it. `graph_expand`
  stays out of the CLI: only the money-flow view calls it.

### Changed

- A money-flow line last seen under a day ago reads "less than a day ago",
  not "today", so it never contradicts its UTC date.

## [0.42.0] - 2026-10-06 — feat: the swap route is a topology question, and TRANSFER lists internal transfers

An agent that uses `cia` now learns two changes of the graph server's facts
layer. A facts `SWAP` row carries no route. A facts `TRANSFER` row covers every
transfer the money-flow link counts, internal transfers included.

### Changed

- The swap route is a topology question. A `USE facts` `SWAP` row has no
  `pools` and no `families` column, and a read that names one of them, to
  return it, to filter on it or to order by it, is refused. The route of a swap
  is `SWAPPED.pools` and `SWAPPED.families` on `USE topology`, anchored on the
  payer or the recipient. `SWAPPED` has one link per payer, recipient, sold
  asset and bought asset, so its `pools` cover every route on the link, not one
  route. `route_id` stays on the facts row. The property table of the
  `chain-insights-schema-evm` skill lists the columns the server maps on `SWAP`
  and no route list.
- The note "Temporary, until graph server issue 1121 is fixed" is gone. It told
  an agent to leave `pools` out of a facts `SWAP` read, and it named a second
  column that the facts row no longer has. It stood in both skills,
  `docs/graph-tools.md`, `docs/graph-query-compatibility.md`, the served graph
  hints and the workspace runtime notes. The permanent rule stands in each of
  them.
- "No MCP read lists internal native transfers yet" is gone from the schema
  skill, `docs/graph-tools.md`, the served graph hints, the workspace runtime
  notes and the comment of the anchor query. Every `TRANSFER` row has a `kind`:
  `token`, `native` or `internal`. An `internal` row is ETH a contract sends
  while it runs a call, such as the ETH leg of a wrap. `kind` is a column and a
  filter: add `t.kind = "internal"` to the pair and the day to read only the
  internal rows. The rows of a pair are the transfers its `FLOWS_TO` link
  counts, up to the height the link was built to, so a pair with a `tx_count`
  above 0 has `TRANSFER` rows. An `internal` row has an `edge_index` of 0 and
  no `raw_amount`, so a sum names `amount` or `amount_usd`. The call depth, the
  call type and the parent frame are not served.
- The transaction anchor of a pair no longer says it works only for a pair with
  token or native transfers. A pair that only internal transfers move has a row.

### Added

- A `USE facts` example in the `chain-insights-cypher` skill that reads the
  internal rows of a pair on one day with `t.kind = "internal"`.
- `tests/fixtures/facts-columns.json`, made by `scripts/pin-facts-columns.mjs`
  from the graph server's mapping of the facts relationships: the property names
  each of the five serves, and nothing else. `tests/swap-route.test.ts` holds
  the skill's `SWAP` property table to it and checks that no shipped query names
  a route column in a facts `SWAP` read. `tests/transfer-kind.test.ts` holds
  every list of `TRANSFER` properties to it, and fails when a home still says an
  internal transfer is not listed. Both replace `tests/swap-read-stopgap.test.ts`
  and the sentences it pinned.

### Fixtures

- `tests/fixtures/facts-contract.json` is the pin of the graph server's current
  read contract: the numbers, the codes and the 53 refusals are unchanged.
  `tests/fixtures/server-refusal-codes.json` names the server commit it was
  re-read from, with the same 40 codes.

## [0.41.0] - 2026-10-05 — feat: pick the layer first, act on every refusal, and show a tool error as the server's own text

An agent that uses `cia` now learns which layer a question goes to, and what to
do with each refusal. A refusal is the server answering, and `cia` no longer
shows it as a dead endpoint.

### Fixed

- `cia mcp call` printed any tool error whose text held the word `network` as
  "Could not reach the Chain Insights Graph endpoint (the endpoint is
  unreachable)". The text of a switched-off chain layer, `chain_unavailable:
  the chain layer is switched off. Check chain_admission.enabled in
  network_capabilities.`, is one, and so is `invalid_network`. A tool reply
  with `isError` is now an `McpToolError`. `cia mcp call` prints the server's
  own text, then one line, `code <code> · class <class> · <fix>`, and exits
  with a non-zero status. For `chain_unavailable` the line adds that the chain
  layer is off or behind, that the endpoint is up, and that `USE topology` and
  `USE facts` still work. The bare word `network` no longer marks a message as
  a transport failure. A dropped connection still reads "Could not reach the
  Chain Insights Graph endpoint".
- The routing rule offered a lookup the chain layer does not have. It read "I
  know one address, hash or block", so an agent that knew an address sent it to
  `USE chain` and got a refusal back. The chain layer serves a transaction by
  its hash, a block by its number or its hash, and the head. An address now
  goes to `USE topology` to be found, and then to `USE facts` for the rows.
  `tests/fixtures/chain-catalogue.json` pins the labels the chain layer serves,
  with the keys and properties of each, and a test holds every `USE chain`
  recipe and the routing line to that pin.
- `docs/graph-tools.md` said that at most 4 topology queries run at once. That
  number belongs to the server, which publishes it, and the 4 was the chain
  layer's. The guide now names `topology_admission` in
  `meta_network_capabilities` and writes no number.

### Added

- The `chain-insights-cypher` skill teaches three read layers, not two. It
  opens with the routing rule: topology searches, while facts and chain look up
  one known thing. It has the question table, the keys the layers hand to each
  other, and a plain "served on no layer" for a list, a range or a
  whole-chain question.
- "When a query is refused": the move for each class of `error_detail`
  (`refused`, `killed`, `capacity`, `failed`), one rewrite or one retry and then
  the user, and one row for each of the 40 codes the server returns, with its
  layer and class. A test fails when the server returns a code with no row.
- `USE chain` recipes for `Transaction`, `Block` and `Head`, in the skill and
  in `tests/fixtures/documented-recipes.json`, and a "USE chain" section in the
  `chain-insights-schema-evm` skill and in `docs/graph-tools.md`.
- The facts limits are stated in words, and a test pins them to the server's
  contract: an address pair with one day, or one transaction hash; at most 200
  rows in a reply; one relationship and no hop; no `ORDER BY`. The pinned files
  are `tests/fixtures/facts-contract.json` and
  `tests/fixtures/server-refusal-codes.json`. `scripts/pin-facts-contract.mjs`
  makes the first from the server's list of read shapes.
- `src/mcp/layer-routing.ts`, the one source of the routing rule and the move
  by class. The served graph hints are built from it, and the skill and the
  guide hold the same lines word for word.
- `tests/fixtures/layer-routing.json`, written by `npm run corpus:generate`:
  every recipe, every fenced query of the two skills and every query of the
  served hints, with its layer. A test holds each entry to the rule of its layer.

### Changed

- `meta_network_capabilities` and `cia networks --json` keep `layers`,
  `chain_admission`, `topology_admission` and `facts_admission` exactly as the
  server sends them. They were dropped before. A block the server does not send
  stays absent. The skills name the field and no longer write a limit that the
  server publishes: the line "Topology queries share 4 slots" is gone, and a
  test fails when a skill, a guide or a hint states a `chain_admission` number.
- Three served hints taught reads the topology guard refuses, and now teach
  reads it admits: the `LINKED` enumeration and the actor-level exposure read
  end with a `LIMIT`, and the schema discovery probe has no `WHERE`.
- The reader of the facts limits in `tests/support/facts-contract.ts` answers as
  the server does, with one code for each read, and a test holds it to every
  refusal on the server's list.

## [0.40.0] - 2026-10-05 — feat: Chain Insights views in Claude, served by the local proxy; money flows, the top-up QR view, and the Claude plugin

Claude Desktop and Cowork sessions on your computer draw Chain Insights views
next to a tool answer. The local `cia` MCP proxy serves every view itself and
reads the Chain Insights Graph for the data only. The old local graph viewer is
gone.

### Added

- `cia setup claude-desktop`: registers the local MCP proxy in Claude
  Desktop's `claude_desktop_config.json` (macOS, Windows, and
  `$XDG_CONFIG_HOME/Claude` on Linux), keeping every other server and setting
  and writing a `.bak` copy first. It starts the proxy with the installing
  Node's absolute path, because Claude Desktop does not inherit a shell PATH.
  A file that is not valid JSON is refused and left untouched.
- `ui://chain-insights/view`, served by the local proxy from one HTML file in
  the package (`src/mcp/apps/claude-view.html`, rebuilt with
  `scripts/refresh-claude-view.mjs <commit>`). It draws the money-flow graph,
  the `graph_query` result table and the balance of `meta_usage_status` and
  `meta_subscription_status`, in Claude's light or dark theme. Nothing is
  fetched at run time.
- `money_flows`, a local MCP tool: one robinhood address with its 12 most
  recent senders and receivers, each link with lifetime USD, transaction count
  and age. The model reads a text summary of at most 20 lines; the view draws
  `chain-insights.flows.v1` (at most 60 addresses, under 40,000 characters).
  It makes three anchored `graph_query` reads through the configured endpoint,
  billed as graph queries.
- `graph_expand`, a local MCP tool only the view calls
  (`_meta.ui.visibility` `["app"]`): the next page of one clicked address. A
  refused read (`query_timeout`, `topology_busy`, any error) answers as an
  error naming its code, and the view marks the address.
- Both refuse a malformed address, a network other than robinhood and an
  offset over 10,000 before any read, at no cost.
- `graph_query`, `meta_usage_status` and `meta_subscription_status` name the
  view in their `_meta.ui`. Their answers are unchanged.
- `wallet_topup`, a local MCP tool with the view `ui://chain-insights/topup`:
  the local wallet address, its QR code, Base Mainnet and USDC, in Claude's
  light or dark theme. It reads the address only; it signs and sends nothing.
  With no wallet it names `cia wallet create`.
- `plugin/`, the Chain Insights Claude plugin: the `chain-insights-cypher` and
  `chain-insights-schema-evm` skills, and a `.mcp.json` that starts the local
  proxy (`chain-insights-mcp-proxy`) over stdio from this package. It runs in
  Claude Desktop, Cowork sessions on your computer and Claude Code; claude.ai
  on the web, the mobile apps and Cowork cloud sessions cannot start it.
  `.claude-plugin/marketplace.json` lists it. `scripts/sync-plugin-skills.mjs`
  keeps the plugin skills equal to `skills/`, and a test fails when they drift.

### Changed

- The proxy no longer forwards views from the graph endpoint: its `ui://`
  resources, its tools' `_meta.ui` and its app-only tools are ignored. The
  proxy is the only source of views.

### Fixed

- The QR code generator encodes a 42-character address. It picked version 2,
  which holds at most 32 bytes, so the address QR code did not scan. It now
  picks the smallest of versions 1 to 4.

### Removed

- The local graph viewer: `src/viz/`, the local Hono server (`src/server/`),
  `src/mcp/artifact-server.ts`, `src/mcp/graph-reports.ts`, their tests, and
  the `hono` and `@hono/node-server` dependencies. `aml_address_risk` in
  workspace mode no longer writes a `.graph.html` file; it still writes the
  graph JSON, the tables and the report.

## [0.38.0] - 2026-10-05 — feat: anchored topology recipes and the list of queries the graph must refuse

This release changes recipes, text and tests only. The CLI and the MCP proxy
behave as in 0.37.5, apart from the hint text the proxy serves. The graph
server will refuse a topology read that has no address in its pattern, and a
route search that asks for more than one path. This release stops showing those
reads as reads that work, and adds the list that the server and the skills are
both tested against.

### Changed

- The whole-graph recipes are gone from `tests/fixtures/documented-recipes.json`.
  `recipe_topology_06`, the 25 largest links of the whole graph, reads the 25
  largest inflows of one address; `recipe_topology_05` already reads the
  outflows. Both return `first_seen_timestamp` and `last_seen_timestamp` of
  each link, so a caller can name the day of a link. `recipe_topology_07` (the
  out degree of every source) and `recipe_topology_09` (a prefix scan) are
  removed: the out degree of one address is the node property `degree_out`, and
  a prefix is not an anchor on any layer.
- `ALL SHORTEST` is no longer taught. A route search asks for one path:
  `SHORTEST 1` or `ANY SHORTEST`. The recipe that asked for every shortest
  path is removed, and the dialect skill, `docs/graph-tools.md`,
  `docs/graph-query-compatibility.md` and the served graph hints say so.
- The route example ends in `LIMIT 5` in `docs/graph-tools.md`, in the dialect
  skill and in the served graph hint. A topology read without a literal `LIMIT`
  is refused, so the example as it stood was a query the server would refuse.
- The dialect skill states the anchor rule: an address in every pattern, the
  probe as the one read without one, a `LIMIT` of at most 5,000, at most 5 hops
  in a path and 8 in a query, one path for a route search, and a refusal that
  carries `error_detail` with a fix and an example.
- The generated corpus holds 46 entries, from 49. The entry
  `addressFeatureQuery` has the scope `topology`: its text starts with
  `USE topology`, and it was filed as `facts`.

### Added

- `tests/fixtures/topology-shape-cases.json`, written by
  `npm run corpus:generate`: the topology queries the graph must admit (every
  `USE topology` query of the corpus, of the documented recipes and of the
  examples of the two skills) and the queries it must refuse. Each refusal names
  the code and the rule word it must get, from `aggregate_unanchored`,
  `anchor_missing`, `cartesian_product`, `hop_budget`, `limit_missing`,
  `query_too_large`, `route_search_refused`, `unsupported_expression_shape`
  and `unsupported_topology_dialect`. The texts of the removed recipes are
  refuse cases.
- `tests/topology-shape-cases.test.ts` keeps that file equal to a fresh run,
  keeps every `USE topology` example of the two skills in the admit list and
  every refuse case out of them, fails when a skill, a guide or a served
  hint teaches `ALL SHORTEST`, and fails when a shortest-path search that
  `docs/graph-tools.md`, the dialect skill or a served hint shows has no
  literal `LIMIT` of 5,000 or less.

## [0.37.5] - 2026-10-05 — fix: the facts recipes and examples name an address pair with one day, or a transaction hash

This release changes recipes, text and tests only. The CLI and the MCP proxy
behave as in 0.37.4. The graph server will refuse a `USE facts` read that
names one address, a day alone, a window of days or an `ORDER BY`, and this
release stops showing those reads as reads that work.

### Changed

- A `USE facts` read names an address pair with one day, or one `tx_id`. The
  pair is both endpoint addresses, from then to, and the day is a `block_date`
  equality. A facts read has one relationship and takes no `ORDER BY`. The
  dialect skill, the schema guide, `docs/graph-tools.md`, the served graph
  hints and the workspace runtime notes say so for `TRANSFER`, `SWAP`,
  `LIQUIDITY_ADD`, `LIQUIDITY_REMOVE` and `BRIDGE_CROSSING`. They no longer
  advertise one address, a day alone, a block range, the 90-day window an
  address read once got, or an `ORDER BY` as reads that work.
- The transaction anchor of a pair reads one transfer on one day: take the
  day from the `first_seen_timestamp` or `last_seen_timestamp` of the link.
  `pairAnchorQuery` takes that day in place of `ASC` or `DESC`.
- The time-window example in the dialect skill and in `docs/graph-tools.md`
  names a pair.
- `Asset` is no longer listed as a facts label in the schema guide. A facts
  read of `Asset` is not served.
- `tests/fixtures/documented-recipes.json`: `recipe_facts_transfer_02` reads a
  real EVM transaction hash, and `recipe_facts_transfer_08` names both
  addresses of its pair. The facts recipes that read one address, a day alone
  or nothing carry `admits: false` and a new field `expects_code` with the
  code the graph answers: `facts_pair_required` or `facts_no_anchor`. The
  generated corpus holds 49 entries, from 53.
- The live recipe test checks each refused recipe against its `expects_code`.

### Added

- `tests/facts-read-contract.test.ts` reads every facts read that a recipe, the
  corpus, a skill, a doc, the served hints or the workspace notes show, and
  fails on one that names no pair with one day and no transaction hash. It
  also fails when a refused recipe names a code that is not the one limit it
  breaks.

## [0.37.4] - 2026-10-04 — ci: tier scripts and dispatch-only workflows

No runtime change. The CLI, the MCP proxy and the skills are the same as
0.37.3.

### Changed

- The checks run from three scripts under `ci/`, named in `ci/manifest.json`:
  `ci/t1.sh` (typecheck, build, the vitest suite with coverage, 180 s budget),
  `ci/lint.sh` (oxlint, the secret pattern scan, the secret egress scan,
  120 s budget) and `ci/build.sh` (build, publint, attw, the release gate,
  the package contents). The GitHub jobs run the same files, and so does the
  local merge gate (AP1000 change `local-ci-gate`).
- `verify.yml`, `security.yml`, `release.yml`, `dependency-review.yml` and
  `pr-title.yml` run on `workflow_dispatch` only (and `security.yml` weekly).
  No push or pull request starts a fleet run. A release is tagged with
  `gh workflow run release.yml --ref main`.
- The secret egress scan uses `grep -E`; `rg -E` named an encoding, not a
  pattern, so the step could never match.

## [0.37.3] - 2026-10-03 — fix: the guide says how to read swaps until the graph server is fixed

This release changes text and tests only. It does not fix the read. The graph
server fix is tracked as graph server issue 1121.

### Changed

- The schema guide, the dialect skill, `docs/graph-tools.md`,
  `docs/graph-query-compatibility.md`, the served graph hints and the
  workspace runtime notes now say: do not return, filter or order by `pools` in
  a `USE facts` `SWAP` read. Every such read fails at the warehouse query
  memory limit with `facts query could not be completed`: by address, by day
  and by `tx_id`. The server builds `pools` with a read of every swap day that
  ignores the day and the transaction bound. Until the fix ships:
  - Read `SWAP` rows by `tx_id` or by a bare `block_date` bound, and leave
    `pools` out. The server accepts a bare `block_date` bound on a `SWAP` read,
    beside the address and `tx_id` rules the same pages state. A read by
    address can fail for a busy address, even without `pools`.
  - Only `pools` comes from the failing part of the warehouse view.
    `pool_keys` and `families` come from the main read.
  - For the pools of a swap, read `SWAPPED.pools` on `USE topology`, anchored
    on the payer or the recipient. A `SWAPPED` link covers every route of one
    payer, recipient and asset pair, so it gives the pools of the link, not of
    one route.
  - Every one of these texts is marked temporary and names the issue, so each
    is removed when the fix ships. The `SWAP` property table in the schema
    guide says not to return, filter or order by `pools` for now.
- The two documented recipes that returned `pools` from a `USE facts` `SWAP`
  read (one transaction's swap routes, in the dialect skill and in
  `docs/graph-tools.md`) no longer return it. `docs/graph-tools.md` gains a
  `USE topology` recipe for the pools of the swaps from one payer.

### Added

- Tests that pin the temporary text in the schema guide, the dialect skill,
  both docs, the served graph hints and the workspace runtime notes, and that
  no shipped recipe uses `pools` in a `USE facts` `SWAP` read, whether it
  returns, filters or orders by it. The recipe test reads the documented
  recipes, the query corpus, the skills, the docs, the README and the served
  graph hints.

## [0.37.2] - 2026-10-03 — fix: cia waits for graph answers, and the guide says what the graph holds

### Fixed

- `cia mcp call graph_query` and `cia mcp call graph_query_batch` gave up
  after 60 s, the MCP SDK default. The graph server may spend 60 s on one
  topology query and 100 s on a batch, so a slow batch failed on the client
  while the server was still working. Both calls now wait 5 minutes, the same
  wait `aml_address_risk` already used. Every other tool keeps the SDK
  default.
- The stale "10 seconds" limit text is now 60 seconds. It sat in the schema
  guide, `docs/graph-tools.md`, `docs/graph-query-compatibility.md` and the
  sample batch answer. `per_query_timeout_seconds` is said to cap at `60` (`30`
  for `USE facts`). It can lower a limit and cannot raise one.

### Changed

- A topology read that filters on a link property needs an address anchor.
  This is in the served graph hints, the `chain-insights-cypher` skill, the
  workspace runtime notes and `docs/graph-tools.md`, with an anchored
  `SWAPPED` example. With no address in the pattern, the read starts from
  every link of that type. `LIMIT` stops it only after enough rows match, so a
  filter that matches few or none can run to the 60 s limit and fail with
  `query_timeout`. A discovery probe with `LIMIT` and no filter stays valid.
  `degree_out` and `degree_in` are called a rough guide for picking an
  address: they count neighbours, not links. `docs/graph-tools.md` also
  documents the batch budget: 100 s shared by the queries of one batch, and a
  client that sets its own timeout needs at least 100 s for a batch.
- The schema guide names every link field it left out, and a new "Bookkeeping
  fields on links" section says which are not part of the contract:
  - `synced_through_height` (on ten link kinds) and `pair_key` (`FLOWS_TO`,
    `SWAPPED`) are sync bookkeeping. Do not filter, sort or group on them.
  - `OPERATED_BY` valuation fields: `valuation_tracked_count`,
    `valued_count`, `missing_valuation_price_count`, `unknown_quantity_count`,
    `unrepresentable_quantity_count`, `usd_range_count`,
    `valuation_complete` and `valuation_coverage_ratio`. `amount_usd_sum`
    counts a transfer with no USD value as 0, so it is a floor unless
    `valuation_complete` is true.
  - `LINKED` `owner_state`, `SIGNED_FOR` `operations` and
    `failed_operations`, and `DEPLOYED_CONTRACT` `confidence_score`,
    `call_type` and `amount`.
  - The contract fields on an address: `is_contract` and the
    `contract_creation_*` fields.
  - The facts `SWAP` claim names its `strength` values (`swap` or
    `swap_like`).
- `FLOWS_TO` `tx_count` is described as it is counted. A link counts token and
  native transfers plus internal native transfers (a contract sending ETH
  during a call), and `amount_usd_sum` prices them all. `USE facts` `TRANSFER`
  lists the first group only, and no MCP read lists internal native transfers
  yet. So a pair can have a `tx_count` above 0 and no `TRANSFER` row, and the
  transaction anchor query returns nothing for it. The guide said a flow's
  transactions are `TRANSFER` rows. It also says an address-only `TRANSFER`
  read covers a recent window (90 days today) while a link covers all time:
  bound the read with `block_date` to read further back.
- The swap guide says what `swap_like` and `swap_unsplit` mean today. No route
  is `swap`: the swap reader reads transaction receipts only, with no
  execution trace. Every served route is `swap_like`, with `reason`
  `unknown_pool_code` and `families` `unknown`. A Uniswap V2 or V3 swap reads
  this way, and `unknown` does not mean the protocol is unsupported. A filter
  on `strength = 'swap'` or on a known family matches nothing. A route that
  could not be paired (`swap_unsplit`) has no payer, recipient or pool. It
  makes no `SWAPPED` edge and no `SWAP` row, and it exists in the warehouse
  only. Every Uniswap v4 swap is `swap_unsplit` today, by design, so v4 swaps
  are hidden. The guide gives the share on four days: 1%, 7%, 19% and 32%.
  The facts `family` of a liquidity row (`v2` or `v3`) is not a swap family.
  The words "no reviewed family" are gone.
- `SWAPPED` `sold_usd` and `bought_usd` sum the routes on the edge, and a
  route side with no price adds 0. So 0 can mean no price, and it must not
  be read as worth nothing. The facts `SWAP` row of one route says which side
  had none (`sold_price_missing`, `bought_price_missing`). On 2026-07-26, 47 of
  100 swap routes had no price on the bought side. The older text said USD is
  empty when no service prices the asset. It now says that holds on a facts
  row only.

### Added

- Tests that pin the guide against the fields the graph serves (a table of
  the keys each link kind carries, checked against the schema guide, the
  served hints and the runtime notes), the `tx_count`, swap strength and USD
  wording, the absence of the old 10-second limit text, and the 5-minute wait
  of the two graph tools in the real `cia mcp call` command.

## [0.37.1] - 2026-10-03 — fix: aml_address_risk no longer caps its graph queries at 10 s

### Fixed

- `aml_address_risk` sent `per_query_timeout_seconds: 10` with every graph
  batch. A caller's value can only lower the server's ceiling, so the tool
  kept the old 10 s limit after the graph MCP moved to 60 s per topology
  query (100 s per batch). The tool now sends no per-query value and gets the
  server's ceiling. The 5-minute request timeout is unchanged.

## [0.37.0] - 2026-10-02 — feat: coverage says how far each kind of data reaches

### Added

- `meta_network_capabilities` passes three things through from the graph
  server, which the mirror dropped before:
  `coverage.complete_through_block` (the lowest raw-data lane: below it every
  raw relationship is indexed), `lane_progress` (each writer lane's height,
  `null` for a lane that has not started) and `graph_progress` (the height of
  each topology link layer and their lowest). All three are optional and
  absent on an older graph server.
- One graph query hint: an empty answer above a floor may mean "not indexed
  yet", and an absent `chain_tip_block` means the indexers are catching up.
  Read `freshness.max_data_age_seconds` for the lag.

### Security

- `hono` is raised past 4.13.7 (GHSA-hxh3-vqpv-xpqv, moderate).

## [0.36.0] - 2026-09-30 — feat: the readers follow the rebuilt graph

### Changed

- `aml_address_risk` reads per-label risk from the three lists the graph
  stores on an address: `label_risk_labels`, `label_risk_levels` and
  `label_risk_updated_timestamps`. The profile query asked for one
  `label_risk` property, which the graph does not hold, so a labelled address
  read as unlabelled. The strongest label now drives the level again, and the
  ten newest labels still fill the risk sources. The query corpus is
  regenerated (53 entries; 2 change text). The graph server's copy follows in
  the same release wave.
- The graph viewer no longer reads `first_tx_id` from a flow. A flow edge
  carries value only, and a flow's transaction comes from `USE facts`
  (`TRANSFER` rows). A compact-evidence flow that still carries a
  `first_tx_id` is drawn without a transaction hash.
- The served graph hints and the workspace runtime notes describe the graph as
  it is built now:
  - the three `label_risk_*` lists, entry by entry;
  - an absent `risk_score` means `UNSCORED`: no verdict, never low risk;
  - labels are role words (`Exchange`, `Scam`, `Victim`, `Sanctioned`), never
    detector names, and each role is a node label and a flag: `:Exchange` and
    `is_exchange` follow the `exchange` label, `:Scam` and `is_scam` the `risk`
    label, `:Victim` and `is_victim` the `protection` label, `:Sanctioned` and
    `is_sanctioned` the `sanctioned` label;
  - each flag is present only when true and absent otherwise, never `false`,
    so a labelled node with no `is_exchange` is walked through and only
    `is_exchange` ends a walk;
  - swap attribution is read from `SWAPPED`, the aggregate, or from the facts
    `SWAP` row, one route. `FLOWS_TO` carries value only;
  - the `FLOWS_TO` hint lists the four served fields (`tx_count`,
    `amount_usd_sum`, `first_seen_timestamp`, `last_seen_timestamp`) and names
    `pair_key` and `synced_through_height` as internal sync bookkeeping, not to
    be queried. It no longer says no other edge field exists.
- The `chain-insights-schema-evm` skill and the graph query compatibility
  guide match the rebuilt graph:
  - one section per link type: `APPROVED` (`granted_tokens`, `infinite_tokens`,
    `has_infinite_grant`, `first_height`, `last_height`), `DEPLOYED_CONTRACT`
    (`kind`), `SPONSORED`, `BUNDLED`, `SIGNED_FOR` and `SIGNED_AUTHORIZATION`,
    the EIP-7702 link (a plain wallet signs a `SET_CODE` authorization and
    acts as a smart account from then on; a permit lands on `APPROVED`,
    never there);
  - the ten ML pattern link types by name, `FLASH_LOAN_ENVELOPE` included,
    each with `kind`, `source_event` `ml_pattern` and the run id in `run_id`;
  - `:Pool` is set by both DEX layers, so a pool with liquidity and no swap
    carries it;
  - `BRIDGED.totals_raw` is keyed by event kind and asset, and `LINKED`
    carries `last_height`;
  - the role words, their node labels and the four role flags are named, and
    the `:Exchange` label is no longer forbidden in the dialect skill.
- `OPERATED_BY` is described as it is built: the edge runs from the owner to
  the transaction sender that moved the owner's tokens (ERC-20/721), or the
  event operator (ERC-1155); not the approved spender. It meets an `APPROVED`
  spender only when that spender sent the transaction itself. The served
  hints, the schema skill and both guides say so; they called the
  destination the approved operator before.

### Removed

- The `chain-insights-schema-bittensor` skill, its folder and every link to
  it (README, installer, guides, the other skills and their contract tests).
  The graph serves an EVM chain only. The installer no longer copies it, and
  it lists `chain-insights-schema-bittensor` among its retired skills, so an
  install from an earlier release deletes the old copy.
- The `first_tx_id` and `last_tx_id` `FLOWS_TO` properties, and the
  `OPERATED_BY` bucket timestamps, leave the schema skill and the guides. The
  `FLOWS_TO` table also drops `avg_tx_size_usd` and `price_coverage_ratio`,
  which the graph does not carry: compute an average inline.
- The Bittensor labels and neuron model leave the graph query compatibility
  guide.

### Added

- Tests that pin the label-risk read against a graph that stores the three
  lists, the role flags as markers, the swap attribution wording, and the
  schema names in the skill and the guide.

## [0.35.1] - 2026-09-29 — fix: aml_address_risk walks no longer cross a DEX pool

### Fixed

- `aml_address_risk` no longer reads through a `:Pool`. Once the graph carries
  pools, a trace that left a pool on `FLOWS_TO` made every trader who used the
  pool look one hop from the screened address. The pool trace rule now holds
  in the query code, not only in the skills and the served text: a walk never
  starts at a `:Pool` and never passes through one, and it may end at one.
- The route between the screened address and the compare address
  (`connection_route_outbound`, `connection_route_inbound`) is the guarded
  route shape the dialect skill serves word for word: `WHERE NOT a:Pool` on
  the start, `WHERE NOT via:Pool` inside the path pattern, `{0,4}` on the
  guarded middle and one last hop to the target, which may be a pool. It
  follows `FLOWS_TO` and `SWAPPED`, so it crosses a swap from payer to
  recipient. A route is now 1 to 5 hops, one more than before, because the
  last hop sits outside the guarded quantifier. The route evidence reports
  `depth_bound: 5`. This is the shape graphrag-mcp runs on the fast
  shortest-path search.
- The exchange exposure walks (`exchange_outflows_1` to `_3` and
  `exchange_inflows_1` to `_3`) add `NOT a:Pool` and `NOT n1:Pool`,
  `NOT n2:Pool` on every intermediate address, each as its own `AND` term. The
  exchange end is the target and carries no guard.
- The actor-exposure read over one `LINKED` hop (`linked_exposure_via_linked`)
  is a two-hop walk through the owned address. It now carries
  `WHERE NOT a:Pool AND NOT owned:Pool`, the same text the served AC11 recipe
  uses. The target end stays open.
- Ruling: the direct one-hop listings (`connection_probe`,
  `linked_exposure_direct`, the inline average flow) stay unguarded. A direct
  counterparty listing of one address is a listing, not a trace. Screening a
  pool address itself still returns its counterparties.
- Known gap, follow-up task: the exchange exposure walks follow `FLOWS_TO`
  only. Routes cross `SWAPPED`, exposure walks do not, so a swap between payer
  and recipient is invisible to exposure. `SWAPPED` on the exchange walks is
  not part of this fix.
- Route USD totals exclude `SWAPPED` hops, because a `SWAPPED` edge carries no
  `amount_usd_sum`. The `amount_usd_sum_total` of a route that crosses a swap
  therefore under-counts.
- The query corpus is regenerated (53 entries; 17 change text). The copy in
  data-pipeline follows in the same release wave.

## [0.35.0] - 2026-09-28 — swaps, liquidity pools and bridges, and the pool trace rule

### Added

- The graph map describes the new topology edges: `SWAPPED` (swap payer to a
  different recipient, one edge per payer, recipient, sold asset and bought
  asset, with `strength`), `ADDED_LIQUIDITY` (provider to pool) and
  `REMOVED_LIQUIDITY` (pool to receiver, with `receiver_added_usd` and
  `receiver_provided`), the `:Pool` label with its liquidity totals, and
  `BRIDGED` between an address and a `:Chain` bridge endpoint. It describes
  the facts relationships `SWAP`, `LIQUIDITY_ADD`, `LIQUIDITY_REMOVE` and
  `BRIDGE_CROSSING`, their properties and their indexed predicates.
- The pool trace rule, stated once in the `chain-insights-schema-evm` skill:
  enter a `:Pool` on any edge, leave it only on `REMOVED_LIQUIDITY`, never
  leave it on `FLOWS_TO`, and follow `SWAPPED` between two different
  addresses. The MCP server's graph hints carry the same four steps, and the
  dialect skill, the graph tools guide and the workspace runtime notes point
  to it. A trace no longer fans out to every trader who used a pool, and it
  still reaches the address that took the liquidity out.
- Two documented recipes in `tests/fixtures/documented-recipes.json`: a
  rug-pull check that follows a victim into a pool and out on a liquidity
  removal, with the receiver's profit, and a two-hop trace that never fans out
  through a pool. The query corpus is regenerated with them (53 entries).
- The pool guard on every served `FLOWS_TO` walk: a walk may end at a
  `:Pool`, but never starts at one or passes through one. Fixed-hop walks add
  `WHERE NOT src:Pool AND NOT mid:Pool`. Quantified and shortest-path walks
  carry `WHERE NOT a:Pool` on the start and `WHERE NOT via:Pool` inside the
  path pattern, so the search finds the shortest route that avoids pools
  instead of dropping the route that crosses one. The route between two
  addresses (`SHORTEST 1`, `ANY SHORTEST`, `ALL SHORTEST`) and the open target
  from one address each have one guarded shape, served word for word by the
  dialect skill, the documented recipes, the MCP server's graph hints, the
  graph tools guide and the graph query compatibility guide. The one-hop,
  two-hop and rug-pull recipes carry the guard too. The one-`LINKED`-hop
  recipe guards its start and the linked address:
  `WHERE NOT a:Pool AND NOT owned:Pool`.
- Every served trace walks `SWAPPED` beside `FLOWS_TO` (`FLOWS_TO|SWAPPED`),
  so it crosses a swap from payer to recipient instead of stopping at the
  pool. The two-hop and one-`LINKED`-hop recipes return the edge type, and on
  a `SWAPPED` hop they report `bought_usd` and `swap_count`.
- A contract test keeps the rule in one place: the served hints must match
  the skill's four steps word for word, and no other surface may restate
  them. It reads every served query (skills, docs, README, documented
  recipes and the MCP server's graph hints) one `UNION` branch at a time, as
  one walk across all its `MATCH` and `OPTIONAL MATCH` clauses,
  comma-separated patterns, `WITH` projections, pattern predicates, pattern
  comprehensions and subqueries. It reads unlabelled middle addresses,
  reverse arrows, backquoted names, quantified relationships, quantified path
  patterns, shortest-path selectors and the legacy `shortestPath()` and
  `allShortestPaths()` functions. It counts the guard only as a whole `AND`
  term, never inside an `OR`, and only with `Pool` in that exact case:
  labels are case-sensitive, so `NOT mid:pool` guards nothing.
- Where the contract test says a walk starts. A start is an address the
  query pins: an inline `address` map, or an `address` comparison with a
  value in the node's own `WHERE` or in the clause, such as `=`, `IN` or
  `STARTS WITH`, with or without a function such as `toLower()` around it.
  Every end but the last of a shortest-path walk is a start too, even when
  the test reads no pin on it. Any other walk with no pin is a listing, not a
  trace, and only its middle is checked.
- The contract test fails a `FLOWS_TO` walk that leaves its start or an
  address in its middle without the pool guard, on any edge but
  `REMOVED_LIQUIDITY`; a `FLOWS_TO` walk that leaves a `:Pool` on any edge but
  `REMOVED_LIQUIDITY`; a trace that does not also follow `SWAPPED` through an
  address in the middle; and any served route or open target, however its
  start is pinned, that is not one of the guarded shapes.

### Removed

- The seven `swap.*` properties on `FLOWS_TO` and the `DexTransaction`,
  `DexRoute`, `DexPoolFact` and `DexPairContribution` nodes are gone from the
  skills, the graph tools guide and the MCP server's graph hints. The graph no
  longer carries them: a swap's strength is on `SWAPPED`, and its reason,
  families, pools and route id are on its `SWAP` facts row. The recipes that
  filtered `FLOWS_TO` by swap stamp now read `SWAPPED`, `:Pool` and `SWAP`.

### Changed

- The `graph_query` tool description, its `query` argument and the two graph
  prompts name the new topology edges and facts relationships, from one
  shared text.
- The facts property lists name `block_timestamp` on `SWAP` and
  `LIQUIDITY_*` rows as epoch milliseconds, as on `TRANSFER`, and name the
  matching `…price_missing` property per relationship.
- The route between two addresses and the open target carry the pool guard
  inside a quantified path pattern, in one fixed shape each. Use the shapes as
  written, changing only the addresses and the `RETURN`: the graph server
  recognises them. The `{0,4}` bound is part of the shape.
- The documented quantified-path recipe between two anchored addresses is
  now the open-target recipe: a route is served only with a shortest-path
  selector. The documented route recipes name their path `p` and their ends
  `a` and `b`, as the served shape does.

## [0.34.0] - 2026-09-27 — facts recipes for the transaction hash and the time window, live recipe run

### Added

- Three documented recipes anchored on the Robinhood day 2026-07-11 in
  `tests/fixtures/documented-recipes.json`: a `TRANSFER` lookup by `tx_id`,
  which on EVM networks is the `0x` transaction hash; a time window written
  as a bare `block_date` bound plus `block_timestamp` bounds in epoch
  milliseconds; and an address read with the caller's own day bound. The
  query corpus is regenerated with them (51 entries). Each carries
  `expect_rows: true`, so a live run must return rows for it.
- `tests/graph-recipes-live.integration.test.ts` runs every documented recipe
  and every query corpus entry against a live Chain Insights Graph endpoint
  when `CHAIN_INSIGHTS_LIVE_GRAPH_MCP_ENDPOINT` is set (token in
  `CHAIN_INSIGHTS_LIVE_GRAPH_MCP_TOKEN`, network in
  `CHAIN_INSIGHTS_LIVE_GRAPH_NETWORK`, default `robinhood`). Admitted recipes
  and every corpus entry must run, recipes marked `admits: false` must be
  refused with the remedy, and the anchored recipes must return rows under
  exactly their `RETURN` aliases. The product's pair anchor is asked for the
  first and the latest transfer of the tx recipe's pair. The suite is skipped
  when the variable is unset.

### Changed

- The `chain-insights-cypher` and `chain-insights-schema-evm` skills, the
  compatibility matrix, graph tools, the served schema hints and the
  investigation instructions name the third indexed predicate on `TRANSFER`,
  a bare `block_date` bound; say that `tx_id` is the transaction hash on EVM
  networks; and show the time window. No query's output column names change.
- The compatibility matrix rows for `tx_id`, the time window, the bare
  `block_date` bound and address equality name only the operators the
  backend accepts: `IN` and `BETWEEN` are refused, so a lookup
  of several transactions is one equality per query in one
  `graph_query_batch`, and a range is written with `>=` and `<`.
  `block_timestamp` takes `>=`, `>`, `<` and `<=` but not `=`, so one instant
  is written `>= x AND <= x`; `block_height` also takes `=`.

## [0.33.1] - 2026-09-26 — refreshed GitHub artwork

### Changed

- Updated the GitHub crime-scene illustration to the current Chain Insights cast.

## [0.33.0] - 2026-09-22 — docs: hosted topology limits and typed errors

### Changed

- `docs/graph-tools.md` and the `chain-insights-cypher` skill document the
  hosted topology limits (time budget, 4 concurrent topology queries,
  per-query memory limit) and the typed errors `topology_busy`,
  `query_timeout`, and `query_memory_limit`, with what to do for each. A
  stopped query means the question was too big, never that the data is
  missing — the difference between "ask a smaller question" and a false
  all-clear. Live on the hosted endpoint since 2026-09-14 (Chain Insights
  Graph 1.26.5); written then as 0.30.1 and unpublished until now.

## [0.32.0] - 2026-09-22 — feat: the served graph describes swap attribution

### Added

- The served schema, the `chain-insights-cypher` skill and
  [Graph tools](docs/graph-tools.md) now describe the swap stamp on
  `FLOWS_TO`: `swap.kind`, `swap.family`, `swap.deployment`, `swap.pool`,
  `swap.reason`, `swap.route_id` and `swap.interpreter_version`. Every name
  contains a dot and must be backquoted in Cypher, which is stated at each
  place the properties appear.
- The three stamp kinds are defined where an agent will read them. `swap` is a
  proven complete route; `swap_like` is a swap shape on a pool whose bytecode
  matches no reviewed family; `swap_unsplit` is real legs that could not be
  paired, with `swap.reason` naming why. `swap_unsplit` is explicitly **not**
  "no swap happened", because reading it that way produces a false negative.
- The detailed `DexTransaction` / `DexRoute` / `DexPoolFact` /
  `DexPairContribution` nodes and their `HAS_DEX_*` relationships are
  documented for the cases the stamp cannot answer, with the warning that
  route amounts are raw token quantities and not interchangeable with
  `amount_usd_sum`.

### Fixed

- The served schema claimed `FLOWS_TO` had no fields beyond `tx_count`,
  `amount_usd_sum`, `first_seen_timestamp` and `last_seen_timestamp`. It has
  carried the optional swap stamp since the verified DEX attribution work
  landed upstream, so an agent was told the capability did not exist.

## [0.31.2] - 2026-09-15 — fix: route evidence uses the early-stop shortest path search

### Changed

- `aml_address_risk` route evidence between the subject and the compare
  address (`connection_route_outbound`, `connection_route_inbound`) sends
  `-[:FLOWS_TO]-{0,4}` instead of `{1,4}`. For two different addresses both
  bounds return the same routes. The graph engine (Neo4j 5.26.27) plans
  `{0,4}` onto its early-stop shortest path search; the undirected `{1,4}`
  form read whole hubs and timed out at 10 s through a 2.15M-relationship
  hub, where `{0,4}` answered in 23 to 33 ms.
- `skills/chain-insights-cypher/SKILL.md` shows `{0,5}` for a route between
  two known addresses and keeps `{1,5}` for an open target.

## [0.31.1] - 2026-09-15 — fix: actionable error for an unreachable graph endpoint

### Fixed

- `cia mcp call` (and every command that reaches the Chain Insights Graph
  endpoint) now reports which endpoint was unreachable and why — connection
  refused, host not found, timeout, or TLS — instead of a bare `fetch failed`.
  A stale `graphMcpEndpoint` (for example a `debug` config pointing at a stopped
  local server) is now self-explaining, and points at the config key and the
  `CHAIN_INSIGHTS_GRAPH_MCP_ENDPOINT` override. Real backend errors (bounds
  rejections, payment-required, tool errors) are returned unchanged.

## [0.31.0] - 2026-09-14 — feat: slim FLOWS_TO field contract

### Changed

- The FLOWS_TO edge serves exactly `tx_count`, `amount_usd_sum` (total money
  flow, token and native value merged), `first_seen_timestamp`, and
  `last_seen_timestamp` (openspec `dozerdb-flows-to-slim-schema`). Transaction
  anchors resolve through `USE facts`; averages compute inline.
- Agent guidance (`src/mcp/proxy.ts`, `src/workspace/init.ts`) documents the
  four-field contract and the replacement recipes.

### Added

- `pairAnchorQuery`: first/last transfer between two addresses via the facts
  lane (`ORDER BY t.block_timestamp LIMIT 1`, both directions).
- `inlineAverageFlowQuery`: average transfer size computed at read time.
- Corpus regenerated (48 entries) with both recipes; dropped fields removed.

## [0.30.0] - 2026-09-08 — feat: subscription status, buy guard, pass hints

### Added

- `meta_subscription_status` local proxy tool: window end, daily allowance,
  consumed amount, and tier for the signed wallet (unavailable-shape when
  the server lacks the flag-gated tool; never throws).
- `cia buy day|month` with the no-admin-sink deposit pre-sign guard:
  "N days active; this deposit extends to M" + typed `DEPOSIT`
  confirmation, and USD-equivalent pass hints (the indexer TWAP computes
  the exact $CIA amount).

## [0.29.3] - 2026-09-07 — docs: rename the README banner asset

### Changed

- Banner asset renamed to chain-insights-github-crime-scene.png.

## [0.29.2] - 2026-09-07 — docs: crime-scene GitHub banner

### Changed

- README banner swapped for the agency crime-scene scene: the cast tracing a
  glowing fund-flow trail while the scammer flees with the coin.

## [0.29.1] - 2026-09-07 — docs: brand the README with the agency identity

### Changed

- README header now carries the agency banner and tagline, so users landing
  from chain-insights.ai get the same brand. Setup content is unchanged.

## [0.29.0] - 2026-09-03 — feat: serve Chain Insights through Robinhood Dozer GQL

### Added

- Bounded ISO GQL shortest-path route evidence for the Robinhood topology.

### Changed

- Public Cypher guidance, recipes, and the query corpus now use bounded ISO GQL.

### Removed

- Client-side shard merge and the retired federation component.

### Security

- Updated production dependency locks to clear npm audit findings.
## [0.27.5] - 2026-09-01 — fix: emit valid workspace query JSON

### Fixed

- Workspace initialization now preserves valid JSON quoting in its generated node-label query example.

## [0.28.0] - 2026-09-01 — feat: OPERATED_BY operator topology surface

### Added

- `OPERATED_BY` owner-to-operator topology edge across the compatibility
  matrix, the EVM schema skill, the graph tool guide, and the documented
  recipe corpus: direction, aggregate properties, topology-only scope, the
  canonical high-fan-in operator query, and the not-a-risk-label caveat.
- Contract test pinning the documented direction, network scoping, bounds,
  and the absence of any automatic risk-label claim.

## [0.27.4] - 2026-08-31 — ci: make docs self-contained

### Changed

- Moved Docs validation and architecture rendering helpers into this repository.
- Removed private cross-repository checkout and protected-branch commit-back from Docs.
- Docs now verifies that rendered architecture files are committed with their source changes.

## [0.27.3] - 2026-08-31 — ci: use hosted runners for docs and Scorecard

### Fixed

- Moved Docs to `ubuntu-latest` so it does not wait for the saturated x64 runner pool.
- Moved OpenSSF Scorecard to `ubuntu-latest`, as required to publish public score results.

## [0.27.2] - 2026-08-31 — ci: fix docs gate and scope workflow permissions

### Fixed

- Added the release guidance required by the scheduled README quality gate.
- Scoped write permissions to only the workflow jobs that commit changes.
- Added a direct link for private GitHub vulnerability reports.


## [0.27.1] - 2026-08-31 — fix: use production endpoint in agent setup

Fresh `cia --claude`, `cia --codex`, and `cia --hermes` setup now starts with
the hosted production Chain Insights Graph endpoint. Local endpoints remain
available only through explicit configuration.

### Fixed

- Removed the stale loopback endpoint from the installer-created config.

## [0.27.0] - 2026-08-31 — feat: separate workflows from MCP primitives

The CLI now separates high-level CIA workflows from low-level GraphRAG MCP
access so each command group has one clear purpose.

### Added

- `cia workflows` to discover high-level CIA workflow tools.
- `cia workflow aml-address-risk` to run the address-risk workflow with JSON
  output and version selection.

### Changed

- `cia mcp` now documents low-level GraphRAG access and remote tool discovery.
- README, documentation, generated workspace guidance, and shipped skills now
  describe the workflow and GraphRAG command boundaries.

### Removed

- `cia mcp aml-address-risk`; use `cia workflow aml-address-risk`.
- High-level AML execution through `cia mcp call aml_address_risk`; use the
  workflow command instead.

## [0.26.0] - 2026-08-31 — change: scope tool discovery to networks

The CLI now keeps address-risk screening under `cia mcp`. Network capability
output reports only the tools advertised for each network by Chain Insights
Graph.

### Changed

- Removed the root `cia aml-address-risk` command.
- Added per-network tool discovery to `cia network <name>` and the network
  capability tables.
- Updated CLI, workspace, documentation, and skill examples for the current
  `USE topology` and `USE facts` graph split.

## [0.25.0] - 2026-08-31 — feat: improve CLI output and tool versioning

The CLI now presents graph results in a readable terminal format and supports
explicit machine-readable output. AML tool contracts can be pinned separately
from the package version.

### Added

- `--json` output for graph and AML CLI commands.
- Human-readable graph result summaries and aligned result tables by default.
- `v1` routing for `aml_address_risk`; omitted versions use the latest contract.
- CLI, MCP schema, and documentation coverage for AML tool versions.

## [0.24.2] - 2026-08-31 — fix: make CLI command paths self-guiding

The CLI now keeps its command tree consistent and shows the relevant command
help when an invocation is incomplete.

### Added

- `cia aml-address-risk` as a direct shortcut for address screening.
- Automated help coverage for every public command node and leaf.

### Changed

- Incomplete command invocations now print the affected command's usage and
  options.
- Unknown MCP tools now point users to `cia mcp tools --refresh`.
- Configuration get/set leaves now include descriptions in their help.

## [0.24.1] - 2026-08-31 — fix: clarify CLI network and tool catalogs

The CLI now separates the user network overview from the detailed MCP
capability matrix and labels remote GraphRAG tool discovery clearly.

### Changed

- `cia networks` shows network status and dataset coverage without repeating
  the tool matrix.
- `cia mcp networks` labels its tool column as Chain Insights tools.
- `cia mcp tools` identifies its remote GraphRAG tool catalog and cache period.
- Tool descriptions wrap cleanly instead of being cut off mid-word.

## [0.24.0] - 2026-08-31 — feat: improve first-run CLI onboarding

The CLI now uses `cia` consistently in public help and guidance. Users can
inspect one network directly and create a local payment wallet with an
explicit private-key backup confirmation.

### Added

- `cia network <name>` for details about one supported network.
- `cia wallet create` for local wallet generation.
- A colorized, aligned wallet backup warning with a plain-text fallback.

### Changed

- Wallet creation keeps the generated key in memory until the user enters
  `BACKED UP`.
- Wallet guidance explains the encrypted local storage path and recovery limit.
- Public CLI help, errors, payment guidance, and command examples use `cia`.

## [0.23.0] - 2026-08-30 — release: ship the focused CLI and MCP surface

The first public release keeps the install-to-first-screen path focused on
AML screening and graph facts. Local workspaces, the local server, and graph
visualizations are deferred until they are ready for general use.

### Removed from the public surface

- `cia init`, `cia serve`, and `cia viz` commands.
- MCP Apps graph resources, visualization metadata, and graph attachments.
- Public workspace, graph-report, and visualization instructions and docs.
- The unused MCP Apps runtime dependency and bundled graph template.

### Changed

- Default MCP proxy behavior is stateless.
- `cia status` reports configuration and Graph connectivity without a local
  server or workspace.
- README, architecture docs, shipped skills, and tests describe only the
  supported first-release workflow.

## [0.22.3] - 2026-08-30 — fix: make fresh installs usable

A new installation now connects to the hosted Chain Insights Graph by default.
Users can run `cia networks` immediately after installing the package. Local
development remains available through an explicit loopback endpoint override.

### Changed

- Use `https://mcp.chain-insights.ai/` as the CLI and workspace default.
- Keep `http://127.0.0.1:8012/mcp` available for explicit local development.
- Update the first-run documentation, acceptance contract, and release smoke
  test to cover zero-configuration hosted use.

## [0.22.2] - 2026-08-30 — fix: align hosted MCP tests with production

Hosted Chain Insights Graph now exposes the Robinhood network and the current
`topology` and `facts` scopes. The release smoke path and production-facing
tests use those current capabilities.

### Changed

- Default fresh workspaces to the hosted `robinhood` network.
- Update hosted MCP smoke checks and CLI tests to use the production endpoint.
- Remove stale staging endpoint references from mocked tests.
- Replace retired `live_topology` assumptions with `USE topology`.

## [0.22.1] - 2026-08-30 — chore: prettier formatting baseline (#349)

`npm run lint:format` is declared over the whole tree but had never been
enforced: 114 tracked files carried pre-existing formatting drift. This
establishes the baseline so the check is meaningful from now on.

### Changed

- Formatting only (prettier: quotes, semicolons, indentation, markdown table
  alignment and emphasis normalization) across src, tests, bin shims, scripts,
  workflows, docs, and shipped skill files. No behavior change.
- Added `.prettierignore` for the files that must not be reformatted:
  `CHANGELOG.md` (append-only history), `tests/fixtures/` (byte-pinned
  contracts), and `src/viz/templates/graph.html` (hand-authored bundled UI
  template that prettier would inflate ~13x).

### Validation

- Fixture byte-pins verified unchanged (sha256) and full local gate green.
- `npm run lint:format` now passes and stays in the local + CI-reproducible
  gate.

## [0.22.0] - 2026-08-30 — feat!: remove the local Bittensor devkit (#342)

The devkit (deterministic local Chain Insights Graph backend: StarRocks,
Memgraph, importers, Bittensor fixture data, lite Go MCP server) is removed,
together with its CI workflow, npm script tiers, probe tests, and all
user-facing devkit documentation. The hosted free tier (`graph_query` daily
allowance, visible via `meta_usage_status`) is the supported way to use
Chain Insights without running local infrastructure.

### Removed

- `devkit/` (74 tracked files) and `.github/workflows/devkit-smoke.yml`.
- The `devkit:smoke`, `devkit:smoke:parity`, `probe:capability`, and
  `test:devkit` npm script tiers.
- The devkit-gated capability-matrix and route-evidence probe tests.
- Devkit sections in README, development, debugging, and architecture docs.

### Changed

- The `meta_usage_status` primitive-backend fallback hint no longer names
  the devkit.

## [0.21.3] - 2026-08-30 — chore: public-repo hygiene sweep — private references removed (#281)

Completed the hygiene sweep: private repository names, internal epic/
migration numbers, and internal module paths no longer appear in the
CHANGELOG, source comments, devkit sources and scripts, test fixtures,
architecture context docs, or the rendered docs inputs. Functional CI
references (the vendored docs workflow's private checkout) are
intentionally retained. Historical CHANGELOG entries were edited in place
with neutral phrasing ("internal epic", "the upstream pipeline"); no
behavioral change.

### Changed

- Documentation, comments, and fixture metadata only. No runtime behavior.

## [0.21.2] - 2026-08-30 — docs: adopt the No Code of Conduct (#341)

`CODE_OF_CONDUCT.md` is replaced with the [No Code of
Conduct](https://nocodeofconduct.com) text (canonical stub plus the short
tenets and contact information), per the maintainer's decision in #341.
The file stays at the repository root so GitHub's community profile keeps
detecting it.

### Changed

- `CODE_OF_CONDUCT.md` content.

## [0.21.1] - 2026-08-30 — docs: README opening — AML/forensics positioning, MCP access, free tier (#343)

The opening paragraph now states what the product actually is: AML and
forensics infrastructure reached over a hosted Chain Insights Graph MCP
endpoint. It drops the claim that we manage workspaces (a workspace is an
optional plain local folder, created with `cia init`), confirms the graph
report/viz surface, and puts the free tier — a daily graph-query allowance
with no payment setup — in the first screen along with the fastest first
call.

### Changed

- README opening paragraph and quickstart sequence.

## [0.21.0] - 2026-08-30 — feat: reviewed truth proposals

Reviewed investigation findings can become evidence proposals.
They never become a final label.

### Added

- `buildTruthProposal` refuses self-review and model-only evidence.
- Mutual TLS paths stay in config. Secret bytes are not logged.

## [0.20.0] - 2026-08-30 — feat!: remove `cia monitor` (case tracking and dossiers)

**Removed in this release (no deprecation window):** the `cia monitor`
command family is gone. It rendered case dossiers from local case
documents only and never read chain data, so it did not earn its place
in a lean production surface. Dossiers, run logs, and
`.chain-insights/monitor/` state are no longer produced;
`docs/monitoring.md` and the monitor component documentation are
removed. Workspaces that contain monitor artifacts from earlier
releases keep them on disk; nothing reads or rewrites them.

### Removed

- `cia monitor` and every subcommand (`run`, `status`, `render`,
  `init victim`, `case add/list/add-seed/remove-seed/close`).
- `src/monitor/`, `tests/monitor/`, `docs/monitoring.md`, and
  `docs/architecture/components/monitor.md`.
- The `monitor` module entry from the architecture module table and
  the monitor workspace section from the workspace docs.
- `.chain-insights/monitor/` from the guaranteed workspace layout in
  the stability policy. Exit code `2` stays defined for batch-style
  commands but no current command exits `2`.

## [0.19.1] - 2026-08-28 — feat: kind-aware facts admission + partition metadata

The devkit mirrors the production facts partition-pruning gate: every facts
`TRANSFER` query must carry a bare `block_date` bound, a `tx_id` equality/IN,
or an address filter (a 90-day recency window is auto-applied). Height /
timestamp-only ranges, function-wrapped `block_date`, and `block_date` inside
an `OR` arm are rejected with a remedy error. The stale
`facts_address_features_view` mapping, `AddressFeature` label, and
`HAS_FEATURE` edge are removed (the view was dropped by migration 0033);
`Address` stays a TRANSFER endpoint only. The mapping gains
`partition_column` / `partition_granularity` metadata.

### Changed

- `USE facts` cost-shape gate is kind-aware (bare `block_date`, `tx_id`,
  address), mirroring production; rejection errors name the remedy.
- Address-only facts queries compile with a bare `block_date >= now − 90
  days` floor (`FACTS_RECENCY_WINDOW_DAYS`); `block_date`-bounded and
  `tx_id` queries keep lifetime semantics.
- `docs/graph-query-compatibility.md` states the admitted shapes, the window
  default, and the new rejection rows.

### Removed

- `facts_address_features_view` mapping + fixture (migration 0033); the
  `AddressFeature` label and `HAS_FEATURE` edge are unmapped.

## [0.19.0] - 2026-08-26 — breaking: networks follow GraphRAG MCP

CIA no longer hardcodes Robinhood as the only public network. It lists
what GraphRAG advertises. `network=` is a string. GraphRAG refuses a
miss.

### Changed

- `meta_network_capabilities` mirrors every GraphRAG network and
  overlays the seven public CIA tools. Layers stay `{}`.
- `network` tool args accept any non-empty string. Call
  `meta_network_capabilities` first. CIA does not invent a default.
- Empty or missing GraphRAG list returns no networks.
- Address-risk skill and workspace schema notes teach the same rule.

## [0.18.22] - 2026-08-24 — fix: teach bounded hop lambdas

The Cypher skill now shows the three Memgraph hop-lambda forms. Each
form keeps an explicit hop bound of 5 or less.

### Changed

- `chain-insights-cypher` teaches 2-arg, 3-arg, and weighted 4-arg hop
  lambdas. No unbounded `*BFS`. No official Memgraph write recipes.

## [0.18.21] - 2026-08-23 — fix: public agent skill set

Agent installs now ship a short address-risk skill, two GraphRAG schema
skills, and a Memgraph Cypher skill. Upgrades remove six stale skill
copies without touching user skills.

### Added

- `chain-insights-schema-evm` — EVM / Robinhood GraphRAG map.
- `chain-insights-schema-bittensor` — Bittensor GraphRAG map. Not a public
  hosted MCP network claim.

### Changed

- Rewrote `chain-insights-address-risk` around `aml_address_risk` only.
- Rewrote `chain-insights-cypher` as Memgraph dialect only. No query cookbook.
- Claude Code, Codex, Hermes, and local installs use one reviewed skill
  allow-list.

### Removed

- `chain-insights-bittensor-cypher`
- `chain-insights-developer-experience`
- `chain-insights-investigation`
- `chain-insights-monitoring`
- `ci-status`
- `test-chain-insights-graph`

## [0.18.20] - 2026-08-23 — feat: signed burnhole wallet proof

CIA attaches `X-CIA-Wallet-Proof` on Graph MCP calls when a wallet is loaded.
The till stays on MCP. CIA does not add a quota gate.

### Added

- EIP-191 `cia-mcp-permit` header for burnhole permits.

## [0.18.19] - 2026-08-22 — docs: public production Graph URL

Docs-only change. No behavior change.

### Changed

- Hosted endpoint examples now use public production
  `https://mcp.chain-insights.ai/` (host root, no `/mcp` path).
- The npm package default is still local `http://127.0.0.1:8012/mcp`.

## [0.18.18] - 2026-08-15 — docs: public-surface cleanup

Docs-only changes. No behavior change.

### Changed

- Billing wording: Chain Insights Graph bills by billable units (dropped
  the legacy query-time contrast).
- Shell snippets now state they target Linux (bash); they work as-is on
  macOS, on Windows use WSL.
- Endpoint examples use a placeholder host; hosted endpoints are operator
  configuration, never package defaults.

### Removed

- Retired hosted staging endpoint URL and tester-activation notes from
  README and docs.
- "Pre-Staging And Release" README section and internal workspace
  references (release-orchestration internals, staging workflow mentions);
  the architecture C4 model no longer includes internal systems — diagram
  re-render follows via the docs subsystem.

## [0.18.17] - 2026-08-14 — skill: BFS-first connectivity checks

Docs-only change to the Bittensor Cypher skill. No behavior change.

### Added

- `skills/chain-insights-bittensor-cypher/SKILL.md`: new "Connectivity
  Checks: BFS First" section — one bounded `*BFS` path query for
  address-to-address connectivity, shard narrowing via `time_scope`.

## [0.18.16] - 2026-08-14 — state-of-the-art: adoption surface

Docs and README polish. No behavior change.

### Added

- README quickstart: `npx` one-liner, install, `cia init`, `cia networks`,
  plus a recorded terminal demo (`docs/images/quickstart-demo.svg`).

### Fixed

- README intro no longer says "traces fund flows" — trace tools were
  retired in 0.18.7; it now describes graph-query exploration.

## [0.18.15] - 2026-08-14 — state-of-the-art: quality gates

Lint and coverage plumbing. No behavior change.

### Added

- `npm run lint` (oxlint) and a Lint step in `verify.yml`. First-pass result:
  0 errors, warnings only. Prettier config included for formatting
  (`npm run format` / `lint:format`, advisory — not CI-gated, no mass
  reformat).
- v8 coverage via `npm run test:coverage`: json-summary + lcov, with ratchet
  thresholds measured on 2026-08-14 (lines 73, statements 72, functions 79,
  branches 69 — only raise them). Coverage summary lands in the CI job
  summary; lcov uploads as an artifact.
- `pr-title.yml`: conventional-commit PR title check.

### Fixed

- The 0.18.14 entry below advertised a `dependency-review.yml` workflow; it
  was removed hours later (#311) because the repo's Dependency graph is not
  enabled. It returns once the graph is on.

## [0.18.14] - 2026-08-14 — state-of-the-art: release automation and supply chain

CI/release plumbing. No behavior change.

### Added

- `release.yml`: on a push to `main` whose `package.json` version has no tag
  yet, CI creates the `v<version>` tag and a **draft** GitHub Release with
  generated notes and a CycloneDX SBOM attached (`sbom.cyclonedx.json`).
  Draft-only by design — a human reviews and publishes; npm publication stays
  behind the manual publisher gate.
- `dependency-review.yml`: PR dependency-diff review, failing on
  high-severity advisories.

### Changed

- All GitHub Actions across every workflow are now pinned to full commit
  SHAs (docs, devkit-smoke, and project-board-add workflows previously used
  tag refs).

## [0.18.13] - 2026-08-14 — state-of-the-art: community health

Contributor-facing surface. No behavior change.

### Added

- Root `CONTRIBUTING.md` with setup, PR rules, and check commands.
- `CODE_OF_CONDUCT.md` (Contributor Covenant 2.1 by reference).
- GitHub issue templates (bug report, feature request) with blank issues
  disabled and a security-report contact link.
- Pull request template with the release-metadata checklist.
- `.github/CODEOWNERS` (single maintainer for now).
- `docs/stability.md`: the stability and deprecation policy covering CLI
  exit codes, the seven public MCP tool names, workspace layout, config
  keys, and how deprecation works.

## [0.18.12] - 2026-08-14 — state-of-the-art: package metadata

Packaging and metadata pass. No behavior change.

### Added

- `license: MIT` in `package.json`. Matches the existing LICENSE file.
- `publishConfig` with public access and provenance for npm publishing.
- `sideEffects: false`. No `src/` module runs import-time side effects.
- `publint` and `@arethetypeswrong/cli` dev dependencies.
- `lint:package` and `check:types-resolution` scripts, wired into the
  Verify workflow after the Build step.
- README badges: npm version, CI, OpenSSF Scorecard, and license. Each
  badge links to its live page.

## [0.18.11] - 2026-08-14 — architecture diagram drift fix

Docs-only change. No behavior change.

### Fixed

- C4 model drift: `caseManager` now points at `src/monitor` and
  `installer` at `bin/install.cjs` (previously `src/cases` / `src/install`,
  neither of which exists).
- Re-rendered the structurizr PlantUML/SVG/PNG outputs so the committed
  diagrams match the current model.

## [0.18.10] - 2026-08-14 — post-cut consistency pass

Docs, skills, and dependency cleanup after the detector-cell/watchlist cut
(#300) and the `cia monitor watch` cut (#305). No behavior change.

### Removed

- `@duckdb/node-api` dependency. The DuckDB store was retired in the earlier
  cut; the package had zero importers left in `src/`.
- `limitFromParams` in `src/config/limits.ts`. Dead code: its only callers
  were the retired detector params path.

### Fixed

- Acceptance docs now match the real CLI surface: `cia viz [source-id]
  --data <file>` (served URL, not a written-file path), `cia serve` instead
  of the never-built `dist/server.mjs`, loopback-only `http://` endpoint
  override, and `cia wallet import` overwrite refusal with the `--force`
  path documented.
- README: `cia monitor` renders dossiers on an external schedule, and the
  tool table lists all seven tools including `meta_help`.
- Architecture docs: dropped the retired `chain-insights.duckdb` data file,
  the phantom `mcpAuthToken` config key, the Export Builder container and
  trace/Obsidian flows in the C4 model, and tracing wording in the context
  overview; added the real `graphMcpMode` config key; corrected the
  workspace marker name (`.chain-insights/workspace.json`) and component
  test-file headers; filled the `federation` component placeholder.
- Skills: removed the phantom `--include-attachments` CLI flag from the
  address-risk example, reworded retired trace-tool framing, dropped the
  retired reviewer-approval label path, fixed the exit-2 wording
  ("isolated case failure"), and removed duplicated sentences.
- `docs/monitoring.md` and `docs/acceptance/mcp.md`: `cia monitor status`
  shows the last run (failed passes are recorded too), and the structured
  log path is `~/.chain-insights/runtime/logs/mcp-proxy.jsonl`.

## [0.18.9] - 2026-08-14 — monitor slim-down: watch loop removed

`cia monitor` is now one-shot only: `monitor run` renders every open case's
dossier and exits, and an external scheduler (cron, pm2 `cron_restart`, or
an agent harness's scheduled tasks) owns the interval.

### Removed

- `cia monitor watch`, the self-scheduled interval loop. Schedule
  `cia monitor run` instead — see the "Scheduling" section of
  `docs/monitoring.md`.
- The `intervalSeconds` monitor config key. Its only consumer was `watch`;
  existing configs that carry it are still read (the key is ignored).
- Dead residue from the earlier monitoring cut: the shared JSONL reader
  (`src/monitor/jsonl.ts`), unused workspace path constants (alerts,
  watchlist, probe, review, detections, DuckDB store paths), and the
  case-document dirty/traced markers (`markCaseDirty`, `markCaseTraced`,
  `dirty_since_timestamp`, `last_traced_at_timestamp`), which had no
  production callers.

## [0.18.8] - 2026-08-13 — devkit parity pins post-cut contract

The devkit parity smoke now pins the post-cut capabilities contract: the
CLI's public view reports no networks against the bittensor-serving devkit
(robinhood-only public surface, by design), while the devkit backend's own
document still advertises `bittensor` with the topology/facts layers.

### Fixed

- Devkit parity smoke crashed (`IndexError`) reading the pre-cut
  `cia mcp networks` shape; it now fetches the backend capabilities document
  directly and asserts both sides of the cut contract.

## [0.18.7] - 2026-08-13 — ACP/CIA production cut

The production cut retires the internal detection realm and the fund-flow
trace tools, reduces `cia monitor` to case tracking only, and collapses the
public surface to one robinhood graph with seven tools.

### Removed

- Detection realm (`src/detection/`) and the experimental internal tools
  `aml-scam-corridor-trace`, `aml-exchange-likeness`, and their detection
  findings plumbing. The detection scan CLI (`cia detect`) is gone too;
  detection now surfaces through the curated label set that supervises
  `aml_address_risk`.
- Detection limit keys from `src/config/limits.ts` (corridor, attribution,
  poisoning, fake-token, exchange-likeness caps).
- The public trace tools `aml_trace_victim_funds`, `aml_trace_deposit_sources`,
  and `aml_trace_suspect_funds`: CLI subcommands, `chain-insights.trace.v1`
  contract, limit keys, and the `chain-insights-trace-funds` skill. Fund-flow
  work now runs through `graph_query` / `graph_query_batch` with
  `USE topology`.
- The monitor detection/watching surface: detector cells, review/approve,
  alerts, watchlist, and label export are retired. `cia monitor` now tracks
  cases only: `run`, `watch`, `render`, `status`, `init victim`, and
  `case add|list|add-seed|remove-seed|close`. The `monitor:uat` devkit
  script is retired with it.

### Changed

- `meta_network_capabilities` collapses to one public `robinhood` network
  with `layers: {}` and seven public tools
  (`aml_address_risk`, `graph_query`, `graph_query_batch`,
  `meta_network_capabilities`, `meta_usage_status`, `meta_help`,
  `wallet_balance`).
- Docs and skills that referenced the removed surface are swept to match.

## [0.18.6] - 2026-08-08

### Changed
- Docs CI: nightly schedule (03:05 UTC) instead of every push to main.

## [0.18.5] - 2026-08-05 — codeql-action 4.37.3 -> 4.37.4

### Changed

- `github/codeql-action/{init,analyze,upload-sarif}` pinned SHA moved from
  `e4fba868` (v4.37.3) to `f205ea1c` (v4.37.4), across `security.yml` and
  `scorecard.yml`.

Combines dependabot #284, #285 and #286. They could not merge on their own:
the release gate requires a version bump plus a CHANGELOG entry on every
pull request, and a workflow-only change has no `package.json` to bump. All
three were stuck behind a gate they had no way to satisfy.

## [0.18.4] - 2026-08-05 — retire three empty acceptance stubs

### Removed

- `docs/acceptance/detection.md`, `federation.md`, `monitor.md`. Each held
  685-694 bytes with exactly two non-placeholder lines: a `---` rule and a
  "See components/x.md" pointer. Every scenario section read "No acceptance
  evidence detected for this component".
- The generator that emitted them is retired (rbmk
  `docs-reusable.yml:106`), so nothing recreates them and nothing will fill
  them in. They surfaced as `placeholder,no-triples` in the RBMK vault
  review queue.
- The other six acceptance docs are real authored scenarios and are
  untouched. `docs/acceptance/` remains a sanctioned category.

## [0.18.3] - 2026-08-05 — patch three production dependency vulnerabilities

### Security

- `ip-address` 10.2.0 -> 10.4.0. Three **high** SSRF and trust-boundary
  bypasses: leading-zero octets decoded as decimal while resolvers decode
  them as octal; a CIDR suffix suppressing special-use classification; and
  misclassified IPv4-mapped/NAT64 IPv6 addresses.
- `fast-uri` 3.1.4 -> 3.1.5. **High** — host confusion via a backslash
  authority introducer.
- `hono` 4.12.32 -> 4.13.0. **Moderate** — ReDoS in the CORS middleware via
  `Access-Control-Request-Headers`.
- `postcss` 8.5.22 -> 8.5.25 pulled in by the same resolution.

All semver-compatible; `npm audit fix` with no `--force`. Lockfile only.
`npm audit --omit=dev` now reports 0 vulnerabilities.

npm Audit is a REQUIRED check, so these three were blocking every pull
request in this repository, not just one.

## [0.18.2] - 2026-07-31 — per-workflow billable-units usage on aml_* responses

### Added

- **Usage block on every `aml_*` workflow response**
  (`src/lib/usage-accumulator.ts`): `aml_address_risk`,
  `aml_trace_victim_funds`, `aml_trace_suspect_funds`, and
  `aml_trace_deposit_sources` each make many internal `graph_query_batch`
  calls to answer one question. Every response now carries a `usage` block
  (`billable_units`, `query_count`, `truncated_queries`) totaling those
  internal calls, so downstream pricing and cost-aware callers see the real
  cost of the workflow, not just of `graph_query` itself.
- Capture point: each tool wraps its MCP client once
  (`wrapClientForUsageTracking`) before making any internal calls; the
  wrapper observes `graph_query_batch`/`graph_query` responses in transit
  and totals them, without changing what any call returns. A backend that
  does not yet emit billing fields contributes 0 units but still counts the
  query — this never blocks or fails a workflow.
- `usage` lives inside `facts` for `aml_address_risk`
  (`chain-insights.result.v1`) and at the top level of structuredContent for
  the three trace tools (`chain-insights.trace.v1`, which has no `facts`
  wrapper) — same key name, same place in each schema's factual payload.

## [0.18.1] - 2026-07-31 — client-side billable-units recount

### Added

- **Billable-units recount** (`src/lib/recount-units.ts`): counts the rows,
  nodes, and edges in a query payload the same way the server bills them.
  Clients can recount their own results to verify a bill. Audit-parity test
  proves the recount equals the server-reported `billable_units`.
- **README**: new "Billing: billable units" section — what a unit is, how to
  recount, and how to page with `LIMIT`/`SKIP` when a result is `truncated`.

## [0.18.0] - 2026-07-31 — money-trail enrichment for risk, tracing, and reports

### Added

- **Risk screening** (`aml_address_risk`): when an address sits on a known
  money trail, the result now carries a `money_trail` block — whether it is
  the operation's own plumbing or just touched the funds, how many hops from
  the source, and where the trail ends (exchange, mixer, bridge). Addresses
  off any trail are unaffected.
- **Suspect tracing** (`aml_trace_suspect_funds`): when the target is a known
  source, the trace is answered instantly from the precomputed money trail
  instead of re-walking the graph, stamped with the investigation round it
  came from. Live tracing stays the default for everything else and can be
  forced with `live`.
- **Graph reports and dossiers**: money-trail steps and trail-end shortcuts
  now render as their own labelled layer, distinct from ordinary fund flow.

## [0.17.1] - 2026-07-30 — monitor: :OnMoneyTrail family rename with dedup re-key

- fix(monitor): the graph-layer node-label family `:Attributed` is renamed
  `:OnMoneyTrail` (money-trail graph rebuild, projection version bump). The
  label probe's overlay vocabulary (`OVERLAY_FAMILIES`, `label-probe.ts`)
  now recognizes `OnMoneyTrail` and drops `Attributed`; severity stays
  `context` under the new name (`severityForFamilies`); the label-text ->
  family map (`attribution_peripheral`/`attribution_funder`) now resolves
  to `OnMoneyTrail`.
- fix(monitor): a new one-time transparent re-key pass (`migrateFamilyRename`,
  wired into `withStore` alongside `migrateLabelSourceRefs`) maps any
  pre-existing `watchlist_hits` row already shaped `address|Attributed|source`
  to `address|OnMoneyTrail|source`, idempotently, on store open — so the
  graph rebuild's `:OnMoneyTrail` label cannot mint a fresh, non-colliding
  `source_ref` for an address already known under the retired `:Attributed`
  family (the #270 retro-flood class, one layer further than the Plan 3 D3
  label-text guard).

## [0.17.0] - 2026-07-30 — monitor: overlay-family severity on label alerts

- feat(monitor): the label probe (`src/monitor/label-probe.ts`) now reads
  `labels(a) AS families` alongside the free-text `a.labels` property, and
  derives a `severity: 'alert' | 'context'` from the graph's node-label
  overlay (`extractFamilies`, `severityForFamilies`) — never from the label
  text itself, so a future label-text rename cannot move severity.
  `Scam`/`Mixer`/`Bridge`/`Poisoned`/`Propagated` alert; `Attributed` alone
  and/or `Victim`/`Exchange` alone are `context`; no overlay family at all
  (labels-text-only) stays `alert`, the conservative prior behavior.
  `AlertEvent` and `WatchlistHit` gain the optional `severity` field,
  populated for `watchlist_label` alerts only (label-governance Plan 3, D2).
- fix(monitor): cutover-proof label dedup re-key — the #270 retro-flood class
  guard (label-governance Plan 3, D3). `source_ref` for label hits is now
  `address|family|source` instead of `address|label|source`, and the
  monotone label baseline keys freshness on `(family, source)` too — both via
  a strict label-text vocabulary (`vocabularyFamily`/`familyForLabel` in
  `src/monitor/label-probe.ts`) that maps the retired v2 detector text
  (`attack_attributed`) and its v3 replacement (`attribution_transport`)
  to the SAME family (`Scam`), so a label-text rename can never mint a
  fresh, non-colliding ref for an address already known. A one-time,
  transparent migration (`migrateLabelSourceRefs`, wired into `withStore`
  the same way as the existing `migrateAbsoluteDocKeys`) re-keys
  pre-existing `trigger='label'` `watchlist_hits` rows on every read-write
  store open; unmappable legacy label text keeps its old ref unchanged.

## [0.16.0] - 2026-07-29 — Permit2 payments on Robinhood Chain + payment-asset preference

- feat(mcp): the x402 payment client now accepts Permit2-based `upto` offers
  on Robinhood Chain (`eip155:4663`, RPC `https://rpc.mainnet.chain.robinhood.com`)
  alongside Base Mainnet — no viem chain-registry entry is needed, the x402
  SDK resolves RPC per CAIP-2 chain ID directly.
- feat(mcp): `CHAIN_INSIGHTS_PAYMENT_ASSET_PREFERENCE` (comma-separated
  symbols or addresses, e.g. `CHOICE,USDG,USDC`) re-orders a 402 response's
  `accepts` offers before the payment scheme picks one, so an operator can
  route payments to a preferred asset without a server change. New pure
  `src/mcp/payment-asset-preference.ts` module (`orderPaymentOptions`).
- fix(mcp): when a Permit2 allowance is missing for an asset/network this
  client cannot auto-approve (anything other than USDC on Base), it now
  throws a clear error naming the token, the canonical Permit2 address
  (`0x000000000022D473030F116dDEE9F6B43aC78BA3`), and the exact `approve(...)`
  call — instead of silently attempting the Base-only auto-approval flow.

## [0.15.5] - 2026-07-28 — ci: README lint becomes a hard gate

- ci: drop `--warn-only` from the vendored docs workflow README lint,
  matching the root `docs-reusable.yml` hard-gate flip. The README already
  passes the anchored 11-section check.

## [0.15.4] - 2026-07-28 — docs: knowledge layer migration — skill into docs, README to standard

- docs: migrate the retired repo knowledge skill into authored docs:
  new `docs/architecture/data-contracts.md` (tool surface, search limits,
  endpoint rules, shared-graph model, detection scanner contract, devkit
  contract) and `docs/architecture/operating-rules.md` (repo invariants,
  findings rules, CI gotchas, method ownership); the stub
  `docs/architecture/components/monitor.md` and `detection.md` are now
  fully authored from the same source.
- docs: rewrite `README.md` to the RBMK 11-section standard (purpose,
  boundaries, dependencies, architecture, setup, run, configure, test,
  debug, release, links); the generated workers marker region is replaced
  by a hand-maintained module table.
- docs: remove all `<!-- gsd: ... -->` generation markers; architecture
  docs are human-authored from here on.
- ci: slim the vendored `docs.yml` to match the upstream docs-reusable
  slim-down — the gsd architecture generator, the claude CLI step, and the
  knowledge-skill autorefresh are retired; the README lint and C4 render
  steps stay.
- chore: delete the retired knowledge skill directory. No shipped product
  skill (`chain-insights-*`, `ci-status`, `test-chain-insights-graph`) is
  touched.

## [0.15.3] - 2026-07-28 — adopt dependabot batch 2026-07-28 (10 PRs)

- chore(deps): adopt the mcp-and-payments group (#266): `@modelcontextprotocol/ext-apps`
  1.7.4 → 1.7.5, `@modelcontextprotocol/sdk` 1.29.0 → 1.30.0, `@x402/evm` and
  `@x402/fetch` 2.19.0 → 2.20.0, `viem` 2.55.5 → 2.55.10.
- chore(deps): `hono` 4.12.31 → 4.12.32 (#243), `@hono/node-server` 2.0.11 → 2.0.12
  (#242), `@duckdb/node-api` 1.5.5-r.1 → 1.5.5-r.2 (#241).
- chore(deps-dev): adopt the tooling group (#259): `@types/node` 26.1.1 → 26.1.2,
  `tsdown` 0.22.13 → 0.22.14.
- ci: adopt GitHub Actions bumps: `actions/checkout` 7.0.0 → 7.0.1 (#249),
  `actions/setup-node` 4/6.4.0 → 7.0.0 (#248), `ossf/scorecard-action`
  2.4.3 → 2.4.4 (#247), `github/codeql-action/upload-sarif` 4.37.1 → 4.37.3
  (#246), `github/codeql-action/analyze` 4.37.1 → 4.37.3 (#245); `github/codeql-action/init`
  is moved to 4.37.3 as well because CodeQL fails when its actions are not all on
  the same version. SHA pins and version comments updated to match.

## [0.15.2] - 2026-07-28 — retire dominant_asset/asset_usd_totals from the FLOWS_TO contract

- chore: `dominant_asset` and `asset_usd_totals` are address-level features
  computed on demand, not FLOWS_TO edge payload — the upstream pipeline write path
  no longer writes them, so the advertised MCP schema text (`proxy.ts`,
  `init.ts`, the chain-insights-cypher skill) stops listing them and the
  dormant `dominant_asset` constituent-merge rule is dropped from the
  federation client merge. Keeping them in the schema text advertised fields
  that queries would never return, which is worse than a shorter schema: agents
  write queries against what the schema promises.

## [0.15.1] - 2026-07-28 — the action log now records CLI tool calls, not just proxy ones

- fix: the action log was installed only on the MCP proxy's remote client. Every
  `cia` command builds its own client, so an unattended instance driven by
  `cia monitor watch` produced an empty log while the feature appeared to work —
  a full ten-cell monitoring pass recorded nothing. The wrapper is now shared and
  installed on both client paths; the same pass records 24 entries. The failure
  mode mattered more than the missing rows: an audit log that is silently empty
  on the one path that runs unattended is worse than no audit log, because it is
  trusted.

## [0.15.0] - 2026-07-28 — label trigger & detector-cell cutover

- feat: watchlist label trigger — a diff-based probe in the watchlist pass
  raises `watchlist_label` when a watched address gains a new
  (label, source) pair from the platform's topology label overlay. One
  batched graph query per distinct network per pass; last-seen label sets
  live in the append-only canonical `logs/label-baseline.jsonl` (probe-
  cursor discipline); hits land in the canonical watchlist-hits log with
  `source_ref = <address>|<label>|<source>` (deduped, rebuild-safe).
  Bootstrap is silent: pre-existing labels are state, not events. Managed
  (`case:<id>`) entries name the owning case on the alert, so victim
  workspaces are covered with no victim-specific code.
- feat: `cia detect` and monitor cells for `address-poisoning`,
  `fake-token`, and `attack-pattern` print a deprecation warning
  (recorded as `deprecation` on the run document's cell outcome): these
  detections now run on the platform backend and surface via
  `watchlist_label` alerts and `aml_address_risk`. Mixer is untouched.
  Detection code stays as the cutover shadow reference.
- docs: `docs/monitoring.md` documents the platform-label flow and the
  mixer-only monitor detector set.
- devkit: monitor smoke asserts the label probe's silent bootstrap on real
  fixture labels, a seeded label delta alerting exactly once (dedup across
  runs and rebuild), and the deprecation warnings (absence for mixer).

## [0.14.1] - 2026-07-28 — scam-topology case -> label lifecycle

- feat: `cia monitor export labels` emits the frozen
  `chain-insights.curated-labels.v1` contract — one row per (address, label)
  from approved docs with columns
  `address,network,label,case_id,decision_id,doc_ref,decided_at_timestamp,reviewer`.
  Case-doc roles map seed -> `scam_seed`, candidate_intermediate -> `mule`,
  candidate_deposit -> `deposit_endpoint`; unknown roles are skipped with a
  warning; detector docs keep their classification as the label with an
  empty case_id. `decision_id` is the content-addressed decision filename
  stem, so downstream importers can dedup full-snapshot re-exports.
- feat: case findings docs carry per-address cluster roles — the bootstrap
  trace writes the full initial cluster (seeds included) for review; later
  docs carry only new corridor entrants and operator-added seeds. Approvals
  feed only candidate_intermediate addresses back into the corridor seed set.
- feat: `monitor status` lists open cases and marks a scam-topology case
  `-> closable` once its cluster is labeled and its managed watchlist
  entries have been dormant for `render.dormant_after_days`. Close remains a
  human action.
- feat: `case close` keeps the case's `managed_by` watchlist entries as the
  dormancy tripwire and says so; a new `case_reactivated` alert (deduped via
  the canonical watchlist-hits log) fires when an activity hit lands on a
  managed entry of a CLOSED case, naming the case and address. No
  auto-reopen.
- devkit: monitor smoke asserts the curated-labels envelope and provenance
  columns, the reworked U8 role-typed bootstrap doc, and a new close-keeps-
  tripwire phase.

## [0.14.0] - 2026-07-28 — victim lane & event-driven tracing

- feat: monitor config gains `profile: "operator" | "victim"` and
  `trace_mode: "interval" | "on_movement"` (absent profile = operator;
  resolved default interval for operator, on_movement for victim); detector
  `cells` may now be empty.
- feat: event-driven tracing — in on_movement mode `traceCase` runs only for
  never-traced (bootstrap), probe-marked-dirty, or forced cases
  (`monitor render --force`, new `monitor run --force-trace`); skipped cases
  record `trace_skipped_reason: "no_activity"` in the run document.
- feat: cluster auto-watchlist — every successful trace upserts the case's
  cluster (seeds, intermediates, deposit endpoints; never exchanges) as
  `managed_by: "case:<id>"` watchlist entries, refreshing and pruning per
  trace; manual entries are never touched and case close keeps managed
  entries.
- feat: activity probe — one cheap query per network over all watched
  addresses on `last_activity_timestamp > cursor` with per-shard MAX merge;
  hits are canonical (rebuild-safe), emit `watchlist_activity` alerts, and
  mark the owning case dirty. Probe cursors live in append-only
  `logs/probe-cursors.jsonl`.
- feat: `cia monitor init victim --case-id <id> --network <net> --seed
  <addr...>` one-shot victim bootstrap (refuses to clobber an existing
  monitor config); `monitor status` is profile-aware.
- docs: `docs/monitoring.md` restructured victim-first.

## [0.13.3] - 2026-07-28 — devkit U6 snapshot-on-change

- test: monitor smoke U6 asserts the snapshot-on-change contract (no second
  snapshot file for an unchanged topology; run document records
  confirmed_unchanged) — verified against a fully regenerated devkit fixture
  (131 pass, 0 fail).

## [0.13.2] - 2026-07-28 — uniform epoch-ms timestamps in the render layer

- fix: `_timestamp` fields are epoch milliseconds everywhere — the render
  layer (verdict, dossier, notes) formats them directly and the unit-guessing
  `toSeconds` heuristic is removed; `monitor render` passes `Date.now()` (ms)
  so the Generated line and ACTIVE/DORMANT arithmetic use one unit.
- feat: `chain-insights.trace.v1` evidence edges now carry
  `first_seen_timestamp`/`last_seen_timestamp` (epoch ms) projected as the
  min/max over their contributing traced hop rows, so case verdicts date
  ACTIVE/DORMANT from real edge timestamps (omitted when the source rows
  lack them).
- devkit: seeded FLOWS_TO edges carry production-shaped properties
  (`first_seen_timestamp`/`last_seen_timestamp` in ms, tx id anchors,
  amount/count), and the monitor smoke asserts the rendered dossier headline
  carries a sane date.

## [0.13.1] - 2026-07-27 — dossier verdict + dedupe fixes

- fix: dossier verdict handles mixed timestamp units (case documents carry
  milliseconds, trace docs seconds) — no more far-future DORMANT dates; when
  traces carry no edge timestamps the headline reads "no movement observed
  since monitoring began <date>".
- fix: dossier deduplicates paths revisited by the victim and suspect traces —
  funds-destination totals count each path once, and exchange deposit
  endpoints aggregate one row per deposit→exchange pair with a path count.

## [0.13.0] - 2026-07-27 — monitor investigation output

- feat: human-readable investigation output per open case under
  `published/cases/<case_id>/` — a Markdown dossier with an ACTIVE/DORMANT
  headline verdict, funds-destination summary by terminal endpoint class,
  exchange deposit endpoints with labels, scammer-cluster address list, a
  bounded Mermaid money-flow diagram, and links to the HTML graph reports;
  per-address notes under `addresses/`; and an append-only, idempotent
  `timeline.md` (one line per alert).
- feat: change-triggered re-trace — on case change (new snapshot content,
  case edits, or new alerts) the render pass re-traces the case seeds as
  victim funds and as suspect funds through the standard trace tools and
  persists `chain-insights.trace.v1` artifacts under `cases/<id>/traces/`;
  unchanged cases skip tracing entirely (render state in
  `.chain-insights/monitor/render-state.json`).
- feat: `cia monitor render [--force] [case_id]` renders on demand;
  `monitor run` and `monitor watch` run the render pass automatically after
  case tracing, with per-case error isolation.
- feat: `render.dormant_after_days` monitor config (default 30) controls the
  DORMANT threshold.

## [0.12.1] - 2026-07-27 — monitor lifecycle hardening

- feat: review decisions are content-addressed and append-only. Decision files
  are named `<docHash8>-<decision>.review.json` from the findings doc's
  workspace-relative path (no same-millisecond collisions), decision docs
  record a workspace-relative `doc_path`, and a second decision for the same
  doc is refused unless `--force` supersedes it with a NEW decision recording
  `supersedes` — the prior file is never rewritten. Exports and case-address
  unions follow the effective (non-superseded) decisions.
- fix: reviewed copies are keyed by doc identity (`<docHash8>-<basename>`),
  and approve/reject refuse any path outside the workspace `detections/` tree.
- fix: `monitor case close` goes through the case state machine — a missing
  case reports `no such case`, re-closing is a warning no-op that preserves
  the original `closed_at_timestamp`, and the case-id shape is validated in
  every case command before any path join.
- feat: alert sinks are bounded by `alerts.hook_timeout_ms` (default 30s) —
  a hung webhook is aborted and a hung exec hook is killed, logged as a sink
  failure, and never fails the run.
- fix: `monitor review list` and label export skip unreadable or malformed
  findings/decision files with a warning instead of failing wholesale.
- fix: alert ids are sequenced per `run_timestamp`, so a mixed-run batch
  cannot mint duplicate `alert_id`s; dust hits are deduplicated by hit key
  within a single probe batch.
- fix: derived-store doc keys (`ingested_docs`, `findings`,
  `finding_addresses`, replay cursors, finding-trigger `source_ref`) are
  workspace-relative, with transparent migration of legacy absolute keys on
  store open — moving the workspace no longer re-ingests or re-alerts.
- fix: report table cells escape `|` and flatten newlines so an error message
  cannot break the Markdown table.

## [0.12.0] - 2026-07-27 — monitor store and runner durability

- fix: watchlist-hit dedup now survives `monitor rebuild`. Hits are appended
  to the canonical `.chain-insights/monitor/logs/watchlist-hits.jsonl`; the
  DuckDB `watchlist_hits` table is a pure replay index, so a rebuilt store no
  longer re-alerts every historical hit.
- fix: alerts are at-least-once. The runner appends alerts to the canonical
  JSONL, commits the derived DB, and only then delivers sinks, marking each
  delivery in `alerts/emitted.jsonl`; undelivered alerts are re-emitted at the
  start of the next run instead of being lost to a crash.
- fix: every canonical JSON doc (snapshots, run docs, findings, case docs) is
  written atomically via tmp-file + rename, and a malformed doc found during
  ingest is quarantined to `<name>.corrupt` with a warning instead of wedging
  every later run and rebuild.
- feat: a PID lockfile at the workspace root excludes concurrent
  `monitor run`/`monitor watch` loops; a stale lock (dead pid) is taken over
  and a live holder makes the second run exit 0 with a log line.
- perf: ingest is O(new data). JSONL replay sources track byte offsets in
  `replay_cursors` (a torn tail is held back until complete), and snapshot
  ingest diffs against only the immediate predecessor file. `monitor rebuild`
  still removes the DB, so rebuild remains full replay from zero.
- fix: unchanged case snapshots are no longer re-written every run — snapshot
  content is hashed (run timestamp excluded) and the run doc records
  `confirmed_unchanged` with the hash; empty findings docs whose previous
  same-detector doc was also empty are skipped.

## [0.11.22] - 2026-07-27 — monitor smoke reads the renamed timestamp fields

- fix: the devkit monitor smoke still read `run_ms`, `last_block_timestamp_ms`,
  `seeds_added_at_ms`, `at_ms` and `closed_at_ms` through `jq`, which the
  previous release renamed to `_timestamp`. Shell field reads are invisible to
  the typechecker, so the rename left them behind and two assertions failed
  against fields that were now always null. Reading a renamed field as null is
  also how an assertion can pass for the wrong reason, so this is worth more
  than the two visible failures suggested.

## [0.11.21] - 2026-07-27 — points in time are `_timestamp`, not `_ms`

- chore: renamed every internal identifier that names a point in time from
  the `_ms` convention to `_timestamp`, matching the serving-layer convention
  already used by Chain Insights Graph (`first_seen_timestamp`,
  `last_seen_timestamp`, `block_timestamp`, etc.). Elapsed-time/duration
  identifiers (`duration_ms`, `wall_clock_ms`, `scan_window_ms`) are
  unchanged — only points in time convert. Renamed directly with no
  compatibility shim, since Chain Insights is not yet in production: no
  external callers and no workspace history to preserve.
- fix: the public MCP tool argument `incident_timestamp_ms` on the
  `aml_trace_victim_funds`/`aml_trace_suspect_funds` family is now
  `incident_timestamp`, with `PUBLIC_MCP_TOOL_ALLOWED_ARGS` and
  `NUMERIC_ARG_KEYS` updated to match, and a new proxy test proving the
  renamed argument survives `normalizeRemoteToolArguments`'s allowlist
  filter instead of being silently stripped.
- Renamed identifiers include (non-exhaustive): `run_ms` → `run_timestamp`,
  `incident_timestamp_ms` → `incident_timestamp`, `seeds_added_at_ms` →
  `seeds_added_at_timestamp`, `decided_at_ms` → `decided_at_timestamp`,
  `generated_at_ms` → `generated_at_timestamp`, `emitted_at_ms` →
  `emitted_at_timestamp`, `from_ms`/`to_ms` → `from_timestamp`/
  `to_timestamp`, `created_at_ms`/`closed_at_ms`/`updated_at_ms`/
  `acked_at_ms`/`at_ms` → `..._timestamp`, `last_scanned_at_ms` →
  `last_scanned_at_timestamp`, `last_block_timestamp_ms` →
  `last_block_timestamp`, `since_ms` → `since_timestamp`, `first_seen_ms` →
  `first_seen_timestamp`, `last_seen_ms` → `last_seen_timestamp`, `ts_ms` →
  `timestamp`, and the federation merge fields `bucket_start_ms`/
  `bucket_end_ms` → `bucket_start_timestamp`/`bucket_end_timestamp`
  (matching the corresponding upstream graph-property rename).
- Persisted on-disk shape changed: DuckDB column names in
  `src/monitor/store.ts`, the canonical JSON on `case.json`/`alerts.jsonl`/
  checkpoints/run docs, and `detection/checkpoint.ts` state now use the
  `_timestamp` names. An existing local `.chain-insights/` workspace is
  incompatible with this release; rebuild with `cia monitor rebuild` or
  recreate the workspace.

## [0.11.20] - 2026-07-27 — optional action log for unattended runs

- feat: optional append-only JSONL action log of every MCP tool invocation,
  gated behind the `CIA_ACTION_LOG` environment variable and off by default.
  Each entry records the tool name, arguments, outcome, duration, and any
  `warnings`/`search_limits` the result surfaced — the signal an operator or a
  later reviewing agent needs to audit what ran unattended and tell "found
  nothing" from "hit a cap" without re-running anything. A log write can never
  fail or stall the tool call it observes: errors are swallowed, and the write
  is bounded by a short internal timeout so a pathological target path cannot
  hang the caller.

## [0.11.19] - 2026-07-27 — a case's seeds are no longer fixed at creation

- feat: `cia monitor case add-seed <case-id> --address <addr...> [--note]` and
  `cia monitor case remove-seed <case-id> --address <addr...>`, backed by
  `addCaseSeeds` / `removeCaseSeeds`. Investigations grow — an operator wallet
  surfaces, an intermediate coldkey funds the same exchange deposit — and until
  now the only route was hand-editing canonical `cases/<id>/case.json`, which is
  meant to be a fallback rather than the only door. Both commands are idempotent
  (re-adding an existing seed is a no-op, not an error), both validate against
  the same chain-address allow-list the watchlist uses so nothing outside it can
  reach a query builder, and a case can never be left with zero seeds.
- feat: seed mutations are recorded on the case — `seeds_added_at_ms`
  (address → when it became a seed) plus a `seed_events` timeline carrying the
  `--note`. That is what explains a corridor discontinuity to whoever reads the
  case later.
- fix: **a widened aperture is no longer reported as movement.** Case movements
  are diffed against the previous snapshot, so adding a seed made the next run
  report every newly visible address as a new hop — a fabricated forensic claim
  that funds moved at a timestamp when they did not. Snapshots now record which
  seed(s) reached each address (`via_seeds`), and the diff separates the two:
  reachable from a pre-existing seed → movement; reachable only from a
  newly added seed → **scope expansion**, surfaced as `scope_expansions_count`
  on the run document, `movement = 'scope_expansion'` in the derived store, and
  a `case_scope_expansion` alert. The split lives in the pure diff, so
  `cia monitor rebuild` rederives it identically. Classification signals
  (`cashout_endpoint`, `frontier_candidate`) still fire for scope-expanded
  addresses and still reach the review queue — only the movement claim is
  withheld.
- feat: `add-seed` / `remove-seed` are refused on a closed case. The run loop
  re-traces only open cases, so a seed added to a closed one would sit in
  canonical JSON with no snapshot behind it and silently rewrite what was
  investigated and when. There is no reopen path: a closed investigation that
  needs to grow is a new case.
- docs: `docs/monitoring.md` and the monitoring skill gain the seed-mutation
  lifecycle and the movement-vs-scope-expansion rule; the case sections no
  longer imply seeds are fixed at creation.
- devkit: `smoke-monitor.sh` Phase I expands its known-answer theft case with
  `case add-seed` instead of hand-editing `case.json`, and asserts the phantom
  -movement guard on real data — zero movements and zero `case_movement` alerts
  for the widened scope, accounted for as scope expansion instead, quiet again
  on the next idle re-run. New Phase J covers the guards: removal cannot empty a
  case, a Cypher-shaped address never reaches canonical JSON, the narrowed seed
  set is traced on the next run, and both mutations are refused on a closed case
  with the canonical document left untouched.

## [0.11.18] - 2026-07-27 — search bounds are tunable, bounded, and visible

- feat: every search bound in the investigation and detection tools is now a
  named knob with a published default and a hard ceiling, instead of a constant
  compiled into one call site. The motivating case was measured, not
  hypothetical: on a real high-fan-in deposit the reverse-trace row cap of 500
  left the origin unreachable at four hops, while 5000 closed the full
  deposit-to-origin chain in about six seconds. The cap, not the depth, was the
  binding constraint — and a value that generous would be badly wrong on a
  quieter chain. See `docs/search-limits.md` for the full table.
- feat: bounds resolve through four layers, highest first: the per-call
  argument, then `networkLimits.<network>` in the config file, then `limits`
  for all networks, then the per-network default table, then the built-in.
  Unattended monitor runs read the same two config blocks, with per-cell
  `params` remaining the most specific layer.
- feat: `aml_trace_deposit_sources` accepts `row_limit`; `aml_trace_victim_funds`
  and `aml_trace_suspect_funds` accept `per_address_limit`. Both are also
  available as `cia` flags. Detector bounds stay on `--param`.
- feat: trace results report `input.search_limits` — what was requested, what
  was used, the unconfigured default, and the ceiling — so a bounded search is
  visible without reading warnings. Truncation warnings now name the knob that
  bit and how much headroom it still has.
- change: a request above a ceiling is REJECTED with an error naming the knob
  and its limit, rather than clamped. A silently clamped search returns a
  result that reads as exhaustive when it is not, which is the same class of
  failure as the arbitrary truncation this work exists to fix.
- change: hop depth is bounded harder than any other knob, because its cost
  grows exponentially rather than linearly — three hops produced 5,201 paths
  against a real deposit where four produced 10,201, and five exhausted the
  graph backend's memory outright. Hop ceilings are at most 5 and never more
  than three above the shipped default, and they cannot be raised from the
  per-call layer; a per-network entry may lower a ceiling, but only a code
  change raises the absolute maximum.
- fix: the attack-pattern detector accepted any non-negative `max_hops`,
  `max_frontier`, or `max_rows` from a `--param` or a monitor config with no
  upper bound at all — a live way to hang the graph from a config file. All
  three are now range-checked.
- fix: `per_address_limit` and `row_limit` are registered in the MCP proxy's
  argument allowlist and in the CLI's numeric-argument set. An argument absent
  from either is silently dropped with no error; a contract test now proves,
  for every public tool, that each declared schema argument is allowlisted.
- note: defaults are unchanged. Every existing call that passes no override
  produces byte-identical query text and identical results, pinned by a test
  that asserts each default against its previously hardcoded literal.
## [0.11.17] - 2026-07-27 — devkit smoke: known-answer case tracking over a real theft corridor

- devkit: `smoke-monitor.sh` gains Phase I, a known-answer case-tracking
  scenario over a real theft corridor present in the pinned fixture (actors
  referenced by neutral on-chain role labels only). It asserts the exact
  baseline corridor from the victim seed (theft hop plus a near-equal 3-way
  split, all `propagated_scam`), expands the case with the second controlled
  wallet via the canonical `cases/<id>/case.json`, and asserts the
  convergence: the shared exchange deposit enters the corridor, raises
  `case_movement` and `frontier_candidate` alerts, and lands in the case
  findings document.
- devkit: the same phase proves the watchlist end to end on a case address —
  a watched deposit raises `watchlist_finding` (via the case findings doc)
  and `watchlist_movement` (via `case_movements`) on the next run, and both
  dedupe by `source_ref` across idle re-runs.
- devkit: regression rows for #232 — an idle re-run adds no pending reviews,
  and `review list` never lists a zero-findings document.## [0.11.16] - 2026-07-27 — deposit tracing keeps the highest-value paths when it truncates

- fix: `aml_trace_deposit_sources` capped each hop's reverse paths with a bare
  row limit and no ordering, so the backend returned an arbitrary slice of
  whatever matched. On a deposit with heavy fan-in that quietly discarded the
  largest flows into it — the routes an investigation is actually looking for —
  while keeping negligible ones, and raising `max_hops` made it worse rather
  than better, because deeper hops fan out wider and reach the cap sooner.
  Reverse paths are now ranked before the cap is applied, so truncation loses
  the least value-bearing routes first. A path is ranked by its narrowest edge
  rather than by a total: a route cannot carry more value than its bottleneck,
  and ranking by a sum would favour long chains of small transfers over a short
  chain of large ones.
- fix: the truncation warning now states what survived instead of only that
  something was cut — it reports the value of the weakest retained path, which
  is the upper bound on anything dropped, so it is possible to tell at a glance
  whether the missing rows could have mattered.

## [0.11.15] - 2026-07-27 — scheduling: recommend pm2 supervising `monitor watch`

- docs: the recommended standing-watch setup is now pm2 supervising
  `cia monitor watch` — the loop lives in `watch` (interval from the monitor
  config), and pm2 does the job it is built for: restart on crash, one log
  surface, one status command, boot persistence. Under this pairing `pm2 list`
  showing `online` simply means healthy, instead of the previous hybrid where
  the process read `stopped` between one-shot passes and the status needed
  explaining away. The hybrid — pm2 launching the one-shot `monitor run` via
  `cron_restart` — is now documented as an anti-pattern: it is one missing
  `autorestart: false` away from a hot loop that re-runs the full detector
  matrix continuously against metered graph allowance.
- docs: corrected the exit-code section — under `watch` the process never
  exits between passes, so per-pass exit codes are not visible to a
  supervisor. An isolated cell failure is recorded on the cell entry in the
  pass's run document and in `cia monitor status`, and the docs now say where
  to look instead of implying pm2 would flag it.

## [0.11.14] - 2026-07-26 — monitoring UAT asserts results, not exit codes

- fix: the monitoring acceptance suite asserted process exit codes where it
  should have asserted results. Four detector scenarios shared a single
  "did the run finish" check that passed whether a detector found everything
  or nothing — and tolerated a permanently failing detector — so two of the
  four scenarios had in fact never observed a finding. Every scenario now
  reads the run record, the findings document, the review queue, or the alert
  stream and asserts on its contents.
- fix: the scenario for "a second scheduled run only covers the new window"
  was specified but never implemented. It is now covered in both directions:
  an incremental detector must advance its checkpoint and report nothing for
  an empty new window, and a full-state detector must keep scanning in full
  while emitting only findings it has not already reported. Three consecutive
  runs over unchanged data, and a `--full` re-emit, are asserted end to end.
- fix: the two network views over one shared address-grain graph are now
  pinned by an executable case — each view must return only its own address
  family, with no overlap — so a regression to unscoped queries fails the
  suite instead of shipping.
- fix: added scenarios for a forced detector failure staying isolated while
  the run completes, for `watch` resuming after a hard kill with no lost or
  duplicated alerts, for the curated-import contract (an approved document
  carries a reviewer and identical findings; its unreviewed sibling does not),
  and for watchlist alerts de-duplicating across runs.
- fix: the local Bittensor development kit now serves both network views of
  its shared topology graph instead of refusing the EVM one, which is what
  made the network-scoping case testable at all. Its capability document
  advertises the second view with its facts layer off, matching the data the
  kit actually carries.
- fix: scenarios that genuinely cannot assert anything on the local fixture —
  the token-registry spoof case, the metered usage guard, and the exact
  remote-call count — now print an explicit skip naming the blocker and the
  unit test that covers them, instead of being silently absent or quietly
  passing.

## [0.11.13] - 2026-07-26 — monitoring is discoverable

- docs: new shipped skill `chain-insights-monitoring` routes an agent from
  "watch this" to `cia monitor` — workspace setup, the detector×network matrix,
  cases, the review→labels boundary, alerts and sinks, the watchlist, exit
  codes, and scheduling. Monitoring shipped across 0.11.x but no shipped skill
  mentioned it, so an agent installing Chain Insights could not discover it.
- docs: `chain-insights-monitoring/references/pm2-scheduling.md` documents
  scheduling a one-shot with pm2. `cia monitor run` performs one pass and
  exits by design, so `autorestart: false` is mandatory — pm2's default treats
  each clean exit as a crash and hot-loops the detector matrix. Also covers
  exit code 2 showing as `errored` (intended alerting, not a broken deploy),
  the separate `pm2 save` and `pm2 startup` persistence steps, and when to
  prefer pm2 over cron or `cia monitor watch`.
- docs: `docs/monitoring.md` gains the scheduling section (cron, pm2, `watch`)
  with a working `ecosystem.config.cjs`, full-state vs incremental detector
  semantics and why an unchanged run legitimately yields an empty findings
  document, the `--full` re-emit escape hatch, network scoping, and guidance to
  quarantine bad findings by rejecting rather than deleting them.
- docs: `chain-insights-cypher`, `chain-insights-bittensor-cypher`, and
  `docs/graph-query-compatibility.md` now state the shared-graph model
  explicitly: a chain's address spaces are two views over ONE address-grain
  topology graph split by the `Address.network` node property, so the `network`
  argument selects the graph and not the addresses inside it, and every
  non-exact `:Address` match must scope itself. Under `USE facts` the inverse
  holds — each network has its own backing database and `Address` carries no
  mapped `network` property at all.
- docs: `chain-insights-investigation` now routes standing-watch requests to
  the monitoring skill instead of improvising a loop around the AML tools;
  `test-chain-insights-graph` gains a monitoring UAT contract that will not
  misreport exit 2 or an empty findings document as a failure.
- docs: the `dist/` trap is called out in `chain-insights-developer-experience`,
  `docs/development.md`, and `docs/debugging.md` — `dist/` is gitignored, does
  not auto-rebuild, and is not rebuilt by `npm test`, so a stale build passes
  CI and ships a plausible wrong answer with no error. `docs/development.md`
  also documents worktrees for concurrent work.
- docs: README expands the monitoring section into the full command surface
  with the three non-obvious behaviors (one-shot, exit 2, empty-is-valid), and
  replaces a stale `USE facts` example that referenced the retired address
  feature surface.
- docs: `docs/investigation-workspaces.md` explains how a monitor workspace
  relates to an investigation workspace and when to keep them separate.

## [0.11.12] - 2026-07-26 — review queue only lists documents that have something to review

- fix: a detector run that found nothing still wrote a findings document, and
  that empty document was queued as a pending review. Full-state detectors emit
  one per suppressed cell on every run, so a standing monitor accumulated review
  items indefinitely without any of them containing a finding — an eight-cell
  hourly schedule added roughly 192 empty items a day, burying the handful that
  were real. Empty documents are no longer listed as pending review work. They
  are still written and still replayed by `monitor rebuild`, because they are
  provenance: the run record and the suppression count they carry remain intact.
## [0.11.11] - 2026-07-26 — detectors scope by address network

- fix: detector sweeps now scope their topology queries by the address network,
  so two network views over one shared address-grain graph no longer return
  identical findings. Previously the network argument selected the graph but
  not the subset of addresses within it, so an attack-pattern sweep for a
  chain's EVM view returned the same rows as its SS58 view — wrong-network
  attributions published as reviewable findings, at double the metered cost.
- fix: the change covers both the seed pull and the frontier expansion in
  attack-pattern (both endpoints of the downstream walk), and the
  degree-qualified candidate enumeration in mixer-likeness. Address-anchored
  lookups are unchanged: an exact address is already a unique key, and
  screening an EVM address under a chain's primary network name keeps working.
- fix: transfer-registry detectors (address-poisoning, fake-token) are
  unaffected — they read the bounded facts layer, which is already routed to a
  per-network database.

## [0.11.10] - 2026-07-26 — monitor address watchlist

- feat: `cia monitor` gains an address watchlist, so monitoring can answer
  "did any of this touch *my* addresses?" and not only "what is happening on
  the network". Manage it with `cia monitor watchlist add|list|remove`, or by
  hand-editing `.chain-insights/monitor/watchlist.json` — address plus network
  is the identity, and re-adding an address updates its note rather than
  failing. Enable the pass with a `watchlist` block in the monitor config; with
  no block, or with an empty watchlist, a run behaves exactly as before.
- feat: three triggers raise alerts on the existing stream (`alerts list`,
  `ack`, webhook and exec sinks, and the report): `watchlist_finding` when a
  detector sweep names a watched address, `watchlist_movement` when a tracked
  case's funds reach one, and `watchlist_dust` on a small incoming transfer
  below the configured ceiling — the opening move of address poisoning, which a
  network-wide detector may not flag on its own.
- feat: the cost profile is flat in watchlist size. The finding and movement
  triggers are answered entirely from data the run already produced locally and
  cost nothing extra; the dust check is one batched graph query per distinct
  network, so a 500-address watchlist costs the same as a 5-address one.
  Repeated runs with overlapping dust windows never re-alert the same transfer.
- feat: `cia monitor report` gains a Watchlist section listing each watched
  address with its hit counts by trigger; the section is omitted entirely when
  nothing is watched. Watched addresses and their hits live in the derived
  store and are rebuilt by `cia monitor rebuild` like everything else.
- note: monitoring deliberately never polls an address risk score. Risk is a
  final enrichment product you read about an address, not a monitoring input —
  polling it per watched address would spend metered allowance re-reading a
  downstream result instead of watching a threat.

## [0.11.9] - 2026-07-26 — detection: scheduled runs stop re-emitting findings the reviewer has already seen

- fix: three of the four detectors (`attack-pattern`, `fake-token`,
  `mixer`) accepted the scan window and discarded it, so every scheduled run
  re-derived and re-published its ENTIRE result set. Consecutive hourly runs
  produced identical finding sets — around two thousand duplicate findings per
  hour into `cia monitor review list` — while the scan checkpoint kept
  advancing, making an inert scan look incremental. Each detector now declares
  a `windowMode`. `address-poisoning` stays `incremental`: its dust transfers
  carry a date, so its checkpoint is real. The other three are `full-state`:
  they classify from cumulative graph state (degree metrics, taxonomy labels,
  the verified-asset registry) that carries no event timestamp, and bounding
  them by a window would make them wrong rather than cheaper — attribution
  needs the complete labelled seed set, a symbol collision needs both sides of
  the asset registry, and hourglass degree has no "became mixer-shaped since T"
  form. A full-state detector therefore keeps its full scan, no longer advances
  a checkpoint nothing reads, and emits only findings not already emitted for
  that network. A run over unchanged data now produces an empty findings
  document and adds nothing to the review backlog; the count of suppressed
  findings is recorded in the document's warnings rather than hidden. Genuinely
  new findings still surface on the next run, and `--full` re-emits everything
  so a lost backlog can be rebuilt.
## [0.11.8] - 2026-07-26 — monitor robustness: torn alert logs, read-only reads, path base (#212, #214)

- fix: a torn or truncated line in the append-only `alerts.jsonl` / `acks.jsonl`
  monitor logs (what a process killed mid-append leaves behind) broke the two
  readers in opposite directions. `cia monitor alerts list` swallowed the parse
  error and returned NO alerts at all — silent total data loss from the user's
  point of view — while the derived-store ingest threw on the same line, so
  every subsequent `cia monitor run` exited 1 at its final ingest step and
  `cia monitor rebuild` replayed the same bad line without recovering. Only
  hand-editing the JSONL cleared it. Both paths now share one line-tolerant
  reader: an unparseable line is skipped with a warning naming the file and the
  1-based line number, every other record survives, list and ingest agree on
  exactly which records survived, and `rebuild` recovers on its own. Tolerance
  is deliberately scoped to the append-only logs — a malformed detection
  findings document still fails loudly.
- fix: emitting an alert after a torn line appended onto it, because the torn
  line has no trailing newline. One crash therefore corrupted every alert
  emitted afterwards, not just the one being written. The log is re-terminated
  before an append, confining the damage to the single torn line.
- fix: `cia monitor status` and `cia monitor report` opened the derived DuckDB
  store read-write even though neither writes. DuckDB permits many concurrent
  read-only holders of a file but only one read-write holder, so two ordinary
  read commands conflicted with each other for no reason. Read paths now open
  read-only, falling back to a normal open when the database does not exist yet
  (read-only cannot create one). A lock conflict with a genuine concurrent
  `monitor run` ingest is retried briefly and then reported as an actionable
  message instead of a raw DuckDB IO error.
- fix: `cia monitor review approve` / `reject` resolved a relative document path
  against the current working directory, so the same relative path meant
  different documents depending on which subdirectory of the workspace you ran
  it from — it either failed outright or recorded a decision against the wrong
  base. Relative document paths now resolve against the discovered workspace
  root, matching the paths `cia monitor review list` prints.
- fix: monitor config loading treated ANY read failure as "no config file" and
  silently fell back to the built-in detector matrix. A permission or IO error
  therefore changed what was being monitored with no indication. Only a genuine
  missing file falls back now; anything else fails with a readable error.
- fix: the derived-store helper leaked its DuckDB instance handle — and with it
  the database file lock — if opening a connection failed after the instance was
  created.
- fix: CSV label export did not quote a field containing a bare carriage return,
  which terminates a record early for strict RFC-4180 readers.
- fix: in the monitor smoke script a failed hard assertion exited non-zero
  *without* printing its `MONITOR-SMOKE FAIL` row or the summary line, hiding
  the very failure it was there to report. Assertions now capture their exit
  status without aborting the run, and the script covers the torn-alert-log
  recovery path.

## [0.11.7] - 2026-07-26 — devkit graph_query parity: time_scope and the Asset label (#210)

- fix: the devkit graph backend rejected the `graph_query` / `graph_query_batch`
  `time_scope` argument as an unexpected property, because its tool schema never
  declared the field. The serving contract has accepted `time_scope` since
  0.10.15 and the mixer detector sends `time_scope=recent` by default, so
  `cia detect mixer` / `cia monitor mixer` cells failed against the devkit while
  passing against the hosted backend. Both devkit tools now declare `time_scope`
  and validate it with the serving contract's grammar
  (`lifetime | recent | since_ms:<n>`, malformed values rejected with the same
  message). The devkit serves a single topology graph, so every accepted
  directive resolves to the same covering shard.
- fix: the devkit graph mapping did not include the `Asset` node label, so the
  fake-token detector's asset-registry lookups failed to compile against the
  devkit. `Asset` is mapped to the assets facade view with the serving
  contract's property set, and the facade table is now created even when the
  local fixture does not ship an asset export — `:Asset` queries return an empty
  result instead of an unmapped-label error. Populating the asset fixture is a
  follow-up.
- fix: the MCP proxy's `graph_query` / `graph_query_batch` argument allow-list
  omitted `time_scope`, silently stripping it from pass-through calls so every
  caller received a lifetime-scoped result. Both tools now allow it.

## [0.11.6] - 2026-07-26 — fix trace query size cap crash on well-connected seeds (#209)

- fix: `aml_trace_suspect_funds`/`aml_trace_victim_funds` hard-failed with
  `query too large: maximum 32768 bytes per query` at moderate `max_hops` on
  well-connected seeds, forcing per-seed depth guessing. Root cause:
  `directEdgePropsQuery` and `reverseLeadsQuery` in `trace-funds.ts` each
  built ONE Cypher query with an `OR`-predicate per discovered flow edge /
  deposit address — a count driven by graph connectivity, not by
  `max_hops`. On a well-connected seed the edge-hydration query alone
  measured 55KB (confirmed live) while the depth-bounded path builders
  (`forwardExchangeQueries`/`backwardSourceQueries`, unchanged) stayed a
  few KB regardless of depth.
- fix: `directEdgePropsQuery`/`reverseLeadsQuery` replaced with
  `directEdgePropsQueries`/`reverseLeadsQueries`, which chunk the
  OR-predicate list into multiple queries that each measure under the
  32768-byte cap (with a safety margin for the `USE topology` prefix and
  transport overhead), sent in the same `graph_query_batch` call and merged
  client-side. A chunk that still fails to execute (e.g. a shard timeout)
  is surfaced as a `warnings[]` entry naming the failed query id — no
  silent partial result.
- test: `tests/trace-query-size-cap.test.ts` pins that every generated
  query for a 400-600 item edge/deposit set stays under the byte cap, and
  that small sets keep the legacy single-query id for compatibility.
  `scripts/generate-query-corpus.mjs` and the committed corpus fixture
  updated for the renamed builders (query text unchanged for the existing
  small corpus grid).
- verified live on the dev federation: seed
  `5D9yaXf5nqrzKHqgoWMYeKqEERthvftdJB7XkrwNgQzNGrYb`, which previously
  failed at `max_hops=4`, now succeeds at `max_hops=4` (410 edges) and
  `max_hops=5` (694 edges); `max_hops=3` is unchanged (9 edges, 2 exchange
  endpoints, 3 deposit candidates).

## [0.11.5] - 2026-07-26 — wire client-side shard merge into the graph read path (#217)

- feat: `mergeShardRows` (federation/merge.ts, shipped in #213/#218/#219 but
  never called) is now wired into every graph-read seam that can see
  `__shard`-tagged rows: `graph_query_batch` parsing in
  `scam-corridor-trace.ts`, `exchange-likeness.ts`, `trace-funds.ts`, and
  `public-tools.ts`, plus the single-query `graph_query` path in
  `detection/graph-client.ts` used by all detectors. A federated
  (thin-fan-out) response is now merged and stripped of `__shard` before it
  reaches any caller; a non-federated (single-shard) response passes through
  byte-identical — the merge is a true no-op when the server is not in
  fan-out mode.
- feat: added `src/federation/apply-merge.ts`, deriving `MergeOptions` from
  the query text already in hand rather than guessing: `aggregateKeys` from
  RETURN-clause `count`/`sum`/`avg`/`min`/`max` aliases, `orderBy`/`limit`
  from ORDER BY/LIMIT, and `orderKeyClass` (`invariant` vs `merge-affected`)
  from whether the sort key is a shard-invariant node property (`address`,
  `network`, `labels`, `is_exchange`, `risk_score`, `risk_level`,
  `identity_id`, `label_risk`). No filtering is added anywhere on this path.
- feat: batch `graph_query_batch` entries now carry `perShard`/`ordering`
  alongside `results` when a merge happened, so a caller reading the raw
  batch entry keeps the per-shard aggregate breakdown and the
  exact/approximate ordering marker instead of losing them silently. The
  single-query `graph_query` seam (`detection/graph-client.ts`) returns a
  bare row array with no envelope slot for this metadata — that limitation
  is documented in code rather than worked around.

## [0.11.4] - 2026-07-26 — aml_trace_deposit_sources: general upstream sources (#208)

- fix: `aml_trace_deposit_sources` no longer restricts the reverse traceback
  to exchange-funded upstream senders. The `source.is_exchange IS NULL`
  predicate silently dropped every non-exchange-funded path, so a deposit
  funded exclusively by non-exchange addresses reported `path_count: 0`
  even when the topology showed dozens of real inbound funders.
- fix: exchange-funded upstream sources are no longer discarded either. They
  are returned and classified as a distinguished subset (`role: 'exchange'`,
  `summary.exchange_count`, `exchange_exposure`) instead of being excluded
  from the result and instead of being misclassified as
  `candidate_suspect`/`candidate_intermediate` -- exchange hot wallets stay
  terminal per the existing exchange-terminal rule.
- fix: the `"No upstream sources were connected in the queried topology."`
  warning is no longer emitted when the reverse traceback queries
  themselves failed (a federation/partial-failure condition). A query
  failure is now reported as a distinct warning naming the failed query
  IDs and errors, so the tool never claims a clean negative finding when it
  actually means "the query could not be answered."
- Additive-only trace output: `paths[].source_is_exchange` is a new field;
  `exchange_exposure` is now populated (previously always `[]`);
  `chain-insights.trace.v1` shape is otherwise unchanged.
- tests: `tests/trace-deposit-sources-filters.test.ts` pins the query-builder
  and warning-text fixes; `tests/mcp-proxy.test.ts` updated to assert the
  fixed classification instead of the previous exchange-required query text.

## [0.11.3] - 2026-07-26 — federation merge exactness fixes

- federation: `combineEdge` now correctly merges every FLOWS_TO property the
  oracle differential harness checks, not just the four it special-cased
  before. `last_tx_id`/`first_tx_id` follow the constituent shard whose
  `last_seen_timestamp`/`first_seen_timestamp` won, instead of whichever
  shard happened to merge first. `avg_tx_size_usd` is recomputed from the
  merged `amount_usd_sum`/`tx_count` totals (guarded against divide-by-zero)
  instead of carrying one shard's partial average. `dominant_asset` is
  chosen from the constituent with the single largest individual
  `amount_usd_sum` via an N-way fold over all contributing shards at once —
  not a pairwise fold of a running accumulator, which cannot correctly pick
  a winner once more than two shards contribute. `price_coverage_ratio` is a
  tx-count-weighted mean across shards. `bucket_start_ms`/`bucket_end_ms`
  merge to the outer span `[MIN start, MAX end]` of contributing shard
  windows. Endpoint identity and lookalike flags are confirmed shard-invariant
  and pass through unchanged.
- federation: `MergedResult.perShard[shard]` is now an array of per-group
  entries instead of a single object keyed by aggregate name. A GROUPED
  aggregate (e.g. `RETURN counterparty, sum(...) AS usd`) previously
  collided when the same shard returned more than one group, silently
  losing every group but the last; the array representation can only grow,
  never overwrite.
- Found by the oracle differential harness (an internal differential audit)
  comparing client-merged federated results against a monolithic
  genesis-to-tip oracle graph.

## [0.11.2] - 2026-07-26 — shard-merge filter for oracle verification

- federation: `mergeShardRows` is now exported from the package entry point.
- federation: `scripts/merge-shards.mjs` reads shard-tagged rows on stdin and
  writes the merged result on stdout, so the oracle differential harness can
  verify the exact merge implementation that ships rather than a second copy.
  Not a public CLI surface — no bin entry, no command registration.
- Internal only: no change to any command, tool, or output.

## [0.11.1] - 2026-07-26 — client-side shard merge (internal)

- federation: `mergeShardRows` merges the per-shard results the Chain Insights
  Graph now returns when it fans a query out across shards — deduplicates
  nodes, sum-merges the same address pair into one lifetime flow, and re-sorts
  and re-cuts the limit globally rather than per shard.
- federation: aggregates that cannot be merged exactly (counts, averages) are
  reported per shard instead of as a single total, so a caller cannot mistake
  a partial for a lifetime figure.
- federation: results say whether their ordering is exact or approximate.
  Ordering by an address is exact after merging; ordering by a summed amount
  is not, because a flow ranked low in every shard can rank highest once
  merged.
- Internal only: nothing routes through this module yet, so there is no change
  to any command, tool, or output in this release.

## [0.11.0] - 2026-07-26 — cia monitor

- monitor: `cia monitor` command group for continuous coverage — `run`,
  `watch`, `status`, `case add/list/close`, `review list/approve/reject`,
  `report`, `export labels`, `alerts list/ack`, `rebuild`.
- monitor: DuckDB-backed derived store indexing runs, findings, cases,
  snapshots, movements, reviews, and alerts, with `cia monitor rebuild`
  reconstructing it from canonical workspace JSON at any time.
- monitor: incident-centric case tracking (`stolen-funds`, `scam-topology`)
  with run-over-run snapshot diffs, derived movements, cashout-endpoint
  alerts, and review-gated frontier expansion.
- monitor: review workflow stamping a reviewer identity onto an immutable
  copy under `detections/reviewed/`, feeding `cia monitor export labels`
  from approved decisions only.
- monitor: alert stream with webhook and exec sinks, best-effort delivery
  that never fails a run.
- deps: new dependency `@duckdb/node-api` for the monitor derived store.
- docs: new `docs/monitoring.md` continuous monitoring guide, linked from
  the README.

## [0.10.20] - 2026-07-25

- devkit: restore admission parity with the product server. The bundled
  `chain-insights-graph-devkit` had drifted from `graphrag-mcp` and accepted
  seven query shapes the product now refuses, so a developer could build and
  ship against the devkit and have the same query rejected in production
  (internal epic).
  Ported: (1) the topology read-statement opener allowlist, wired into BOTH
  the single-query and batch dispatch paths — the batch path had no opener
  check at all; (2) bracket-balanced edge-body scanning plus literal/comment
  stripping, so `{asset:"0..2"}`, `/*1..3*/` and `*1..1_000_000` can no longer
  forge a hop bound past the depth cap; (3) literal and comment blanking in the
  indexed-predicate check, with a carve-out for backtick-quoted bare
  identifiers; (4) the tier dot/colon-context guard; (5) the range-pattern
  backtick wrapper and `!=` arm; (6) endpoint-label binding in the SQL emitter.
  Adds parity suites (`internal/cypheradmit/parity_test.go`,
  `internal/devkitmcp/bounds_parity_test.go`) that assert the forged-bound and
  opener cases directly, verified red before green.

## [0.10.19] - 2026-07-25

- uat: the graph UAT could not pass and had not been able to since 2026-07-22.
  Two of its queries used shapes the platform had retired, so the steps failed
  before any assertion ran, and nothing surfaced it because the script is
  manual-only (not in any CI workflow).
  (1) The "facts address query" used a single-node `(a:Address)` match; the
  facts tier became TRANSFERS-ONLY in an upstream pipeline change (internal epic), so
  the compiler refuses it — "label Address is served only as a relationship
  endpoint". Address-grain `labels`/`is_exchange` live on the topology tier,
  where they are shard-invariant node properties, so the query moves there.
  (2) The topology query was an UNSCOPED `count(f)` over every `FLOWS_TO` edge —
  a cross-shard aggregate re-derivation that exceeds the planner cardinality cap
  (measured on dev: 1,460,339 edge rows against a 250,000 cap). Scoping it to
  the fixture address is also what the assertion actually wants. Verified live:
  flows=36, routing=bittensor.
  Confirmed pre-existing, NOT caused by the internal epic hardening epic, by A/B
  against two live servers with the same data: the pre-epic image refuses the
  topology query identically.
  SKILL.md's claim that "USE facts returns address facts" is corrected to state
  the transfers-only contract.

## [0.10.18] - 2026-07-23

- attack-pattern: fix a silent false-negative and a timeout, found by
  exercising the label economy end-to-end (internal epic). (1) The seed query
  matched `a.address_subtype IN [...]`, but the graphsync overlay never projects
  `address_subtype` onto Address nodes — it stamps the scam family as taxonomy
  NODE LABELS (`:Scam`, `:Poisoned`). Seeds are now matched by node label
  (default `:Scam`, operator-overridable via `--param seed_labels=Scam,Poisoned`;
  labels are charset-validated before interpolation). (2) The walk did one or two
  graph queries PER node and timed out on a wide graph; it now expands the whole
  BFS frontier per hop in one chunked `WHERE a.address IN [...]` query that also
  returns each downstream node's boundary flag. Live on bittensor: 0 → 1,572
  attributed findings from 43 `:Scam` seeds in ~47s (was a timeout).

## [0.10.17] - 2026-07-23

- All detectors are now parametrized like mixer: per-network default tables +
  operator `--param key=value` overrides, with the effective config echoed in
  `threshold_provenance`. address-poisoning: `dust_floor`, `scan_window_days`,
  `max_rows`. attack-pattern: `max_hops`, `max_frontier`, `max_rows`,
  `seed_subtypes` (csv), `boundary_keywords` (csv). fake-token: `max_pages`,
  `page_size`. Shared param coercion helpers live in `src/detection/params.ts`
  (numbers fall back to the default on malformed input; csv lists are trimmed
  and lowercased); mixer now uses them too.

## [0.10.16] - 2026-07-23

- mixer is now a flexible, parametrized tool. It ships per-network default
  hourglass thresholds (bittensor 50/50, bittensor_evm 20/20, generic 5/5 —
  tuned to each chain's degree density) and the operator overrides any knob via
  a repeatable `cia detect mixer --param key=value`: `min_in`, `min_out`,
  `max_candidates`, `time_scope`, `role_keywords`. Unset knobs fall back to the
  network default, then the generic default; the effective config is echoed in
  the findings document's `threshold_provenance`. The detection runtime gains a
  generic operator param bag (`DetectorParams`) threaded through `scan` and
  `thresholds`, so any detector can expose its own tunables. `classifyMixer`,
  `mixerScanBatch`, and `mixerScanCandidates` take an explicit `MixerConfig`.

## [0.10.15] - 2026-07-23

- mixer detector unblocked via `time_scope`. Its `degree_in`/`degree_out`
  candidate query is a node-metric projection that could not merge across the
  federated topology's temporal shards, so the batch scan errored. It now issues
  the query with `time_scope: "recent"` (live shard only), making the projection
  exact within that window — a deliberate live-window-vs-lifetime tradeoff for
  mixer candidacy (DEC-11/DEC-19). `graphQueryRows` gains an optional
  `timeScope` argument. Interim hourglass thresholds raised to 50/50 with a
  deterministic degree ordering so the qualifying set fits under the candidate
  cap (no silent truncation) on dense chains; hourglass-degree alone remains a
  weak signal pending balance-ratio/pass-through features. Verified live on
  bittensor: mixer runs federated-exact (was a hard federation error).

## [0.10.14] - 2026-07-23

- address-poisoning: network-aware lookalike matching + vanity-cluster evidence.
  The lookalike core now branches on address family — EVM (hex) still requires a
  shared prefix AND suffix, but Substrate ss58 addresses match on a long shared
  PREFIX only, because their trailing checksum can't be cheaply ground. This
  fixes a false-negative that hid a live campaign: the detector now surfaces a
  bittensor dusting operation of ~116 vanity addresses sharing the
  `5EYCAe5jLQhn6o…` prefix, impersonating a ~2M-TAO hot wallet across scores of
  victims. Findings gain `vanity_cluster_prefix` / `vanity_cluster_size`
  evidence (the campaign fingerprint), and the scan's underlying facts query is
  corrected to bind `from`/`to` as endpoint nodes (`(from:Address)-[t:TRANSFER]->
  (to:Address)`) rather than reading non-existent edge scalars. Findings remain
  reviewer-unset; the curated-import gate is unchanged.

## [0.10.13] - 2026-07-23

- Detection-to-CIA (internal epic), remaining detectors: `address-poisoning`,
  `attack-pattern`, and the mixer batch candidate-source now run through the
  same `cia detect <detector>` runtime as fake-token, completing the four-
  detector relocation from the upstream pipeline backend recipes.
  `address-poisoning` scans a bounded recent facts window for dust transfers and
  flags dusters that are vanity lookalikes (shared prefix/suffix) of a victim's
  real prior counterparties. `attack-pattern` walks downstream FLOWS_TO from
  seed-labeled bad actors (poisoning_duster / dusting_source /
  fake_token_contract) up to a bounded hop depth, stopping at infrastructure
  boundaries (exchange/bridge/mixer/contract/validator). `mixer` gains a
  degree-qualified candidate source so its batch `scan()` enumerates hourglass
  candidates instead of returning empty. All emit reviewer-unset
  `chain-insights.detection-findings.v1` documents — the curated-import gate is
  unchanged. Ported thresholds are recorded as tunables (DEC-7); full-history
  poisoning sweeps beyond the bounded window are marked truncated pending the
  time_scope follow-up (DEC-11). Backend recipes remain untouched (operator-
  gated retirement, DEC-9).

## [0.10.12] - 2026-07-23

- Detection-to-CIA (internal epic), first slice: a client-side detection runtime and
  the fake-token detector, relocated from the upstream pipeline backend recipe.
  `cia detect fake-token --network <net> [--full|--since-checkpoint] [--watch]`
  scans the verified-token registry (facts_assets_view) for symbol-spoof
  contracts and emits a `chain-insights.detection-findings.v1` document with the
  reviewer deliberately unset — the curated-import gate stays the only path to a
  label. Incremental checkpoints (`.chain-insights/detectors/`) advance only
  after a findings file is durably written. The mixer hourglass classifier core
  ships (candidate-driven, mirrors exchange-likeness); its interactive tool and
  batch candidate-source wiring land next. Findings schema gains the four
  relocated detectors' tool names + classifications; the rbmk import gate maps
  them to curated labels. Backend recipes are untouched (operator-gated
  retirement).

## [0.10.11] - 2026-07-22

- Facts tier is transfers-only end-to-end: remove the two documented
  single-node `USE facts MATCH (a:Address)` recipes (`recipe_facts_03`,
  `recipe_facts_17`) — the serving layer now treats `Address` as an
  endpoint-only facts label (valid on TRANSFER endpoints; bare single-node
  facts MATCH refuses with a typed unsupported-shape error) after an internal hardening epic
  migration 0034 dropped `facts_addresses_view`. Query corpus regenerated
  (91 entries).

## [0.10.10] - 2026-07-22

- Retire the last facts `AddressFeature`/`HAS_FEATURE` references: the two
  documented recipes (`recipe_facts_01`, `recipe_facts_16`) are removed from
  `tests/fixtures/documented-recipes.json` (query corpus regenerated, 92
  entries), and `docs/graph-tools.md` / `docs/graph-query-compatibility.md`
  now point lifetime address metrics at `USE topology` node properties. In
  lockstep with internal migration 0033, which drops `facts_address_features_*`
  and adds `facts_addresses_view` (internal epic).

## [0.10.9] - 2026-07-22

- Federation compatibility for the AML trace tools: `aml_trace_victim_funds`
  and `aml_trace_suspect_funds` were refused end-to-end on the multi-shard
  topology (`cross_shard_scalar_projection`) because their fan-out queries
  projected `r.<prop>` scalars in the final RETURN (edge maps, reverse-lead
  `ORDER BY r.amount_usd_sum`). All trace builders now project EDGE OBJECTS
  and unwrap `properties` client-side (`edgeProperties`); `direct_edge_props`
  gains exact lifetime edge totals from the federated sum-merge; reverse
  leads order client-side. Golden trace snapshots updated under
  SPEC-2026-07-22-FED-PLANNER.
- `aml_address_risk` lifetime features (`address_feature`) read from
  federated `USE topology` node-metric projections (13 metrics incl. the
  activity window, oracle-verified exact via the upstream pipeline planner) instead
  of `facts_address_features_view` via `HAS_FEATURE` — the view's last
  reader is gone (internal epic). Prompt strings and the public cypher
  skills drop the facts `AddressFeature` surface accordingly.

## [0.10.8] - 2026-07-22

- `aml_exchange_likeness` reads the lifetime profile (degree_in,
  total_in_usd) from federated `USE topology` node-metric projections instead
  of `facts_address_features_view` via `HAS_FEATURE`. The federation
  typed-AST planner (internal epic) re-derives multi-shard node metrics exactly
  (additive props summed across disjoint shard windows, degrees as distinct
  counterparty set unions), oracle-verified — removing the tool's last facts
  feature-view dependency (internal epic) and fixing the 2026-07-09 ~10x
  window-vs-lifetime divergence at the $50M threshold.
- Security: dedupe `@hono/node-server` to the patched 2.0.11 line via an npm
  override (the MCP SDK's nested 1.19.x copy tripped GHSA-frvp-7c67-39w9);
  `npm audit` clean at all levels. `npm audit fix` refreshed `body-parser`
  and `fast-uri` advisories.

## [0.10.7] - 2026-07-21

- Adopt the open npm dependabot PRs in one batch (#193, #192, #182, #173):
  `hono` 4.12.27→4.12.31, `@hono/node-server` 2.0.8→2.0.11 (via `npm update`,
  supersedes the PR's 2.0.10 target), `@x402/evm` 2.17.0→2.19.0, `@x402/fetch`
  2.17.0→2.19.0, `viem` 2.53.x→2.55.4, `@types/node` 26.0.1→26.1.1, `tsdown`
  0.22.3→0.22.12, `tsx` 4.21.x→4.23.1, `vitest` 4.1.9→4.1.10, and `typescript`
  6.0.3→7.0.2 (major bump, `package.json` range updated; the other bumps
  already satisfied their existing `^` ranges so only `package-lock.json`
  moved). Full suite (typecheck, build, test, release:check) green after the
  bump.

## [0.10.6] - 2026-07-21

- Ship the capped `facts_transfers_view` devkit fixture (internal epic): a full 23-day slice is ~1.38M rows / 256MB
  raw, too heavy for a devkit fixture, so the rbmk exporter
  (`scripts/devops/chain-insights-devkit/export_queries.py`) now emits a
  capped, address-scoped `TRANSFER` export instead — rows touching the
  devkit's own `facts_address_features_view` address universe (either
  `from_address` or `to_address`), within the fixture window, ordered
  `block_timestamp DESC, tx_id, event_index, edge_index`, `LIMIT 50000`.
  Result: 50,000 rows / 1.63MB gz, well under the git-blob part-split
  threshold, so it ships as a single `devkit/data/starrocks/facts_transfers_view.tsv.gz`
  (no `.part-NNN.gz` split needed at this size — the existing parts
  machinery in `render-manifest.py` would kick in automatically past
  40MB). `devkit/data/manifest.json` gains the new object entry.
  `devkit/scripts/validate-manifest.py` moves `facts_transfers_view` from
  `ALLOWED_UNEXPORTED_TABLES` to `REQUIRED_TABLES`, and
  `devkit/scripts/smoke-memgql-objects.py` drops it from its own
  `ALLOWED_UNEXPORTED_TABLES` mirror (added in 0.10.5) — the `TRANSFER`
  edge coverage probe now runs for real instead of being skipped.

## [0.10.5] - 2026-07-21

- Fix Devkit Smoke CI failure on `c292b6e` ("MemGQL object coverage
  failed: 1 failure(s)"): `devkit/scripts/smoke-memgql-objects.py`
  asserts every mapped node/edge is queryable through the live devkit
  MCP endpoint, but `TRANSFER`→`facts_transfers_view` is mapped while
  its fixture is legitimately unexported (the capped TSV export is a
  separate, not-yet-shipped operator-side step) — the coverage probe was
  failing on a gap `validate-manifest.py` already tolerates via
  `ALLOWED_UNEXPORTED_TABLES`. `smoke-memgql-objects.py` gains its own
  `ALLOWED_UNEXPORTED_TABLES` (a duplicated 1-entry set with a
  KEPT-IN-SYNC comment pointing at `validate-manifest.py` — kept simple
  rather than a cross-script import, since these are standalone
  operator scripts with no existing shared-module pattern): checks
  against exempted tables are skipped with an explicit `"skipped
  (fixture not yet exported): <table>"` stderr line and excluded from
  the failure count, while coverage still fails for any mapped table
  that is absent/unreachable and NOT in the exemption set (the
  underlying `graph_query` call still executes and still raises for
  every non-exempted table, unchanged from before — verified locally
  with a monkeypatched `graph_query` since no pytest harness exists for
  devkit Python scripts). No other script in the smoke chain
  (`starrocks-ddl.py` also iterates the mapping, but only emits DDL
  driven off manifest presence, never asserts live queryability) needed
  the same fix.

## [0.10.4] - 2026-07-21

- Retire the facts-scope `NeuronEndpoint`/`Hotkey`/`IPAddress` mappings and
  their dead fixtures (internal epic): `facts_neuron_endpoints_view`,
  `facts_neuron_hotkeys_view`, and `facts_neuron_ip_addresses_view` dropped
  from the warehouse (internal migration 0031) and stopped being exported by the
  internal fixture exporter tonight. Mirrors the upstream pipeline's mapping removal
  (`75ce9c96`/`67744b2f`): the devkit's vendored `mapping.json` drops the
  three node entries and the `HAS_NEURON_ENDPOINT`/`REGISTERED_NEURON`/
  `SERVED_FROM`/`OPERATED_FROM` edges (now byte-identical to
  the upstream pipeline's mapping.json), `compile_test.go` gains
  `TestNeuronShapesRejectedAsUnmapped` (all seven retired shapes reject as
  unmapped at compile time), and `testdata/facts-goldens.json` drops the
  seven neuron goldens (`recipe_facts_06..12`). `devkit/data/manifest.json`
  drops the three neuron fixture objects and their `tsv.gz` files are
  removed; `REQUIRED_TABLES` in `validate-manifest.py` shrinks to
  `{facts_address_features_view}` with a retirement comment — validated
  green: "validated 3 devkit fixture objects". No devkit import/smoke
  script hardcoded the three table names (manifest-driven), so none needed
  changes.
  `tests/fixtures/documented-recipes.json` drops `recipe_facts_06..12` (the
  corpus generator source, not just the fixture) and the regenerated
  `graph-query-corpus.json` shrinks 100 -> 93 entries. Reconciliation:
  the regenerated corpus's `documented-recipe` id set is now **exactly
  identical** to the upstream pipeline's `internal/graphmcp/testdata/
  chain_insights_query_corpus.json` mirror (both 93 entries, same ids) —
  the P5 Task 3 neuron/TRANSFER divergence is fully closed. The only
  remaining diff between the two files is pre-existing and unrelated to
  tonight's work: chain-insights's `addressProfileQuery` builder entries
  (params `{address: "corpus-address-a"}` and the quote-escaping variant,
  topology scope) project an extra `a.label_risk AS label_risk` field that
  the upstream pipeline's mirror lacks — a future dp-side sync should copy those 2
  entries verbatim to reach full byte-identity.
  `src/mcp/proxy.ts`, `src/workspace/init.ts`'s sibling skill
  (`chain-insights-bittensor-cypher/SKILL.md`), and
  `docs/graph-query-compatibility.md` drop the `NeuronEndpoint`/`Hotkey`/
  `IPAddress` facts mentions and `REGISTERED_NEURON`/`SERVED_FROM`/
  `HAS_NEURON_ENDPOINT`/`OPERATED_FROM` edge references, restating that
  neuron identity/hotkey-coldkey pairing/IP-axon-port observation live
  entirely on the topology `:Neuron` node and
  `MINES`/`VALIDATES`/`HOTKEY_OF`/`COLDKEY_OF` edges.
  `tests/skills-contract.test.ts` and `tests/mcp-proxy.test.ts` flip their
  `REGISTERED_NEURON`/`SERVED_FROM`/`NeuronEndpoint` assertions to
  `not.toContain` and add `toContain` coverage for the topology neuron
  edges, per the `c7c888c`/`1a57b80` retirement-assertion pattern.

## [0.10.3] - 2026-07-21

- Map the facts-scope `TRANSFER` edge onto `facts_transfers_view`
  (internal epic), mirroring the upstream pipeline's `cyphersql` mapping
  addition (`6f679c32`/`a5487cec`): the devkit's vendored
  `mapping.json`/`ast.go`/`parser.go`/`emit.go`/`errors.go` gain
  `(from:Address)-[t:TRANSFER]->(to:Address)`, `sum(variable.property)` as a
  supported facts aggregate (`COALESCE(SUM(...), 0)` for StarRocks
  empty-group NULL semantics), and a TRANSFER-specific indexed-predicate
  admission rule in `internal/cypheradmit/cypher.go` (address equality on
  either endpoint, or `tx_id` equality — required even with `LIMIT`, since
  `facts_transfers_view` is a full transfer-history table, not a small
  per-address dimension view); `compile_test.go` and
  `testdata/facts-goldens.json` gain the TRANSFER golden coverage.
  `tests/fixtures/documented-recipes.json` gains
  `recipe_facts_transfer_01..05` (3 admitted row-select/aggregate shapes, 2
  documented-rejected unbounded shapes), and the regenerated
  `graph-query-corpus.json` gains the 3 admitted entries (97 -> 100).
  `devkit/scripts/validate-manifest.py` tolerates `facts_transfers_view`'s
  absence from the manifest until the devkit fixture export leg ships
  (operator-side StarRocks export, separate from this change).
  `src/mcp/proxy.ts`, `src/workspace/init.ts`, the shipped
  `chain-insights-cypher`/`chain-insights-bittensor-cypher` skills, and
  `docs/graph-query-compatibility.md` document the TRANSFER edge shape,
  its properties (`amount`, `amount_usd`, `asset_symbol`, `asset_contract`,
  `tx_id`, `block_height`, `block_timestamp`, `event_index`, `edge_index`,
  `price_usd`, `price_missing`), and the mandatory indexed-predicate rule;
  the facts clause now reads "bounded individual transfer rows (TRANSFER
  edges) and, until P3, address features."

## [0.10.2] - 2026-07-21

- Remove the facts-tier `AddressLabel`/`HAS_LABEL` label surface everywhere
  it was still mapped or documented (internal epic), mirroring the
  the upstream pipeline `cyphersql` mapping removal (`b1c3048c`): the devkit's
  vendored `mapping.json`/`compile_test.go`/`facts-goldens.json` drop the
  `AddressLabel` node and `HAS_LABEL` edge and gain
  `TestLabelEdgeRejectedAsUnmapped`; the devkit fixture manifest drops the
  `facts_address_labels_view` object and its `tsv.gz`, and
  `REQUIRED_TABLES` in `validate-manifest.py` no longer requires it.
  `tests/fixtures/documented-recipes.json` and the regenerated
  `graph-query-corpus.json` drop the three label-driven recipes.
  `src/mcp/proxy.ts`, `src/workspace/init.ts`, and the shipped
  `chain-insights-cypher`/`chain-insights-bittensor-cypher` skills and
  `docs/graph-query-compatibility.md` move the label mention to the
  topology clause: labels and per-label risk live on the address node
  (`labels` array + `label_risk` entries), and the facts clause now covers
  only address features and neuron endpoints.

## [0.10.1] - 2026-07-21

- Label risk read moves from the facts tier to the topology graph
  (`facts_address_labels_view` retirement, P2b′): `addressProfileQuery` now
  projects `a.label_risk` (per-label `{label, risk_level,
  updated_timestamp}` maps materialized on the `:Address` node by
  graphsync); the retired `addressLabelRiskQuery` (`USE facts`
  `[:HAS_LABEL]->(:AddressLabel)`) is removed. `aml_address_risk` derives
  the same deterministic `ORDER BY updated_timestamp DESC LIMIT 10` subset
  from the profile row instead of a separate query — verdict escalation,
  `ml_label_divergence`, and the label driver line are unchanged. The
  `label_risk` entry in `riskScoreSources` now reports
  `{layer: 'topology', source: 'address_node'}` in place of the retired
  `facts_address_labels_view` provenance; `trust_level`/`confidence_score`/
  `source` no longer appear in that output.

## [0.10.0] - 2026-07-16

- BREAKING (public MCP surface): migrated to the unified two-scope graph
  model — `USE topology` (Memgraph-native, unified recent + historical
  lifetime graph) and `USE facts` (StarRocks facts allowlist). The
  `topology_scope` tool argument is removed from `aml_address_risk`,
  `aml_trace_victim_funds`, `aml_trace_suspect_funds`, and
  `aml_trace_deposit_sources`, along with the `--topology-scope` CLI flag;
  all emitted query text now uses `USE topology` instead of
  `USE live_topology`/`USE archive_topology`. Because topology is now
  unconditionally Memgraph-backed, `risk_score`/`risk_level` are always
  projected on path nodes, native `*BFS` route evidence always runs when a
  compare address is given, and the archive-retry hint
  (`retry with topology_scope=archive_topology`) is retired.
- Embedded devkit mirrors the new dispatch: `USE facts` routes to the
  StarRocks translator tier; everything else (including `USE topology`)
  runs natively on Memgraph. The vendored `cyphersql` translator is now
  facts-only (topology never compiles to SQL); the archive topology
  mapping (`Address`/`TopologySnapshot`/`FLOWS_TO` views), its cost bound,
  archive fixture TSVs, archive capability probes, and archive goldens are
  removed. The native capability probe surface is renamed to the
  `USE topology` capability matrix.
- Deleted 11 archive-only documented recipes (period-granular rollup
  shapes with `period_granularity`/`period_start_date`/`period_end_date`
  — retired StarRocks rollup schema with no equivalent in the lifetime
  FLOWS_TO contract) and the orphaned archive result goldens; renamed the
  17 live-topology recipes to `topology`; facts recipes unchanged.
- Added a repo-wide CI gate (`tests/no-legacy-topology-scope-text.test.ts`)
  asserting zero occurrences of `topology_scope`/`live_topology`/
  `archive_topology` outside changelog history.

## [0.9.4] - 2026-07-10

- Fixed `aml-scam-corridor-trace` reading the wrong label field: the gates
  now read the `labels(t)` node-label taxonomy (PascalCase
  `:Scam`/`:Exchange`/`:Validator`/`:Miner`/`:Subnet`/`:Mixer`/`:Bridge`/`:Victim`)
  that graphsync reconciles onto each `:Address`, matching the server-side
  original `gates.go`. The first port matched those constants against the
  free-text `t.labels` property array (entity names + lowercase tags such as
  `exchange`, `scam corridor hub`), where they never appear — so every label
  gate silently missed against real graph data and real exchanges/hubs were
  traced through as `propagated_scam`. The free-text array is still surfaced
  as `entity_labels` evidence. Added a regression test pinning the
  `labels(t)` gate source, and a live UAT harness
  (`scripts/devops/chain-insights-devkit/capture-scam-corridor-uat.sh` in
  the control-plane repo) asserting exchange/hub gate diversity end-to-end.

## [0.9.3] - 2026-07-09

- Added two read-only detection tools for AML investigators:
  `aml-scam-corridor-trace` (per-seed scam-corridor propagation with
  exchange/hub/boundary/mixer/shared-deposit gating and a bounded,
  three-valued complete/partial/inconclusive result) and
  `aml-exchange-likeness` (classifies an address as exchange-like from
  fan-in, reciprocity, and lifetime inbound value). Both are strictly
  read-only, emit reviewable findings artifacts, and stay off the public
  MCP tool surface.

## [0.9.2] - 2026-07-09

- Resynced the graph devkit's `cypheradmit`/`cyphersql` mirror of
  the production pipeline's identity-grain removal: `hasStarRocksIndexedPredicate`
  no longer treats an inline `{identity_id: ...}` filter as a valid
  StarRocks cost-bound anchor (closes a StarRocks cost-gate bypass); the
  FLOWS_TO cost-bound error message and a doc-comment example now read
  `{address: ...}`/`:Address` instead of the retired `identity_id`/`:Identity`
  shape, matching canonical wording exactly.

## [0.9.1] - 2026-07-09

- Regenerated the devkit fixture against a dev stack with real
  `core_address_labels` data for the first time since the address-grain
  revert (the previous fixture snapshot was captured while that table was
  empty fleet-wide, a pre-existing gap unrelated to the revert itself).
  The devkit now carries real exchange/scam/validator labels, including a
  confirmed Kucoin exchange deposit — `aml_trace_victim_funds` and related
  tools now surface real exchange exposure instead of an empty result.
- Fixed a real bug this surfaced in the export tooling:
  `export-memgraph-fixture.py`'s node/relationship export queries had no
  pagination, so a single unbounded `ORDER BY` sort over the full graph
  (~478k nodes / ~1.3M edges) exceeded the dev Memgraph instance's
  query-execution timeout. Now paginated via keyset (id-cursor) batching.
- Re-recorded `trace-{victim,suspect,deposit}-devkit-golden.json` against
  the newly-labeled devkit (real path/exchange counts instead of the
  previous all-zero empty-label state).
- Documented a real interactive-dev trap in `CLAUDE.md`: `bin/cli.js`
  loads the compiled `dist/cli.mjs` bundle, not `src/` directly, and
  `dist/` does not auto-rebuild — a stale bundle silently ran pre-revert
  `:Identity`-based seed resolution against a graph with zero `:Identity`
  nodes, failing every trace as "unresolved" with no indication the
  build (not the data) was the problem.

## [0.9.0] - 2026-07-08

- **Breaking: Bittensor money graph reverted from an identity flatten back to
  address grain.** The `:Identity` money node (a canonical-address-links
  flatten of SS58 + H160 addresses into one merged identity) is retired. The
  graph node is now `:Address {address, network}` with
  `network ∈ {bittensor, bittensor_evm}` — one public Bittensor investigation
  network, with the SS58/EVM-pallet split expressed as a node property
  instead of two separate identity-scoped networks.
- New `LINKED` ownership overlay: an undirected `:Address-[:LINKED]-:Address`
  edge (`basis`, `confidence`, `source_event`, `declared_owner`) replaces the
  retired `HAS_ADDRESS` satellite hop and the identity-collapse join. Same-
  owner SS58/H160 pairs are discoverable via one `-[:LINKED]-` hop instead of
  being pre-merged into a single node — labels stay per-address (no rank-1
  owner-label collapse) and cross-space actor-exposure queries expand
  explicitly through `LINKED` rather than implicitly through the flatten.
- Cross-space and actor-exposure recipes: `crossSpaceLinkedQuery` and
  `linkedExposureQueries` (money-only totals vs. `LINKED`-expanded totals for
  a dual-space owner).
- The archive/facts money layer (StarRocks) stays money-only and
  address-grain throughout — `archive_topology_addresses_view` now carries
  `network`; `linked_addresses_view` replaces
  `archive_identity_address_links_view` as the LINKED source.
- cia CLI, devkit fixtures (StarRocks + Memgraph legs), and the Cypher→SQL
  archive translator (all three tree copies) are rebuilt for the address-
  grain contract; saved investigation corpora are re-keyed off `address`
  instead of `identity_id`.

## [0.8.28] - 2026-07-07

- MemGQL (Memgraph Zero) retired from the graph query surface. `graph_query` /
  `graph_query_batch` now route `USE live_topology` to Memgraph directly (native
  Cypher, bounded traversal) and `USE archive_topology` / `USE facts` to
  StarRocks via a corpus-scoped Cypher→SQL translator. `USE live_topology` gains
  native bounded traversal — `*1..5`, `*BFS`, `*WSHORTEST` (weight lambda),
  `*KSHORTEST`, `*ALLSHORTEST`, and per-hop filter lambdas — with depth ≤ 5,
  KSHORTEST k ≤ 16, and UNWIND ≤ 1000; unbounded/over-depth traversal is rejected.
- `aml_address_risk` route evidence migrated to native Cypher: the directed
  two-endpoint route now uses `*BFS 1..N` instead of the retired GQL
  `ANY SHORTEST … {1,N}` form (native Memgraph rejects the GQL form). Fixes
  route discovery on the post-retirement live surface.
- Devkit graph backend rewired to match: direct Memgraph + StarRocks (no memgql
  container), a faithful mirror of production admission (read-only + StarRocks
  cost-shape gate + traversal bounds), Neo4j driver v6.
- `docs/graph-query-compatibility.md` and the `chain-insights-cypher` skill
  rewritten for the native surface; the GQL parser-gate and MemGQL 0.7.0 hazard
  guidance are now historical.

## [0.8.27] - 2026-07-06

- `aml_address_risk` compare-address route evidence (additive): when a
  `compare_address` is given on the live topology scope, the structured
  `connection` object gains `route_evidence` — directed `ANY SHORTEST`
  route discovery in both directions (outbound/inbound, depth bound 4)
  with hop counts, route identities, USD totals, and **disclosed**
  exchange intermediates (paths through exchanges are reported, never
  silently filtered). Existing `connection.compare_address` and
  `connection.paths` fields are unchanged; archive scope keeps the
  legacy 1-hop probe only.
- MemGQL capability probe suite: `npm run probe:capability` (live lane,
  self-contained containers) and `npm run probe:capability:archive`
  (devkit-gated) pin the federation layer's real capability matrix per
  image version with result-set assertions. Known upstream defects are
  pinned as canaries (memgraph/memgraph#4343 quantifier-inner `WHERE`
  silently ignored, #4344 `SHORTEST k` mis-translation, #4345
  shortest+`WHERE` anchor drop) so an image bump that changes behavior
  fails tests loudly instead of shifting semantics silently.
- Trace query golden pins: snapshot tests freeze the exact emitted query
  text of all five fan-out trace builders at every depth and scope —
  trace tools are deliberately unchanged in this release.
- Graph query corpus contract: `npm run corpus:generate` exports every
  builder-emitted query in production shape
  (`tests/fixtures/graph-query-corpus.json`); the Chain Insights Graph
  backend validator proves admission of the full corpus in its own test
  suite.
- Added `docs/graph-query-compatibility.md`: a construct-by-construct
  GQL/Cypher support matrix for the three Chain Insights Graph layers
  (`live_topology`, `archive_topology`, `facts`), including
  rejected→accepted rewrite recipes (native Cypher `[:R*1..3]`/`*BFS`
  forms vs GQL `{m,n}`/`ANY SHORTEST` forms), spike-verified hazard
  rules, and traversal guidance.
- Extended the `chain-insights-cypher` skill with a
  `references/gql-translation-matrix.md` reference and sharpened its
  layer-choice guidance: the GQL parser rejects Memgraph-native syntax on
  every layer, bounded quantified paths `{m,n}` are the supported
  variable-length form (live, and archive with tight bounds), shortest
  paths are `ANY`/`ALL SHORTEST` on live only, and quantifier-inner
  `WHERE` must never be used.
- Devkit: upgraded the bundled Memgraph Zero/MemGQL federation image from
  0.6.3 to 0.7.0 (cross-backend join fixes and federation improvements).

## [0.8.26] - 2026-07-06

- Graph visualization now recognizes a `hub` entity type (dense
  infrastructure a scam trace routed through, distinct from a confirmed
  `mixer` classification) so hub-typed nodes render correctly instead of
  failing schema validation.

## [0.8.25] - 2026-07-05

- Regenerated the devkit fixture (data only, no source changes here) to
  pick up two upstream export fixes (the internal monorepo root): a
  label-window boundary-precision fix and a fix bounding
  `facts_address_labels_view`'s declared `exported_max` correctly by
  whichever window branch each row actually qualified through, instead of
  a blanket write-audit-column timestamp that could read "now" for
  properly historically-bounded data.

## [0.8.24] - 2026-07-05

- Fixed a false-clean AML result: `aml_address_risk`'s exchange-behavior
  search runs one query per hop depth, and a hop-depth query can fail
  independently (e.g. an archive-tier query-memory limit on a deep
  multi-hop search) while others succeed with zero rows. The response
  previously reported "No exchange inflow/outflow paths found in bounded
  search" identically whether the search genuinely found nothing or
  partially failed -- an analyst reading only the headline could not tell
  a clean result from an incomplete one. The response now says "Exchange
  search incomplete" when any hop-depth query fails, and adds a caveat
  even when some hops did return hits, since deeper ones may still be
  missing; `exchange_behavior.search_status` (`complete`/`incomplete`)
  and `failed_query_ids` are now in the structured response too.
- devkit fixture scripts: removed internal workstream-label references
  from code comments (product-facing wording only, no behavior change).

## [0.8.23] - 2026-07-04

- Fixed `aml_address_risk`'s ML risk-score enrichment query: it selected
  `risk.risk_level`, a column `facts_risk_scores_view` has never had (only
  a numeric `risk_score`), which hard-errored the whole query and silently
  discarded every downstream field including the real ML score. The field
  is now dropped from the query; the existing "unscored" abstention
  handling already treats a missing `ml_risk_level` as not-abstained, so
  ML scores are used normally.
- Regenerated the devkit fixture from a repaired dev warehouse: the six
  bittensor exchange labels (Binance, KuCoin, Gate.io, MEXC, HTX, Bitget)
  were fabricated placeholder addresses with zero on-chain history;
  they're replaced with a real taostats capture (11 real exchange
  wallets with genuine flow history). `is_exchange` now imports as a real
  typed `TINYINT NULL` instead of the varchar `"NULL"` string that made
  `IS NOT NULL` match every row. `smoke.sh` gained a check pinning this.
- `validate-manifest.py`: the fixture window's upper bound is now a live
  coverage watermark, not a fixed calendar date, so the manifest's
  consistency checks validate internal consistency (a valid, later-than-
  `from` timestamp) instead of an exact-match against a stale literal that
  would have rejected every fixture built after 2026-07-03. Added
  structural-consistency and symmetric cross-tier label-parity checks.
- `starrocks-ddl.py`: added a column-type override map so `is_exchange`
  types correctly instead of the blanket `VARCHAR(4096)` every other
  column gets.

## [0.8.22] - 2026-07-04

- `aml_address_risk` label reads are deterministic: the label subset feeding
  the risk level is now ordered by recency before the LIMIT, so the reported
  level no longer varies between runs for label-heavy identities.
- Risk precedence hardening: labels remain the leading signal, but a
  lower-severity label no longer suppresses a more severe usable ML band —
  the response reports the more severe band with an `ml_label_divergence`
  driver. An AML triage verdict never fails toward "looks safe".

## [0.8.21] - 2026-07-04

- Removed the dead legacy `mcpEndpoint` and `mcpAuthToken` config keys. They
  date from the pre-`graphMcpEndpoint` MCP server on `:4000`. `mcpEndpoint` was
  only ever read as an unreachable fallback — the `graphMcpEndpoint` default
  always wins — and `mcpAuthToken` only fed a never-called fetch helper plus a
  redundant `graphMcpAuthToken` fallback. Endpoint selection now reads
  `graphMcpEndpoint` directly, and the debug/test bearer token reads
  `graphMcpAuthToken` only. The installer now seeds the live `graphMcpEndpoint`
  instead of the retired `:4000` endpoint. All AML, debug, test-access, and
  normal (paid) flows are unaffected — they were already wired to the
  `graphMcp*` keys via `cia debug on`, `cia access-key set`, and
  `cia config set graphMcpEndpoint`.

## [0.8.20] - 2026-07-04

- Removed the legacy `--remote` flag from `cia mcp aml-address-risk` and
  `cia mcp aml-trace-victim-funds`. It dates from when the graph backend served
  the AML tools server-side; the tools are now composed client-side (the CLI
  recipe and the local `chain-insights-mcp-proxy`) and the backend serves only
  graph primitives (`graph_query`, `graph_query_batch`, `network_capabilities`,
  `usage_status`), so `--remote` called a tool no backend serves and always
  failed with `unknown tool`. The AML commands run the local recipe as before;
  this supersedes the 0.8.18 `--remote` argument-handling change, which tuned a
  path that no longer exists.

## [0.8.19] - 2026-07-04

- The Chain Insights Graph's ML verdict now includes an explicit abstention
  band: `risk_level = UNSCORED` means the model had too little labeled graph
  context to stand behind a severity. Chain Insights treats it as "no
  stance", never low risk: `aml_address_risk` stops deriving a severity from
  an abstained ML score (falls back to label/exchange-exposure signal, adds
  an `ml_abstained` driver and `ml_verdict: unscored`, and reports `level:
  unscored` when no other signal exists), and trace/report graph payloads
  normalize `risk_level` casing (`HIGH` -> `high`) so the graph app's risk
  borders fire regardless of backend casing while `unscored` renders with the
  neutral border.

## [0.8.18] - 2026-07-04

- `cia serve` and `cia viz` now bind the configured `serverPort` when `--port`
  is omitted, instead of always hardcoding 4321. `cia status` and persisted
  graph-report URLs advertise `config.serverPort`, so after `config set
  serverPort <n>` the advertised URL is now the one the server actually listens
  on. `--port` still overrides, and a non-numeric or out-of-range `--port` is
  now rejected with a clear message instead of letting `NaN` reach `listen()`.
- `cia mcp aml-trace-victim-funds --remote` now forwards `--incident-timestamp-ms`
  and `--max-hops` (both accepted by the remote tool contract) instead of
  silently dropping them, and rejects `--per-address-limit` / `--min-amount-sum`
  with a clear error since those tune the local recipe only and the remote tool
  does not accept them. Previously all four flags were silently ignored in
  `--remote` mode.

## [0.8.17] - 2026-07-03

- Corrected the LICENSE copyright holder to Chainswarm Technology (the legal
  entity; "Chain Swarm AML" was never the company name). No code changes.

## [0.8.16] - 2026-07-03

- `cia mcp call` now exits non-zero when the backend tool returns an error
  result (`isError`). Previously the error text was printed and the CLI still
  exited 0, so scripts and CI treated remote tool failures as success.
- `cia status`, `cia config get`, and `cia config set` now fail with a clean
  one-line error and a non-zero exit on a corrupt config (e.g. invalid
  `config.json`), instead of a raw Node stack trace. The CLI parses commands
  with `parseAsync` so any async action rejection is surfaced cleanly.

## [0.8.15] - 2026-07-03

- Fix stateless MCP proxy mode (`CHAIN_INSIGHTS_MCP_PROXY_MODE=stateless`): the
  proxy exited cleanly before `server.connect()` ran, so every host call failed
  with `MCP error -32000: Connection closed`. A misplaced brace left the
  `if (workspaceArtifactsEnabled)` block wrapping the graph app resource, the
  `aml_*`/`graph_*` tool registration, and the stdio connect — all skipped when
  not in workspace mode. Scope the gate to the workspace-only `wallet_balance`
  tool so the shared surface and the transport attach in both modes. Stateless
  mode now completes the handshake and serves the four `aml_*` tools plus the
  graph primitives without writing workspace artifacts.

## [0.8.14] - 2026-07-03

- Installer safety: `cia --claude` / `--codex` / `--hermes` no longer delete
  every `ci-*` directory in the shared global skills folder before copying. A
  user's own unrelated `ci-*` skill was being removed on install; clean
  reinstall is now scoped to only the skill directories Chain Insights ships.
- `cia --claude --help` (and `--codex`/`--hermes` with `--help`/`--version`)
  now print help/version instead of running the global installer. A help or
  version request must never mutate the machine.

## [0.8.13] - 2026-07-03

- Wallet safety: the payment wallet no longer signs an unbounded token
  approval when a paid endpoint returns an `allowance_required` challenge.
  Endpoint-dictated auto-approvals are capped at 10 USDC (override with
  `CHAIN_INSIGHTS_MAX_AUTO_APPROVAL_USDC`); larger allowances must be approved
  deliberately with `chain-insights wallet ready --payment-usdc <amount>`.
- Wallet safety: `chain-insights wallet import` now refuses to overwrite an
  existing wallet unless `--force` is passed, and backs up the previous
  encrypted key next to `wallet.json` before replacing it. Setting
  `walletPrivateKey` via `config set` is create-only for the same reason.

## [0.8.12] - 2026-07-03

- Document devkit's persistent `cia debug on --token <token> --endpoint
  http://127.0.0.1:18012/mcp` config path in the top-level README, matching
  the pattern used for the local/staging endpoint examples.

## [0.8.11] - 2026-07-03

- Fix the Verify workflow's "Verify npm package contents" step: `npm pack`
  runs the `prepare` build hook, and that child process's build-tool stdout
  was getting captured into the tarball filename variable, causing `tar -tf`
  to fail with "Cannot open" on every push and PR since 0.8.8. Take the last
  line of `npm pack --silent` output instead of the whole capture.

## [0.8.10] - 2026-07-03

- Fix the devkit README's `cia mcp call` example: the sample address
  extraction referenced a retired `addresses.csv` fixture file. The devkit
  fixture format moved to `nodes.jsonl.gz`/`relationships.jsonl.gz`; the
  example now extracts a substrate address from `nodes.jsonl.gz`.
- Document `cia debug on --token <token> --endpoint <devkit-url>` as the
  persistent way to point `cia` at the devkit backend, as an alternative to
  the one-off `CHAIN_INSIGHTS_GRAPH_MCP_ENDPOINT` environment variable.

## [0.8.9] - 2026-07-03

- Devkit MemGQL bumped to 0.6.3 (latest), matching the dev compose stack and
  the staging chart.

## [0.8.8] - 2026-07-03

- Add a `prepare` script so installing Chain Insights as a git dependency
  builds `dist/` on install. Since 0.7.13 `dist/` is untracked, so GitHub
  tarball/git installs shipped a `chain-insights-mcp-proxy` whose bin shim
  could not resolve `../dist/mcp-proxy.mjs` and exited at spawn ("MCP error
  -32000: Connection closed" in consumers such as the aml-acp benchmark).
  Consumers must pin via the `github:` protocol (not archive tarball URLs)
  for `prepare` to run.

## [0.8.7] - 2026-07-03

- Add the `Devkit Smoke` workflow: on pushes to `main` touching `devkit/` or
  `src/` (and on manual dispatch), boot the devkit fixture stack on a trusted
  self-hosted runner and run the backend smoke plus the full `cia` parity
  smoke, uploading the evidence bundle as a workflow artifact. Pull requests
  intentionally stay off self-hosted runners.

## [0.8.6] - 2026-07-02

- Restore full devkit fixture parity inside the 2024-01-01 through 2026-07-02
  window by removing the rejected repeated-flow filter and shipping the largest
  StarRocks edge fixture as manifest-declared gzip parts.

## [0.8.5] - 2026-07-02

- Refresh the Bittensor devkit fixture to cover 2024-01-01 through
  2026-07-02, including updated StarRocks/Memgraph objects, hashes, coverage
  counts, and manifest validation bounds.
- Keep the devkit fixture in ordinary Git by chunking the largest StarRocks
  fixture object into Git-safe parts without dropping rows inside the fixture
  window.
- Return `graph_query` results in the Chain Insights result envelope with query
  tier, timeout, topology routing, and semantic database facts for parity with
  the production surface.
- Enforce the production `graph_query_batch` 20-query cap in the lite devkit
  backend.

## [0.8.4] - 2026-07-02

- Restore the devkit-only lite Chain Insights Graph backend (reverts the 0.8.3
  swap to the production binary). The lite backend exists so third-party
  developers can build and host the graph MCP from this repository alone,
  against locally served StarRocks and Memgraph, without production backend
  source or any payment/quota/telemetry surface.
- Contract-sync the lite backend to the current production surface instead:
  add the unmetered `usage_status` tool, two-tier query timeout ceilings
  (live 10s, archive/facts 30s) selected by the query's `USE` clause with
  caller overrides only lowering them, per-query `tier`/`timeout_seconds` and
  batch tier-ceiling facts in `graph_query_batch` results, and capability
  live/archive topology sublayers with tier timeouts.

## [0.8.3] - 2026-07-02

- Devkit now runs the real Chain Insights Graph backend binary (built from a sibling internal checkout) instead of the bespoke lite MCP, with x402 billing, telemetry, and dynamic capabilities disabled and production two-tier query timeouts (live 10s, archive/facts 30s). The bespoke Go module and `Dockerfile.mcp` are removed.
- Devkit smoke expects the backend's four tools (`network_capabilities`, `usage_status`, `graph_query`, `graph_query_batch`); the parity smoke accepts the backend-served usage status alongside the primitive fallback.
- Devkit parity smoke derives MemGQL object-coverage totals from the live mapping instead of pinning node/relationship counts (the pinned 12/13 counts predated the exposure-surface removal and failed against the current 10/9 mapping).

## [0.8.2] - 2026-07-01

- Add an explicit `topology_scope` parameter (`live_topology` default, `archive_topology` override) to `aml_address_risk`, `aml_trace_victim_funds`, `aml_trace_suspect_funds`, and `aml_trace_deposit_sources`, with tool/parameter descriptions stating the archive cost/latency tradeoff.
- Fix seed resolution to use the `:Address` graph node (with an existence check for canonical hex-form inputs) instead of falling back to an unresolved raw address as a synthetic identity key; a fabricated address is now reported `unresolved` rather than silently traced.
- Add a best-effort archive-retry hint (bounded independent timeout) suggesting `archive_topology` when a `live_topology` trace finds nothing.
- Fix dual-layer (`live`/`archive`) topology capability reporting across both capability-cleaning code paths.
- Fix a StarRocks `<>` node-comparison incompatibility affecting `archive_topology` exchange-detection and deposit-source queries.
- Validate direct CLI `--topology-scope` flags against the same enum as the MCP proxy path.

## [0.8.1] - 2026-06-30

- Consolidated dependency and workflow bumps: `hono` 4.12.27, `@hono/node-server` 2.0.6, `github/codeql-action` v4.36.2, `actions/checkout` v7, plus the tooling and mcp-and-payments dependency groups.
- docs(architecture): federated docs subsystem (wrapper + context/containers/comp).
- ci(docs): thin docs caller wired to the RBMK docs subsystem.

## [0.8.0] - 2026-06-28

- Remove the public `exposure_*` MCP tools (`exposure_profile`, `exposure_quality`,
  `exposure_carry`, `exposure_crowding`, `exposure_exit_pressure`,
  `exposure_correlation`, `exposure_explain`) and their devkit fixtures, as part of
  the coordinated removal of the exposure subsystem across Chain Insights. The
  `aml_address_risk` exchange-exposure signal is unchanged.

## [0.7.13] - 2026-06-23

- Show dataset coverage (block range / date range) in `cia networks` output.
- List public Chain Insights investigation, graph, and wallet tools in
  `cia networks` alongside network-native tools, wrapping rows for
  readability.
- Remove the stale Claude Desktop setup path; align `cia setup` help
  with supported CLI installer targets (`cursor`, `codex`, `claude`).
- Stop tracking `dist/` build artifacts in git. Build artifacts are
  regenerated by CI and included in the npm package via `package.json`
  `files` field.

## [0.7.12] - 2026-06-23

- Show full addresses in the D3 graph canvas (removed truncation). Fall back
  to `node.id` when `address` is absent.
- Show full src/dst addresses in Mermaid flowchart report markdown (was 8-char
  truncation).
- Add `cursor.com` and `www.cursor.com` to `graph.html` trusted parent origins
  for MCP App iframe handshake in Cursor IDE.

## [0.7.11] - 2026-06-18

- Hardened the devkit Chain Insights Graph MCP record mapper so mismatched
  Neo4j/Memgraph record keys and values no longer panic during graph query
  result formatting.
- Added a regression test for mismatched devkit MCP records and made devkit
  Chain Insights smoke scripts more tolerant of CSV line endings.

## [0.7.10] - 2026-06-17

- Fixed devkit import scripts so Memgraph fixture objects are excluded from
  StarRocks DDL, stream-load, and count checks.
- Added semicolon-terminated Memgraph index DDL and pinned the Security
  workflow CodeQL job to an X64 self-hosted runner.

## [0.7.9] - 2026-06-16

- Replaced the devkit Memgraph live-topology fixture with a GraphRAG-synced
  JSONL export that preserves node labels, relationship types, properties,
  Bittensor structure, ML risk scores, and scam-topology relationships while
  excluding runtime `GlobalState` cursor data.
- Updated the devkit Memgraph importer to load the enriched JSONL graph instead
  of the earlier bare CSV topology.

## [0.7.8] - 2026-06-16

- Published the devkit fixture as a static real Bittensor semantic export for
  StarRocks and Memgraph, replacing synthetic placeholder rows with 2023-2025
  data generated from the RBMK-controlled semantic facade.
- Removed UAT-only seed-address metadata from the fixture manifest; smoke
  scripts now derive real graph addresses at runtime from the exported
  Memgraph CSVs.

## [0.7.7] - 2026-06-15

- Bumped dependency lockfiles for the latest maintenance updates from Dependabot:
  - `@modelcontextprotocol/ext-apps`, `@x402/evm`, `@x402/fetch`, and `viem`
  - tooling updates: `@types/node`, `tsdown`, `tsx`, and `vitest`
  - `hono` runtime dependency

## [0.7.6] - 2026-06-15

- Renamed the product-facing graph layer to Chain Insights Graph across README,
  docs, shipped skills, CLI output, wallet readiness text, and MCP proxy errors.
- Renamed the devkit lite graph backend and UAT skill to
  `chain-insights-graph-devkit` and `test-chain-insights-graph` so local
  devkit output no longer exposes retired graph-layer names.

## [0.7.5] - 2026-06-15

- Documented the Bittensor devkit as the deterministic local Chain Insights Graph
  backend for Chain Insights development, including clean compose startup,
  smoke scripts, CIA parity checks, and the primitive-only backend boundary.
- Clarified Chain Insights Graph docs so `graph_query` and `graph_query_batch` remain
  the portable graph primitives, while Chain Insights owns local metadata,
  usage-status fallback behavior, wallet state, and AML workflows.
- Fixed public trace summaries and Markdown reports so final artifact paths
  point at the Chain Insights workspace bundle instead of internal trace probe
  placeholders.

## [0.7.4] - 2026-06-14

- Refined the MCP Inspector-facing surface after review: canonical prompts now
  require `network` instead of silently defaulting it, graph prompts provide
  schema-discovery query guidance, and help/resource copy no longer exposes
  graph-app internals such as `_meta` URLs or iframe behavior.
- Made the CLI `mcp call` shortcut enforce the same public argument allow-list
  as the MCP proxy so removed trace controls such as `min_amount_sum` and
  `per_address_limit` are rejected instead of looking supported.

## [0.7.3] - 2026-06-14

- Removed free-text `network` inputs from MCP Inspector prompt cards. Prompts
  now generate instructions with the current supported investigation network,
  while tools continue to expose `network` as an enum/dropdown input.
- Stopped passing through remote canonical prompt definitions so upstream prompt
  metadata cannot reintroduce stale descriptions or free-text network fields.

## [0.7.2] - 2026-06-14

- Cleaned up the MCP Inspector tool surface: network inputs now use generic,
  short descriptions; `aml_address_risk` no longer hardcodes a network name in
  its description; timestamp fields say they expect Unix milliseconds rather
  than block heights; and trace depth is described as hops.
- Simplified the public Inspector trace schemas by hiding low-level
  `time_range`, `per_address_limit`, and `min_amount_sum` filters from the
  `aml_trace_*` tool cards while keeping product-facing controls available.
- Reworked `meta_help` into a short product guide instead of returning graph
  schema internals.

## [0.7.1] - 2026-06-14

- Improved the `wallet_balance` MCP Inspector result. The tool now returns
  structured wallet balance JSON in `structuredContent` while keeping a concise
  human-readable text summary. The visible text uses `Payment network: Base`
  instead of `Network: Base` so the Base payment rail is not confused with the
  Chain Insights semantic investigation network.

## [0.7.0] - 2026-06-14

- BREAKING: refactored the MCP Inspector-facing public surface to canonical
  prefix families. Metadata tools are now `meta_network_capabilities`,
  `meta_usage_status`, and `meta_help`; the payment wallet tool is now
  `wallet_balance`; AML tools remain under `aml_*`; graph primitives remain
  `graph_query` and `graph_query_batch`. The legacy `network_capabilities`,
  `usage_status`, `help`, `balance`, `address_risk`, `track_funds`, and
  unprefixed trace aliases are no longer exposed.
- Rebuilt the prompt catalogue around the same prefixes:
  `aml-address-risk`, `aml-trace-victim-funds`,
  `aml-trace-suspect-funds`, `aml-trace-deposit-sources`,
  `meta-network-capabilities`, `meta-usage-status`, `meta-help`,
  `wallet-balance`, `graph-query`, and `graph-query-batch`.
- Simplified `meta_network_capabilities` to the only current semantic
  workflow network, `bittensor`, and removed unsupported-network,
  retention-window, and aggregation fields from the public result.
- Tightened no-argument MCP schemas for metadata and wallet tools so MCP
  Inspector renders strict empty inputs, and aligned docs, runtime skills,
  Chain Insights Graph UAT guidance, and ACP-facing surface names with the prefixed
  contract.

## [0.6.2] - 2026-06-13

- Refreshed the MCP inspector-facing prompt and tool metadata: added the
  `network-capabilities` prompt, aligned graph prompt titles, and capitalized
  the local `Balance` and `Help` tool titles.
- Updated Chain Insights graph docs, shipped Cypher skills, and Chain Insights Graph UAT
  guidance for the current semantic identity graph: the only public Chain Insights Graph
  investigation network is `bittensor`, Bittensor SS58 and EVM-pallet member
  addresses share `network=bittensor`, and money-flow queries use
  `(:Identity)-[:FLOWS_TO]->(:Identity)` with `amount_usd_sum`.

## [0.6.1] - 2026-06-13

- Removed the exposure analysis/profile/report tool surfaces from the first
  public release package. The public tool set now keeps exposure data out of
  the initial CLI/MCP surface while the backend graph and risk tooling continue
  through the dedicated trace and address-risk tools.

## [0.6.0] - 2026-06-12

- BREAKING: removed the interactive `scam_topology` investigation tool. Scam
  topology is now derived automatically by a backend labeler daemon that
  traverses the identity graph from confirmed scam/victim seeds and writes
  `inferred` scam labels for serving and ML supervision, so the analyst no
  longer runs an interactive topology traversal and curates candidates by hand.
  Dropped the `scamTopology` public-tools export, the `src/investigation/scam-topology.ts`
  implementation, the `scam-topology` CLI dispatch entry, and the
  `scam_topology` hidden-remote-tool registration plus its
  `assertPublicMcpToolName` redirect branch. Use `aml_trace_suspect_funds` for
  on-demand suspect fund-flow tracing. Confirmed scam/victim seeds are managed
  through the upstream pipeline seed corpus.

## [0.5.6] - 2026-06-12

- AML trace tools accept an activity window. `aml_trace_victim_funds` and
  `aml_trace_suspect_funds` take `time_range` (`from_ms` required, `to_ms`
  optional) or derive the window from `incident_timestamp_ms`; traced
  `FLOWS_TO` edges are filtered on `first_seen_timestamp`/`last_seen_timestamp`
  on every hop, and the effective window is echoed back as `time_filter`
  (`'none'` when unfiltered). `time_range` takes precedence over
  `incident_timestamp_ms`. Edge timestamps now ride along in trace projections,
  compact evidence, graph payloads, and the CSV/Markdown/HTML flow tables.
- Victim/suspect traces now run the bounded deposit traceback and expose a
  `deposit_funding` section: source-exchange paths covering roughly the first
  `floor(20/max_hops)` deposit candidates plus reverse 1-hop leads, with
  `source_exchange_paths[].path` in traversal order deposit-to-source (the
  reverse of money flow). Traceback query failures surface as result warnings
  instead of aborting the trace, and an exchange-funded deposit candidate adds
  a continuation note pointing at `aml_trace_deposit_sources`.
- `aml_trace_deposit_sources` gains noise controls: `min_amount_sum` drops
  reverse `FLOWS_TO` edges below the given USD amount (`amount_usd_sum`; dust
  control), `time_range` applies the same activity window (echoed as
  `time_filter`), and each reverse depth warns explicitly when it saturates
  the 500-row limit.
- `aml_address_risk` exchange-exposure rows include edge activity timestamps,
  and when no ML risk score exists the fallback score is structure-weighted
  instead of a flat 0.4: log-scaled USD exposure volume with shared/omnibus
  edges dampened, bounded in (0, 0.6] so a fallback can never impersonate a
  high ML score band.
- MCP proxy schemas and descriptions updated for the three trace tools:
  shared `time_range` fragment, `min_amount_sum` on deposit sources, and
  product-facing descriptions of the window semantics, the bounded
  `deposit_funding` traceback preview, and dust/truncation controls. All new
  filters and fields follow the USD-only value grain of the graph property
  contract (v0.5.5): every amount is `amount_usd_sum`.

## [0.5.5] - 2026-06-12

- Breaking graph-property contract alignment (identity/address property
  contract, spec 2026-06-11). Identity nodes carry `identity_id`, `labels`,
  `is_exchange` (sparse), the slim risk verdict (`risk_score`/`risk_level`),
  external-flow rollups (`degree_in`/`degree_out`/`degree_total`,
  `tx_in_count`/`tx_out_count`/`tx_total_count`,
  `total_in_usd`/`total_out_usd`/`total_volume_usd`, `net_flow_usd` = in minus
  out, `first_activity_timestamp`/`last_activity_timestamp`,
  `activity_span_days`), and sparse `internal_tx_count`/`internal_volume_usd`.
  Dropped everywhere: `address_type`, `lifetime_*`, and `active_days` reads.
- `FLOWS_TO` is USD-only at identity grain: the native `amount_sum` edge
  property no longer exists. All trace/risk/scam-topology queries, predicates,
  projections, CSV/Markdown/HTML tables, mermaid labels, compact evidence, and
  graph payloads now use `amount_usd_sum`. The `min_amount_sum` option keeps
  its name but filters on `amount_usd_sum`; its CLI/MCP descriptions say so.
- Scam topology scores candidate confidence from the USD grain only
  (`reliableScoringValue` takes a single USD argument); thresholds and
  promotion logic are unchanged and owned by the separate recalibration plan.
  The scam-typed (`address_type`) traversal carve-outs were removed with the
  property; the strict exchange-label matcher remains the protection against
  reading scam-output labels as exchanges.
- Address satellites carry `network`; contract docs (MCP proxy schema hints
  and the workspace runtime-skill prompt) document the full new contract,
  including the sparse idiom, `internal_*`, and the `FLOWS_TO` edge surface
  (`tx_count`, `amount_usd_sum`, `avg_tx_size_usd`, `first/last_seen_timestamp`,
  `first/last_tx_id`, `dominant_asset`, `price_coverage_ratio`).
- Viz: the synthesized display field formerly named `address_type` is now
  `node_kind` (wallet/exchange) across the HTML generator, graph template, and
  fixtures; the graph normalizer no longer special-cases `address_type`.

## [0.5.4] - 2026-06-11

- Breaking graph-model change: Identity nodes no longer carry the `addresses`
  list property. Member-address forms live exclusively on the
  `(:Address {address})` satellite nodes reached via
  `(:Identity)-[:HAS_ADDRESS]->(:Address)`; enumerate an identity's member
  forms with `MATCH (i:Identity {identity_id: $id})-[:HAS_ADDRESS]->(m:Address)
  RETURN m.address`. Removed every `addresses`-property read: the
  `aml_address_risk` profile now collects member addresses through a dedicated
  `HAS_ADDRESS` batch query, trace path-node maps no longer project
  `addresses`, the workspace runtime-skill prompt and MCP schema hints document
  the satellite traversal instead of the list property, and the Chain Insights Graph
  UAT asserts membership via `collect(m.address)` from the satellites.

## [0.5.3] - 2026-06-11

- Renamed the identity member-address edge from `(:Identity)-[:OF]->(:Address)`
  to `(:Identity)-[:HAS_ADDRESS]->(:Address)`. `OF` is a reserved word in the
  MemGQL grammar and required backtick escaping in every query; `HAS_ADDRESS`
  parses bare and matches the facts-graph `HAS_RISK_SCORE`/`HAS_LABEL`/
  `HAS_FEATURE` edge family. The member-address resolution lookup is now
  `MATCH (m:Address {address: $input})<-[:HAS_ADDRESS]-(i:Identity)
  RETURN i.identity_id LIMIT 1`. Removed the backtick escaping and
  reserved-word notes from the resolution helper, workspace runtime-skill
  prompt, MCP schema hints, and the Chain Insights Graph UAT member-address
  resolution phase.

## [0.5.2] - 2026-06-11

- Fixed member-address resolution against MemGQL: `OF` is a reserved word in
  the GQL grammar, so the relationship type must be backtick-escaped. The
  resolution lookup is now
  `MATCH (m:Address {address: $input})<-[:\`OF\`]-(i:Identity)
  RETURN i.identity_id LIMIT 1`. Updated the resolution helper, workspace
  runtime-skill prompt, MCP schema hints, and the Chain Insights Graph UAT
  member-address resolution phase. The graph model from 0.5.1 is unchanged.

## [0.5.1] - 2026-06-11

- Adopted the final member-address graph naming: the satellite label is
  `:Address` (not `:MemberAddress`) and the relationship is Identity-outward
  `(:Identity)-[:OF]->(:Address)` (not `(m)-[:ADDRESS_OF]->(i)`). The
  resolution lookup is now
  `MATCH (m:Address {address: $input})<-[:OF]-(i:Identity)
  RETURN i.identity_id LIMIT 1`. Updated the resolution helper, workspace
  runtime-skill prompt, MCP schema hints, and the Chain Insights Graph UAT
  member-address resolution phase. Everything else from 0.5.0 stands.

## [0.5.0] - 2026-06-10

- **Breaking:** adopted the generic member-address graph model. Identity
  nodes no longer carry `evm_address`/`substrate_address` scalars; member
  addresses come from the `addresses` list property (canonical 0x form
  first, SS58 form second when present). Tool responses and graph nodes
  now expose `member_addresses` as a list instead of the two scalars.
- AML tool address inputs accept any member address form. Non-0x inputs
  (for example SS58) are resolved through the indexed
  `(:MemberAddress {address})-[:ADDRESS_OF]->(:Identity)` exact lookup;
  0x inputs are derived locally as `<network>:<lowercase 0x form>`.
  Unresolvable inputs pass through unchanged.
- Identity nodes regained investigator triage properties: a slim live
  risk verdict (`risk_score`, `risk_level`) and base activity rollups.
  `aml_address_risk` surfaces the live verdict as
  `facts.risk.live_node` and a `Live node triage` summary line; the
  facts-first detailed scoring (`facts_risk_scores_view` with
  provenance) remains the authoritative risk source. Path/graph nodes
  carry `risk_score`/`risk_level` quick-triage values when present.
- Workspace runtime-skill prompt and MCP schema hints teach the
  `addresses` list, the MemberAddress resolution pattern, the node
  triage/rollup properties, and the scores-detail-via-`USE facts` rule.
- Chain Insights Graph UAT asserts a non-empty `addresses` list on the UAT
  identity node and that MemberAddress resolution by the SS58 member
  form returns the identity; all existing identity/scope assertions are
  kept.

## [0.4.0] - 2026-06-10

- **Breaking:** rewrote every investigation tool to the slim identity-grain
  graph schema. Live and archive topology recipes now match
  `(:Identity {identity_id})` with `[:FLOWS_TO]` edges; tool inputs take
  canonical identity keys (`<network>:<canonical_address>`, for example
  `bittensor:0x1874a43d7c6d888f9eda3d22a3a49704e3cadb24`).
- **Breaking:** removed ghost node-property reads (`risk_score`,
  `risk_level`, `pattern_flags`, `confluence_score`, `ml_*`,
  `address_subtypes`, `lifetime_degree_*`, `total_volume_usd`) from all
  live-topology queries; the slim graph no longer carries score or rollup
  properties.
- `aml_address_risk` is now facts-first: `ml_risk_score` comes from the
  semantic `facts_risk_scores_view` (`HAS_RISK_SCORE`), label risk from
  `facts_address_labels_view` (`HAS_LABEL`), with per-family provenance in
  `facts.risk.sources`. Member addresses (`evm_address`,
  `substrate_address`) are surfaced from the Identity node in the summary,
  `facts.subject.member_addresses`, and graph nodes.
- Workspace runtime-skill prompt teaches the slim identity schema:
  identity key form, member-address properties, exposure shapes, and the
  scores-come-from-`USE facts` rule. `topology_scope` accepts only
  `identity`.
- Chain Insights Graph UAT now runs identity-only assertions (identity node lookup
  with member-address checks, identity exposure discovery) and asserts that
  `graph_query` with `topology_scope=address` fails with the
  unsupported-scope error.

## [0.3.24] - 2026-06-10

- Reordered the UAT so the CLI live-topology assertion runs before the
  proxy/exposure phase. Exposure scans abandoned at the MCP per-query
  timeout keep executing on the memgql proxy's serial session and can
  poison subsequent live reads for the remainder of the run; no assertion
  was weakened and every step still executes.

## [0.3.23] - 2026-06-10

- Switched the UAT CLI live-topology lookup to the inline property-map form
  (`MATCH (n:Address {address: …})`). The `WHERE`-clause form deterministically
  hangs in the memgql proxy when sent from the Chain Insights Graph Go client, while
  the inline form resolves in milliseconds through every client path.

## [0.3.22] - 2026-06-10

- Added a bounded retry (3 attempts, `GRAPH_QUERY_ATTEMPTS` override) to the
  UAT CLI live-topology lookup. A busy graph store can transiently queue
  point reads past the MCP per-query timeout (e.g. mid-resync); the
  assertion still requires the exact UAT address row.

## [0.3.21] - 2026-06-10

- Fixed the Chain Insights Graph UAT CLI live-topology lookup to use a labeled
  `MATCH (n:Address)` pattern. The unlabeled `MATCH (n)` form forced a full
  client-side proxy scan (~27s on a large graph) and broke under the MCP
  per-query timeout; labeled lookups resolve via the address index in
  under a second.

## [0.3.20] - 2026-06-09

- Cut the Chain Insights Graph UAT identity assertions to the public route:
  `graph_query` with `network=bittensor` plus `topology_scope=identity` now
  asserts live `Identity FLOWS_TO Identity` topology, resolved routing
  metadata (`facts.routing.starrocks_database=bittensor_semantic`),
  identity-keyed semantic facts, and unregressed address topology. The
  internal `bittensor_identity` network key is no longer a public tool input.
- Added the `usage_status` tool to the required proxy tool allow-list.

## [0.3.19] - 2026-06-09

- Removed the in-repo npm publish workflow. npm publishing now runs only from the
  private `chainswarm/chain-insights-publisher` repo via manual `workflow_dispatch`,
  so the npm token no longer lives in this public contribution repo.

## [0.3.18] - 2026-06-09

- Added secret egress pattern detection to the PR secret scan.
- Added a workflow smoke test to confirm `stdout` secrets are redacted by
  GitHub Actions logs.

## [0.3.13] - 2026-06-07

- Added generic `exposure_quality`, `exposure_carry`, `exposure_crowding`,
  `exposure_exit_pressure`, `exposure_correlation`, and `exposure_explain`
  MCP tools plus matching `cia mcp` commands over the shared exposure model.
- Extended Chain Insights Graph UAT to discover a seeded generic exposure
  account and smoke all exposure tools without exposing storage or graph
  relationship internals.

## [0.3.14] - 2026-06-08

- Removed the legacy non-public `stake_insights` implementation and remaining
  stake-topology Chain Insights Graph assumptions from the public Chain Insights source,
  skills, and UAT surface.
- Removed the deprecated case/vault/playbook product surface, including
  `cia case` export and vault scaffolding, shipped `ci-case` guidance, and
  runtime compatibility paths that recreated legacy case directories.
- Reframed the shipped docs, skills, and tests around workspace-only
  artifacts, reports, and graph outputs.

## [0.3.16] - 2026-06-09

- Made security workflows more reliable on PR by routing CodeQL and Scorecard to
  GitHub-hosted runners and making the self-hosted runner usage conditional.
- Hardened workflow secret scanning to include test files while excluding known
  synthetic secret fixtures only.
- Standardized CI `verify` and `security` runner selection by event type for
  consistent PR execution.

## [0.3.15] - 2026-06-08

- Reordered the README tool table so `aml_` tools come first, `exposure_`
  tools follow, `graph_query` sits below the investigative tools, and
  `usage_status` remains the final metadata tool.

## [0.3.12] - 2026-06-07

- Added the public `exposure_profile` MCP tool and `cia mcp exposure-profile`
  command for generic staking and trading exposure around an account, owner, or
  counterparty.
- Hid the old public `stake_insights` surface from proxy tool discovery and UAT
  contracts while preserving non-public implementation compatibility during the
  exposure topology migration.

## [0.3.11] - 2026-06-02

- Increased the packaged CLI init integration test timeout so npm publish CI can
  complete reliably on slower runners.

## [0.3.10] - 2026-06-02

- Allowed Chain Insights Graph endpoint configuration to use trusted Kubernetes
  `*.svc.cluster.local` HTTP service URLs for in-cluster proxy deployments while
  continuing to reject arbitrary remote HTTP endpoints.

## [0.3.9] - 2026-06-02

- Added `cia update` / `chain-insights update` to check the global npmjs
  registry for the newest Chain Insights CLI release and run the global npm
  update command.
- Added an interactive update prompt after `cia init` when a newer npm release
  is available, while keeping noninteractive workspace initialization quiet.

## [0.3.8] - 2026-06-01

- Sent invited tester access keys through the Chain Insights Graph debug, staging
  test-key, and bearer auth headers for both MCP tool calls and network
  capability metadata reads, so staging smoke tests can exercise graph-backed
  tools without falling through to x402 payment.
- Added stateless MCP proxy mode for ACP and hosted callers so graph-backed CIA
  tools can return summaries and structured results without requiring a local
  investigation workspace, case files, or graph report attachments.

## [0.3.7] - 2026-05-31

- Reworded public access guidance to the clearer "daily free tier": 10
  execution seconds per IP per UTC day for bounded `graph_query` reads, then
  wallet or approved access for sustained usage.

## [0.3.6] - 2026-05-31

- Clarified the public Chain Insights Graph free-tier path: 10 execution seconds per IP per
  UTC day should be spent on bounded single `graph_query` reads, prepared wallet
  users receive the daily free tier first, and batches are documented as
  paid-access usage.
- Added staging UAT notes for the public free tier and free-to-paid handoff.

## [0.3.5] - 2026-05-30

- Made fresh Chain Insights workspaces Obsidian-compatible investigation vaults
  by default, including root vault notes, starter `.obsidian` settings, canvas,
  entity, evidence, and published handoff directories.
- Added live case vault refresh files and CLI workflow so case notes, agent
  console notes, entity notes, evidence notes, and `Graph.canvas` can be
  reviewed in Obsidian during active investigations.
- Repositioned docs around the Obsidian-first local workflow while preserving
  `cia case export` and MCP `case_export` for public, partner, LLM Wiki, and
  agent handoff bundles.

## [0.3.4] - 2026-05-30

- Added `docs/knowledge-exports.md` with install and setup instructions for
  Obsidian, LLM Wiki, Codex, Claude Code, ChatGPT, and portable agent usage.
- Linked the knowledge export guide from README, investigation workspace docs,
  and MCP proxy docs so users can go from `cia case export` to an Obsidian
  vault or LLM Wiki ingestion flow without guessing the next step.

## [0.3.3] - 2026-05-30

- Added `cia case export` and MCP `case_export` to produce Obsidian,
  LLMWiki, Codex, Claude Code, and ChatGPT-friendly local case bundles.
- Added export artifacts including `manifest.chain-insights.json`,
  `graph.chain-insights.json`, `Graph.canvas`, Markdown entity/evidence notes,
  `LLMWIKI.md`, `llms.txt`, and agent prompt files.
- Added private, partner, and public redaction modes; public mode aliases
  addresses by default and all modes remove secrets from generated exports.

## [0.3.2] - 2026-05-30

- Added `AGENTS.md` as the Codex-facing twin of `CLAUDE.md` and documented
  that both agent entrypoints must stay byte-identical.

## [0.3.1] - 2026-05-30

- Tightened trace traversal boundaries so exchange hot wallets are terminal
  endpoints only: forward trace tools now require every non-terminal path node
  to be non-exchange, reverse deposit traceback excludes exchange sources and
  exchange deposit seeds, and defensive result filtering drops backend rows that
  would classify exchange nodes as deposit or suspect candidates.
- Updated generated runtime schema guidance, shipped Chain Insights skills, MCP
  server instructions, and graph-tool docs to state that BFS, fixed-depth
  fallback, shortest-path, and manual `FLOWS_TO` traversals must not expand
  through exchange hot wallets.

## [0.3.0] - 2026-05-29

- Replaced the public trace workflow surface with role-specific
  `trace_victim_funds`, `trace_deposit_sources`, and `trace_suspect_funds`
  tools returning `chain-insights.trace.v1`; legacy public `track_funds` and
  `scam_topology` exposure is hidden.
- Added CLI commands for the new trace tools and updated workspace runtime
  skill, shipped skills, docs, playbooks, and UAT guidance to teach the
  victim -> deposit traceback -> suspect chaining workflow.
- Added a shipped Memgraph examples reference for `chain-insights-cypher`,
  covering staging-tested Chain Insights Graph reads, archive/facts examples, and
  fixed-hop traversal fallbacks for native Memgraph deep traversal syntax that
  the hosted endpoint currently rejects.
- Allowed skill-local `references/` bundles to be tracked and shipped while
  keeping root-level local investigation references ignored.
- Expanded Bittensor Cypher guidance with practical prefix search,
  address-family census, and combined SS58/EVM examples under
  `network=bittensor`.

## [0.2.31] - 2026-05-29

- Added shipped `chain-insights-cypher` and
  `chain-insights-bittensor-cypher` skills for schema-aware Chain Insights Graph
  GQL/Cypher work, including generic live/archive/facts layer guidance and
  Bittensor-specific SS58 plus EVM-pallet address handling.
- Updated graph-tool and MCP proxy docs to point agents at the new Cypher
  skills and to use portable schema probes that avoid non-portable metadata
  functions.

## [0.2.30] - 2026-05-29

- Clarified the investigation skill for Bittensor: native Substrate/SS58 `5...`
  addresses and EVM-pallet `0x...` addresses are queried under the same
  `network=bittensor`; agents should not switch networks based only on address
  format.

## [0.2.29] - 2026-05-29

- Added `usage_status` documentation and client coverage for the Chain Insights Graph public free `graph_query` quota.
- Updated graph access guidance to call out the default 10 execution seconds per IP per UTC day, explicit query `LIMIT`/pagination, and paid fallback after quota exhaustion.
- Let paid-mode Chain Insights Graph clients make public free calls before wallet setup, while still surfacing wallet-ready guidance when the endpoint returns payment required.

## [0.2.28] - 2026-05-29

- Added `chain-insights wallet import <private-key>` as the user-facing way to configure a Base payment wallet.
- Removed raw `walletPrivateKey` and debug-bypass guidance from hosted missing-wallet errors; normal users are now pointed to `wallet ready`, `wallet topup`, or invited tester access keys.
- Updated wallet setup docs to keep payment setup protocol details out of the normal activation path.

## [0.2.27] - 2026-05-29

- Made `chain-insights wallet ready` default output fully user-facing: normal users now see one-time payment setup guidance instead of approval mechanics or transaction hashes, while `--json` keeps machine-readable readiness fields for operators.
- Added `wallet ready --check-only` and `--payment-usdc` as the user-facing flags, keeping the older approval-named flags as hidden compatibility aliases.
- Clarified staging activation docs: approved testers should use `https://staging-mcp.chain-insights.ai/mcp` only until production is live.

## [0.2.26] - 2026-05-29

- The MCP proxy now starts its local Chain Insights tool surface even when paid Chain Insights Graph fetch setup needs wallet or access-key configuration. Fresh MCP clients can list `help`, wallet/case tools, and the local AML workflows first, then receive user-facing `wallet ready` or `access-key` guidance when graph-backed calls need hosted access instead of seeing the proxy exit during `tools/list`.

## [0.2.25] - 2026-05-28

- `scam_topology` auto-promotion now uses a decay-calibrated confidence threshold (0.5) instead of 0.72. Because carried value is scored from native token amounts — whose magnitudes sit far below the USD-scale value saturation — even a hop-1 incident-scale edge decays to ~0.5-0.6, so the old 0.72 bar was unreachable on victim-anchored traces and nothing ever auto-promoted. Combined with the `hop <= 2` gate, the close-hop real-value core now promotes while dust and deeper edges stay review-only.


## [0.2.24] - 2026-05-28

- Added `chain-insights wallet ready` to check Base USDC, Base ETH gas, and one-time payment approval readiness in one user-facing command before paid Chain Insights Graph calls.
- Paid Chain Insights Graph calls now automatically prepare the local wallet and retry once when the x402 endpoint reports missing payment approval, so new users do not need to understand low-level approval mechanics.
- Updated payment guidance across the CLI, MCP proxy, workspace scaffold, and docs to point users at `wallet ready` first.

## [0.2.23] - 2026-05-28

- `scam_topology` exchange-endpoint detection now keys off the authoritative `is_exchange` flag and exact `exchange` registry labels, and explicitly ignores nodes typed SCAM or VICTIM. Previously, label text that merely contained the word "exchange" or a brand name could cause a scam-typed node to be mistaken for an exchange, prematurely terminating fund-flow traversal and corrupting the exchange-deposit list. Traversal now continues through such nodes.
- `scam_topology` candidate confidence now decays with hop distance and scales with the carried value of each transfer, so a close-hop, high-value laundering edge outranks a deep, low-value one instead of every candidate sitting at a near-flat floor.
- `scam_topology` value scoring prefers the native transferred amount and falls back to USD only when no native amount is available, so unreliable or missing deep-hop USD pricing no longer distorts confidence.
- `scam_topology` now emits an automatic promotable tier: a close-hop, high-confidence core is marked `promote_confirmed` while the diluted tail stays `review_required`, reducing manual triage of low-signal candidates.

## [0.2.22] - 2026-05-28

- `scam_topology` no longer auto-labels shared exchange-deposit infrastructure as scam. A penultimate-to-exchange address whose deposit edge exceeds shared-infrastructure thresholds (`tx_count >= 1000` or `amount_usd_sum >= 5,000,000`) is recorded as a `do_not_label_shared_exchange_deposit` safety decision instead of a SCAM `exchange_deposit_candidate`, so high-throughput omnibus/routing addresses ($M, thousands of transfers) stay out of `scam_labels`. Scammer-dedicated cash-out deposits (low throughput) are unchanged.

## [0.2.21] - 2026-05-27

- Clarified npm-facing endpoint configuration: local loopback remains the package default, hosted staging is an explicit operator setting, hosted access requires an approved access key or prepared wallet, and payment/chain details stay in focused MCP docs.

## [0.2.20] - 2026-05-27

- Removed internal planning artifacts from the public repository and ignored the local planning catalog path.
- Cleaned public docs, shipped skills, and agent guidance so they use product-facing Chain Insights and Chain Insights Graph language.

## [0.2.19] - 2026-05-27

- Added the Chain Insights `stake_insights` recipe over Chain Insights Graph `STAKES_IN` live/archive topology queries, including MCP proxy and CLI exposure, graph report metadata, and explicit backend-unavailable failures.
- Removed the hardcoded hosted Chain Insights Graph default from runtime config and workspace scaffold paths; local defaults now point to loopback.
- Added MCP endpoint validation for operator config (`graphMcpEndpoint` / `mcpEndpoint`) with explicit errors for malformed URLs, remote `http://`, credentials, and query/fragment usage.
- Added README operator guidance for MCP server address configuration across local, staging, and production environments, including precedence and validation rules.
- Removed synthetic fallback private-key generation from wallet topup startup; topup servers now require valid EVM wallet addresses at runtime entry points.
- Hardened topup HTML generation by validating wallet addresses and escaping or script-serializing dynamic values before embedding them in HTML/JS.
- Added topup regression tests for invalid wallet-address rejection and safe artifact rendering.

## [0.2.18] - 2026-05-26

- Updated GitHub Actions dependencies for checkout, Node setup, CodeQL, and OpenSSF Scorecard so CI runs on current pinned action releases.
- Updated tooling, MCP/payment, Hono, and Node server dependency locks for the release.
- Replaced generic Streamable HTTP payment failures with actionable Chain Insights access guidance.

## [0.2.17] - 2026-05-25

- Reworked npm package positioning with growth-friendly description, homepage, repository, issue tracker, and keywords.
- Updated the npm-facing README to link the website, GitHub, and npm package, and to explain x402-paid Chain Insights Graph access without exposing backend infrastructure names.
- Removed backend infrastructure names from public package docs, shipped skills, MCP tool copy, and generated workspace runtime guidance.

## [0.2.16] - 2026-05-25

- Added GitHub Actions workflow for automated npm publishing on release or manual dispatch.

## [0.2.15] - 2026-05-24

- Fixed the Chain Insights MCP proxy so graph query timeout options survive runtime query logging and slow `graph_query_batch` calls do not fall back to the SDK default timeout.
- Made `address_risk` report partial enrichment query failures without failing the whole screening or graph report.
- Updated the Chain Insights Graph UAT skill to validate a local Chain Insights Graph endpoint on port 8012.

## [0.2.14] - 2026-05-24

- Reworked README into a product-first Chain Insights overview with a cleaner quick start, AML tool showcase, Chain Insights Graph layering, and live/archive/facts topology guidance.
- Added Chain Insights developer-experience guidance plus focused contributing and debugging docs.
- Dogfooded the installed `cia` workflow from a clean workspace and documented the resulting README/CLI feedback.

## [0.2.13] - 2026-05-24

- Split the overloaded README into focused graph tools, workspace, MCP proxy, architecture, and development docs while keeping README as the operator entry point.
- Added scaffolded `imports/README.md` and `templates/README.md` files so fresh investigation workspaces explain how to use empty input/template directories.
- Made `cia init` preflight all scaffold file collisions before writing directories or files, avoiding partial workspaces when a target already contains files such as `README.md`.

## [0.2.12] - 2026-05-23

- Added `case_id` / `--case` support to `scam_topology` across direct CLI, generic `mcp call`, and the Chain Insights MCP proxy.
- Made `scam_topology` case evidence match `track_funds`: cases now receive compact `chain-insights.evidence_pointer.v1` entries that point to workspace graph, HTML, CSV, compact JSON, and Markdown report artifacts.
- Updated README and investigation skills to document the scam-topology case evidence and artifact contract.

## [0.2.11] - 2026-05-23

- Reworked `scam_topology` traversal to use one explicit activity policy mode: `node_relative_only` by default or `global_incident_only` when requested.
- Added node-relative novelty wave metadata, non-expanding convergence edges, and one primary run in the structured result.
- Updated CIA CLI help, MCP schema, built-in scam-topology playbook, README JSON contract notes, and graph report output to use the canonical `source` / `target` edge convention.

## [0.2.10] - 2026-05-23

- Reworked `scam_topology` public input to one `victim_address` plus required `incident_timestamp_ms`; removed the public scammer seed, scope, since timestamp, per-address limit, and amount filter knobs.
- Added ML-ready `scam_labels` with simple `scam: true` flags and victim incident provenance while keeping `label_candidates` as review context.
- Fixed scam topology live queries to bind source addresses in the `MATCH` pattern, cap per-hop frontier breadth, and skip slow downstream frontier reads instead of failing the whole incident topology.

## [0.2.9] - 2026-05-23

- Expanded `scam_topology` label discovery around exchange-deposit clusters reached from known scam victim/scammer seeds.
- Added `deposit_cluster_inflow` topology edges so shared deposit senders become review-required laundering candidates instead of being omitted from the scam cluster.
- Preserved generic address labels as review context while keeping victims and exchange endpoints out of risky label candidates.

## [0.2.8] - 2026-05-23

- Reworked `scam_topology` into outward victim/scammer traversal with `history`, `incident`, and `compare` scopes.
- Added review-safe label candidate semantics: victims, exchange endpoints, and generic labeled context nodes are not automatic scam labels.
- Added `scope` and `since_timestamp_ms` support to the CIA CLI and MCP proxy.

## [0.2.7] - 2026-05-23

- Added `scam_topology` live infrastructure expansion: seed funding inputs, seed sweeps, and fan-in/fan-out context around traced laundering anchors.
- Raised `graph_query_batch` timeout metadata to 600 seconds so archive-scale graph reads can be requested through the Chain Insights proxy and Chain Insights Graph.
- Updated Chain Insights investigation docs/skills for the wider scam-topology graph report.

## [0.2.6] - 2026-05-22

- Switched Chain Insights graph recipes to MemGQL-native `live_topology`, `archive_topology`, and `facts` queries.
- Reworked `track_funds` to avoid MemGQL-unsupported BFS, variable-length paths, `labels()`, reserved aliases, and top-level `UNWIND`.
- Updated Chain Insights Graph UAT guidance for the primitive `graph_query` and `graph_query_batch` endpoint.

## [0.2.5] - 2026-05-21

- Removed the experimental archival topology backend path and kept local investigation recipes on Memgraph BFS.
- Simplified graph schema caching to one runtime schema file per network.

## [0.2.4] - 2026-05-21

- Kept Chain Insights probes on graph-language reads: `track_funds` and `address_risk` use bounded Memgraph BFS recipes over `graph_query_batch`.
- Added schema discovery for runtime graph reports and compact evidence files.
- Added numeric-string handling and reverse-lead degree checks so trace reports stay stable for Bittensor exchange-path probes.

## [0.2.3] - 2026-05-19

- Tightened investigation workspace output: large JSON evidence is stored under `reports/tables/` with compact evidence pointers, case briefs are more actionable, dossiers omit empty placeholder sections, and runtime logs now live under `.chain-insights/runtime/logs/`.
- Clarified that `reports/graphs/` is the canonical graph payload location and duplicated graph artifacts are not created.
- Fixed `cia mcp track-funds --case <number>` so numeric case selectors resolve to the real case ID before evidence is attached.
- Restored legacy Python graph-path semantics for local `track_funds` forward exchange discovery: Chain Insights now issues Memgraph `FLOWS_TO *BFS` through the Go graph primitive instead of replacing the probe with plain variable-length path enumeration.
- Restored legacy Python graph-path semantics for local `address_risk` exchange discovery: exchange outflow/inflow checks use Memgraph `FLOWS_TO *BFS` with Python-style result budgets instead of bounded `FLOWS_TO *1..N` recipes, and missing stored risk fields now produce deterministic risk facts instead of `unknown/null`.

## [0.2.2] - 2026-05-18

- Updated x402/viem dependencies and pinned `ws` override to clear production npm audit.

## [0.2.1] - 2026-05-18

- Added `chain-insights access-key set|clear|status` for simple invited tester setup without exposing x402 details.
- Documented Chain Insights Graph test access key mode for invited users who should bypass x402 payment.
- Documented server-side test key hash configuration and rotation guidance.

## [0.2.0] - 2026-05-18

- Added GitHub release discipline: PR release gate, semver bump enforcement, and changelog enforcement.
- Added repository security posture: Verify, Security, OpenSSF Scorecard, Dependabot, npm registry signature verification, CodeQL, and secret-pattern scanning.
- Added canonical graph report schema support and local graph report serving from workspace `reports/graphs`.
- Added workspace output-root handling so investigation outputs stay in initialized workspaces.
- Added wallet balance visibility for Base ETH gas alongside USDC.
- Updated the default Chain Insights Graph endpoint to staging.
