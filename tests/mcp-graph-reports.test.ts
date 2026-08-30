import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

describe('MCP graph report store', () => {
  let fakeHome: string
  let workspace: string
  let previousHome: string | undefined
  let previousWorkspace: string | undefined

  beforeEach(async () => {
    fakeHome = join(
      tmpdir(),
      `ci-graph-reports-home-${Date.now()}-${Math.random().toString(36).slice(2)}`
    )
    workspace = join(
      tmpdir(),
      `ci-graph-reports-workspace-${Date.now()}-${Math.random().toString(36).slice(2)}`
    )
    await mkdir(fakeHome, { recursive: true })
    await mkdir(join(workspace, '.chain-insights'), { recursive: true })
    await writeFile(
      join(workspace, '.chain-insights', 'workspace.json'),
      JSON.stringify({
        schema: 'chain-insights.workspace.v1',
        workspace_root: workspace,
      }) + '\n'
    )
    previousHome = process.env['HOME']
    previousWorkspace = process.env['CHAIN_INSIGHTS_WORKSPACE']
    process.env['HOME'] = fakeHome
    process.env['CHAIN_INSIGHTS_WORKSPACE'] = workspace
  })

  afterEach(async () => {
    vi.useRealTimers()
    process.env['HOME'] = previousHome
    if (previousWorkspace === undefined) delete process.env['CHAIN_INSIGHTS_WORKSPACE']
    else process.env['CHAIN_INSIGHTS_WORKSPACE'] = previousWorkspace
    await rm(fakeHome, { recursive: true, force: true })
    await rm(workspace, { recursive: true, force: true })
  })

  it('writes canonical graph JSON under reports/graphs and returns a Hono graph report URL', async () => {
    const { writeGraphReport } = await import('../src/mcp/graph-reports.js')

    const report = await writeGraphReport(
      {
        schema: 'chain-insights.graph.v1',
        nodes: [
          {
            address: '5Exchange',
            labels: ['Address', 'Exchange', 'Binance'],
          },
        ],
        edges: [{ source: '5Seed', target: '5Exchange', type: 'FLOWS_TO' }],
        flows: [],
        edge_anchors: [],
      },
      {
        serverPort: 4567,
        slug: 'Address Risk 5Seed',
      }
    )

    expect(report.schema).toBe('chain-insights.graph.v1')
    expect(report.filename).toMatch(
      /^\d{8}T\d{6}\d{3}Z-address-risk-5seed-[a-z0-9-]+\.graph\.json$/
    )
    expect(report.path).toBe(join(workspace, 'reports', 'graphs', report.filename))
    expect(report.url).toBe(`http://127.0.0.1:4567/graph-reports/${report.filename}`)

    const raw = await readFile(report.path, 'utf8')
    expect(JSON.parse(raw)).toMatchObject({
      schema: 'chain-insights.graph.v1',
      nodes: [
        {
          address: '5Exchange',
          node_type: 'address',
          labels: ['Binance'],
          roles: ['exchange'],
        },
      ],
      edges: [
        {
          source: '5Seed',
          target: '5Exchange',
          edge_type: 'flows_to',
        },
      ],
      flows: [],
      edge_anchors: [],
    })

    await expect(stat(join(workspace, 'artifacts'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(stat(join(fakeHome, '.chain-insights', 'artifacts'))).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })

  it('defaults optional flows and edge_anchors while requiring node and edge arrays', async () => {
    const { writeGraphReport } = await import('../src/mcp/graph-reports.js')

    const report = await writeGraphReport(
      {
        schema: 'chain-insights.graph.v1',
        nodes: [{ id: '5Seed' }],
        edges: [],
      },
      {
        serverPort: 4567,
        slug: 'minimal',
      }
    )

    const raw = await readFile(report.path, 'utf8')
    expect(JSON.parse(raw)).toMatchObject({
      schema: 'chain-insights.graph.v1',
      nodes: [{ id: '5Seed' }],
      edges: [],
      flows: [],
      edge_anchors: [],
    })
  })

  it('sanitizes unsafe slugs and falls back to graph for empty slugs', async () => {
    const { writeGraphReport } = await import('../src/mcp/graph-reports.js')

    const unsafe = await writeGraphReport(
      {
        schema: 'chain-insights.graph.v1',
        nodes: [],
        edges: [],
      },
      {
        serverPort: 4567,
        slug: '../A Weird Report!!',
      }
    )
    const fallback = await writeGraphReport(
      {
        schema: 'chain-insights.graph.v1',
        nodes: [],
        edges: [],
      },
      {
        serverPort: 4567,
        slug: '...///',
      }
    )

    expect(unsafe.filename).toMatch(/-a-weird-report-[a-z0-9-]+\.graph\.json$/)
    expect(fallback.filename).toMatch(/-graph-[a-z0-9-]+\.graph\.json$/)
    expect(unsafe.path).toBe(join(workspace, 'reports', 'graphs', unsafe.filename))
    expect(fallback.path).toBe(join(workspace, 'reports', 'graphs', fallback.filename))
  })

  it('keeps same-slug rapid writes separate without overwriting', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-17T08:30:45.123Z'))

    const { writeGraphReport } = await import('../src/mcp/graph-reports.js')

    const first = await writeGraphReport(
      {
        schema: 'chain-insights.graph.v1',
        nodes: [{ id: 'first' }],
        edges: [],
      },
      {
        serverPort: 4567,
        slug: 'same slug',
      }
    )
    const second = await writeGraphReport(
      {
        schema: 'chain-insights.graph.v1',
        nodes: [{ id: 'second' }],
        edges: [],
      },
      {
        serverPort: 4567,
        slug: 'same slug',
      }
    )

    expect(first.filename).not.toBe(second.filename)
    expect(first.path).not.toBe(second.path)
    expect(first.filename).toMatch(/^20260517T083045123Z-same-slug-[a-z0-9-]+\.graph\.json$/)
    expect(second.filename).toMatch(/^20260517T083045123Z-same-slug-[a-z0-9-]+\.graph\.json$/)

    const firstGraph = JSON.parse(await readFile(first.path, 'utf8')) as {
      nodes: Array<{ id: string }>
    }
    const secondGraph = JSON.parse(await readFile(second.path, 'utf8')) as {
      nodes: Array<{ id: string }>
    }

    expect(firstGraph.nodes[0]?.id).toBe('first')
    expect(secondGraph.nodes[0]?.id).toBe('second')
  })

  it('rejects malformed graph arrays before writing a report file', async () => {
    const { writeGraphReport } = await import('../src/mcp/graph-reports.js')

    await expect(
      writeGraphReport(
        {
          schema: 'chain-insights.graph.v1',
          nodes: 'not-array',
          edges: [],
          flows: [],
          edge_anchors: [],
        },
        {
          serverPort: 4567,
          slug: 'bad',
        }
      )
    ).rejects.toThrow('Invalid graph payload')

    await expect(
      writeGraphReport(
        {
          schema: 'chain-insights.graph.v1',
          nodes: [],
          edges: [],
          flows: 'not-array',
        },
        {
          serverPort: 4567,
          slug: 'bad-flows',
        }
      )
    ).rejects.toThrow('Invalid graph payload')

    await expect(stat(join(workspace, 'reports', 'graphs'))).rejects.toMatchObject({
      code: 'ENOENT',
    })
    await expect(stat(join(workspace, 'artifacts'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects unsupported graph schemas', async () => {
    const { writeGraphReport } = await import('../src/mcp/graph-reports.js')

    await expect(
      writeGraphReport(
        {
          schema: 'chain-insights.graph.v2',
          nodes: [],
          edges: [],
        },
        {
          serverPort: 4567,
          slug: 'bad-schema',
        }
      )
    ).rejects.toThrow('Unsupported graph payload schema: chain-insights.graph.v2')
  })

  it('hardens existing reports directories', async () => {
    if (process.platform === 'win32') {
      return
    }

    const { writeGraphReport } = await import('../src/mcp/graph-reports.js')
    const reportsDir = join(workspace, 'reports')
    const graphsDir = join(workspace, 'reports', 'graphs')
    await mkdir(graphsDir, { recursive: true, mode: 0o755 })

    const report = await writeGraphReport(
      {
        schema: 'chain-insights.graph.v1',
        nodes: [],
        edges: [],
      },
      {
        serverPort: 4567,
        slug: 'permissions',
      }
    )

    const reportsDirStat = await stat(reportsDir)
    const graphsDirStat = await stat(graphsDir)
    const fileStat = await stat(report.path)

    expect(reportsDirStat.mode & 0o777).toBe(0o700)
    expect(graphsDirStat.mode & 0o777).toBe(0o700)
    expect(fileStat.mode & 0o777).toBe(0o600)
  })
})
