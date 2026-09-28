import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  isFlowsToTrace,
  markdownQueries,
  proseQueries,
  traceHopsWithoutSwapped,
  unguardedPoolWalks,
} from './support/pool-walk-guard.js'

const root = process.cwd()

function read(path: string): string {
  return readFileSync(join(root, path), 'utf8')
}

function expectNoRetiredHostedMcpHost(content: string): void {
  expect(content).not.toMatch(/(^|[^a-z0-9-])staging-mcp\.chain-insights\.ai(?=\/|[\s`'")\]}]|$)/i)
}

function retiredName(head: string, tail: string): string {
  return `${head}${tail}`
}

// Every Markdown page under dir, recursively.
function markdownFiles(dir: string): string[] {
  return readdirSync(join(root, dir), { withFileTypes: true }).flatMap((entry) => {
    const path = `${dir}/${entry.name}`
    if (entry.isDirectory()) return markdownFiles(path)
    return entry.name.endsWith('.md') ? [path] : []
  })
}

// The graph hints the MCP server serves, as the running server joins them.
function servedGraphHints(): string {
  const source = read('src/mcp/proxy.ts')
  const start = source.indexOf('const GRAPH_SCHEMA_HINTS = [')
  const end = source.indexOf("].join('\\n')", start)
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  const literal = source.slice(source.indexOf('[', start), end + 1)
  return (new Function(`return ${literal}`)() as string[]).join('\n')
}

// The guarded route contract (ruled 2026-09-28): the only route and
// open-target shapes served, with $from, $to and $addr the only variables.
function routeContractShapes(): string[] {
  const walk =
    '(()-[:FLOWS_TO|SWAPPED]-(via:Address) WHERE NOT via:Pool){0,4} ()-[:FLOWS_TO|SWAPPED]-'
  return [
    ...['SHORTEST 1', 'ANY SHORTEST', 'ALL SHORTEST'].map(
      (selector) =>
        `MATCH p = ${selector} (a:Address {address: $from} WHERE NOT a:Pool) ${walk}(b:Address {address: $to})`
    ),
    `MATCH SHORTEST 1 (a:Address {address: $addr} WHERE NOT a:Pool) ${walk}(b:Address)`,
  ]
}

// The contract shapes as patterns, with a literal address allowed in place of
// a parameter.
function contractShapePatterns(): RegExp[] {
  return routeContractShapes().map(
    (shape) =>
      new RegExp(
        `^${shape
          .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          .replace(/\\\$(from|to|addr)\b/g, (_, name: string) => `(?:\\$${name}|"[^"]*")`)}$`
      )
  )
}

// A walk with a quantifier: a SHORTEST selector, a legacy shortest-path
// function, a quantified path pattern or relationship ({m,n}, + or *), or a
// legacy variable-length relationship.
const QUANTIFIED =
  /SHORTEST|shortestPath|allShortestPaths|\)\s*(\{\s*\d*\s*,?\s*\d*\s*\}|\+|\*(?=\s*\())|\]\s*-\s*>?\s*(\{\s*\d*\s*,?\s*\d*\s*\}|\+|\*)|\[[^\]]*\*[^\]]*\]/i

// The walk of a served route or open target: a quantified FLOWS_TO trace, from
// an address anchored in any form the pool check reads (an inline map, or an
// address predicate in the node's own WHERE or in the clause), or on a
// shortest-path search. Everything before RETURN, spaces squashed.
function routeWalk(query: string): string | null {
  const walk = query
    .replace(/\s+/g, ' ')
    .replace(/^\s*USE \w+ /, '')
    .split(/ RETURN\b/)[0]
    ?.trim()
  if (!walk || !QUANTIFIED.test(walk) || !isFlowsToTrace(query)) return null
  return walk
}

const reviewedSkills = [
  'chain-insights-address-risk',
  'chain-insights-cypher',
  'chain-insights-schema-bittensor',
  'chain-insights-schema-evm',
]

describe('shipped Chain Insights skills contract', () => {
  it('ships exactly the reviewed public skill directories', () => {
    const actual = readdirSync(join(root, 'skills'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()

    expect(actual).toEqual(reviewedSkills)
  })

  it('teaches schema plus ISO GQL and excludes stale product guidance', () => {
    const evm = read('skills/chain-insights-schema-evm/SKILL.md')
    const bittensor = read('skills/chain-insights-schema-bittensor/SKILL.md')
    const cypher = read('skills/chain-insights-cypher/SKILL.md')
    const addressRisk = read('skills/chain-insights-address-risk/SKILL.md')

    expect(evm).toMatch(/label|relationship|property/i)
    expect(bittensor).toMatch(/Bittensor/i)
    expect(cypher).toMatch(/ISO GQL/i)
    expect(cypher).toContain('graph_query')
    expect(addressRisk).toContain('aml_address_risk')
    expect(addressRisk).toContain('meta_network_capabilities')
    expect(addressRisk).toContain('network=robinhood')
    expect(addressRisk).toContain('compare_address')
    expect(addressRisk).toContain('cia workflows')
    expect(addressRisk).toContain('cia workflow aml-address-risk')
    expect(cypher).toContain('cia mcp call graph_query')

    const content = [evm, bittensor, cypher, addressRisk].join('\n')
    expect(content).not.toMatch(/workspace|debug MCP/i)
    expect(bittensor).not.toMatch(/public hosted MCP|mcp\.chain-insights\.ai/i)
  })

  it('documents the OPERATED_BY owner-to-operator topology edge as topology-only and never as an automatic risk label', () => {
    const evmSkill = read('skills/chain-insights-schema-evm/SKILL.md')
    const graphTools = read('docs/graph-tools.md')
    const compatibility = read('docs/graph-query-compatibility.md')
    const combined = [evmSkill, graphTools, compatibility].join('\n')

    // The relationship is named across the shipped surfaces, including the
    // runtime MCP instructions and the dialect skill agents load first.
    for (const surface of [evmSkill, graphTools, compatibility]) {
      expect(surface).toContain('OPERATED_BY')
    }
    expect(read('skills/chain-insights-cypher/SKILL.md')).toContain('`OPERATED_BY`')
    expect(read('src/mcp/proxy.ts')).toContain('(:Address)-[:OPERATED_BY]->(:Address)')
    expect(read('src/workspace/init.ts')).toContain('operated_by_sample')
    expect(read('src/workspace/init.ts')).toContain('OPERATED_BY]->(operator:Address {address:')

    // The documented direction is owner to operator.
    expect(evmSkill).toContain('(:Address)-[:OPERATED_BY]->(:Address)')
    expect(combined).toMatch(/source is the (transfer )?owner/i)
    expect(combined).toMatch(/destination is the approved operator/i)

    // The relation is topology only — never served through USE facts, on any
    // variable spelling, and named in the facts-rejection enumerations.
    expect(combined).not.toMatch(/USE facts MATCH[^"\n]*OPERATED_BY/)
    expect(read('skills/chain-insights-cypher/SKILL.md')).toMatch(
      /Facts rejects[^.\n]*`OPERATED_BY`/
    )

    // The canonical probe is pinned on the shipped recipe fixture: anchored
    // by an exact operator address, projecting the aggregate contract, and
    // bounded by LIMIT. The graph-tools CLI example carries the same anchor.
    const recipes = JSON.parse(read('tests/fixtures/documented-recipes.json')) as {
      recipes: { id: string; query: string; layer: string }[]
    }
    const probe = recipes.recipes.find((r) => r.id === 'recipe_topology_operated_by_01')
    expect(probe).toBeDefined()
    expect(probe!.layer).toBe('topology')
    expect(probe!.query).toContain(
      'MATCH (owner:Address)-[operation:OPERATED_BY]->(operator:Address {address: "0x'
    )
    expect(probe!.query).toContain('ORDER BY operation.tx_count DESC LIMIT 10')
    expect(probe!.query).toContain('coalesce(operation.token_standard, "mixed")')
    expect(graphTools).toMatch(
      /MATCH \(owner:Address\)-\[operation:OPERATED_BY\]->\(operator:Address \{address: \\?"0x/
    )

    // The shipped batch examples carry the named probe, anchored.
    expect(graphTools).toContain('"id":"operated_by_sample"')
    expect(graphTools).toContain('OPERATED_BY]->(operator:Address {address:')

    // The unanchored sweep scopes both endpoints by the network property.
    expect(compatibility).toMatch(
      /MATCH \(owner:Address\)-\[operation:OPERATED_BY\]->\(operator:Address\)[\s\S]{0,200}WHERE owner\.network = "robinhood"[\s\S]{0,200}AND operator\.network = "robinhood"/
    )

    // The text never describes the relation as a risk signal, in any of the
    // phrasings a doc edit would realistically introduce.
    expect(combined).not.toMatch(
      /OPERATED_BY[^.\n]{0,80}(risk (label|signal|verdict)|drainer|scam (label|signal))/i
    )
    expect(evmSkill).toMatch(/not proof of malicious intent/i)
    expect(read('src/mcp/proxy.ts')).toContain('not a risk label')
  })

  it('documents topology LINKED ownership-overlay probes wherever schema probes are shipped (LINKED is topology-only)', () => {
    const readme = read('README.md')
    const graphTools = read('docs/graph-tools.md')
    const cypherSkill = read('skills/chain-insights-cypher/SKILL.md')
    const evmSkill = read('skills/chain-insights-schema-evm/SKILL.md')
    const bittensorSkill = read('skills/chain-insights-schema-bittensor/SKILL.md')
    const combined = [readme, graphTools, cypherSkill, evmSkill, bittensorSkill].join('\n')

    expect(combined).toContain('linked_sample')
    expect(combined).toContain('USE topology MATCH (a:Address)-[l:LINKED]-(b:Address)')
    expect(combined).not.toContain('USE facts MATCH (a:Address)-[l:LINKED]-(b:Address)')
    expect(combined).toContain('b.address AS linked_address')
  })

  it('keeps README product-first and moves debug/client detail to focused docs', () => {
    const readme = read('README.md')
    const mcpProxy = read('docs/mcp-proxy.md')
    const packageJson = read('package.json')

    expect(readme).toContain('open-source AML and forensics infrastructure')
    expect(readme).toContain('https://chain-insights.ai')
    expect(readme).toContain('https://www.npmjs.com/package/chain-insights')
    expect(readme).toContain('[![npm version](https://img.shields.io/npm/v/chain-insights)]')
    expect(readme).toContain('[![CI](https://img.shields.io/github/actions/workflow/status/')
    expect(readme).toContain('[![OpenSSF Scorecard](https://img.shields.io/ossf-scorecard/')
    expect(readme).toContain('[![License](https://img.shields.io/npm/l/chain-insights)]')
    const prose = readme
      .split('\n')
      .filter((line) => !line.startsWith('[!['))
      .join('\n')
    expect(prose).not.toContain('chainswarm/chain-insights')
    expect(readme).not.toContain('[GitHub](')
    expect(readme).toContain('Chain Insights Graph')
    expect(readme).toContain('cia config set graphMcpEndpoint https://mcp.chain-insights.ai/')
    expect(readme).toContain('CHAIN_INSIGHTS_GRAPH_MCP_ENDPOINT=https://mcp.chain-insights.ai/')
    expect(readme).toMatch(/Do not\s+add `\/mcp`/)
    expect(readme).toContain('http://127.0.0.1:8012/mcp')
    expect(readme).toContain('approved access key')
    expect(readme).toContain('prepared wallet')
    expect(readme).toContain('[MCP proxy](docs/mcp-proxy.md)')
    expect(readme).toContain('aml_address_risk')
    expect(readme).toContain('graph_query')
    expect(readme).toContain('graph_query_batch')

    expect(readme).toContain('`topology`')
    expect(readme).toContain('`facts`')
    expect(readme).toContain('tx_out_count')
    expect(readme).not.toContain('sent_count')
    expect(readme).toContain('cia mcp networks')
    expect(readme).toContain('cia mcp tools --refresh')
    expect(readme).toContain('cia workflows')
    expect(readme).toContain('cia workflow aml-address-risk')
    expect(readme).toContain('docs/contributing.md')
    expect(readme).toContain('docs/debugging.md')

    expect(readme).not.toContain('Claude Desktop')
    expect(readme).not.toContain(`${retiredName('Graph', 'RAG')}`)
    expect(readme).not.toContain('x402')
    expect(readme).not.toContain('Base USDC')
    expect(readme).not.toContain('USDC on Base')
    expect(readme).not.toContain('paid hosted')
    expect(readme).not.toContain('Memgraph')
    expect(readme).not.toContain('StarRocks')
    expect(readme).not.toContain('chain-insights debug on')
    expect(readme).not.toContain('GRAPH_MCP_GO_DEBUG_BYPASS')
    expect(readme).not.toContain('Release rules:')

    expect(packageJson).not.toContain('x402-paid')
    expect(mcpProxy).toContain('https://mcp.chain-insights.ai/')
    expect(mcpProxy).toContain(
      'The endpoint lives in Chain Insights config, not in the MCP client registration.'
    )
    expect(mcpProxy).toMatch(/MCP client JSON does not carry\s+the endpoint/)
    expect(mcpProxy).toContain('x402')
    expect(readme + mcpProxy + read('docs/architecture.md')).toContain(
      'https://mcp.chain-insights.ai/'
    )
  })

  it('uses hosted Chain Insights Graph by default and preserves local development overrides', () => {
    const runtimeSources = [
      'src/config/mcp-endpoint.ts',
      'src/config/schema.ts',
      'src/config/index.ts',
      'src/workspace/init.ts',
    ]
      .map(read)
      .join('\n')

    expect(runtimeSources).toContain('https://mcp.chain-insights.ai/')
    expect(runtimeSources).toContain('http://127.0.0.1:8012/mcp')
    expectNoRetiredHostedMcpHost(runtimeSources)
  })

  it('ships Chain Insights developer docs for AML tool contributors', () => {
    const contributing = read('docs/contributing.md')
    const debugging = read('docs/debugging.md')
    const development = read('docs/development.md')

    expect(contributing).toContain('Adding AML Tools')
    expect(contributing).toContain('npm run release:check')
    expect(debugging).toContain('Chain Insights Graph')
    expect(debugging).toContain('Inspector')
    expect(development).toContain('docs/contributing.md')
    expect(development).toContain('docs/debugging.md')
  })

  it('ships ISO GQL guidance without a query cookbook', () => {
    const skill = read('skills/chain-insights-cypher/SKILL.md')
    const openai = read('skills/chain-insights-cypher/agents/openai.yaml')
    const graphTools = read('docs/graph-tools.md')
    const mcpProxy = read('docs/mcp-proxy.md')

    expect(skill).toContain('graph_query')
    expect(skill).toContain('graph_query_batch')
    expect(skill).toContain('USE topology')
    expect(skill).toContain('USE facts')
    expect(skill).toContain('ISO GQL')
    expect(skill).not.toContain('AddressFeature')
    expect(skill).not.toContain('AddressLabel')
    expect(skill).not.toContain('HAS_LABEL')
    expect(skill).not.toContain('HAS_RISK_SCORE')
    expect(skill).not.toContain('sent_count')
    expect(skill).not.toContain('references/memgraph-examples.md')
    expect(skill).not.toContain('docs/graph-query-compatibility.md')
    expect(openai).toContain('Chain Insights Cypher')
    expect(graphTools).toContain('chain-insights-cypher')
    expect(graphTools).toContain('chain-insights-address-risk')
    expect(graphTools).toContain('chain-insights-schema-evm')
    expect(graphTools).toContain('chain-insights-schema-bittensor')
    expect(graphTools).not.toContain('chain-insights-bittensor-cypher')
    expect(graphTools).not.toContain('references/memgraph-examples.md')
    expect(mcpProxy).toContain('chain-insights-cypher')
    expect(mcpProxy).toContain('chain-insights-address-risk')
    expect(mcpProxy).toContain('chain-insights-schema-evm')
    expect(mcpProxy).toContain('chain-insights-schema-bittensor')
    expect(mcpProxy).not.toContain('chain-insights-bittensor-cypher')
    expect(mcpProxy).not.toContain('Memgraph examples reference')
  })

  it('states the pool trace rule once and every shipped trace obeys it', () => {
    const evmSkill = read('skills/chain-insights-schema-evm/SKILL.md')
    const cypherSkill = read('skills/chain-insights-cypher/SKILL.md')
    const graphTools = read('docs/graph-tools.md')
    const proxy = read('src/mcp/proxy.ts')
    const runtimeSkill = read('src/workspace/init.ts')
    const squash = (text: string) => text.replace(/\s+/g, ' ').trim()

    // The rule's one home: four numbered steps under "## Pool trace rule".
    const section = evmSkill.split('## Pool trace rule\n')[1]?.split('\n## ')[0] ?? ''
    const steps = section
      .split(/\n(?=\d\. )/)
      .filter((part) => /^\d\. /.test(part))
      .map((part) => squash(part.split('\n\n')[0]))
    expect(steps).toEqual([
      '1. Enter a `:Pool` on any edge.',
      '2. Leave a `:Pool` only on `REMOVED_LIQUIDITY`, to the address the liquidity was paid to.',
      '3. Never leave a `:Pool` on `FLOWS_TO`.',
      '4. Across a swap, follow `SWAPPED` from payer to recipient, between two different addresses. Do not walk through the pool.',
    ])

    // MCP clients load no skill, so the served hints carry the same steps word for word.
    for (const step of steps) expect(squash(proxy)).toContain(step)

    // Every other surface points at the rule and never restates it.
    const restated = /Leave a `:Pool` only on `REMOVED_LIQUIDITY`/
    for (const surface of [cypherSkill, graphTools, runtimeSkill]) {
      expect(surface).toMatch(/pool trace rule/i)
      expect(surface).toContain('chain-insights-schema-evm')
      expect(surface).not.toMatch(restated)
    }
    expect(evmSkill.match(new RegExp(restated, 'g'))).toHaveLength(1)

    // The graph tools guide says where the rule lives and that MCP clients get the same text.
    expect(squash(graphTools)).toContain(
      'The rule is stated once, in the [`chain-insights-schema-evm` skill]'
    )
    expect(squash(graphTools)).toContain(
      'The MCP server instructions serve the same four steps, word for word, because an MCP client loads no skill. A test keeps the two equal.'
    )

    // The retired swap stamp and the retired DEX bookkeeping nodes are gone.
    for (const surface of [evmSkill, cypherSkill, graphTools, proxy, runtimeSkill]) {
      expect(surface).not.toMatch(/swap\.(kind|family|deployment|pool|reason|route_id)/)
      expect(surface).not.toMatch(/Dex(Transaction|Route|PoolFact|PairContribution)/)
    }
    expect(evmSkill).toContain('(:Pool)-[:REMOVED_LIQUIDITY]->(:Address)')
    expect(evmSkill).toContain('(:Address)-[:SWAPPED]->(:Address)')
    expect(evmSkill).toContain('(:Address)-[:BRIDGED]->(:Chain)')
    for (const rel of ['SWAP', 'LIQUIDITY_ADD', 'LIQUIDITY_REMOVE', 'BRIDGE_CROSSING']) {
      expect(evmSkill).toContain(`:${rel}]->`)
    }

    const recipes = JSON.parse(read('tests/fixtures/documented-recipes.json')) as {
      recipes: { id: string; query: string; layer: string }[]
    }

    // The rug-pull recipe enters a pool and leaves it only on a removal.
    const rugPull = recipes.recipes.find((r) => r.id === 'recipe_topology_pool_rug_pull_01')
    expect(rugPull?.layer).toBe('topology')
    expect(rugPull?.query).toMatch(
      /-\[paid:FLOWS_TO\]->\(pool:Pool\)-\[removal:REMOVED_LIQUIDITY\]->\(receiver:Address\)/
    )
    expect(rugPull?.query).toContain(
      'removal.usd - removal.receiver_added_usd AS receiver_profit_usd'
    )
    expect(rugPull?.query).toContain('WHERE NOT victim:Pool AND')

    // The no-fan-out recipe keeps pools out of the FLOWS_TO walk and passes one
    // only on REMOVED_LIQUIDITY.
    const noFanOut = recipes.recipes.find((r) => r.id === 'recipe_topology_pool_no_fan_out_01')
    expect(noFanOut?.layer).toBe('topology')
    const [walk, throughPool] = (noFanOut?.query ?? '').split(' UNION ')
    expect(walk).toContain('NOT src:Pool AND NOT mid:Pool')
    expect(throughPool).toMatch(/\(mid:Pool\)-\[r2:REMOVED_LIQUIDITY\]->\(dst:Address\)/)
    expect(throughPool).toContain('WHERE NOT src:Pool AND')
  })

  it('guards every served FLOWS_TO walk against pools: never from one, never through one', () => {
    // Every surface an agent or an MCP client reads a query from.
    const surfaces: { name: string; queries: string[] }[] = [
      {
        name: 'tests/fixtures/documented-recipes.json',
        queries: (
          JSON.parse(read('tests/fixtures/documented-recipes.json')) as {
            recipes: { query: string }[]
          }
        ).recipes.map((r) => r.query),
      },
      { name: 'src/mcp/proxy.ts graph hints', queries: proseQueries(servedGraphHints()) },
    ]
    const markdown = [
      'README.md',
      ...readdirSync(join(root, 'skills')).map((skill) => `skills/${skill}/SKILL.md`),
      ...markdownFiles('docs'),
    ]
    for (const path of markdown) surfaces.push({ name: path, queries: markdownQueries(read(path)) })

    const violations = surfaces.flatMap(({ name, queries }) =>
      queries.flatMap((query) => unguardedPoolWalks(query).map((v) => `${name}: ${v}\n  ${query}`))
    )
    expect(violations).toEqual([])

    // A trace follows SWAPPED beside FLOWS_TO (step 4 of the rule), so the
    // guard never cuts it off at a swap.
    const withoutSwapped = surfaces.flatMap(({ name, queries }) =>
      queries.flatMap((query) =>
        traceHopsWithoutSwapped(query).map((v) => `${name}: ${v}\n  ${query}`)
      )
    )
    expect(withoutSwapped).toEqual([])

    // The guarded route contract: every served route and open-target walk (a
    // quantified FLOWS_TO trace, see routeWalk) is exactly one of these
    // shapes, with a literal address allowed in place of a parameter.
    const shapes = routeContractShapes()
    const shapePatterns = contractShapePatterns()
    const routeWalks = surfaces.flatMap(({ name, queries }) =>
      queries.flatMap((query) => {
        const walk = routeWalk(query)
        return walk ? [{ name, walk }] : []
      })
    )
    const offContract = routeWalks
      .filter(({ walk }) => !shapePatterns.some((pattern) => pattern.test(walk)))
      .map(({ name, walk }) => `${name}: ${walk}`)
    expect(offContract).toEqual([])
    // Every contract shape is served: the cypher skill carries the route and
    // the open target verbatim, and the documented recipes carry all four.
    const cypherSkill = read('skills/chain-insights-cypher/SKILL.md')
    expect(cypherSkill).toContain(shapes[0])
    expect(cypherSkill).toContain(shapes[3])
    for (const [i, pattern] of shapePatterns.entries()) {
      expect(
        routeWalks.some(
          ({ name, walk }) =>
            name === 'tests/fixtures/documented-recipes.json' && pattern.test(walk)
        ),
        `no documented recipe serves ${shapes[i]}`
      ).toBe(true)
    }
  })

  it('the pool-guard check recognises every walk shape it must refuse', () => {
    const walk =
      '(()-[:FLOWS_TO|SWAPPED]-(via:Address) WHERE NOT via:Pool){0,4} ()-[:FLOWS_TO|SWAPPED]-'
    const [route, anyRoute, allRoute, openTarget] = routeContractShapes()
    const A = '"5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY"'
    const B = '"5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty"'
    const middle = (node: string) =>
      `${node} is in the middle of a FLOWS_TO walk without the pool guard`
    const start = (node: string) => `${node} starts a FLOWS_TO walk without the pool guard`
    const pool = (node: string) => `${node} is a :Pool the walk leaves on FLOWS_TO`

    // Each planted walk is refused, and for the reason named beside it.
    const refused: Record<string, [string, string]> = {
      // The served recipes as they stood before the pool guard.
      cypher_skill_route: [
        'MATCH p = SHORTEST 1 (a:Address {address: $from})-[:FLOWS_TO]-{0,5}(b:Address {address: $to}) RETURN [n IN nodes(p) | n.address] AS route',
        middle('()'),
      ],
      cypher_skill_open_target: [
        'MATCH SHORTEST 1 (a:Address {address: $addr})-[:FLOWS_TO]-{1,5}(b:Address) RETURN b.address LIMIT 50',
        middle('()'),
      ],
      recipe_topology_12: [
        `USE topology MATCH (src:Address {address: ${A}})-[r1:FLOWS_TO]->(mid:Address)-[r2:FLOWS_TO]->(dst:Address) WHERE mid.is_exchange IS NULL RETURN src.address AS from_address LIMIT 25`,
        middle('(mid)'),
      ],
      recipe_topology_15: [
        `USE topology MATCH p = (a:Address {address: ${A}})-[:FLOWS_TO]-{1,5}(b:Address {address: ${B}}) RETURN p LIMIT 3`,
        middle('()'),
      ],
      recipe_topology_16: [
        `USE topology MATCH path = SHORTEST 1 (src:Address {address: ${A}})-[:FLOWS_TO]-{1,5}(dst:Address {address: ${B}}) RETURN path LIMIT 5`,
        middle('()'),
      ],
      recipe_topology_17: [
        `USE topology MATCH path = ANY SHORTEST (src:Address {address: ${A}})-[:FLOWS_TO]-{1,5}(dst:Address {address: ${B}}) RETURN path LIMIT 5`,
        middle('()'),
      ],
      recipe_topology_18: [
        `USE topology MATCH path = ALL SHORTEST (src:Address {address: ${A}})-[:FLOWS_TO]-{1,5}(dst:Address {address: ${B}}) RETURN path LIMIT 3`,
        middle('()'),
      ],
      recipe_topology_20: [
        `USE topology MATCH (a:Address {address: ${A}})-[l:LINKED]-(owned:Address)-[r:FLOWS_TO]-(b:Address) WHERE owned.address <> b.address AND a.address <> b.address RETURN b.address LIMIT 25`,
        middle('(owned)'),
      ],
      // The served shapes before the start guard (ruled 2026-09-28): a walk
      // may end at a pool, never start at one.
      route_without_the_start_guard: [
        `MATCH p = SHORTEST 1 (a:Address {address: $from}) ${walk}(b:Address {address: $to}) RETURN [n IN nodes(p) | n.address] AS route`,
        start('(a)'),
      ],
      open_target_without_the_start_guard: [
        `MATCH SHORTEST 1 (a:Address {address: $addr}) ${walk}(b:Address) RETURN b.address LIMIT 50`,
        start('(a)'),
      ],
      any_shortest_recipe_without_the_start_guard: [
        `USE topology MATCH path = ANY SHORTEST (src:Address {address: ${A}}) ${walk}(dst:Address {address: ${B}}) RETURN path LIMIT 5`,
        start('(src)'),
      ],
      all_shortest_recipe_without_the_start_guard: [
        `USE topology MATCH path = ALL SHORTEST (src:Address {address: ${A}}) ${walk}(dst:Address {address: ${B}}) RETURN path LIMIT 3`,
        start('(src)'),
      ],
      unselected_route_without_the_start_guard: [
        `USE topology MATCH p = (a:Address {address: ${A}}) ${walk}(b:Address {address: ${B}}) RETURN p LIMIT 3`,
        start('(a)'),
      ],
      start_guard_after_the_selector: [
        `MATCH p = SHORTEST 1 (a:Address {address: $from}) ${walk}(b:Address {address: $to}) WHERE NOT a:Pool RETURN p`,
        start('(a)'),
      ],
      rug_pull_without_the_start_guard: [
        'MATCH (victim:Address {address: $addr})-[paid:FLOWS_TO]->(pool:Pool)-[removal:REMOVED_LIQUIDITY]->(receiver:Address) WHERE receiver.address <> victim.address RETURN receiver.address LIMIT 25',
        start('(victim)'),
      ],
      one_hop_from_an_address: [
        'MATCH (src:Address {address: $addr})-[flow:FLOWS_TO]->(dst:Address) RETURN dst.address LIMIT 50',
        start('(src)'),
      ],
      one_hop_back_from_an_address: [
        'MATCH (a:Address {address: $addr})<-[:FLOWS_TO]-(src:Address) RETURN src.address LIMIT 50',
        start('(a)'),
      ],
      none_over_the_inside_leaves_the_start: [
        'MATCH p = (a:Address {address: $from})-[:FLOWS_TO]-{1,5}(b:Address {address: $to}) WHERE NONE(n IN nodes(p)[1..-1] WHERE n:Pool) RETURN p LIMIT 3',
        start('(a)'),
      ],
      starts_at_a_labelled_pool: [
        'MATCH (p:Pool {address: $pool})-[:FLOWS_TO]->(t:Address) RETURN t.address LIMIT 25',
        pool('(p)'),
      ],
      lists_a_pools_payouts: [
        'MATCH (p:Pool)-[:FLOWS_TO]->(t:Address) RETURN t.address LIMIT 25',
        pool('(p)'),
      ],
      lists_a_pools_counterparties_either_way: [
        'MATCH (t:Address)-[:FLOWS_TO]-(p:Pool) RETURN t.address LIMIT 25',
        pool('(p)'),
      ],
      // Walk shapes the check reads.
      reverse_arrow: [
        'MATCH (a:Address {address: $addr})<-[:FLOWS_TO]-(mid:Address)<-[:FLOWS_TO]-(src:Address) RETURN src.address LIMIT 25',
        middle('(mid)'),
      ],
      unlabelled_middle: [
        'MATCH (a:Address {address: $addr})-[:FLOWS_TO]->()-[:FLOWS_TO]->(b:Address) RETURN b.address LIMIT 25',
        middle('()'),
      ],
      untyped_relationships: [
        'MATCH (a:Address {address: $addr})-->(mid)-->(b) RETURN b.address LIMIT 25',
        middle('(mid)'),
      ],
      leaves_a_pool: [
        'MATCH (v:Address {address: $addr})-[:FLOWS_TO]->(p:Pool)-[:FLOWS_TO]->(t:Address) RETURN t.address LIMIT 25',
        pool('(p)'),
      ],
      guard_after_the_selector: [
        'MATCH p = SHORTEST 1 (a:Address {address: $from})-[:FLOWS_TO]-{0,5}(b:Address {address: $to}) WHERE NONE(n IN nodes(p)[1..-1] WHERE n:Pool) RETURN p',
        middle('()'),
      ],
      quantified_path_without_guard: [
        'MATCH p = SHORTEST 1 (a:Address {address: $from} WHERE NOT a:Pool) (()-[:FLOWS_TO]-(via:Address)){0,4} ()-[:FLOWS_TO]-(b:Address {address: $to}) RETURN p',
        middle('(via)'),
      ],
      anchored_on_the_right: [
        'MATCH (exchange:Address)-[r1:FLOWS_TO]->(n1:Address)-[r2:FLOWS_TO]->(a:Address) WHERE a.address = "0x1" RETURN n1.address LIMIT 25',
        middle('(n1)'),
      ],
      anchored_by_an_in_list: [
        'MATCH (a:Address)-[:FLOWS_TO]->(b:Address) WHERE a.address IN ["0x1", "0x2"] RETURN b.address LIMIT 25',
        start('(a)'),
      ],
      split_across_match_clauses: [
        'MATCH (a:Address {address: $addr})-[:FLOWS_TO]->(m:Address) MATCH (m)-[:FLOWS_TO]->(b:Address) RETURN b.address LIMIT 25',
        middle('(m)'),
      ],
      split_across_with: [
        'MATCH (a:Address {address: $addr})-[:FLOWS_TO]->(m:Address) WITH m MATCH (m)-[:FLOWS_TO]->(b:Address) RETURN b.address LIMIT 25',
        middle('(m)'),
      ],
      renamed_by_with: [
        'MATCH (a:Address {address: $addr})-[:FLOWS_TO]->(m:Address) WITH m AS mid MATCH (mid)-[:FLOWS_TO]->(b:Address) RETURN b.address LIMIT 25',
        middle('(m/mid)'),
      ],
      guard_on_a_new_variable_after_with: [
        'MATCH (a:Address {address: $addr})-[:FLOWS_TO]->(m:Address)-[:FLOWS_TO]->(b:Address) WITH b MATCH (m:Address) WHERE NOT m:Pool RETURN b.address LIMIT 25',
        middle('(m)'),
      ],
      split_across_optional_match: [
        'MATCH (a:Address {address: $addr}) OPTIONAL MATCH (a)-[:FLOWS_TO]->(m:Address) OPTIONAL MATCH (m)-[:FLOWS_TO]->(b:Address) RETURN b.address LIMIT 25',
        middle('(m)'),
      ],
      comma_separated_patterns: [
        'MATCH (a:Address {address: $addr})-[:FLOWS_TO]->(m:Address), (m)-[:FLOWS_TO]->(b:Address) RETURN b.address LIMIT 25',
        middle('(m)'),
      ],
      guard_weakened_by_or: [
        'MATCH (a:Address {address: $addr})-[:FLOWS_TO]->(m:Address)-[:FLOWS_TO]->(b:Address) WHERE NOT m:Pool OR m.address IS NOT NULL RETURN b.address LIMIT 25',
        middle('(m)'),
      ],
      inner_guard_weakened_by_or: [
        'MATCH p = SHORTEST 1 (a:Address {address: $from} WHERE NOT a:Pool) (()-[:FLOWS_TO|SWAPPED]-(via:Address) WHERE NOT via:Pool OR via.is_exchange IS NULL){0,4} ()-[:FLOWS_TO|SWAPPED]-(b:Address {address: $to}) RETURN p',
        middle('(via)'),
      ],
      label_alternative: [
        'MATCH (a:Address {address: $addr})-[:FLOWS_TO]->(mid:Address|!Pool)-[:FLOWS_TO]->(b:Address) RETURN b.address LIMIT 25',
        middle('(mid)'),
      ],
      in_a_subquery: [
        'MATCH (a:Address {address: $addr}) RETURN COLLECT { MATCH (a)-[:FLOWS_TO]->(m:Address)-[:FLOWS_TO]->(b:Address) RETURN b.address } AS reached',
        middle('(m)'),
      ],
      one_union_branch_unguarded: [
        'MATCH (a:Address {address: $addr})-[:FLOWS_TO]->(m:Address)-[:FLOWS_TO]->(b:Address) WHERE NOT m:Pool RETURN b.address LIMIT 25 UNION MATCH (a:Address {address: $addr})-[:FLOWS_TO]->(m:Address)-[:FLOWS_TO]->(b:Address) RETURN b.address LIMIT 25',
        middle('(m)'),
      ],
      // Backquoted names (ruled 2026-09-28): `FLOWS_TO` is FLOWS_TO, `Pool` is Pool.
      backquoted_relationship_type: [
        'MATCH (a:Address {address: $addr} WHERE NOT a:Pool)-[:`FLOWS_TO`]->(mid:Address)-[:`FLOWS_TO`]->(b:Address) RETURN b.address LIMIT 25',
        middle('(mid)'),
      ],
      backquoted_type_in_a_union: [
        'MATCH p = SHORTEST 1 (a:Address {address: $from} WHERE NOT a:Pool) (()-[:`FLOWS_TO`|SWAPPED]-(via:Address)){0,4} ()-[:`FLOWS_TO`|SWAPPED]-(b:Address {address: $to}) RETURN p',
        middle('(via)'),
      ],
      backquoted_pool_left_on_flows_to: [
        'MATCH (v:Address {address: $addr} WHERE NOT v:Pool)-[:FLOWS_TO]->(p:`Pool`)-[:`FLOWS_TO`]->(t:Address) RETURN t.address LIMIT 25',
        pool('(p)'),
      ],
      // Pattern comprehensions (ruled 2026-09-28): a walk in a list.
      pattern_comprehension: [
        'MATCH (a:Address {address: $addr} WHERE NOT a:Pool) RETURN [(a)-[:FLOWS_TO|SWAPPED]->(mid:Address)-[:FLOWS_TO|SWAPPED]->(b:Address) | b.address] AS reached',
        middle('(mid)'),
      ],
      pattern_comprehension_in_with: [
        'MATCH (a:Address {address: $addr} WHERE NOT a:Pool) WITH a, [p = (a)-[:FLOWS_TO|SWAPPED*2..3]-(b:Address) | b.address] AS reached RETURN reached',
        middle('()'),
      ],
      pattern_comprehension_guard_weakened_by_or: [
        'MATCH (a:Address {address: $addr} WHERE NOT a:Pool) RETURN [(a)-[:FLOWS_TO|SWAPPED]->(m:Address)-[:FLOWS_TO|SWAPPED]->(b:Address) WHERE NOT m:Pool OR m.is_exchange IS NULL | b.address] AS reached',
        middle('(m)'),
      ],
      pattern_comprehension_from_an_unguarded_start: [
        'MATCH (a:Address {address: $addr}) RETURN [(a)-[:FLOWS_TO|SWAPPED]->(b:Address) | b.address] AS reached',
        start('(a)'),
      ],
      // Pattern predicates in WHERE (ruled 2026-09-28): a walk as a condition.
      pattern_predicate_in_where: [
        'MATCH (a:Address {address: $addr} WHERE NOT a:Pool), (b:Address) WHERE (a)-[:FLOWS_TO|SWAPPED]->(:Address)-[:FLOWS_TO|SWAPPED]->(b) RETURN b.address LIMIT 25',
        middle('()'),
      ],
      pattern_predicate_after_and: [
        'MATCH (a:Address {address: $addr} WHERE NOT a:Pool), (b:Address) WHERE b.is_exchange IS NULL AND (a)-[:FLOWS_TO|SWAPPED]->()-[:FLOWS_TO|SWAPPED]->(b) RETURN b.address LIMIT 25',
        middle('()'),
      ],
      pattern_predicate_in_exists: [
        'MATCH (a:Address {address: $addr} WHERE NOT a:Pool), (b:Address) WHERE exists((a)-[:FLOWS_TO|SWAPPED]->()-[:FLOWS_TO|SWAPPED]->(b)) RETURN b.address LIMIT 25',
        middle('()'),
      ],
      // The legacy path functions (ruled 2026-09-28).
      legacy_shortest_path: [
        'MATCH p = shortestPath((a:Address {address: $from})-[:FLOWS_TO|SWAPPED*1..5]-(b:Address {address: $to})) WHERE NOT a:Pool RETURN p',
        middle('()'),
      ],
      legacy_all_shortest_paths: [
        'MATCH p = allShortestPaths((a:Address {address: $from})-[:FLOWS_TO|SWAPPED*1..5]-(b:Address {address: $to})) WHERE NOT a:Pool RETURN p',
        middle('()'),
      ],
      legacy_shortest_path_from_an_unguarded_start: [
        'MATCH p = shortestPath((a:Address {address: $from})-[:FLOWS_TO|SWAPPED*1..5]-(b:Address {address: $to})) WHERE NONE(n IN nodes(p)[1..-1] WHERE n:Pool) RETURN p',
        start('(a)'),
      ],
      legacy_shortest_path_without_a_path_variable: [
        'MATCH shortestPath((a:Address {address: $from} WHERE NOT a:Pool)-[:`FLOWS_TO`*1..5]-(b:Address {address: $to})) RETURN b.address',
        middle('()'),
      ],
      // A start anchored in its own WHERE is a start (the round-3 skeptic).
      open_target_anchored_in_the_node_where: [
        `MATCH SHORTEST 1 (a:Address WHERE a.address = "0x1") ${walk}(b:Address) RETURN b.address LIMIT 50`,
        start('(a)'),
      ],
      route_anchored_in_the_node_where: [
        `MATCH p = SHORTEST 1 (a:Address WHERE a.address = "0x1") ${walk}(b:Address WHERE b.address = "0x2") RETURN p`,
        start('(a)'),
      ],
      anchor_wrapped_in_a_function: [
        `MATCH SHORTEST 1 (a:Address WHERE toLower(a.address) = toLower($addr)) ${walk}(b:Address) RETURN b.address LIMIT 50`,
        start('(a)'),
      ],
      anchor_by_an_address_prefix: [
        'MATCH (a:Address)-[:FLOWS_TO|SWAPPED]->(b:Address) WHERE a.address STARTS WITH "0x1" RETURN b.address LIMIT 25',
        start('(a)'),
      ],
      shortest_walk_with_no_anchor_the_check_reads: [
        `MATCH SHORTEST 1 (a:Address WHERE a.is_exchange = true) ${walk}(b:Address) RETURN b.address LIMIT 50`,
        start('(a)'),
      ],
      // Labels are case-sensitive: :pool and :POOL match no pool.
      pool_guard_in_lower_case: [
        'MATCH (src:Address {address: "0x1"})-[r1:FLOWS_TO|SWAPPED]->(mid:Address)-[r2:FLOWS_TO|SWAPPED]->(dst:Address) WHERE NOT src:pool AND NOT mid:pool RETURN dst.address LIMIT 25',
        middle('(mid)'),
      ],
      pool_guard_in_upper_case: [
        'MATCH (src:Address {address: "0x1"})-[r1:FLOWS_TO|SWAPPED]->(mid:Address)-[r2:FLOWS_TO|SWAPPED]->(dst:Address) WHERE NOT src:POOL AND NOT mid:POOL RETURN dst.address LIMIT 25',
        start('(src)'),
      ],
      none_guard_in_lower_case: [
        'MATCH p = shortestPath((a:Address {address: $from})-[:FLOWS_TO|SWAPPED*1..5]-(b:Address {address: $to})) WHERE NONE(n IN nodes(p) WHERE n:pool AND n <> b) RETURN p',
        middle('()'),
      ],
      // A FLOWS_TO walk leaves an address on any relationship: its start and
      // its middle carry the guard whatever the relationship, and a pool is
      // left only on REMOVED_LIQUIDITY.
      linked_hop_from_an_unguarded_start: [
        'MATCH (a:Address {address: "0x1"})-[l:LINKED]-(owned:Address)-[r:FLOWS_TO|SWAPPED]-(b:Address) WHERE NOT owned:Pool AND owned.address <> b.address AND a.address <> b.address RETURN b.address LIMIT 25',
        start('(a)'),
      ],
      pool_left_on_linked: [
        'MATCH (a:Pool {address: "0x1"})-[:LINKED]-(owned:Address)-[:FLOWS_TO]-(b:Address) WHERE NOT owned:Pool RETURN b.address LIMIT 25',
        '(a) is a :Pool the walk leaves on LINKED, not on REMOVED_LIQUIDITY',
      ],
      middle_left_on_linked: [
        'MATCH (a:Address {address: $addr} WHERE NOT a:Pool)-[:FLOWS_TO|SWAPPED]->(m:Address)-[:LINKED]-(b:Address) RETURN b.address LIMIT 25',
        middle('(m)'),
      ],
    }
    for (const [name, [query, reason]] of Object.entries(refused)) {
      expect(unguardedPoolWalks(query), name).toContain(reason)
    }

    const admitted: Record<string, string> = {
      route: `${route} RETURN p`,
      any_shortest_route: `${anyRoute} RETURN p`,
      all_shortest_route: `${allRoute} RETURN p`,
      open_target: `${openTarget} RETURN b.address LIMIT 50`,
      route_with_literal_addresses: `USE topology MATCH p = SHORTEST 1 (a:Address {address: ${A}} WHERE NOT a:Pool) ${walk}(b:Address {address: ${B}}) RETURN p LIMIT 5`,
      fixed_hop:
        'MATCH (src:Address {address: $addr})-[r1:FLOWS_TO]->(mid:Address)-[r2:FLOWS_TO]->(dst:Address) WHERE NOT src:Pool AND NOT mid:Pool RETURN dst.address LIMIT 25',
      label_expression:
        'MATCH (a:Address&!Pool {address: $addr})-[:FLOWS_TO]->(mid:Address&!Pool)-[:FLOWS_TO]->(b:Address) RETURN b.address LIMIT 25',
      out_on_a_removal:
        'MATCH (v:Address {address: $addr})-[:FLOWS_TO]->(p:Pool)-[:REMOVED_LIQUIDITY]->(r:Address) WHERE NOT v:Pool RETURN r.address LIMIT 25',
      ends_at_a_pool:
        'MATCH (v:Address {address: $addr})-[:FLOWS_TO]->(p:Pool) WHERE NOT v:Pool RETURN p.address LIMIT 25',
      none_without_a_selector:
        'MATCH p = (a:Address {address: $from})-[:FLOWS_TO]-{1,5}(b:Address {address: $to}) WHERE NONE(n IN nodes(p) WHERE n:Pool AND n <> b) RETURN p LIMIT 3',
      one_hop_listing:
        'MATCH (src:Address)-[flow:FLOWS_TO]->(dst:Address) RETURN dst.address LIMIT 10',
      listing_into_pools:
        'MATCH (v:Address)-[:FLOWS_TO]->(p:Pool) RETURN p.address, count(v) AS payers LIMIT 10',
      split_across_match_clauses:
        'MATCH (a:Address {address: $addr})-[:FLOWS_TO]->(m:Address) MATCH (m)-[:FLOWS_TO]->(b:Address) WHERE NOT a:Pool AND NOT m:Pool RETURN b.address LIMIT 25',
      guard_after_with:
        'MATCH (a:Address {address: $addr} WHERE NOT a:Pool)-[:FLOWS_TO]->(m:Address)-[:FLOWS_TO]->(b:Address) WITH m, b WHERE NOT m:Pool RETURN b.address LIMIT 25',
      comma_separated_patterns:
        'MATCH (a:Address {address: $addr})-[:FLOWS_TO]->(m:Address), (m)-[:FLOWS_TO]->(b:Address) WHERE NOT a:Pool AND m.is_exchange IS NULL AND NOT m:Pool RETURN b.address LIMIT 25',
      guard_among_and_terms:
        'MATCH (a:Address {address: $addr})-[:FLOWS_TO]->(m:Address)-[:FLOWS_TO]->(b:Address) WHERE (NOT a:Pool AND m.is_exchange IS NULL AND NOT m:Pool) AND b.address <> a.address RETURN b.address LIMIT 25',
      backquoted_names_with_their_guards:
        'MATCH (a:Address {address: $addr} WHERE NOT a:`Pool`)-[:`FLOWS_TO`]->(mid:Address)-[:`FLOWS_TO`]->(b:Address) WHERE NOT mid:`Pool` RETURN b.address LIMIT 25',
      pattern_comprehension_with_its_guard:
        'MATCH (a:Address {address: $addr} WHERE NOT a:Pool) RETURN [(a)-[:FLOWS_TO|SWAPPED]->(mid:Address)-[:FLOWS_TO|SWAPPED]->(b:Address) WHERE NOT mid:Pool | b.address] AS reached',
      pattern_predicate_with_its_guard:
        'MATCH (a:Address {address: $addr} WHERE NOT a:Pool), (b:Address) WHERE (a)-[:FLOWS_TO|SWAPPED]->(:Address&!Pool)-[:FLOWS_TO|SWAPPED]->(b) RETURN b.address LIMIT 25',
      list_comprehension_is_no_walk: `${route} RETURN [n IN nodes(p)[1..-1] | n.address] AS middle`,
      // The legacy functions evaluate WHERE inside their search: the fast plan
      // the graph server rewrites a guarded route to.
      legacy_shortest_path_guarded:
        'MATCH p = shortestPath((a:Address {address: $from})-[:FLOWS_TO|SWAPPED*1..5]-(b:Address {address: $to})) WHERE NONE(n IN nodes(p) WHERE n:Pool AND n <> b) RETURN p',
      legacy_all_shortest_paths_guarded:
        'MATCH p = allShortestPaths((a:Address {address: $from})-[:FLOWS_TO|SWAPPED*1..5]-(b:Address {address: $to})) WHERE NONE(n IN nodes(p) WHERE n:Pool AND n <> b) RETURN p',
      linked_hop_with_both_guards:
        'MATCH (a:Address {address: $addr})-[l:LINKED]-(owned:Address)-[r:FLOWS_TO|SWAPPED]-(b:Address) WHERE NOT a:Pool AND NOT owned:Pool AND owned.address <> b.address AND a.address <> b.address RETURN b.address LIMIT 25',
      keywords_in_lower_case:
        'MATCH (src:Address {address: $addr})-[r1:FLOWS_TO|SWAPPED]->(mid:Address)-[r2:FLOWS_TO|SWAPPED]->(dst:Address) where not src:Pool and not mid:Pool RETURN dst.address LIMIT 25',
      pool_lookup_walks_no_flows_to:
        'MATCH (p:Pool {address: $pool})<-[:ADDED_LIQUIDITY]-(provider:Address) RETURN provider.address LIMIT 25',
    }
    for (const [name, query] of Object.entries(admitted)) {
      expect(unguardedPoolWalks(query), name).toEqual([])
    }

    // The exact-shape net: every route or open target, however its start is
    // anchored, is read as one and must be a contract shape. Each of these
    // carries its guards, so only the shape check refuses it.
    const shapePatterns = contractShapePatterns()
    const onContract = (query: string) => {
      const found = routeWalk(query)
      return found !== null && shapePatterns.some((pattern) => pattern.test(found))
    }
    const contract: Record<string, string> = {
      route: `${route} RETURN [n IN nodes(p) | n.address] AS route`,
      any_shortest_route: `${anyRoute} RETURN p`,
      all_shortest_route: `${allRoute} RETURN p`,
      open_target: `${openTarget} RETURN b.address LIMIT 50`,
      route_with_literal_addresses: `USE topology MATCH p = SHORTEST 1 (a:Address {address: ${A}} WHERE NOT a:Pool) ${walk}(b:Address {address: ${B}}) RETURN p LIMIT 5`,
    }
    for (const [name, query] of Object.entries(contract)) {
      expect(onContract(query), name).toBe(true)
    }
    const offContract: Record<string, string> = {
      route_anchored_in_the_node_where: `MATCH p = SHORTEST 1 (a:Address WHERE a.address = $from AND NOT a:Pool) ${walk}(b:Address WHERE b.address = $to) RETURN p`,
      open_target_anchored_in_the_node_where: `MATCH SHORTEST 1 (a:Address WHERE a.address = $addr AND NOT a:Pool) ${walk}(b:Address) RETURN b.address LIMIT 50`,
      route_anchored_in_the_clause: `MATCH p = SHORTEST 1 (a:Address WHERE NOT a:Pool) ${walk}(b:Address) WHERE a.address = $from AND b.address = $to RETURN p`,
      shortest_walk_with_no_anchor_the_check_reads: `MATCH SHORTEST 1 (a:Address WHERE NOT a:Pool AND a.is_exchange = true) ${walk}(b:Address) RETURN b.address LIMIT 50`,
      lower_hop_bound: `MATCH SHORTEST 1 (a:Address {address: $addr} WHERE NOT a:Pool) ${walk.replace('{0,4}', '{0,3}')}(b:Address) RETURN b.address LIMIT 50`,
      unbounded_quantifier: `MATCH SHORTEST 1 (a:Address {address: $addr} WHERE NOT a:Pool) ${walk.replace('{0,4}', '+')}(b:Address) RETURN b.address LIMIT 50`,
      guarded_legacy_function:
        'MATCH p = shortestPath((a:Address {address: $from})-[:FLOWS_TO|SWAPPED*1..5]-(b:Address {address: $to})) WHERE NONE(n IN nodes(p) WHERE n:Pool AND n <> b) RETURN p',
      other_variable_names: `MATCH path = SHORTEST 1 (src:Address {address: $from} WHERE NOT src:Pool) (()-[:FLOWS_TO|SWAPPED]-(hop:Address) WHERE NOT hop:Pool){0,4} ()-[:FLOWS_TO|SWAPPED]-(dst:Address {address: $to}) RETURN path`,
    }
    for (const [name, query] of Object.entries(offContract)) {
      expect(unguardedPoolWalks(query), name).toEqual([])
      expect(routeWalk(query), name).not.toBeNull()
      expect(onContract(query), name).toBe(false)
    }

    // A trace that walks FLOWS_TO through an address in the middle also follows SWAPPED.
    const noSwap: Record<string, string> = {
      route_on_flows_to_only:
        'MATCH p = SHORTEST 1 (a:Address {address: $from} WHERE NOT a:Pool) (()-[:FLOWS_TO]-(via:Address) WHERE NOT via:Pool){0,4} ()-[:FLOWS_TO]-(b:Address {address: $to}) RETURN p',
      two_hop_on_flows_to_only:
        'MATCH (src:Address {address: $addr})-[r1:FLOWS_TO]->(mid:Address)-[r2:FLOWS_TO]->(dst:Address) WHERE NOT src:Pool AND NOT mid:Pool RETURN dst.address LIMIT 25',
      linked_hop_on_flows_to_only:
        'MATCH (a:Address {address: $addr})-[:LINKED]-(owned:Address)-[r:FLOWS_TO]-(b:Address) WHERE NOT owned:Pool RETURN b.address LIMIT 25',
      backquoted_flows_to_only:
        'MATCH (src:Address {address: $addr})-[r1:`FLOWS_TO`]->(mid:Address)-[r2:`FLOWS_TO`]->(dst:Address) WHERE NOT src:Pool AND NOT mid:Pool RETURN dst.address LIMIT 25',
    }
    for (const [name, query] of Object.entries(noSwap)) {
      expect(traceHopsWithoutSwapped(query), name).not.toEqual([])
    }
    const followsSwapped: Record<string, string> = {
      route: `${route} RETURN p`,
      open_target: `${openTarget} RETURN b.address LIMIT 50`,
      into_a_pool_out_on_a_removal:
        'MATCH (v:Address {address: $addr})-[:FLOWS_TO]->(p:Pool)-[:REMOVED_LIQUIDITY]->(r:Address) WHERE NOT v:Pool RETURN r.address LIMIT 25',
      untyped:
        'MATCH (a:Address {address: $addr})-->(mid)-->(b) WHERE NOT a:Pool AND NOT mid:Pool RETURN b LIMIT 25',
      one_hop: 'MATCH (src:Address)-[flow:FLOWS_TO]->(dst:Address) RETURN dst.address LIMIT 10',
    }
    for (const [name, query] of Object.entries(followsSwapped)) {
      expect(traceHopsWithoutSwapped(query), name).toEqual([])
    }
  })

  it('teaches bounded ISO GQL paths and shortest selectors', () => {
    const skill = read('skills/chain-insights-cypher/SKILL.md')

    expect(skill).toContain('MATCH SHORTEST 1')
    expect(skill).toContain('MATCH ANY SHORTEST')
    expect(skill).toContain('MATCH ALL SHORTEST')
    expect(skill).toContain('-[:FLOWS_TO]-{1,5}')
    expect(skill).not.toMatch(/\*\s*(BFS|DFS|WSHORTEST|ALLSHORTEST|KSHORTEST)/i)
    expect(skill).not.toContain('USING HOPS LIMIT')
    expect(skill).not.toContain('DROP GRAPH')
    expect(skill).not.toContain('eu_border')
  })

  it('ships Bittensor schema guidance without claiming a public hosted MCP network', () => {
    const skill = read('skills/chain-insights-schema-bittensor/SKILL.md')
    const readme = read('README.md')
    const graphTools = read('docs/graph-tools.md')
    const mcpProxy = read('docs/mcp-proxy.md')

    expect(skill).toContain('Bittensor')
    expect(skill).toContain('network=bittensor')
    expect(skill).toContain('Substrate/SS58')
    expect(skill).toContain('EVM-pallet `0x...`')
    expect(skill).toContain('MINES')
    expect(skill).toContain('HOTKEY_OF')
    expect(skill).toContain('LINKED')
    expect(skill).not.toContain('Identity')
    expect(skill).not.toContain('HAS_ADDRESS')
    expect(skill).not.toContain('HAS_RISK_SCORE')
    expect(skill).not.toContain('legacy `bittensor_evm`')
    expect(skill).not.toContain('address_type')
    expect(skill).not.toContain('TopologySnapshot')
    expect(skill).not.toContain('REGISTERED_NEURON')
    expect(skill).not.toContain('SERVED_FROM')
    expect(skill).not.toMatch(/public hosted MCP|mcp\.chain-insights\.ai/i)
    expect(readme).toContain('chain-insights-address-risk')
    expect(readme).toContain('chain-insights-schema-evm')
    expect(readme).toContain('chain-insights-schema-bittensor')
    expect(readme).not.toContain('chain-insights-bittensor-cypher')
    expect(readme).toContain('linked')
    expect(readme).toContain('USE topology MATCH (a:Address)-[l:LINKED]-(b:Address)')
    expect(readme).not.toContain('USE facts MATCH (a:Address)-[l:LINKED]-(b:Address)')
    expect(graphTools).toContain('chain-insights-schema-bittensor')
    expect(mcpProxy).toContain('chain-insights-schema-bittensor')
  })
})
