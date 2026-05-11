import { t as __exportAll } from "./rolldown-runtime-wcPFST8Q.mjs";
import { wrapFetchWithPaymentFromConfig } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm";
import { privateKeyToAccount } from "viem/accounts";
//#region src/mcp/client.ts
var client_exports = /* @__PURE__ */ __exportAll({ createMcpFetchClient: () => createMcpFetchClient });
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
function createMcpFetchClient(privateKey) {
	const account = privateKeyToAccount(privateKey);
	return wrapFetchWithPaymentFromConfig(fetch, { schemes: [{
		network: "eip155:8453",
		client: new ExactEvmScheme(account)
	}] });
}
//#endregion
export { createMcpFetchClient as n, client_exports as t };

//# sourceMappingURL=client-DPA33paN.mjs.map