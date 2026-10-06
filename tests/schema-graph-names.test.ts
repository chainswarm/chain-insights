import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// The EVM schema skill and the graph query compatibility guide describe the
// graph as it is built now: one section per link type, the ten ML pattern link
// types, role words, and none of the retired names or Bittensor labels.

const root = process.cwd()

function read(path: string): string {
  return readFileSync(join(root, path), 'utf8')
}

const SKILL = 'skills/chain-insights-schema-evm/SKILL.md'
const COMPAT = 'docs/graph-query-compatibility.md'
const GRAPH_TOOLS = 'docs/graph-tools.md'
const PROXY = 'src/mcp/proxy.ts'

// Every file a reader is served, walked, so no file can keep an old wording.
function filesUnder(dir: string): string[] {
  return readdirSync(join(root, dir)).flatMap((name) => {
    const path = `${dir}/${name}`
    return statSync(join(root, path)).isDirectory() ? filesUnder(path) : [path]
  })
}

const SERVED_FILES = ['src', 'skills', 'docs']
  .flatMap(filesUnder)
  .filter((file) => /\.(md|ts|json|cjs)$/.test(file))

const LINK_TYPES = [
  'APPROVED',
  'DEPLOYED_CONTRACT',
  'SPONSORED',
  'BUNDLED',
  'SIGNED_FOR',
  'SIGNED_AUTHORIZATION',
] as const

const ML_PATTERN_TYPES = [
  'CYCLE_PARTICIPANT',
  'LAYERING_HOP',
  'SMURFING_CLUSTER',
  'SYBIL_CLUSTER',
  'MOTIF_PARTICIPANT',
  'RISK_PROXIMITY',
  'BURST_ACTIVITY',
  'DORMANT_REACTIVATION',
  'THRESHOLD_EVASION',
  'FLASH_LOAN_ENVELOPE',
] as const

const RETIRED = [
  'first_tx_id',
  'last_tx_id',
  'bucket_start_timestamp',
  'bucket_end_timestamp',
  'owner_last_height',
  'BRIDGE_CROSSED',
  ':Instrument',
  ':Subnet',
  ':Coinbase',
  ':Neuron',
]

describe.each([SKILL, COMPAT])('%s', (file) => {
  const text = read(file).replace(/\s+/g, ' ')

  it('names no retired property and no Bittensor label', () => {
    for (const name of RETIRED) expect(text.includes(name), `${file} names ${name}`).toBe(false)
  })

  it.each(LINK_TYPES)('describes %s', (type) => {
    expect(text.includes(`\`${type}\``), `${file} does not name ${type}`).toBe(true)
  })

  it('describes the EIP-7702 link: a SET_CODE authorization, and a permit lands on APPROVED', () => {
    expect(text).toContain('EIP-7702')
    expect(text).toContain('`SET_CODE`')
    expect(text).toMatch(/permit lands on `APPROVED`, never here/)
  })

  it('names both DEX layers setting :Pool', () => {
    expect(text).toMatch(/Both DEX layers set `:Pool`|Both DEX layers set it/)
    expect(text).toMatch(/pool with liquidity and no swap carries it/)
  })

  it('keys BRIDGED.totals_raw by event kind and asset, and gives LINKED a last_height', () => {
    expect(text).toMatch(/totals_raw`[^.]{0,80}event kind and asset/)
    expect(text).toMatch(/`last_height`/)
  })
})

describe('the schema skill sections', () => {
  const skill = read(SKILL)

  it.each(LINK_TYPES)('has a "## %s properties" section', (type) => {
    expect(skill).toContain(`\n## ${type} properties\n`)
  })

  it('gives APPROVED its token lists and height pair', () => {
    const start = skill.indexOf('\n## APPROVED properties\n')
    const body = skill.slice(start, skill.indexOf('\n## ', start + 4))
    for (const property of [
      'granted_tokens',
      'infinite_tokens',
      'has_infinite_grant',
      'first_height',
      'last_height',
    ]) {
      expect(body.includes(property), `APPROVED lacks ${property}`).toBe(true)
    }
  })

  it('gives SIGNED_AUTHORIZATION source_event and the height pair, and DEPLOYED_CONTRACT a kind', () => {
    const at = (heading: string) => {
      const start = skill.indexOf(`\n## ${heading} properties\n`)
      return skill.slice(start, skill.indexOf('\n## ', start + 4))
    }
    for (const property of ['source_event', 'first_height', 'last_height']) {
      expect(at('SIGNED_AUTHORIZATION').includes(property), `lacks ${property}`).toBe(true)
    }
    expect(at('DEPLOYED_CONTRACT')).toContain('`kind`')
  })
})

// OPERATED_BY points at the actor, not at an approval (design.md, "Merge rules
// that are not a plain add"; decision log R10 and R16).
describe('OPERATED_BY is the transaction sender, never the approved spender', () => {
  const SENTENCE =
    "the transaction sender that moved the owner's tokens (ERC-20/721), or the event operator (ERC-1155); not the approved spender"

  it.each([SKILL, COMPAT, GRAPH_TOOLS, PROXY])('%s gives the ruled sentence', (file) => {
    const text = read(file).replace(/\s+/g, ' ')
    expect(text.includes(SENTENCE), `${file} lacks the ruled OPERATED_BY sentence`).toBe(true)
    // The task check greps line by line: the closing words stay on one line.
    expect(read(file).includes('not the approved spender'), `${file} wraps the closing words`).toBe(
      true
    )
  })

  it('no file under src, skills or docs calls the destination an approved operator', () => {
    for (const file of SERVED_FILES) {
      const text = read(file).replace(/\s+/g, ' ')
      expect(/approved operator/i.test(text), `${file} says approved operator`).toBe(false)
      expect(/operator executed transfers on the owner/i.test(text), `${file} says on behalf`).toBe(
        false
      )
      expect(/executed a transfer on the owner/i.test(text), `${file} says on behalf`).toBe(false)
    }
  })
})

// EVM only on the reader side: the Bittensor schema skill and every link to it
// are gone. Past CHANGELOG.md entries stay as history (decision log R11). The
// installer is the one file that still names it, in its retired-skill list, so
// an install from an earlier release deletes the old copy (decision log R25).
describe('the Bittensor schema skill is gone', () => {
  const NAME = ['chain-insights', 'schema', 'bittensor'].join('-')

  it('ships no folder for it', () => {
    expect(existsSync(join(root, 'skills', NAME))).toBe(false)
  })

  it('no served file or contract test links to it', () => {
    const files = [
      ...SERVED_FILES,
      'README.md',
      ...filesUnder('tests').filter((file) => /\.(ts|json)$/.test(file)),
    ]
    for (const file of files) {
      expect(read(file).includes(NAME), `${file} names ${NAME}`).toBe(false)
    }
  })

  it('the installer lists it as retired and never as a shipped skill', () => {
    const installer = read('bin/install.cjs')
    const list = (name: string): string => {
      const match = new RegExp(`const ${name} = Object\\.freeze\\(\\[([^\\]]*)\\]\\)`).exec(
        installer
      )
      expect(match, `bin/install.cjs has no ${name} list`).not.toBeNull()
      return match?.[1] ?? ''
    }
    expect(list('RETIRED_SKILL_NAMES')).toContain(`'${NAME}'`)
    expect(list('PUBLIC_SKILL_NAMES')).not.toContain(NAME)
  })
})

// The ML layer writes the run id in the property run_id (decision log R3). The
// risk layer is off on the live server (layers.risk.enabled is false), so the
// schema skill no longer maps the ML pattern links or the risk verdict. The
// compatibility guide still does.
describe('the ML pattern links', () => {
  const guide = read(COMPAT).replace(/\s+/g, ' ')

  it('the compatibility guide names the ten ML pattern link types, FLASH_LOAN_ENVELOPE included', () => {
    for (const type of ML_PATTERN_TYPES) {
      expect(guide.includes(`\`${type}\``), `${COMPAT} does not name ${type}`).toBe(true)
    }
  })

  it('the compatibility guide names run_id as the run id property, beside kind and source_event', () => {
    expect(guide).toMatch(/`kind`, `source_event` `ml_pattern` and the run id in `run_id`/)
  })
})

describe('the schema skill maps only what the live server serves', () => {
  const skill = read(SKILL)

  it('says the risk layer is off and names no ML pattern link or risk verdict as served', () => {
    expect(skill).toContain('Not served today: the risk layer is off')
    expect(skill).toContain('`layers.risk.enabled` is false')
    // The one place the schema skill names the verdict fields and RISK_PROXIMITY is
    // that sentence. No table, section or probe maps them.
    for (const name of ['risk_score', 'risk_level', 'RISK_PROXIMITY']) {
      const uses = skill.match(new RegExp(String.raw`\b${name}\b`, 'g')) ?? []
      expect(uses.length, `${name} appears outside the not-served note`).toBe(1)
    }
    for (const type of ML_PATTERN_TYPES.filter((candidate) => candidate !== 'RISK_PROXIMITY')) {
      expect(skill.includes(type), `${SKILL} names ${type}`).toBe(false)
    }
    expect(skill).not.toContain('UNSCORED')
  })

  it('names the account-abstraction and protocol labels the live graph carries', () => {
    for (const label of ['SmartAccount', 'Bundler', 'Paymaster', 'EntryPoint', 'Protocol']) {
      expect(skill, `${SKILL} does not name ${label}`).toContain(`\`${label}\``)
    }
    expect(skill).toContain('`token_standard`')
  })
})
