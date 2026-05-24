import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()

function read(path: string): string {
  return readFileSync(join(root, path), 'utf8')
}

describe('shipped Chain Insights skills contract', () => {
  it('keeps investigation guidance on initialized workspaces and public fund-flow tools', () => {
    const skill = read('skills/chain-insights-investigation/SKILL.md')

    expect(skill).toContain('cia init .')
    expect(skill).toContain('No investigation output belongs under ~/.chain-insights')
    expect(skill).toContain('track_funds')
    expect(skill).toContain('scam_topology')
    expect(skill).toContain('single-address')
    expect(skill).toContain('trusted_addresses')
    expect(skill).toContain('Python GraphRAG MCP is the golden behavior')
    expect(skill).toContain('GraphRAGQueryEngine.check_address_risk')
    expect(skill).toContain('graph_query_batch')
    expect(skill).toContain('USE live_topology')
    expect(skill).toContain('USE archive_topology')
    expect(skill).toContain('USE facts')
    expect(skill).toContain('cia mcp networks')
    expect(skill).toContain('Dataset')
    expect(skill).toContain('<first_height>..<last_height> / <first_date>..<last_date>')
    expect(skill).toContain('Available tools')
    expect(skill).toContain('Current MemGQL does not parse')
    expect(skill).toContain('generated fixed-depth `FLOWS_TO` query batches')
    expect(skill).not.toContain('Use `trace_funds`')
    expect(skill).not.toContain('trace_funds')
  })

  it('documents fund-flow tracking through track_funds and workspace-local output layout', () => {
    const skill = read('skills/chain-insights-trace-funds/SKILL.md')

    expect(skill).toContain('# Chain Insights Fund Flow Tracking')
    expect(skill).toContain('track_funds')
    expect(skill).toContain('scam_topology')
    expect(skill).toContain('label_candidates')
    expect(skill).toContain('Victim/source addresses are not risky labels')
    expect(skill).toContain('single address')
    expect(skill).toContain('reports/graphs/*.graph.json')
    expect(skill).toContain('/graph-reports/<filename>.graph.json')
    expect(skill).toContain('reports/*.graph.html')
    expect(skill).toContain('reports/tables/*.compact-evidence.json')
    expect(skill).toContain('reports/tables/*.flows.csv')
    expect(skill).toContain('reports/*.table.html')
    expect(skill).toContain('reports/*.trace-report.md')
    expect(skill).toContain('No investigation output belongs under `~/.chain-insights`')
    expect(skill).toContain('cia mcp networks')
    expect(skill).toContain('Topology: yes')
    expect(skill).toContain('<first_height>..<last_height> / <first_date>..<last_date>')
    expect(skill).toContain('Python GraphRAG MCP is the golden implementation')
    expect(skill).toContain('StolenFundsProbe')
    expect(skill).toContain('Current MemGQL does not parse')
    expect(skill).toContain('generated fixed-depth `FLOWS_TO` query batches')
    expect(skill).not.toContain('trace_funds')
  })

  it('documents scam topology victim incident traversal and review-only labels', () => {
    const readme = read('README.md')
    const graphToolsDoc = read('docs/graph-tools.md')
    const traceFundsSkill = read('skills/chain-insights-trace-funds/SKILL.md')
    const investigationSkill = read('skills/chain-insights-investigation/SKILL.md')
    const combined = [readme, graphToolsDoc, traceFundsSkill, investigationSkill].join('\n')

    expect(combined).toContain('scam_topology')
    expect(combined).toContain('victim-only traversal is outward from victim/source funds')
    expect(combined).toContain('incident_timestamp_ms')
    expect(combined).toContain('exchange terminal safety')
    expect(combined).toContain('reviewable, not automatic writes')
    expect(combined).toContain('cia mcp scam-topology --network bittensor --victim-address 5... --incident-timestamp-ms 1715532228001 --max-hops 16')
  })

  it('replaces ci-case and ci-status placeholders with workspace guidance', () => {
    const ciCase = read('skills/ci-case/SKILL.md')
    const ciStatus = read('skills/ci-status/SKILL.md')

    expect(ciCase).toContain('cia init .')
    expect(ciCase).toContain('Cases live under the workspace `cases/` directory')
    expect(ciCase).not.toContain('placeholder')
    expect(ciCase).not.toContain('Phase 3')

    expect(ciStatus).toContain('workspace')
    expect(ciStatus).toContain('The workspace is the investigation root')
    expect(ciStatus).not.toContain('placeholder')
    expect(ciStatus).not.toContain('Config:  /home/user/.chain-insights')
    expect(ciStatus).not.toContain('~/.chain-insights` as')
  })

  it('keeps UAT guidance and scripts from treating home as an investigation output root', () => {
    const skill = read('skills/test-chain-insights-graphrag-mcp/SKILL.md')
    const investigationUat = read('skills/chain-insights-investigation/scripts/run-target-uat.sh')
    const graphragUat = read('skills/test-chain-insights-graphrag-mcp/scripts/run-uat.sh')

    expect(skill).toContain('temporary initialized Chain Insights workspace')
    expect(skill).toContain('chain-insights mcp networks')
    expect(skill).toContain('dataset height/date coverage')
    expect(skill).toContain('~/.chain-insights/reports')
    expect(skill).toContain('~/.chain-insights/cases')
    expect(skill).toContain('CLI graph_query')

    for (const script of [investigationUat, graphragUat]) {
      expect(script).toContain('GLOBAL_REPORTS="${HOME}/.chain-insights/reports"')
      expect(script).toContain('GLOBAL_CASES="${HOME}/.chain-insights/cases"')
      expect(script).toContain('CONFIG_SNAPSHOT_READY=0')
      expect(script).toContain('snapshot_global_outputs')
      expect(script).toContain('assert_no_global_outputs_changed')
      expect(script).toContain('trap finish EXIT')
    }

    expect(graphragUat).toContain('node "${CHAIN_INSIGHTS_CLI}" init "${WORKSPACE_ROOT}" --force')
    expect(graphragUat).toContain('export CHAIN_INSIGHTS_WORKSPACE="${WORKSPACE_ROOT}"')
    expect(graphragUat).toContain('cd "${WORKSPACE_ROOT}"')
    expect(graphragUat).toContain('node "${CHAIN_INSIGHTS_CLI}" debug on --token "${DEBUG_TOKEN}" --endpoint "${MCP_ENDPOINT}"')
    expect(graphragUat).toContain('--cli node "${CHAIN_INSIGHTS_PROXY}"')
    expect(graphragUat).not.toContain('--cli "node ${CHAIN_INSIGHTS_PROXY}"')
    expect(graphragUat).not.toContain('config set mcpEndpoint')
    expect(graphragUat).not.toContain('config set mcpAuthToken')
    expect(investigationUat).toContain('cia case session start "${CASE_ID}"')
    expect(investigationUat).toContain('cia case evidence add "${CASE_ID}"')
    expect(investigationUat).toContain('cia case show "${CASE_ID}"')
    expect(investigationUat).toContain('cia mcp call graph_query_batch')
    expect(investigationUat).toContain('USE live_topology')
  })

  it('requires only current public proxy tools in GraphRAG UAT', () => {
    const script = read('skills/test-chain-insights-graphrag-mcp/scripts/run-uat.sh')
    const proxySection = script.slice(script.indexOf('PROXY_TOOLS_JSON='))

    expect(proxySection).toContain(
      "const required = ['balance', 'help', 'address_risk', 'track_funds', 'scam_topology', 'network_capabilities', 'graph_query', 'graph_query_batch']",
    )
    expect(proxySection).toContain(
      "for (const hidden of ['topup', 'trace_funds', 'money_flows_between_exchanges', 'address_connection_risk'])",
    )
    expect(proxySection).toContain("for (const name of ['address_risk', 'track_funds', 'scam_topology'])")
    expect(proxySection).not.toContain("const required = ['balance', 'topup'")
    expect(proxySection).not.toContain("'money_flows_between_exchanges', 'address_connection_risk', 'graph_query']")
    expect(proxySection).not.toContain("for (const name of ['address_risk', 'track_funds', 'money_flows_between_exchanges'")
    expect(script).toContain('node "${CHAIN_INSIGHTS_CLI}" mcp call graph_query')
    expect(script).toContain('USE live_topology MATCH')
  })

  it('keeps README product-first and moves debug/client detail to focused docs', () => {
    const readme = read('README.md')

    expect(readme).toContain('AML investigation framework')
    expect(readme).toContain('GraphRAG MCP')
    expect(readme).toContain('address_risk')
    expect(readme).toContain('track_funds')
    expect(readme).toContain('scam_topology')
    expect(readme).toContain('graph_query')
    expect(readme).toContain('graph_query_batch')
    expect(readme).toContain('live_topology')
    expect(readme).toContain('archive_topology')
    expect(readme).toContain('facts')
    expect(readme).toContain('cia mcp networks')
    expect(readme).toContain('cia mcp tools --refresh')
    expect(readme).toContain('docs/contributing.md')
    expect(readme).toContain('docs/debugging.md')

    expect(readme).not.toContain('Claude Desktop')
    expect(readme).not.toContain('Go Graph MCP')
    expect(readme).not.toContain('chain-insights debug on')
    expect(readme).not.toContain('GRAPH_MCP_GO_DEBUG_BYPASS')
    expect(readme).not.toContain('Release rules:')
  })

  it('ships Chain Insights developer experience guidance for AML tool contributors', () => {
    const skill = read('skills/chain-insights-developer-experience/SKILL.md')
    const contributing = read('docs/contributing.md')
    const debugging = read('docs/debugging.md')
    const development = read('docs/development.md')

    expect(skill).toContain('Chain Insights Developer Experience')
    expect(skill).toContain('GraphRAG MCP')
    expect(skill).toContain('AML tool framework')
    expect(skill).toContain('address_risk')
    expect(skill).toContain('track_funds')
    expect(skill).toContain('scam_topology')
    expect(skill).toContain('live_topology')
    expect(skill).toContain('archive_topology')
    expect(skill).toContain('facts')
    expect(skill).toContain('Dogfood from a clean workspace')

    expect(contributing).toContain('Adding AML Tools')
    expect(contributing).toContain('npm run release:check')
    expect(debugging).toContain('GraphRAG MCP')
    expect(debugging).toContain('Inspector')
    expect(development).toContain('docs/contributing.md')
    expect(development).toContain('docs/debugging.md')
  })
})
