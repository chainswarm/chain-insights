/**
 * T2: `cia subscription buy` against a real anvil node with chain ID 4663.
 * The pinned McpPermitSink runtime and a plain ERC-20 are placed at the real
 * sink and $CIA addresses, so the buy runs on its own constants. The server
 * status is a function the test answers: it is the MCP server, not the node.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  http,
  keccak256,
  parseUnits,
  type Abi,
  type Address,
  type Hex,
} from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import type { SubscriptionStatusFacts } from '../src/mcp/subscription-status.js'
import { executeBuy, robinhoodBuyChain, type BuyChain } from '../src/subscription/buy.js'
import { CIA_TOKEN_ADDRESS, approveCiaForSubscription, robinhoodChain } from '../src/wallet/robinhood.js'

const SINK: Address = '0x67a8c068cc762e371706ea6c399178171f92810d'
const fixture = JSON.parse(readFileSync(join(process.cwd(), 'tests/fixtures/mcp-permit-sink.json'), 'utf8')) as {
  sink: { abi: Abi; bytecode: string; runtimeKeccak: string }
  token: { abi: Abi; bytecode: string }
}

function anvilBinary(): string {
  const candidates = [
    process.env['ANVIL_BIN'],
    ...(process.env['PATH'] ?? '').split(':').map((dir) => join(dir, 'anvil')),
    join(homedir(), '.foundry', 'bin', 'anvil'),
  ].filter((p): p is string => !!p)
  const found = candidates.find((p) => existsSync(p))
  if (!found) throw new Error('anvil is not installed: run ci/t2.sh, which fetches the pinned Foundry release')
  return found
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() => (typeof address === 'object' && address ? resolve(address.port) : reject(new Error('no port'))))
    })
  })
}

const anonymous: SubscriptionStatusFacts = {
  active: false,
  window_start: null,
  window_end: null,
  days_left: 0,
  daily_allowance_usd: 0,
  consumed_today_usd: 0,
  remaining_today_usd: 0,
  tier: 'anonymous',
  pending_payments: [],
}
const active: SubscriptionStatusFacts = {
  ...anonymous,
  active: true,
  window_start: '2026-10-28T10:00:00Z',
  window_end: '2026-10-29T10:00:00Z',
  days_left: 1,
  daily_allowance_usd: 10,
  remaining_today_usd: 10,
  tier: 'subscriber',
}
// 1 day at 0.01 USD per $CIA is 400 $CIA.
const PRICE = { usd: '0.01', updatedAt: new Date() }
const ONE_DAY = parseUnits('400', 18)

describe('cia subscription buy on anvil (chain ID 4663)', () => {
  let anvil: ChildProcess
  let rpcUrl: string
  let env: NodeJS.ProcessEnv
  let reader: ReturnType<typeof createPublicClient>
  let test: ReturnType<typeof createTestClient>

  beforeAll(async () => {
    const port = await freePort()
    rpcUrl = `http://127.0.0.1:${port}`
    anvil = spawn(anvilBinary(), ['--chain-id', '4663', '--port', String(port), '--silent'], { stdio: 'ignore' })
    reader = createPublicClient({ chain: robinhoodChain, transport: http(rpcUrl) })
    test = createTestClient({ chain: robinhoodChain, mode: 'anvil', transport: http(rpcUrl) })
    for (let i = 0; ; i++) {
      try {
        expect(await reader.getChainId()).toBe(4663)
        break
      } catch (err) {
        if (i > 100) throw err
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
    }
    env = { ROBINHOOD_RPC_URL: rpcUrl }

    // Deploy both contracts with a funded deployer, then copy their runtime
    // code to the real sink and $CIA addresses.
    const deployerKey = generatePrivateKey()
    const deployer = privateKeyToAccount(deployerKey)
    await test.setBalance({ address: deployer.address, value: parseUnits('10', 18) })
    const writer = createWalletClient({ account: deployer, chain: robinhoodChain, transport: http(rpcUrl) })
    const deploy = async (abi: Abi, bytecode: string, args: unknown[]) => {
      const hash = await writer.deployContract({ abi, bytecode: `0x${bytecode}` as Hex, args })
      const receipt = await reader.waitForTransactionReceipt({ hash })
      return (await reader.getCode({ address: receipt.contractAddress! }))!
    }
    const sinkRuntime = await deploy(fixture.sink.abi, fixture.sink.bytecode, [])
    expect(keccak256(sinkRuntime).slice(2)).toBe(fixture.sink.runtimeKeccak)
    const tokenRuntime = await deploy(fixture.token.abi, fixture.token.bytecode, ['Chain Insights', 'CIA', 18])
    await test.setCode({ address: SINK, bytecode: sinkRuntime })
    await test.setCode({ address: CIA_TOKEN_ADDRESS, bytecode: tokenRuntime })
  })

  afterAll(() => {
    anvil?.kill()
  })

  /** A new wallet with gas and `cia` $CIA minted to it. */
  async function fundedWallet(cia: bigint) {
    const privateKey = generatePrivateKey()
    const account = privateKeyToAccount(privateKey)
    await test.setBalance({ address: account.address, value: parseUnits('1', 18) })
    const minter = createWalletClient({ account, chain: robinhoodChain, transport: http(rpcUrl) })
    const hash = await minter.writeContract({
      address: CIA_TOKEN_ADDRESS,
      abi: fixture.token.abi,
      functionName: 'mint',
      args: [account.address, cia],
    })
    await reader.waitForTransactionReceipt({ hash })
    return { address: account.address, privateKey, account }
  }

  const balanceOf = (address: Address) =>
    reader.readContract({ address: CIA_TOKEN_ADDRESS, abi: fixture.token.abi, functionName: 'balanceOf', args: [address] }) as Promise<bigint>

  function buyOnce(wallet: { address: string; privateKey: Hex }, chain: BuyChain) {
    let reads = 0
    let clock = 0
    const run = executeBuy({
      account: wallet,
      days: 1,
      chain,
      readStatus: async () => (reads++ === 0 ? anonymous : active),
      fetchPrice: async () => PRICE,
      confirm: async () => true,
      now: () => clock,
      sleep: async (ms) => void (clock += ms),
    })
    return { run, reads: () => reads }
  }

  it('approve then deposit emits Received from the wallet for the exact amount', async () => {
    const wallet = await fundedWallet(parseUnits('1000', 18))
    const sinkBefore = await balanceOf(SINK)
    const { run } = buyOnce(wallet, robinhoodBuyChain(env))
    const result = await run
    expect(result.approve_tx).not.toBeNull()
    expect(result.amount_cia).toBe('400')
    expect(result.grant).toMatchObject({ outcome: 'granted', window_end: active.window_end })
    expect(result.deposit_url).toBe(`https://robin.etherscan.io/tx/${result.deposit_tx}`)
    expect((await balanceOf(SINK)) - sinkBefore).toBe(ONE_DAY)
    expect(await balanceOf(wallet.address as Address)).toBe(parseUnits('600', 18))
    const receipt = await reader.getTransactionReceipt({ hash: result.deposit_tx as Hex })
    expect(receipt.from.toLowerCase()).toBe(wallet.address.toLowerCase())
    expect(receipt.to?.toLowerCase()).toBe(SINK)
  })

  it('a second buy with enough allowance sends one transaction', async () => {
    const wallet = await fundedWallet(parseUnits('1000', 18))
    const approval = await approveCiaForSubscription(wallet.privateKey, parseUnits('800', 18), env)
    expect(approval.status).toBe('success')
    const nonceBefore = await reader.getTransactionCount({ address: wallet.address })
    const { run } = buyOnce(wallet, robinhoodBuyChain(env))
    const result = await run
    expect(result.approve_tx).toBeNull()
    expect(await reader.getTransactionCount({ address: wallet.address })).toBe(nonceBefore + 1)
  })

  it('a reverted deposit stops before polling', async () => {
    const wallet = await fundedWallet(parseUnits('1000', 18))
    const real = robinhoodBuyChain(env)
    // The tokens leave the wallet between the plan and the deposit, so the
    // node refuses the deposit's transfer.
    const chain: BuyChain = {
      ...real,
      deposit: async (key, amount, chainEnv) => {
        const mover = createWalletClient({ account: wallet.account, chain: robinhoodChain, transport: http(rpcUrl) })
        const hash = await mover.writeContract({
          address: CIA_TOKEN_ADDRESS,
          abi: fixture.token.abi,
          functionName: 'transfer',
          args: ['0x000000000000000000000000000000000000dEaD', parseUnits('1000', 18)],
        })
        await reader.waitForTransactionReceipt({ hash })
        return real.deposit(key, amount, chainEnv)
      },
    }
    const sinkBefore = await balanceOf(SINK)
    const { run, reads } = buyOnce(wallet, chain)
    await expect(run).rejects.toThrow()
    expect(reads()).toBe(1)
    expect(await balanceOf(SINK)).toBe(sinkBefore)
  })
})
