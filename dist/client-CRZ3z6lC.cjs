const require_chunk = require("./chunk-CZWwpsFl.cjs");
let _x402_fetch = require("@x402/fetch");
let _x402_evm = require("@x402/evm");
let viem_accounts = require("viem/accounts");
//#region src/mcp/client.ts
var client_exports = /* @__PURE__ */ require_chunk.__exportAll({ createMcpFetchClient: () => createMcpFetchClient });
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
	const account = (0, viem_accounts.privateKeyToAccount)(privateKey);
	return (0, _x402_fetch.wrapFetchWithPaymentFromConfig)(fetch, { schemes: [{
		network: "eip155:8453",
		client: new _x402_evm.ExactEvmScheme(account)
	}] });
}
//#endregion
Object.defineProperty(exports, "client_exports", {
	enumerable: true,
	get: function() {
		return client_exports;
	}
});
Object.defineProperty(exports, "createMcpFetchClient", {
	enumerable: true,
	get: function() {
		return createMcpFetchClient;
	}
});
