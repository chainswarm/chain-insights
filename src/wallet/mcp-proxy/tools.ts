import type { WalletData } from "./types.js";
import { createPublicClient, http, formatUnits } from "viem";
import { base } from "viem/chains";

const USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
const USDC_ABI = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export async function getBalanceUsdc(wallet: WalletData): Promise<string> {
  try {
    const rpcUrl = process.env.BASE_RPC_URL ?? "https://base.llamarpc.com";
    const client = createPublicClient({ chain: base, transport: http(rpcUrl) });
    const balance = await client.readContract({
      address: USDC_ADDRESS,
      abi: USDC_ABI,
      functionName: "balanceOf",
      args: [wallet.address as `0x${string}`],
    });
    return formatUnits(balance, 6);
  } catch {
    return "unknown";
  }
}

export async function getBalance(wallet: WalletData): Promise<string> {
  const balance = await getBalanceUsdc(wallet);
  const approxCalls = balance !== "unknown" ? `~${Math.floor(parseFloat(balance) * 100)} standard tool calls` : "";
  return [
    `Balance: ${balance} USDC`,
    `Network: Base`,
    `Address: ${wallet.address}`,
    approxCalls ? `Capacity: ${approxCalls}` : "",
  ].filter(Boolean).join("\n");
}

export function getTopupInfo(wallet: WalletData): string {
  return JSON.stringify({
    wallet_address: wallet.address,
    network: "Base (Chain ID 8453)",
    token: "USDC",
    contract: USDC_ADDRESS,
    instructions: [
      `Send USDC on Base network to: ${wallet.address}`,
      "You can use MetaMask, Coinbase Wallet, or any Base-compatible wallet",
      "Minimum recommended: $1.00 USDC (100 tool calls at $0.01 each)",
    ],
  });
}
