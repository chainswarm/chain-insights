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
import { flat, servedGraphHints } from './support/schema-text.js'
import { routingLines } from '../src/mcp/layer-routing.js'

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

// The guarded route contract (ruled 2026-09-28): the only route and
// open-target shapes served, with $from, $to and $addr the only variables. A
// route search asks for one path, so ALL SHORTEST is not served.
function routeContractShapes(): string[] {
  const walk =
    '(()-[:FLOWS_TO|SWAPPED]-(via:Address) WHERE NOT via:Pool){0,4} ()-[:FLOWS_TO|SWAPPED]-'
  return [
    ...['SHORTEST 1', 'ANY SHORTEST'].map(
      (selector) =>
        `MATCH p = ${selector} (a:Address {address: $from} WHERE NOT a:Pool) ${walk}(b:Address {address: $to})`
    ),
    `MATCH SHORTEST 1 (a:Address {address: $addr} WHERE NOT a:Pool) ${walk}(b:Address)`,
  ]
}

// The guarded walks the cypher skill teaches beside the route (ruled 2026-10-06):
// several routes between two addresses, and where the money went and where it
// came from. Each is up to 3 hops (a guarded {0,2} and the last hop), carries the
// guard on its start and on every address in its middle, and follows SWAPPED beside
// FLOWS_TO. The variable names are fixed, as in the route shapes. No selector:
// a count above 1 on SHORTEST is not served, so several routes drop it.
function walkContractShapes(): string[] {
  const via = '(via:Address) WHERE NOT via:Pool){0,2} ()'
  const start = (address: string) => `(a:Address {address: ${address}} WHERE NOT a:Pool) (()`
  return [
    `MATCH p = ${start('$from')}-[:FLOWS_TO|SWAPPED]-${via}-[:FLOWS_TO|SWAPPED]-(b:Address {address: $to})`,
    `MATCH p = ${start('$addr')}-[:FLOWS_TO|SWAPPED]->${via}-[:FLOWS_TO|SWAPPED]->(b:Address)`,
    `MATCH p = ${start('$addr')}<-[:FLOWS_TO|SWAPPED]-${via}<-[:FLOWS_TO|SWAPPED]-(b:Address)`,
  ]
}

// The contract shapes as patterns, with a literal address allowed in place of
// a parameter.
function contractShapePatterns(shapes: string[] = routeContractShapes()): RegExp[] {
  return shapes.map(
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

const reviewedSkills = ['chain-insights-cypher']

describe('shipped Chain Insights skills contract', () => {
  it('ships exactly the reviewed public skill directories', () => {
    const actual = readdirSync(join(root, 'skills'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()

    expect(actual).toEqual(reviewedSkills)
  })

  it('teaches ISO GQL and how to find the fields, and excludes stale product guidance', () => {
    const cypher = read('skills/chain-insights-cypher/SKILL.md')

    expect(cypher).toMatch(/ISO GQL/i)
    expect(cypher).toContain('graph_query')
    expect(cypher).toContain('cia mcp call graph_query')
    // The schema skill is gone: the cypher skill sends the agent to meta_schema for
    // the fields of the graph, and keeps the sampling reads as the fallback.
    expect(cypher).toContain('## Find the fields')

    expect(cypher).not.toMatch(/workspace|debug MCP/i)
    // The risk screen is hidden until its verdict is fixed: no skill drives it,
    // and no skill sends an agent to a workflow command to find one.
    expect(cypher).not.toContain('aml_address_risk')
    expect(cypher).not.toContain('aml-address-risk')
  })

  it('documents the OPERATED_BY owner-to-operator topology edge as topology-only and never as an automatic risk label', () => {
    const cypherSkill = read('skills/chain-insights-cypher/SKILL.md')
    const graphTools = read('docs/graph-tools.md')
    const compatibility = read('docs/graph-query-compatibility.md')
    const combined = [cypherSkill, graphTools, compatibility].join('\n')

    // The relationship is named across the shipped surfaces, including the
    // runtime MCP instructions and the dialect skill agents load first.
    for (const surface of [cypherSkill, graphTools, compatibility]) {
      expect(surface).toContain('OPERATED_BY')
    }
    expect(read('src/mcp/proxy.ts')).toContain('(:Address)-[:OPERATED_BY]->(:Address)')
    expect(read('src/workspace/init.ts')).toContain('operated_by_sample')
    expect(read('src/workspace/init.ts')).toContain('OPERATED_BY]->(operator:Address {address:')

    // The documented direction is owner to operator: the skill anchors the
    // operator, the destination of the link.
    expect(cypherSkill).toContain(
      '(owner:Address)-[o:OPERATED_BY]->(operator:Address {address: "0x'
    )
    expect(combined).toMatch(/source is the (transfer )?owner/i)
    expect(combined).toMatch(
      /destination is\s+the\s+transaction\s+sender\s+that\s+moved\s+the\s+owner's\s+tokens/i
    )
    expect(combined).not.toMatch(/approved operator/i)

    // The relation is topology only — never served through USE facts, on any
    // variable spelling, and named in the facts-rejection enumerations.
    expect(combined).not.toMatch(/USE facts MATCH[^"\n]*OPERATED_BY/)
    expect(cypherSkill).not.toMatch(/USE facts[^`]*OPERATED_BY/)

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

    // The unanchored sweep is bounded by a recent window. It carries no network
    // predicate: the network is the query's, so a filter on it narrows nothing.
    expect(compatibility).toMatch(
      /MATCH \(owner:Address\)-\[operation:OPERATED_BY\]->\(operator:Address\)\s+WHERE operation\.last_seen_timestamp >= \d+/
    )
    expect(compatibility).not.toMatch(/(?:owner|operator)\.network = "robinhood"/)

    // The text never describes the relation as a risk signal, in any of the
    // phrasings a doc edit would realistically introduce.
    expect(combined).not.toMatch(
      /OPERATED_BY[^.\n]{0,80}(risk (label|signal|verdict)|drainer|scam (label|signal))/i
    )
    expect(cypherSkill).toMatch(/not proof of malicious intent/i)
    expect(read('src/mcp/proxy.ts')).toContain('not a risk label')
  })

  it('documents topology LINKED ownership-overlay probes wherever schema probes are shipped (LINKED is topology-only)', () => {
    const readme = read('README.md')
    const graphTools = read('docs/graph-tools.md')
    const cypherSkill = read('skills/chain-insights-cypher/SKILL.md')
    const combined = [readme, graphTools, cypherSkill].join('\n')

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
    expect(readme).not.toContain('aml_address_risk')
    expect(readme).toContain('graph_query')
    expect(readme).toContain('graph_query_batch')

    expect(readme).toContain('`topology`')
    expect(readme).toContain('`facts`')
    expect(readme).toContain('tx_out_count')
    expect(readme).not.toContain('sent_count')
    expect(readme).toContain('cia mcp networks')
    expect(readme).toContain('cia mcp tools --refresh')
    expect(readme).not.toContain('cia workflow aml-address-risk')
    expect(readme).toContain('docs/contributing.md')
    expect(readme).toContain('docs/debugging.md')

    // The plugin section names the Claude apps that can start the local proxy,
    // and the ones that cannot. Client detail stays out of the rest of README.
    const pluginSection = /^### Claude plugin\n[\s\S]*?(?=^#{2,3} )/m.exec(readme)?.[0] ?? ''
    expect(pluginSection).toContain('Claude Desktop')
    expect(readme.replace(pluginSection, '')).not.toContain('Claude Desktop')
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

  it('ships ISO GQL guidance with one query for each kind of graph search', () => {
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
    expect(graphTools).not.toContain('chain-insights-address-risk')
    expect(graphTools).not.toContain('chain-insights-bittensor-cypher')
    expect(graphTools).not.toContain('references/memgraph-examples.md')
    expect(mcpProxy).toContain('chain-insights-cypher')
    expect(mcpProxy).not.toContain('chain-insights-address-risk')
    expect(mcpProxy).not.toContain('chain-insights-bittensor-cypher')
    expect(mcpProxy).not.toContain('Memgraph examples reference')
  })

  it('states the pool trace rule once and every shipped trace obeys it', () => {
    const cypherSkill = read('skills/chain-insights-cypher/SKILL.md')
    const graphTools = read('docs/graph-tools.md')
    const proxy = read('src/mcp/proxy.ts')
    const runtimeSkill = read('src/workspace/init.ts')
    const squash = (text: string) => text.replace(/\s+/g, ' ').trim()

    // The rule's one home: four numbered steps under "## Pool trace rule".
    const section = cypherSkill.split('## Pool trace rule\n')[1]?.split('\n## ')[0] ?? ''
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
    for (const surface of [graphTools, runtimeSkill]) {
      expect(surface).toMatch(/pool trace rule/i)
      expect(surface).toContain('chain-insights-cypher')
      expect(surface).not.toMatch(restated)
    }
    expect(cypherSkill.match(new RegExp(restated, 'g'))).toHaveLength(1)

    // The graph tools guide says where the rule lives and that MCP clients get the same text.
    expect(squash(graphTools)).toContain(
      'The rule is stated once, in the [`chain-insights-cypher` skill]'
    )
    expect(squash(graphTools)).toContain(
      'The MCP server instructions serve the same four steps, word for word, because an MCP client loads no skill. A test keeps the two equal.'
    )

    // The retired swap stamp and the retired DEX bookkeeping nodes are gone.
    for (const surface of [cypherSkill, graphTools, proxy, runtimeSkill]) {
      expect(surface).not.toMatch(/swap\.(kind|family|deployment|pool|reason|route_id)/)
      expect(surface).not.toMatch(/Dex(Transaction|Route|PoolFact|PairContribution)/)
    }
    // The skill shows a swap, a pool trace and a bridge read, each on its own link.
    expect(cypherSkill).toContain('-[r:REMOVED_LIQUIDITY]->(b:Address)')
    expect(cypherSkill).toContain('-[s:SWAPPED]->(b:Address)')
    expect(cypherSkill).toContain('-[x:BRIDGED]->(c:Chain)')

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

    // The guarded route contract: every served route, open-target and walk (a
    // quantified FLOWS_TO trace, see routeWalk) is exactly one of the route
    // shapes or the walk shapes, with a literal address allowed in place of a
    // parameter.
    const shapes = routeContractShapes()
    const shapePatterns = contractShapePatterns()
    const walkPatterns = contractShapePatterns(walkContractShapes())
    const routeWalks = surfaces.flatMap(({ name, queries }) =>
      queries.flatMap((query) => {
        const walk = routeWalk(query)
        return walk ? [{ name, walk }] : []
      })
    )
    const offContract = routeWalks
      .filter(
        ({ walk }) => ![...shapePatterns, ...walkPatterns].some((pattern) => pattern.test(walk))
      )
      .map(({ name, walk }) => `${name}: ${walk}`)
    expect(offContract).toEqual([])
    // Every contract shape is served: the cypher skill carries the route (with
    // full addresses), and the documented recipes carry all three.
    const cypherSkill = read('skills/chain-insights-cypher/SKILL.md')
    const skillWalks = markdownQueries(cypherSkill).flatMap((query) => {
      const walk = routeWalk(query)
      return walk ? [walk] : []
    })
    expect(
      skillWalks.some((walk) => shapePatterns[0]?.test(walk)),
      'the cypher skill shows no route search of the contract shape'
    ).toBe(true)
    for (const [i, pattern] of shapePatterns.entries()) {
      expect(
        routeWalks.some(
          ({ name, walk }) =>
            name === 'tests/fixtures/documented-recipes.json' && pattern.test(walk)
        ),
        `no documented recipe serves ${shapes[i]}`
      ).toBe(true)
    }
    // The cypher skill carries every walk shape, with full addresses.
    for (const [i, pattern] of walkPatterns.entries()) {
      expect(
        skillWalks.some((walk) => pattern.test(walk)),
        `the cypher skill shows no walk of the shape ${walkContractShapes()[i]}`
      ).toBe(true)
    }
  })

  it('the pool-guard check recognises every walk shape it must refuse', () => {
    const walk =
      '(()-[:FLOWS_TO|SWAPPED]-(via:Address) WHERE NOT via:Pool){0,4} ()-[:FLOWS_TO|SWAPPED]-'
    const [route, anyRoute, openTarget] = routeContractShapes()
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
    const shapePatterns = contractShapePatterns([...routeContractShapes(), ...walkContractShapes()])
    const [severalRoutes, outward, inward] = walkContractShapes()
    const onContract = (query: string) => {
      const found = routeWalk(query)
      return found !== null && shapePatterns.some((pattern) => pattern.test(found))
    }
    const contract: Record<string, string> = {
      several_routes: `${severalRoutes} RETURN [n IN nodes(p) | n.address] AS route, length(p) AS hops LIMIT 5`,
      where_the_money_went: `${outward} RETURN b.address AS to_address, length(p) AS hops LIMIT 25`,
      where_the_money_came_from: `${inward} RETURN b.address AS from_address, length(p) AS hops LIMIT 25`,
      route: `${route} RETURN [n IN nodes(p) | n.address] AS route`,
      any_shortest_route: `${anyRoute} RETURN p`,
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
      walk_over_the_hop_bound: `${outward.replace('{0,2}', '{0,4}')} RETURN b.address LIMIT 25`,
      several_routes_with_a_selector: `${severalRoutes.replace('p = ', 'p = ANY SHORTEST ')} RETURN p LIMIT 5`,
      walk_on_flows_to_only: `${outward.replaceAll('|SWAPPED', '')} RETURN b.address LIMIT 25`,
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
    expect(skill).not.toContain('MATCH ALL SHORTEST')
    expect(skill).toContain('-[:FLOWS_TO]-{1,5}')
    expect(skill).not.toMatch(/\*\s*(BFS|DFS|WSHORTEST|ALLSHORTEST|KSHORTEST)/i)
    expect(skill).not.toContain('USING HOPS LIMIT')
    expect(skill).not.toContain('DROP GRAPH')
    expect(skill).not.toContain('eu_border')
  })

  it('names the cypher skill in the README and both guides', () => {
    const readme = read('README.md')
    const graphTools = read('docs/graph-tools.md')
    const mcpProxy = read('docs/mcp-proxy.md')

    expect(readme).not.toContain('chain-insights-address-risk')
    expect(readme).toContain('chain-insights-cypher')
    expect(readme).not.toContain('chain-insights-bittensor-cypher')
    expect(readme).toContain('linked')
    expect(readme).toContain('USE topology MATCH (a:Address)-[l:LINKED]-(b:Address)')
    expect(readme).not.toContain('USE facts MATCH (a:Address)-[l:LINKED]-(b:Address)')
    expect(graphTools).toContain('chain-insights-cypher')
    expect(mcpProxy).toContain('chain-insights-cypher')
  })
})

// What the cypher skill teaches beyond the dialect (operator ruling 2026-10-06):
// one query for each kind of graph search, the units, and how to find the fields
// now that the schema skill is gone. Every query ran on the live server and
// returned rows when it was written; tests/topology-shape-cases.test.ts holds each
// one to the topology rules, and the pool-guard test above holds each walk to the
// pool trace rule.
describe('the cypher skill: graph searches, units and the field sampling reads', () => {
  const skill = read('skills/chain-insights-cypher/SKILL.md')
  const flatSkill = skill.replace(/\s+/g, ' ')
  const squash = (text: string) => text.replace(/\s+/g, ' ').trim()
  const fenced = [...skill.matchAll(/^```[\w-]*\n([\s\S]*?)^```/gm)].map((block) =>
    squash(block[1] ?? '')
  )
  const topology = fenced.filter((query) => query.startsWith('USE topology'))

  it('shows one query for each kind of graph search', () => {
    const kinds: Record<string, RegExp> = {
      route:
        /SHORTEST 1 \(a:Address \{address: "0x[0-9a-f]{40}"\} WHERE NOT a:Pool\).*\(b:Address \{address: "0x[0-9a-f]{40}"\}\) RETURN \[n IN nodes\(p\) \| n\.address\] AS route LIMIT 5$/,
      several_routes:
        /^USE topology MATCH p = \(a:Address \{address: "0x[0-9a-f]{40}"\} WHERE NOT a:Pool\) .*\{0,2\} \(\)-\[:FLOWS_TO\|SWAPPED\]-\(b:Address \{address: "0x[0-9a-f]{40}"\}\) RETURN .* AS hops LIMIT 5$/,
      where_the_money_went: /\{0,2\} \(\)-\[:FLOWS_TO\|SWAPPED\]->\(b:Address\) RETURN .*LIMIT 25$/,
      where_the_money_came_from:
        /\{0,2\} \(\)<-\[:FLOWS_TO\|SWAPPED\]-\(b:Address\) RETURN .*LIMIT 25$/,
      shared_counterparties:
        /\(c:Address\)-\[:FLOWS_TO\|SWAPPED\]-\(b:Address \{address: "0x[0-9a-f]{40}"\}\) WHERE NOT a:Pool AND NOT c:Pool RETURN DISTINCT c\.address/,
      ownership_cluster: /-\[:LINKED\]-\{1,2\}\(b:Address\) RETURN/,
      operator_view: /-\[o:OPERATED_BY\]->\(operator:Address \{address: "0x[0-9a-f]{40}"\}\)/,
      swaps: /-\[s:SWAPPED\]->\(b:Address\)/,
      pool_trace:
        /-\[:FLOWS_TO\]->\(p:Pool\)-\[r:REMOVED_LIQUIDITY\]->\(b:Address\) WHERE NOT a:Pool/,
      bridges: /-\[x:BRIDGED\]->\(c:Chain\)/,
      newest_links: /ORDER BY f\.last_seen_timestamp DESC LIMIT 25$/,
    }
    for (const [kind, pattern] of Object.entries(kinds)) {
      expect(
        topology.some((query) => pattern.test(query)),
        `the skill shows no ${kind} query`
      ).toBe(true)
    }
    // Several routes carry no selector: SHORTEST with a count above 1 is refused.
    const several = topology.find((query) => kinds['several_routes']?.test(query)) ?? ''
    expect(several).not.toContain('SHORTEST')
    // The skill does not teach the selectors the server refuses.
    expect(skill).not.toMatch(/SHORTEST [2-9]|GROUPS|PATHS/)
  })

  it('writes every address of a query in full: 42 characters, lowercase', () => {
    for (const query of fenced) {
      for (const [, address] of query.matchAll(/\{(?:address|hash): "(0x[^"]*)"\}/g)) {
        // A chain hash is 66 characters, an address 42.
        expect([42, 66], `${address} in ${query}`).toContain(address?.length)
        expect(address, query).toBe(address?.toLowerCase())
      }
    }
  })

  it('states the units: milliseconds in UTC, a block_date day, US dollars and raw amounts', () => {
    expect(flatSkill).toContain('integer milliseconds since the epoch, UTC')
    expect(flatSkill).toContain('`block_date` is the string `"YYYY-MM-DD"`')
    expect(flatSkill).toContain('Every `*_usd` field is US dollars')
    expect(flatSkill).toContain("`*_raw` is the token's smallest unit, not dollars")
  })

  it("states the topology limits once, and they are the server's published ones", () => {
    const { topology_admission: admission } = JSON.parse(
      read('tests/fixtures/topology-admission-20261006.json')
    ) as { topology_admission: Record<string, number> }
    const places = flatSkill.match(/at most 5,000 rows, 100 for a probe/g) ?? []
    expect(places).toHaveLength(1)
    expect(admission['max_limit']).toBe(5000)
    expect(admission['probe_max_limit']).toBe(100)
    expect(flatSkill).toContain('A path has at most 5 hops and a query at most 8.')
    expect(admission['max_hops_per_path']).toBe(5)
    expect(admission['max_hops_per_query']).toBe(8)
    expect(flatSkill).toContain('`topology_admission`')
  })

  it('every walk stays inside the hop limits of the server', () => {
    const { topology_admission: admission } = JSON.parse(
      read('tests/fixtures/topology-admission-20261006.json')
    ) as { topology_admission: Record<string, number> }
    let walks = 0
    for (const query of topology) {
      // A guarded walk is its repeated part and a last hop. A quantified link is its bound.
      const guarded = /\)\{\d+,(\d+)\} \(\)[<-]/.exec(query)
      const link = /\]-\{\d+,(\d+)\}\(/.exec(query)
      if (!guarded && !link) continue
      walks += 1
      const hops = guarded ? Number(guarded[1]) + 1 : Number(link?.[1])
      expect(hops, query).toBeLessThanOrEqual(admission['max_hops_per_path'] ?? 0)
      expect(hops, query).toBeLessThanOrEqual(admission['max_hops_per_query'] ?? 0)
    }
    expect(walks, 'the skill shows five walks').toBe(5)
  })

  it('sends an agent to meta_schema for the fields, and keeps two sampling reads the guard admits as the fallback', () => {
    const section = skill.split('## Find the fields\n')[1]?.split('\n## ')[0] ?? ''
    const flatSection = squash(section)
    // The one line of the skill and of the server instructions is the same.
    expect(flatSection).toContain(
      'Call `meta_schema {network}` first when you need field names; it is cached for 24 hours.'
    )
    expect(flatSection).toContain('`cia network robinhood --schema`')
    expect(flatSection).toContain('`--json`')
    expect(flatSection).toContain('`--refresh`')
    expect(flatSection).toContain('Fields come from a sample, so a rare field may be missing.')
    expect(section.indexOf('meta_schema')).toBeLessThan(section.indexOf('```cypher'))
    expect(flatSection).toContain('When `meta_schema` is not available')
    const reads = [...section.matchAll(/^```[\w-]*\n([\s\S]*?)^```/gm)].map((block) =>
      squash(block[1] ?? '')
    )
    expect(reads).toEqual([
      'USE topology MATCH (a:Address) RETURN keys(a) AS keys LIMIT 20',
      'USE topology MATCH ()-[r:FLOWS_TO]->() RETURN keys(r) AS keys LIMIT 5',
    ])
    // An unanchored probe takes a literal LIMIT of at most probe_max_limit rows.
    const { topology_admission: admission } = JSON.parse(
      read('tests/fixtures/topology-admission-20261006.json')
    ) as { topology_admission: Record<string, number> }
    for (const query of reads) {
      expect(Number(/LIMIT (\d+)$/.exec(query)?.[1])).toBeLessThanOrEqual(
        admission['probe_max_limit'] ?? 0
      )
    }
    // The catalog calls are served: meta_schema sends them, so the skill names them
    // and never shows one as a query for the agent to send.
    const catalog = [
      'CALL db.labels()',
      'CALL db.relationshipTypes()',
      'CALL db.propertyKeys()',
      'CALL db.schema.visualization()',
      'SHOW INDEXES',
    ]
    for (const call of catalog) expect(flatSkill, call).toContain(`\`${call}\``)
    expect(flatSkill).toContain('The server serves five read-only catalog calls')
    expect(flatSkill).toContain('so do not send them yourself')
    expect(flatSkill).not.toContain('are being enabled on the server')
    for (const query of fenced) expect(query).not.toMatch(/\bCALL\b|\bSHOW\b/)
  })

  it('gives the server instructions the same one line about meta_schema', () => {
    expect(squash(servedGraphHints())).toContain(
      'Call meta_schema {network} first when you need field names; it is cached for 24 hours.'
    )
  })
})

// The unified names (one address, one transaction and one clock on topology,
// facts and chain). Each test is a search of the files that teach an agent, and
// nothing else: it reads files and calls no server.
describe('unified names', () => {
  // Every text that teaches an agent a name: the skills and their plugin copies,
  // the docs, the README, the hints that the proxy serves, and the fixtures.
  function teachingTexts(): [string, string][] {
    const files = [
      ...markdownFiles('skills'),
      ...markdownFiles('plugin/skills'),
      ...markdownFiles('docs'),
      'README.md',
      ...readdirSync(join(root, 'tests/fixtures'))
        .filter((name) => name.endsWith('.json'))
        .map((name) => `tests/fixtures/${name}`),
    ]
    return [
      ...files.map((path): [string, string] => [path, read(path)]),
      ['src/mcp/proxy.ts graph hints', servedGraphHints()],
    ]
  }

  const OLD_CHAIN_NAME =
    /Transaction \{hash|Block \{(?:height|hash)|\bh\.(?:height|hash)\b|\bt\.hash\b|\bb\.(?:height|hash)\b/

  it('skills and fixtures name no old chain key', () => {
    const found = teachingTexts()
      .map(([name, text]) => [name, OLD_CHAIN_NAME.exec(text)?.[0]] as const)
      .filter(([, hit]) => hit !== undefined)
    expect(found, 'a text still names a chain key that was renamed').toEqual([])
  })

  it('no skill names a stored Address.network or :Wallet', () => {
    const STORED_NETWORK = /:?Address\.network|\bno (?:mapped )?`network` property/i
    const WALLET_LABEL = /:Wallet\b/
    const found = teachingTexts()
      .filter(([name]) => !name.startsWith('tests/fixtures/'))
      .flatMap(([name, text]) =>
        [STORED_NETWORK, WALLET_LABEL].flatMap((pattern) => {
          const hit = pattern.exec(flat(text))
          return hit ? [`${name}: ${hit[0]}`] : []
        })
      )
    expect(found, 'a text still teaches a stored network or a :Wallet label').toEqual([])
  })

  it("the served hints say network is the query's", () => {
    const hints = flat(servedGraphHints())
    expect(hints).toMatch(
      /network is the query's network on every node and relationship, never stored, except on :Chain/
    )
    expect(hints).not.toMatch(/network value on Address nodes/i)
    // The kind is a second label on topology, none on facts, and properties on chain.
    expect(hints).toMatch(/topology carries :Account or :Contract as a second label/)
    expect(hints).toMatch(/facts serves no kind/i)
    for (const name of ['is_contract', 'nonce', 'delegated_to']) expect(hints).toContain(name)
  })

  it('routing offers the Address lookup', () => {
    const lines = routingLines().join(' ')
    expect(lines).toMatch(/`USE chain`[^.]*`Address`|`Address`[^.]*`USE chain`/)
    for (const word of ['balance', 'nonce', 'kind', 'at_block']) expect(lines).toContain(word)
    for (const [name, text] of teachingTexts()) {
      expect(flat(text), `${name} says chain has no address lookup`).not.toMatch(
        /(?:chain|`USE chain`) has no address lookup|no address lookup/i
      )
    }
    expect(flat(servedGraphHints())).toContain(
      routingLines().find((line) => line.includes('`Address`')) ?? 'no routing line names Address'
    )
  })
})

describe('the cypher skill teaches the chain Address lookup', () => {
  const skill = flat(read('skills/chain-insights-cypher/SKILL.md'))

  it('shows the lookup for the newest block and for a past block with at_block, with a full address', () => {
    // The skill never shortens an address, so the examples carry all 42 characters.
    expect(skill).toMatch(
      /USE chain MATCH \(a:Address \{address: "0x[0-9a-f]{40}"\}\) RETURN a\.balance/
    )
    expect(skill).toMatch(
      /USE chain MATCH \(a:Address \{address: "0x[0-9a-f]{40}", at_block: \d+\}\) RETURN a\.balance/
    )
  })

  it('names the near-tip refusal and the field that publishes its depth, never the depth', () => {
    expect(skill).toContain('at_block_near_tip')
    expect(skill).toContain('chain_admission.at_block_min_depth')
    expect(skill).not.toMatch(/\b256 blocks\b/)
  })

  it('says a kind is read from is_contract and nonce, and is no lookup label', () => {
    expect(skill).toMatch(/`a\.is_contract`/)
    expect(skill).toMatch(
      /`:Account`[^.]*`:Contract`[^.]*(?:not|never) (?:a )?(?:chain )?lookup label/
    )
  })

  it('names epoch milliseconds for block_timestamp on every layer, chain included', () => {
    expect(skill).toMatch(
      /`block_timestamp` is[^.]*epoch milliseconds on every layer, chain included/
    )
  })
})
