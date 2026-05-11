const require_chunk = require("./chunk-CZWwpsFl.cjs");
let viem_accounts = require("viem/accounts");
let _x402_fetch = require("@x402/fetch");
let _x402_evm = require("@x402/evm");
//#region src/mcp/client.ts
var client_exports = /* @__PURE__ */ require_chunk.__exportAll({
	createConfiguredMcpFetch: () => createConfiguredMcpFetch,
	createMcpAuthFetchClient: () => createMcpAuthFetchClient,
	createMcpFetchClient: () => createMcpFetchClient
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
	const account = (0, viem_accounts.privateKeyToAccount)(privateKey);
	const paymentFetch = (0, _x402_fetch.wrapFetchWithPaymentFromConfig)(fetch, { schemes: [{
		network: "eip155:8453",
		client: new _x402_evm.ExactEvmScheme(account)
	}] });
	return authToken ? createHeaderFetch(authToken, paymentFetch) : paymentFetch;
}
/**
* Creates a bearer/debug-token fetch for local GraphRAG MCP testing.
*
* GraphRAG public x402 debug bypass expects X-MCP-Debug-Token.
* The private endpoint expects Authorization: Bearer <token>.
* Sending both lets one config value work for public debug and private M2M endpoints.
*/
function createMcpAuthFetchClient(authToken, baseFetch = fetch) {
	return createHeaderFetch(authToken, baseFetch);
}
async function createConfiguredMcpFetch(config) {
	const authToken = config.mcpAuthToken?.trim();
	if (authToken) return createMcpAuthFetchClient(authToken);
	const { isWalletConfigured, decryptKey } = await Promise.resolve().then(() => require("./wallet-D6lq6MOc.cjs")).then((n) => n.wallet_exports);
	if (!await isWalletConfigured()) throw new Error("Wallet not configured and mcpAuthToken is empty. Run `chain-insights config set mcpAuthToken <token>` for local GraphRAG debug bypass, or `chain-insights config set walletPrivateKey <key>` to enable paid x402 MCP calls.");
	return createMcpFetchClient(await decryptKey());
}
//#endregion
Object.defineProperty(exports, "client_exports", {
	enumerable: true,
	get: function() {
		return client_exports;
	}
});
Object.defineProperty(exports, "createConfiguredMcpFetch", {
	enumerable: true,
	get: function() {
		return createConfiguredMcpFetch;
	}
});
Object.defineProperty(exports, "createMcpFetchClient", {
	enumerable: true,
	get: function() {
		return createMcpFetchClient;
	}
});
