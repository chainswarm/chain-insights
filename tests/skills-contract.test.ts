import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()

function read(path: string): string {
  return readFileSync(join(root, path), 'utf8')
}

function expectNoRetiredHostedMcpHost(content: string): void {
  expect(content).not.toMatch(/(^|[^a-z0-9-])mcp\.chain-insights\.ai(?=\/|[\s`'")\]}]|$)/i)
}

function retiredName(head: string, tail: string): string {
  return `${head}${tail}`
}

// Retired trace-tool names are never literal in this file (the finished
// state grep must stay empty); absence assertions build them at runtime.
function traceToolName(role: string): string {
  return ['aml_trace_', role, '_funds'].join('')
}

describe('shipped Chain Insights skills contract', () => {
  it('keeps investigation guidance on initialized workspaces and role-specific tools', () => {
    const skill = read('skills/chain-insights-investigation/SKILL.md')

    expect(skill).toContain('cia init .')
    expect(skill).toContain('No investigation output belongs under ~/.chain-insights')
    expect(skill).toContain('single-address')
    expect(skill).toContain('victim_addresses')
    expect(skill).toContain('Topology is address-grain and graph-selected')
    expect(skill).toContain('High-level `aml_*` tools accept addresses with no identity-resolution step')
    expect(skill).toContain('public results, artifacts, and follow-up candidate lists always return the raw address')
    expect(skill).toContain('graph_query_batch')
    expect(skill).toContain('USE topology')
    expect(skill).toContain('USE facts')
    expect(skill).toContain('cia mcp networks')
    expect(skill).toContain('Dataset')
    expect(skill).toContain('<first_height>..<last_height> / <first_date>..<last_date>')
    expect(skill).toContain('Available tools')
    expect(skill).toContain('All Bittensor investigation runs on ONE public network')
    expect(skill).toContain('network=bittensor')
    expect(skill).toContain('not a separate query network')
    expect(skill).toContain('EVM-pallet `0x...`')
    expect(skill).toContain('(:Address)-[:FLOWS_TO]->(:Address)')
    expect(skill).toContain('amount_usd_sum')
    expect(skill).toContain('LINKED')
    expect(skill).toContain('linked_sample')
    expect(skill).toContain('USE topology MATCH (a:Address)-[l:LINKED]-(b:Address)')
    expect(skill).toContain('LINKED` overlay is topology-only')
    expect(skill).toContain('Some Chain Insights Graph deployments do not')
    expect(skill).toContain('generated fixed-depth `FLOWS_TO` query batches')
    expect(skill).toContain('exchange hot wallets are terminal endpoints only')
    expect(skill).toContain('chain-insights.evidence_pointer.v1')
    expect(skill).toContain('LLM Wiki')
    expect(skill).not.toContain(retiredName('track', '_funds'))
    expect(skill).not.toContain(retiredName('scam', '_topology'))
    expect(skill).not.toContain(`Use \`${retiredName('trace', '_funds')}\``)
    expect(skill).not.toContain(retiredName('trace', '_funds'))
  })


  it('ships dedicated address-risk skill with current contracts', () => {
    const addressRisk = read('skills/chain-insights-address-risk/SKILL.md')

    expect(addressRisk).toContain('aml_address_risk')
    expect(addressRisk).toContain('single-address AML screening')
    expect(addressRisk).toContain('compare_address')
    expect(addressRisk).toContain('reports/graphs/')
    expect(addressRisk).toContain('reports/tables/')
    expect(addressRisk).toContain('Markdown summary/report files under `reports/`')
    expect(addressRisk).toContain('No investigation output belongs under `~/.chain-insights`')
    expect(addressRisk).not.toContain(retiredName('trace', '_funds'))
  })


  it('keeps ci-status on workspace guidance without legacy case commands', () => {
    const ciStatus = read('skills/ci-status/SKILL.md')

    expect(ciStatus).toContain('workspace')
    expect(ciStatus).toContain('The workspace is the investigation root')
    expect(ciStatus).toContain('Artifacts:')
    expect(ciStatus).not.toContain('placeholder')
    expect(ciStatus).not.toContain('Config:  /home/user/.chain-insights')
    expect(ciStatus).not.toContain('~/.chain-insights` as')
    expect(ciStatus).not.toContain('cia case list')
  })

  it('keeps UAT guidance and scripts from treating home as an investigation output root', () => {
    const skill = read('skills/test-chain-insights-graph/SKILL.md')
    const investigationUat = read('skills/chain-insights-investigation/scripts/run-target-uat.sh')
    const graphUat = read('skills/test-chain-insights-graph/scripts/run-uat.sh')

    expect(skill).toContain('temporary initialized Chain Insights workspace')
    expect(skill).toContain('chain-insights mcp networks')
    expect(skill).toContain('topology support, risk support, and available tools')
    expect(skill).toContain('USE topology')
    expect(skill).not.toContain(retiredName('topology', '_scope=identity'))
    expect(skill).toContain('facts.routing.starrocks_database=bittensor')
    expect(skill).not.toContain('facts.routing.starrocks_database=bittensor_semantic')
    expect(skill).not.toContain('network=bittensor_identity')
    expect(skill).toContain('~/.chain-insights/reports')
    expect(skill).toContain('CLI graph_query')
    expect(skill).toContain('return the same addresses as the primary address surface')
    expect(skill).toContain('defaults to address-grain topology')
    expect(skill).toContain('(:Address)-[:LINKED]-(:Address)')
    expect(skill).toContain('UAT_LINKED_ADDRESS=0x1874a43d7c6d888f9eda3d22a3a49704e3cadb24')
    expect(skill).not.toContain('raw `Address FLOWS_TO Address` topology')

    for (const script of [investigationUat, graphUat]) {
      expect(script).toContain('GLOBAL_REPORTS="${HOME}/.chain-insights/reports"')
      expect(script).toContain('CONFIG_SNAPSHOT_READY=0')
      expect(script).toContain('snapshot_global_outputs')
      expect(script).toContain('assert_no_global_outputs_changed')
      expect(script).toContain('trap finish EXIT')
    }

    expect(graphUat).toContain('node "${CHAIN_INSIGHTS_CLI}" init "${WORKSPACE_ROOT}" --force')
    expect(graphUat).toContain('export CHAIN_INSIGHTS_WORKSPACE="${WORKSPACE_ROOT}"')
    expect(graphUat).toContain('cd "${WORKSPACE_ROOT}"')
    expect(graphUat).toContain('node "${CHAIN_INSIGHTS_CLI}" debug on --token "${DEBUG_TOKEN}" --endpoint "${MCP_ENDPOINT}"')
    expect(graphUat).toContain('--cli node "${CHAIN_INSIGHTS_PROXY}"')
    expect(graphUat).not.toContain('--cli "node ${CHAIN_INSIGHTS_PROXY}"')
    expect(graphUat).not.toContain('config set mcpEndpoint')
    expect(graphUat).not.toContain('config set mcpAuthToken')
    // Retired identity-key env: the UAT is keyed by the raw address alone
    // (needle built by concatenation so this gate never matches itself).
    expect(graphUat).not.toContain(retiredName('UAT_IDENTITY', '_KEY'))
    expect(graphUat).toContain('topology money-flow FLOWS_TO ok')
    expect(graphUat).toContain('USE topology MATCH (a:Address {address:')
    expect(graphUat).toContain('b.network AS linked_network')
    expect(graphUat).toContain('UAT_LINKED_ADDRESS="${UAT_LINKED_ADDRESS:-0x1874a43d7c6d888f9eda3d22a3a49704e3cadb24}"')
    expect(graphUat).toContain('first.linked_network !== linkedNetwork')
    expect(investigationUat).toContain('GLOBAL_ARTIFACTS="${HOME}/.chain-insights/artifacts"')
    expect(investigationUat).toContain('reports/tables/address_profile.compact.json')
    expect(investigationUat).toContain('entities/${TARGET_ADDRESS}.md')
    expect(investigationUat).toContain('cia mcp call graph_query_batch')
    expect(investigationUat).toContain('linked_sample')
    expect(investigationUat).toContain('USE topology MATCH (a:Address)-[l:LINKED]-(b:Address)')
    expect(investigationUat).not.toContain('facts_linked_sample')
    expect(investigationUat).toContain('b.network AS linked_network')
    expect(investigationUat).toContain('if [[ -d cases || -d Evidence ]]; then')
    expect(investigationUat).not.toContain('cia case ')
  })

  it('documents topology LINKED ownership-overlay probes wherever schema probes are shipped (LINKED is topology-only)', () => {
    const readme = read('README.md')
    const graphTools = read('docs/graph-tools.md')
    const cypherSkill = read('skills/chain-insights-cypher/SKILL.md')
    const bittensorCypherSkill = read('skills/chain-insights-bittensor-cypher/SKILL.md')
    const investigationSkill = read('skills/chain-insights-investigation/SKILL.md')
    const targetUat = read('skills/chain-insights-investigation/scripts/run-target-uat.sh')
    const combined = [
      readme,
      graphTools,
      cypherSkill,
      bittensorCypherSkill,
      investigationSkill,
      targetUat,
    ].join('\n')

    expect(combined).toContain('linked_sample')
    expect(combined).toContain('USE topology MATCH (a:Address)-[l:LINKED]-(b:Address)')
    expect(combined).not.toContain('USE facts MATCH (a:Address)-[l:LINKED]-(b:Address)')
    expect(combined).toContain('b.address AS linked_address')
  })

  it('requires only current public proxy tools in Chain Insights Graph UAT', () => {
    const script = read('skills/test-chain-insights-graph/scripts/run-uat.sh')
    const proxySection = script.slice(script.indexOf('PROXY_TOOLS_JSON='))

    expect(proxySection).toContain(
      "const required = ['wallet_balance', 'meta_help', 'meta_network_capabilities', 'meta_usage_status', 'aml_address_risk', 'graph_query', 'graph_query_batch']",
    )
    expect(proxySection).toContain('proxy tools/list exposed unexpected tools')
    expect(proxySection).toContain("for (const name of ['aml_address_risk'])")
    expect(proxySection).not.toContain("const required = ['wallet_balance', 'topup'")
    expect(proxySection).toContain('names.size !== required.length')
    expect(script).toContain('node "${CHAIN_INSIGHTS_CLI}" mcp call graph_query')
    expect(script).toContain('USE topology MATCH')
    expect(script).not.toContain('IDENTITY_NETWORK')
    expect(script).not.toContain('bittensor_identity')
    expect(script).toContain('direct-network-capabilities.json')
    expect(script).toContain('checking public network capabilities')
    expect(script).toContain('direct-topology.json')
    expect(script).not.toContain(`--tool-arg "${retiredName('topology', '_scope=identity')}"`)
    expect(script).not.toContain(`--tool-arg "${retiredName('topology', '_scope=address')}"`)
    expect(script).toContain('checking public topology address-grain edges')
    expect(script).toContain('public topology address-grain edges ok')
    expect(script).toContain('direct-address-facts.json')
    expect(script).toContain('UAT_LINKED_ADDRESS="${UAT_LINKED_ADDRESS:-0x')
    expect(script).toContain('checking facts address query')
    expect(script).toContain('facts address query ok')
    expect(script).not.toContain('direct-address-scope-rejection.json')
    expect(script).not.toContain(retiredName('topology', '_scope must be identity'))
    expect(script).not.toContain('UAT_EXPOSURE_ACCOUNT')
    expect(script).not.toContain('EXPOSURE_ACCOUNT=')
  })

  it('keeps README product-first and moves debug/client detail to focused docs', () => {
    const readme = read('README.md')
    const mcpProxy = read('docs/mcp-proxy.md')
    const packageJson = read('package.json')

    expect(readme).toContain('open-source AML investigation toolkit')
    expect(readme).toContain('https://chain-insights.ai')
    expect(readme).toContain('https://www.npmjs.com/package/chain-insights')
    expect(readme).not.toContain('chainswarm/chain-insights')
    expect(readme).not.toContain('[GitHub](')
    expect(readme).not.toContain('devkit/README.md')
    expect(readme).not.toContain('blob/main/devkit')
    expect(readme).toContain('Chain Insights Graph')
    expect(readme).toContain('cia config set graphMcpEndpoint https://staging-mcp.chain-insights.ai/mcp')
    expect(readme).toContain('CHAIN_INSIGHTS_GRAPH_MCP_ENDPOINT=https://staging-mcp.chain-insights.ai/mcp')
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
    expect(readme).toContain('published/<workspace-slug>/')
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
    expect(mcpProxy).toContain('https://staging-mcp.chain-insights.ai/mcp')
    expect(mcpProxy).toContain('The endpoint lives in Chain Insights config, not in the MCP client registration.')
    expect(mcpProxy).toContain('Do not')
    expect(mcpProxy).toContain('bake hosted endpoint URLs into MCP client JSON, source code, or workspace')
    expect(mcpProxy).toContain('x402')
    expectNoRetiredHostedMcpHost(readme + mcpProxy + read('docs/architecture.md'))
  })

  it('positions Chain Insights as an editor-neutral workspace', () => {
    const readme = read('README.md')
    const investigation = read('docs/investigation-workspaces.md')
    const mcpProxy = read('docs/mcp-proxy.md')
    const graphTools = read('docs/graph-tools.md')

    expect(readme).toContain('Create an investigation workspace')
    expect(readme).not.toContain('obsidian')
    expect(readme).not.toMatch(/open as\s+(?:a\s+)?vault/i)

    for (const content of [investigation, mcpProxy, graphTools]) {
      expect(content.toLowerCase()).not.toContain('obsidian')
      expect(content).not.toMatch(/open as\s+(?:a\s+)?vault/i)
    }
  })

  it('documents workspace-local published outputs instead of external vault/export workflows', () => {
    const readme = read('README.md')
    const graphTools = read('docs/graph-tools.md')
    const investigation = read('docs/investigation-workspaces.md')
    const mcpProxy = read('docs/mcp-proxy.md')

    for (const content of [readme, graphTools, investigation, mcpProxy]) {
      expect(content).toContain('published/')
      expect(content.toLowerCase()).not.toContain('obsidian')
      expect(content).not.toMatch(/open as\s+(?:a\s+)?vault/i)
    }
  })

  it('does not hardcode hosted Chain Insights Graph endpoints in runtime source defaults', () => {
    const runtimeSources = [
      'src/config/mcp-endpoint.ts',
      'src/config/schema.ts',
      'src/config/index.ts',
      'src/workspace/init.ts',
    ].map(read).join('\n')

    expect(runtimeSources).toContain("http://127.0.0.1:8012/mcp")
    expect(runtimeSources).not.toContain('staging-mcp.chain-insights.ai')
    expectNoRetiredHostedMcpHost(runtimeSources)
  })

  it('ships Chain Insights developer experience guidance for AML tool contributors', () => {
    const skill = read('skills/chain-insights-developer-experience/SKILL.md')
    const contributing = read('docs/contributing.md')
    const debugging = read('docs/debugging.md')
    const development = read('docs/development.md')

    expect(skill).toContain('Chain Insights Developer Experience')
    expect(skill).toContain('Chain Insights Graph')
    expect(skill).toContain('AML tool framework')
    expect(skill).toContain('aml_address_risk')
    expect(skill).toContain('`topology`')
    expect(skill).toContain('`facts`')
    expect(skill).toContain('Dogfood from a clean workspace')
    expect(skill).toContain('workspace artifacts')
    expect(skill).not.toContain('obsidian-llmwiki')
    expect(skill).not.toContain('manifest.chain-insights.json')

    expect(contributing).toContain('Adding AML Tools')
    expect(contributing).toContain('Workspace artifact and report behavior.')
    expect(contributing).toContain('npm run release:check')
    expect(debugging).toContain('Chain Insights Graph')
    expect(debugging).toContain('Inspector')
    expect(development).toContain('docs/contributing.md')
    expect(development).toContain('docs/debugging.md')
  })

  it('ships generic Chain Insights Graph Cypher guidance with layer-aware schema capture', () => {
    const skill = read('skills/chain-insights-cypher/SKILL.md')
    const examples = read('skills/chain-insights-cypher/references/memgraph-examples.md')
    const openai = read('skills/chain-insights-cypher/agents/openai.yaml')
    const graphTools = read('docs/graph-tools.md')
    const mcpProxy = read('docs/mcp-proxy.md')
    const developerSkill = read('skills/chain-insights-developer-experience/SKILL.md')
    const investigationSkill = read('skills/chain-insights-investigation/SKILL.md')

    expect(skill).toContain('graph_query')
    expect(skill).toContain('graph_query_batch')
    expect(skill).toContain('USE topology')
    expect(skill).toContain('USE facts')
    expect(skill).toContain('linked_sample')
    expect(skill).toContain('USE topology MATCH (a:Address)-[l:LINKED]-(b:Address)')
    expect(skill).not.toContain('facts_linked_sample')
    expect(skill).toContain('Chain Insights Graph does not append')
    expect(skill).toContain('per_query_timeout_seconds=5')
    expect(skill).toContain('Future networks may expose different schemas')
    // Lifetime address metrics moved to topology node properties (rbmk#458
    // planner / rbmk#447 P3): the facts AddressFeature surface is retired.
    expect(skill).not.toContain('AddressFeature')
    expect(skill).toContain('tx_out_count')
    expect(skill).not.toContain('sent_count')
    expect(skill).not.toContain('AddressLabel')
    expect(skill).not.toContain('HAS_LABEL')
    expect(skill).toContain('label_risk')
    expect(skill).not.toContain('HAS_RISK_SCORE')
    expect(skill).toContain('risk_score')
    expect(skill).toContain('risk_level')
    expect(skill).toContain('native Memgraph Cypher')
    expect(skill).toContain('metadata functions (`keys()`, `labels()`, `type()`) are')
    expect(skill).toContain('references/memgraph-examples.md')
    expect(skill).toContain('fixed-hop')
    expect(skill).toContain('exchange hot wallets are terminal endpoints only')
    expect(skill).toContain('No raw StarRocks table names')
    expect(examples).toContain('Chain Insights Graph Cypher Examples')
    expect(examples).toContain('Official Memgraph references')
    expect(examples).toContain('Validated against the address-serving contract on 2026-07-07')
    expect(examples).toContain('Top outflows by amount')
    expect(examples).toContain('CASE WHEN flow.amount_usd_sum')
    expect(examples).toContain('WHERE a.address STARTS WITH')
    expect(examples).toContain('LINKED` ownership-overlay census by network')
    expect(examples).toContain('Fixed-Hop Traversal Fallback')
    expect(examples).toContain('*BFS')
    expect(examples).toContain('*WSHORTEST')
    expect(examples).toContain('*ALLSHORTEST')
    expect(examples).toContain('*KSHORTEST')
    expect(examples).toContain('native operators were rejected on staging')
    expect(examples).toContain('per_query_timeout_seconds=5')
    expect(examples).not.toContain('CREATE (')
    expect(examples).not.toContain('DETACH DELETE')
    expect(openai).toContain('Chain Insights Cypher')
    expect(graphTools).toContain('chain-insights-cypher')
    expect(graphTools).toContain('linked_sample')
    expect(graphTools).toContain('USE topology MATCH (a:Address)-[l:LINKED]-(b:Address)')
    expect(graphTools).not.toContain('facts_linked_sample')
    expect(graphTools).toContain('tx_out_count')
    expect(graphTools).not.toContain('sent_count')
    expect(graphTools).toContain('references/memgraph-examples.md')
    expect(graphTools).toContain('fixed-hop traversal fallbacks')
    expect(mcpProxy).toContain('chain-insights-cypher')
    expect(mcpProxy).toContain('Memgraph examples reference')
    expect(developerSkill).toContain('chain-insights-cypher')
    expect(investigationSkill).toContain('chain-insights-cypher')
  })

  it('ships Bittensor-specific Cypher schema guidance for the single public network with a property-split address space', () => {
    const skill = read('skills/chain-insights-bittensor-cypher/SKILL.md')
    const openai = read('skills/chain-insights-bittensor-cypher/agents/openai.yaml')
    const readme = read('README.md')
    const graphTools = read('docs/graph-tools.md')
    const mcpProxy = read('docs/mcp-proxy.md')

    expect(skill).toContain('network=bittensor')
    expect(skill).toContain('Substrate/SS58')
    expect(skill).toContain('EVM-pallet `0x...`')
    expect(skill).toContain('All Bittensor investigation runs on ONE public network')
    expect(skill).toContain('Always pass `network=bittensor`')
    expect(skill).not.toContain('Use `network=bittensor_evm`')
    expect(skill).not.toContain('Identity')
    expect(skill).not.toContain('HAS_ADDRESS')
    expect(skill).not.toContain('HAS_RISK_SCORE')
    expect(skill).toContain('LINKED')
    expect(skill).toContain('linked_sample')
    expect(skill).toContain('USE topology MATCH (a:Address)-[l:LINKED]-(b:Address)')
    expect(skill).not.toContain('facts_linked_sample')
    expect(skill).toContain('amount_usd_sum')
    expect(skill).not.toContain('legacy `bittensor_evm`')
    expect(skill).not.toContain('address_type')
    expect(skill).not.toContain('TopologySnapshot')
    expect(skill).not.toContain('REGISTERED_NEURON')
    expect(skill).not.toContain('SERVED_FROM')
    expect(skill).toContain('MINES')
    expect(skill).toContain('HOTKEY_OF')
    expect(skill).toContain('tx_out_count')
    expect(skill).toContain('tx_in_count')
    expect(skill).not.toContain('sent_count')
    expect(skill).not.toContain('received_count')
    expect(skill).toContain('Topology address grain')
    expect(skill).toContain('Observed against the address-serving contract on 2026-07-07')
    expect(skill).toContain('WHERE a.address STARTS WITH')
    expect(skill).toContain('Find likely address completions from a prefix')
    expect(skill).toContain('references/memgraph-examples.md')
    expect(skill).toContain('Memgraph deep traversal')
    expect(skill).toContain('facts StarRocks-backed numeric fields')
    expect(skill).toContain('Avoid `keys()`, `labels()`, `type()`')
    expect(openai).toContain('Bittensor Cypher')
    expect(readme).toContain('chain-insights-bittensor-cypher')
    expect(readme).toContain('linked')
    expect(readme).toContain('USE topology MATCH (a:Address)-[l:LINKED]-(b:Address)')
    expect(readme).not.toContain('USE facts MATCH (a:Address)-[l:LINKED]-(b:Address)')
    expect(graphTools).toContain('chain-insights-bittensor-cypher')
    expect(mcpProxy).toContain('chain-insights-bittensor-cypher')
  })
})
