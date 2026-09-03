import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

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
