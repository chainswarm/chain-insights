import { t as __exportAll } from "./rolldown-runtime-wcPFST8Q.mjs";
import { privateKeyToAccount } from "viem/accounts";
import { wrapFetchWithPaymentFromConfig } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm";
//#region src/mcp/client.ts
var client_exports = /* @__PURE__ */ __exportAll({
	createConfiguredGraphMcpFetch: () => createConfiguredGraphMcpFetch,
	createConfiguredMcpFetch: () => createConfiguredMcpFetch,
	createMcpAuthFetchClient: () => createMcpAuthFetchClient,
	createMcpFetchClient: () => createMcpFetchClient,
	resolveGraphMcpEndpoint: () => resolveGraphMcpEndpoint
});
function createHeaderFetch(authToken, baseFetch) {
	return (async (input, init) => {
		const requestHeaders = input instanceof Request ? input.headers : void 0;
		const headers = new Headers(init?.headers ?? requestHeaders);
		headers.set("X-MCP-Debug-Token", authToken);
		headers.set("Authorization", `Bearer ${authToken}`);
		return baseFetch(input, {
			...init,
			headers
		});
	});
}
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
function createMcpFetchClient(privateKey, authToken) {
	const account = privateKeyToAccount(privateKey);
	const paymentFetch = wrapFetchWithPaymentFromConfig(fetch, { schemes: [{
		network: "eip155:8453",
		client: new ExactEvmScheme(account)
	}] });
	return authToken ? createHeaderFetch(authToken, paymentFetch) : paymentFetch;
}
/**
* Creates a bearer/debug-token fetch for local Graph MCP testing.
*
* The public x402 debug bypass expects X-MCP-Debug-Token.
* Private endpoints commonly expect Authorization: Bearer <token>.
* Sending both lets one config value work for public debug and private M2M endpoints.
*/
function createMcpAuthFetchClient(authToken, baseFetch = fetch) {
	return createHeaderFetch(authToken, baseFetch);
}
function resolveGraphMcpEndpoint(config) {
	return config.graphMcpEndpoint?.trim() || config.mcpEndpoint;
}
async function createConfiguredFetchWithToken(authToken, missingTokenName) {
	const normalizedAuthToken = authToken?.trim();
	if (normalizedAuthToken) return createMcpAuthFetchClient(normalizedAuthToken);
	const { isWalletConfigured, decryptKey } = await import("./wallet-CrWZrB8c.mjs").then((n) => n.i);
	if (!await isWalletConfigured()) throw new Error(`Wallet not configured and ${missingTokenName} is empty. Run \`chain-insights config set ${missingTokenName} <token>\` for local MCP debug bypass, or \`chain-insights config set walletPrivateKey <key>\` to enable paid x402 MCP calls.`);
	return createMcpFetchClient(await decryptKey());
}
async function createConfiguredMcpFetch(config) {
	return createConfiguredFetchWithToken(config.mcpAuthToken, "mcpAuthToken");
}
async function createConfiguredGraphMcpFetch(config) {
	return createConfiguredFetchWithToken(config.graphMcpAuthToken?.trim() || config.mcpAuthToken?.trim(), "graphMcpAuthToken");
}
//#endregion
export { createConfiguredMcpFetch as n, createMcpFetchClient as r, client_exports as t };

//# sourceMappingURL=client-x1mQeHRi.mjs.map