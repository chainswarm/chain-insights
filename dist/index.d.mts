import * as z from "zod";
import { Hono } from "hono";
import { Address, Hex } from "viem";

//#region src/config/schema.d.ts
declare const ConfigSchema: z.ZodObject<{
  mcpEndpoint: z.ZodDefault<z.ZodPipe<z.ZodString, z.ZodTransform<string, string>>>;
  mcpAuthToken: z.ZodOptional<z.ZodString>;
  graphMcpEndpoint: z.ZodDefault<z.ZodPipe<z.ZodString, z.ZodTransform<string, string>>>;
  graphMcpAuthToken: z.ZodOptional<z.ZodString>;
  graphMcpMode: z.ZodDefault<z.ZodEnum<{
    paid: "paid";
    debug: "debug";
  }>>;
  walletAddress: z.ZodOptional<z.ZodString>;
  serverPort: z.ZodDefault<z.ZodNumber>;
  dataDir: z.ZodDefault<z.ZodString>;
  version: z.ZodDefault<z.ZodString>;
}, z.core.$strip>;
type InvestigatorConfig = z.infer<typeof ConfigSchema>;
//#endregion
//#region src/config/index.d.ts
declare function loadConfig(): Promise<InvestigatorConfig>;
declare function saveConfig(updates: Partial<InvestigatorConfig>): Promise<void>;
declare function resetConfigCache(): Promise<void>;
//#endregion
//#region src/server/app.d.ts
declare function createApp(): Hono;
//#endregion
//#region src/server/index.d.ts
declare function startServer(port?: number): () => void;
//#endregion
//#region src/wallet/index.d.ts
declare function normalizeWalletPrivateKey(value: string): Hex;
declare function walletAddressFromPrivateKey(privateKey: string): Address;
/**
 * Encrypts a private key and writes it to ~/.chain-insights/wallet.json.
 * Uses AES-256-GCM with a machine-identity-derived key and a random per-wallet salt.
 * File is written with 0o600 permissions (owner read/write only).
 *
 * @param privateKey - The EVM private key to encrypt (0x-prefixed)
 */
declare function encryptKey(privateKey: string): Promise<void>;
declare function setWalletPrivateKey(privateKey: string): Promise<Address>;
/**
 * Reads and decrypts the private key from ~/.chain-insights/wallet.json.
 * Throws a human-readable error if wallet is absent or decryption fails.
 *
 * @returns The decrypted EVM private key string
 */
declare function decryptKey(): Promise<string>;
/**
 * Returns true if wallet.json exists, false if absent.
 * Does not validate the wallet contents.
 */
declare function isWalletConfigured(): Promise<boolean>;
//#endregion
//#region src/wallet/tools.d.ts
declare const BASE_CHAIN_ID = 8453;
declare const USDC_ADDRESS: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
interface PaymentWalletAccount {
  address: Address;
  privateKey: Hex;
}
interface TopupInfo {
  wallet_address: string;
  network: 'Base';
  chain_id: typeof BASE_CHAIN_ID;
  token: 'USDC';
  token_contract: typeof USDC_ADDRESS;
  topup_url?: string;
}
interface WalletBalanceFacts {
  address: Address;
  payment_network: 'base';
  payment_network_display: 'Base';
  chain_id: typeof BASE_CHAIN_ID;
  token: 'USDC';
  token_balance: string;
  gas_token: 'ETH';
  gas_balance?: string;
}
interface WalletBalanceResult {
  schema: 'chain-insights.result.v1';
  tool: 'wallet_balance';
  hint: null;
  facts: {
    wallet: WalletBalanceFacts;
  };
}
declare function getWalletAccount(): Promise<PaymentWalletAccount>;
declare function getBalanceUsdc(address: Address | string, rpcUrl?: string | undefined): Promise<string>;
declare function getBalanceEth(address: Address | string, rpcUrl?: string | undefined): Promise<string>;
declare function formatWalletBalance(address: string, balanceUsdc: string, balanceEth?: string): string;
declare function getWalletBalanceResult(account?: PaymentWalletAccount): Promise<WalletBalanceResult>;
declare function formatWalletBalanceResult(result: WalletBalanceResult): string;
declare function getWalletBalanceText(account?: PaymentWalletAccount): Promise<string>;
declare function buildTopupInfo(address: string, topupUrl?: string): TopupInfo;
//#endregion
//#region src/wallet/mcp-proxy/topup-server.d.ts
declare function generateArtifactHtml(walletAddressInput: string, topupUrl: string): string;
//#endregion
//#region src/wallet/topup-server.d.ts
declare function getTopupUrl(): string | null;
declare function startTopupServer(account: PaymentWalletAccount | string): Promise<string>;
//#endregion
//#region src/mcp/client.d.ts
/**
 * Creates an x402-payment-wrapped fetch function for the Chain Insights MCP.
 * Payments are made in USDC on Base Mainnet (eip155:8453).
 *
 * The factory is pure — no side effects, no state, no caching.
 * If called with an invalid private key format, viem throws — the error propagates.
 *
 * @param privateKey - 0x-prefixed EVM private key (decrypted from wallet.json)
 * @returns A fetch-compatible function that auto-handles HTTP 402 payment challenges
 */
declare function createMcpFetchClient(privateKey: `0x${string}`, authToken?: string): typeof fetch;
//#endregion
//#region src/viz/graph-model.d.ts
declare const GraphNode: z.ZodObject<{
  id: z.ZodString;
  label: z.ZodOptional<z.ZodString>;
  entityType: z.ZodDefault<z.ZodEnum<{
    eoa: "eoa";
    contract: "contract";
    exchange: "exchange";
    mixer: "mixer";
    unknown: "unknown";
  }>>;
  riskLevel: z.ZodDefault<z.ZodEnum<{
    unknown: "unknown";
    low: "low";
    medium: "medium";
    high: "high";
    critical: "critical";
  }>>;
  totalIn: z.ZodDefault<z.ZodNumber>;
  totalOut: z.ZodDefault<z.ZodNumber>;
  txCount: z.ZodDefault<z.ZodNumber>;
  firstSeen: z.ZodOptional<z.ZodString>;
  lastSeen: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
type GraphNode = z.infer<typeof GraphNode>;
declare const GraphEdge: z.ZodObject<{
  source: z.ZodString;
  target: z.ZodString;
  value: z.ZodNumber;
  txHash: z.ZodOptional<z.ZodString>;
  blockNumber: z.ZodOptional<z.ZodNumber>;
  timestamp: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
type GraphEdge = z.infer<typeof GraphEdge>;
declare const GraphData: z.ZodObject<{
  nodes: z.ZodArray<z.ZodObject<{
    id: z.ZodString;
    label: z.ZodOptional<z.ZodString>;
    entityType: z.ZodDefault<z.ZodEnum<{
      eoa: "eoa";
      contract: "contract";
      exchange: "exchange";
      mixer: "mixer";
      unknown: "unknown";
    }>>;
    riskLevel: z.ZodDefault<z.ZodEnum<{
      unknown: "unknown";
      low: "low";
      medium: "medium";
      high: "high";
      critical: "critical";
    }>>;
    totalIn: z.ZodDefault<z.ZodNumber>;
    totalOut: z.ZodDefault<z.ZodNumber>;
    txCount: z.ZodDefault<z.ZodNumber>;
    firstSeen: z.ZodOptional<z.ZodString>;
    lastSeen: z.ZodOptional<z.ZodString>;
  }, z.core.$strip>>;
  edges: z.ZodArray<z.ZodObject<{
    source: z.ZodString;
    target: z.ZodString;
    value: z.ZodNumber;
    txHash: z.ZodOptional<z.ZodString>;
    blockNumber: z.ZodOptional<z.ZodNumber>;
    timestamp: z.ZodOptional<z.ZodString>;
  }, z.core.$strip>>;
  metadata: z.ZodObject<{
    title: z.ZodDefault<z.ZodString>;
    generatedAt: z.ZodString;
    truncated: z.ZodDefault<z.ZodBoolean>;
    totalNodes: z.ZodOptional<z.ZodNumber>;
    hiddenNodes: z.ZodOptional<z.ZodNumber>;
  }, z.core.$strip>;
}, z.core.$strip>;
type GraphData = z.infer<typeof GraphData>;
//#endregion
//#region src/viz/index.d.ts
declare function generateVisualization(opts: {
  sourceId?: string;
  dataFile?: string;
}): Promise<{
  vizId: string;
  htmlPath: string;
}>;
//#endregion
export { type GraphData as GraphDataType, type GraphEdge as GraphEdgeType, type GraphNode as GraphNodeType, type InvestigatorConfig, buildTopupInfo, createApp, createMcpFetchClient, decryptKey, encryptKey, formatWalletBalance, formatWalletBalanceResult, generateArtifactHtml, generateVisualization, getBalanceEth, getBalanceUsdc, getTopupUrl, getWalletAccount, getWalletBalanceResult, getWalletBalanceText, isWalletConfigured, loadConfig, normalizeWalletPrivateKey, resetConfigCache, saveConfig, setWalletPrivateKey, startServer, startTopupServer, walletAddressFromPrivateKey };
//# sourceMappingURL=index.d.mts.map