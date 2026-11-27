import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { cpSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  PRODUCTION_GRAPH_MCP_ENDPOINT,
  STAGING_GRAPH_MCP_ENDPOINT,
  selectGraphMcpEndpoint,
} from '../src/config/mcp-endpoint.js'
import { readReleaseChannel } from '../src/version.js'

const LOCAL = 'http://127.0.0.1:8012/mcp'

describe('the npm tag picks the default endpoint', () => {
  it.each([
    { name: 'next reads staging', channel: 'next', want: STAGING_GRAPH_MCP_ENDPOINT },
    { name: 'latest reads production', channel: 'latest', want: PRODUCTION_GRAPH_MCP_ENDPOINT },
    { name: 'no stamp reads production', channel: undefined, want: PRODUCTION_GRAPH_MCP_ENDPOINT },
    { name: 'another tag reads production', channel: 'beta', want: PRODUCTION_GRAPH_MCP_ENDPOINT },
    {
      name: 'the env override wins on next',
      channel: 'next',
      env: { CHAIN_INSIGHTS_GRAPH_MCP_ENDPOINT: PRODUCTION_GRAPH_MCP_ENDPOINT },
      want: PRODUCTION_GRAPH_MCP_ENDPOINT,
    },
    {
      name: 'the legacy env name wins on latest',
      channel: 'latest',
      env: { GRAPH_MCP_ENDPOINT: STAGING_GRAPH_MCP_ENDPOINT },
      want: STAGING_GRAPH_MCP_ENDPOINT,
    },
    {
      name: 'the env override wins over a saved choice',
      channel: 'next',
      env: { CHAIN_INSIGHTS_GRAPH_MCP_ENDPOINT: LOCAL },
      saved: 'https://mcp.example.test/',
      want: LOCAL,
    },
    { name: 'a saved choice wins on next', channel: 'next', saved: LOCAL, want: LOCAL },
    {
      name: 'a saved staging endpoint wins on latest',
      channel: 'latest',
      saved: STAGING_GRAPH_MCP_ENDPOINT,
      want: STAGING_GRAPH_MCP_ENDPOINT,
    },
    {
      name: 'a saved production endpoint is the old default, so next still reads staging',
      channel: 'next',
      saved: PRODUCTION_GRAPH_MCP_ENDPOINT,
      want: STAGING_GRAPH_MCP_ENDPOINT,
    },
  ])('$name', ({ channel, env, saved, want }) => {
    expect(selectGraphMcpEndpoint({ channel, env: env ?? {}, saved })).toBe(want)
  })

  it('reads the channel from the stamped file, and nothing from a missing or broken one', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ci-channel-'))
    try {
      const file = join(dir, 'channel.json')
      expect(readReleaseChannel(pathToFileURL(file))).toBeUndefined()
      writeFileSync(file, '{"channel":"next"}\n')
      expect(readReleaseChannel(pathToFileURL(file))).toBe('next')
      writeFileSync(file, '{ broken')
      expect(readReleaseChannel(pathToFileURL(file))).toBeUndefined()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

// The publish workflow stamps the tag after the build and packs with
// --ignore-scripts. This packs a copy of the built package the same way and
// runs the CLI from it, so a pack that loses the file, or a bundle that looks
// for it in the wrong place, fails here.
describe('the packed package carries its channel', () => {
  const root = process.cwd()

  // Needs the build in dist/, as the other CLI tests do (ci/t1.sh builds first).
  it('a next tarball holds dist/channel.json and its CLI reads staging', () => {
    const work = mkdtempSync(join(tmpdir(), 'ci-pack-'))
    try {
      const pkg = join(work, 'pkg')
      cpSync(join(root, 'package.json'), join(pkg, 'package.json'))
      cpSync(join(root, 'bin'), join(pkg, 'bin'), { recursive: true })
      cpSync(join(root, 'dist'), join(pkg, 'dist'), { recursive: true })
      rmSync(join(pkg, 'dist', 'channel.json'), { force: true })
      execFileSync(
        'node',
        [join(root, 'scripts', 'stamp-release-channel.mjs'), 'next', join(pkg, 'dist')],
        { encoding: 'utf8' }
      )

      const packed = JSON.parse(
        execFileSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', work], {
          cwd: pkg,
          encoding: 'utf8',
        })
      ) as Array<{ filename: string; files: Array<{ path: string }> }>
      expect(packed[0]!.files.map((f) => f.path)).toContain('dist/channel.json')
      const tarball = join(work, packed[0]!.filename)
      expect(
        execFileSync('tar', ['-xOf', tarball, 'package/dist/channel.json'], { encoding: 'utf8' })
      ).toBe('{"channel":"next"}\n')

      const unpacked = join(work, 'unpacked')
      execFileSync('mkdir', ['-p', unpacked])
      execFileSync('tar', ['-xf', tarball, '-C', unpacked])
      symlinkSync(join(root, 'node_modules'), join(unpacked, 'package', 'node_modules'))
      const home = join(work, 'home')
      const env = { ...process.env, HOME: home }
      delete env['CHAIN_INSIGHTS_GRAPH_MCP_ENDPOINT']
      delete env['GRAPH_MCP_ENDPOINT']
      const status = execFileSync('node', [join(unpacked, 'package', 'bin', 'cli.js'), 'status'], {
        encoding: 'utf8',
        env,
      })
      expect(status).toContain(
        `Graph endpoint: ${STAGING_GRAPH_MCP_ENDPOINT} (staging, npm tag next)`
      )
    } finally {
      rmSync(work, { recursive: true, force: true })
    }
  })
})
