import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  META_SUBSCRIPTION_STATUS_DESCRIPTION,
  SUBSCRIPTION_RULES,
  SUBSCRIPTION_TOPUP_DESCRIPTION,
  WALLET_TOPUP_DESCRIPTION,
} from '../src/subscription/rules.js'
import { KNOWN_PUBLIC_TOOL_DESCRIPTIONS } from '../src/mcp/proxy.js'

// Claude Desktop chat loads no skill: the rules ride on every subscription
// tool description, and the core skill repeats them for hosts that load it.
const descriptions = {
  meta_subscription_status: META_SUBSCRIPTION_STATUS_DESCRIPTION,
  subscription_topup: SUBSCRIPTION_TOPUP_DESCRIPTION,
  wallet_topup: WALLET_TOPUP_DESCRIPTION,
}

describe('the subscription rules reach every host', () => {
  it('every subscription tool description says buying is CLI only', () => {
    for (const [tool, text] of Object.entries(descriptions)) {
      expect(text, tool).toContain('`cia subscription buy --days N`')
      expect(text, tool).toContain('An agent never buys')
      expect(text, tool).toContain(SUBSCRIPTION_RULES)
    }
    expect(KNOWN_PUBLIC_TOOL_DESCRIPTIONS.meta_subscription_status).toBe(META_SUBSCRIPTION_STATUS_DESCRIPTION)
  })

  it('every subscription tool description says never send $CIA by hand', () => {
    for (const [tool, text] of Object.entries(descriptions)) {
      expect(text, tool).toContain('Never send $CIA by hand to any other address')
    }
  })

  it('wallet_topup and subscription_topup each name the other door', () => {
    expect(WALLET_TOPUP_DESCRIPTION).toContain('subscription_topup is $CIA')
    expect(SUBSCRIPTION_TOPUP_DESCRIPTION).toContain('wallet_topup is USDC on Base')
  })

  it('the cypher skill names subscription_topup and cia subscription buy', () => {
    for (const root of ['skills', join('plugin', 'skills')]) {
      const skill = readFileSync(join(process.cwd(), root, 'chain-insights-cypher', 'SKILL.md'), 'utf8')
      expect(skill, root).toContain('`subscription_topup`')
      expect(skill, root).toContain('`cia subscription buy --days N`')
      expect(skill, root).toContain('no tool\n   can buy or pay')
    }
  })
})
