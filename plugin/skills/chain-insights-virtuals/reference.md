# Virtuals queries (Robinhood Chain)

Every query here was admitted by the live server on 2026-10-18. Change only
the values in angle brackets. Send related reads in one
`graph_query_batch`. Contract addresses are in [SKILL.md](SKILL.md).

## A. Who is behind

### A1. Creators ranked by number of agents

```cypher
USE topology
MATCH (f:Address {address: "0xfc2e4da3edb2e18100473339c763705d263d20a9"})-[r:DEPLOYED_CONTRACT]->(t:Address)
RETURN r.tx_origin AS creator, count(*) AS agents ORDER BY agents DESC LIMIT 40
```

Totals in one row: `RETURN count(*) AS agents, count(DISTINCT r.tx_origin) AS creators LIMIT 1`.

### A2. Agents of one creator

Newest first. For a random sample, sort by `r.tx_id` instead: a hash order
has no time bias.

```cypher
USE topology
MATCH (f:Address {address: "0xfc2e4da3edb2e18100473339c763705d263d20a9"})-[r:DEPLOYED_CONTRACT]->(t:Address)
WHERE r.tx_origin = "<creator>"
RETURN t.address AS pool, t.labels AS labels, r.tx_id AS tx_id, r.block_timestamp AS created_timestamp,
       t.degree_in AS senders, t.tx_total_count AS tx_count, t.total_volume_usd AS volume_usd
ORDER BY r.block_timestamp DESC LIMIT 25
```

### A3. First funding of a wallet

```cypher
USE topology
MATCH (b:Address)-[f:FLOWS_TO]->(a:Address {address: "<wallet>"}) WHERE NOT b:Pool
RETURN b.address AS from_address, a.address AS to_address, f.amount_usd_sum AS amount_usd_sum, f.tx_count AS tx_count,
       f.first_seen_timestamp AS first_seen_timestamp, f.last_seen_timestamp AS last_seen_timestamp,
       b.labels AS from_labels, a.labels AS to_labels, b.is_exchange AS from_is_exchange, a.is_exchange AS to_is_exchange
ORDER BY f.first_seen_timestamp ASC LIMIT 10
```

Sort by `f.amount_usd_sum DESC` for the biggest funders instead.

### A4. The chain a wallet was funded from

The origin sits on the wallet's own `BRIDGED` link, not on the bridge node.

```cypher
USE topology
MATCH (a:Address {address: "<wallet>"})-[x:BRIDGED]-(c:Chain)
RETURN c.network AS remote_network, c.address AS endpoint, x.events AS events, x.kinds AS kinds LIMIT 10
```

### A5. Money in, out and kept

```cypher
USE topology
MATCH (c:Address {address: "<wallet>"})
RETURN c.total_in_usd AS in_usd, c.total_out_usd AS out_usd, c.net_flow_usd AS kept_usd,
       c.degree_in AS senders, c.degree_out AS receivers, c.tx_total_count AS tx_count LIMIT 1
```

Then its biggest receivers: the newest-links read of `chain-insights-cypher`,
sorted by `f.amount_usd_sum DESC`.

### A6. The three contracts of one agent

The token, the starting pool and the Uniswap pair share the creation `tx_id`.
The factory tells them apart.

```cypher
USE topology
MATCH (f:Address)-[r:DEPLOYED_CONTRACT]->(t:Address)
WHERE f.address IN ["0x43e4c17b15365596caae8e7d00e42bc8e988c2d4", "0xfc2e4da3edb2e18100473339c763705d263d20a9", "0x8bceaa40b9acdfaedf85adf4ff01f5ad6517937f"]
  AND r.tx_id = "<creation tx_id>"
RETURN f.address AS factory, t.address AS contract, t.labels AS labels, r.tx_origin AS creator LIMIT 5
```

## B. Who rugs

### B1. Liquidity seeded and removed on a graduated pair

No rows in the second read means nobody drained the pool.

```cypher
USE topology
MATCH (a:Address)-[r:ADDED_LIQUIDITY]->(p:Address {address: "<uniswap pair>"})
RETURN a.address AS provider, r.usd AS added_usd, r.event_count AS events LIMIT 10
```

```cypher
USE topology
MATCH (p:Address {address: "<uniswap pair>"})-[r:REMOVED_LIQUIDITY]->(b:Address)
RETURN b.address AS receiver, r.usd AS removed_usd, r.event_count AS events, r.receiver_provided AS receiver_provided LIMIT 10
```

### B2. Did a wallet dump or pump the agent token?

A row whose sold asset is the agent token is a sale. A row whose bought asset
is the agent token is a buy.

```cypher
USE topology
MATCH (c:Address {address: "<wallet>"})-[s:SWAPPED]->(b:Address)
RETURN b.address AS recipient, s.sold_asset AS sold_asset, s.bought_asset AS bought_asset,
       s.sold_usd AS sold_usd, s.bought_usd AS bought_usd, s.swap_count AS swap_count
ORDER BY s.sold_usd DESC LIMIT 10
```

The wallet's money into the pair: the newest-links read of
`chain-insights-cypher`, anchored on both the wallet and the pair.

### B3. A pool's life

```cypher
USE topology
MATCH (p:Address) WHERE p.address IN ["<pool 1>", "<pool 2>"]
RETURN p.address AS pool, p.labels AS labels, p.degree_in AS senders, p.degree_out AS receivers,
       p.tx_total_count AS tx_count, p.total_volume_usd AS volume_usd,
       p.first_activity_timestamp AS first_active, p.last_activity_timestamp AS last_active LIMIT 25
```

### B4. Holders at birth and the real buyers

The supply path at creation is mint, then launch contract, then starting
pool. Buyers buy through the router, so the pool pays the router. Read that
pair on the creation day. The example is BIBEL's starting pool on its
creation day, 2026-07-27: change the pool and the day.

```cypher
USE facts
MATCH (a:Address {address: "0x09e9df72f639875b58dbfd356e31c47b0b87f65b"})-[t:TRANSFER]->(b:Address {address: "0x65050a9b7e5075a2ba5ced7b1b64ee66262c40dc"})
WHERE t.block_date = "2026-07-27"
RETURN t.tx_id AS tx_id, t.block_timestamp AS block_timestamp, t.asset_symbol AS asset_symbol, t.amount AS amount LIMIT 50
```

Then read each `tx_id` on the chain layer. Its sender is the real buyer:

```cypher
USE chain
MATCH (t:Transaction {tx_id: "<tx_id>"}) RETURN t.from_address, t.block_timestamp, t.status
```

What the buyer paid: the facts read from the router to the starting pool on
the same day. It moved VIRTUAL.

## C. Cartel

### C1. Earliest receivers of a starting pool: the snipers

```cypher
USE topology
MATCH (p:Address {address: "<starting pool>"})-[f:FLOWS_TO]->(b:Address)
WHERE NOT b:Protocol AND NOT b.address IN ["0x65050a9b7e5075a2ba5ced7b1b64ee66262c40dc", "0xd4ccbfa37e2f35611b3042e4096ad7a3459bd007", "0xca6395246b4382ba70f886526dd9a9de984f6081", "0x6d80b81d9fc56a7a839b1af9006eb49151961ce7"]
RETURN p.address AS from_address, b.address AS to_address, f.tx_count AS tx_count,
       f.first_seen_timestamp AS first_seen_timestamp, f.last_seen_timestamp AS last_seen_timestamp
ORDER BY f.first_seen_timestamp ASC LIMIT 25
```

### C2. Wallets that bought into two agents

```cypher
USE topology
MATCH (p1:Address {address: "<pool a>"})-[:FLOWS_TO]->(w:Address)<-[:FLOWS_TO]-(p2:Address {address: "<pool b>"})
WHERE NOT w.address IN ["0x65050a9b7e5075a2ba5ced7b1b64ee66262c40dc", "0xca6395246b4382ba70f886526dd9a9de984f6081"]
RETURN DISTINCT w.address AS shared_buyer LIMIT 25
```

### C3. Funders shared by a list of buyers (up to 25)

```cypher
USE topology
MATCH (s:Address)-[f:FLOWS_TO]->(b:Address)
WHERE b.address IN ["<buyer 1>", "<buyer 2>"] AND NOT s:Pool AND NOT s:Protocol AND NOT s:System
  AND NOT s.address IN ["0x65050a9b7e5075a2ba5ced7b1b64ee66262c40dc", "0xca6395246b4382ba70f886526dd9a9de984f6081"]
RETURN s.address AS funder, count(DISTINCT b.address) AS buyers_funded, sum(f.amount_usd_sum) AS usd
ORDER BY buyers_funded DESC, usd DESC LIMIT 10
```

A shared funder with 0 USD sent tokens without a price: often spam
airdrops. Weigh the funders that sent value.

### C4. Funders shared by two creators

```cypher
USE topology
MATCH (a:Address {address: "<creator a>"})<-[:FLOWS_TO]-(c:Address)-[:FLOWS_TO]->(b:Address {address: "<creator b>"})
WHERE NOT c:Pool AND NOT c:Protocol AND NOT c:System AND c.is_exchange IS NULL
RETURN DISTINCT c.address AS shared_funder LIMIT 25
```

### C5. Ownership links the graph already holds

```cypher
USE topology
MATCH (a:Address {address: "<wallet>"})-[l:LINKED]-(b:Address)
RETURN b.address AS linked_address, l.basis AS basis, l.confidence AS confidence LIMIT 25
```

## Worked cases (2026-10-18)

| Case | What the queries found |
|---|---|
| Mass creator `0x384d92776496bce2c6f08d5b8e015eae498e78b3` | 12,282 of about 26,200 agents (A1). First funded with 0.00999 ETH bridged from Base (A3, A4). Kept about 6,060 USD of about 261,300 USD received (A5). 9 swaps, no liquidity removed: no rug. |
| Five random agents of that creator | All five never traded beyond dust (B3). |
| BIBEL, starting pool `0x09e9df72f639875b58dbfd356e31c47b0b87f65b` | Three holders: the pool and two wallets that bought in the same second through the router (B4). Both share the funder `0xca7ded7e4f4ba8ab3b10009236ae6d1b95094589` (C3). |
| VEX, Uniswap pair `0x817f16f5d8da83d1b089b082c0172af3923618da` | Seeded with about 23,225 USD by the token contract, never removed (B1). 82.8M USD volume. The creator `0x32e7c4afea4f868a53ec51435c92ed80625eeb33` only bought VEX (B2). |
