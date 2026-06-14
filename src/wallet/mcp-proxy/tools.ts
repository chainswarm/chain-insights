import type { WalletData } from "./types.js";
import { createPublicClient, http, formatEther, formatUnits } from "viem";
import { base } from "viem/chains";

const USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
const DEFAULT_BASE_RPC_URL = "https://mainnet.base.org";
const PUBLIC_BASE_RPC_URLS = [
  DEFAULT_BASE_RPC_URL,
  "https://base-rpc.publicnode.com",
  "https://base.drpc.org",
  "https://1rpc.io/base",
] as const;
const USDC_ABI = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

function walletAddress(wallet: WalletData | string): `0x${string}` {
  return (typeof wallet === "string" ? wallet : wallet.address) as `0x${string}`;
}

export async function getBalanceUsdc(wallet: WalletData | string): Promise<string> {
  const envRpcUrl = process.env.BASE_RPC_URL;
  const rpcUrls = [
    ...(envRpcUrl ? [envRpcUrl] : []),
    ...PUBLIC_BASE_RPC_URLS.filter((url) => url !== envRpcUrl),
  ];

  for (const rpcUrl of rpcUrls) {
    try {
      const client = createPublicClient({ chain: base, transport: http(rpcUrl) });
      const balance = await client.readContract({
        address: USDC_ADDRESS,
        abi: USDC_ABI,
        functionName: "balanceOf",
        args: [walletAddress(wallet)],
      });
      return formatUnits(balance, 6);
    } catch {
      // Try the next public Base RPC endpoint.
    }
  }

  return "unknown";
}

export async function getBalanceEth(wallet: WalletData | string): Promise<string> {
  const envRpcUrl = process.env.BASE_RPC_URL;
  const rpcUrls = [
    ...(envRpcUrl ? [envRpcUrl] : []),
    ...PUBLIC_BASE_RPC_URLS.filter((url) => url !== envRpcUrl),
  ];

  for (const rpcUrl of rpcUrls) {
    try {
      const client = createPublicClient({ chain: base, transport: http(rpcUrl) });
      const balance = await client.getBalance({ address: walletAddress(wallet) });
      return formatEther(balance);
    } catch {
      // Try the next public Base RPC endpoint.
    }
  }

  return "unknown";
}

export async function getBalance(wallet: WalletData): Promise<string> {
  const [balanceUsdc, balanceEth] = await Promise.all([
    getBalanceUsdc(wallet),
    getBalanceEth(wallet),
  ]);
  return [
    `Payment wallet: ${wallet.address}`,
    `USDC on Base: ${balanceUsdc}`,
    `Gas on Base: ${balanceEth} ETH`,
    `Payment network: Base`,
    `Base ETH is used only for one-time payment setup gas.`,
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
    ],
  });
}
