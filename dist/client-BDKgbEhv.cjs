const require_chunk = require("./chunk-CZWwpsFl.cjs");
let viem_accounts = require("viem/accounts");
let _x402_fetch = require("@x402/fetch");
let _x402_evm = require("@x402/evm");
let _x402_evm_upto_client = require("@x402/evm/upto/client");
//#region src/mcp/client.ts
var client_exports = /* @__PURE__ */ require_chunk.__exportAll({
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
function describePaymentRequiredResponse(response, payerAddress) {
	const encoded = response.headers.get("payment-required");
	if (!encoded) return "x402 payment failed: payment_required";
	try {
		const decoded = Buffer.from(encoded, "base64").toString("utf8");
		const parsed = JSON.parse(decoded);
		const reason = typeof parsed.error === "string" && parsed.error.trim() ? parsed.error.trim() : "payment_required";
		const firstRequirement = Array.isArray(parsed.accepts) ? parsed.accepts[0] : void 0;
		const payTo = typeof firstRequirement?.payTo === "string" ? firstRequirement.payTo.trim() : "";
		if (payerAddress && payTo && payerAddress.toLowerCase() === payTo.toLowerCase()) return "Local payment wallet matches the MCP payTo address. Configure a separate payer wallet with USDC on Base; do not use the service recipient wallet as the client payment wallet.";
		const details = [
			typeof firstRequirement?.scheme === "string" ? `scheme=${firstRequirement.scheme}` : void 0,
			typeof firstRequirement?.network === "string" ? `network=${firstRequirement.network}` : void 0,
			typeof firstRequirement?.amount === "string" ? `amount=${firstRequirement.amount}` : void 0
		].filter(Boolean).join(" ");
		const message = details ? `x402 payment failed: ${reason} (${details})` : `x402 payment failed: ${reason}`;
		if (reason.includes("allowance_required")) return `${message}. This wallet needs a one-time USDC Permit2 approval before paid MCP calls can settle. Base ETH is required for approval gas.`;
		return message;
	} catch {
		return "x402 payment failed: payment_required";
	}
}
function createPaymentFailureReportingFetch(baseFetch, payerAddress) {
	const reportingFetch = (async (input, init) => {
		const response = await baseFetch(input, init);
		if (response.status !== 402) return response;
		throw new Error(describePaymentRequiredResponse(response, payerAddress));
	});
	return Object.assign(reportingFetch, baseFetch);
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
	const reportingFetch = createPaymentFailureReportingFetch((0, _x402_fetch.wrapFetchWithPaymentFromConfig)(fetch, { schemes: [{
		network: "eip155:8453",
		client: new _x402_evm_upto_client.UptoEvmScheme(account)
	}, {
		network: "eip155:8453",
		client: new _x402_evm.ExactEvmScheme(account)
	}] }), account.address);
	return authToken ? createHeaderFetch(authToken, reportingFetch) : reportingFetch;
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
	const { isWalletConfigured, decryptKey } = await Promise.resolve().then(() => require("./wallet-Cxq4zv9u.cjs")).then((n) => n.wallet_exports);
	if (!await isWalletConfigured()) throw new Error(`Wallet not configured and ${missingTokenName} is empty. Run \`chain-insights config set ${missingTokenName} <token>\` for local MCP debug bypass, or \`chain-insights config set walletPrivateKey <key>\` to enable paid x402 MCP calls.`);
	return createMcpFetchClient(await decryptKey());
}
async function createConfiguredMcpFetch(config) {
	return createConfiguredFetchWithToken(config.mcpAuthToken, "mcpAuthToken");
}
async function createConfiguredGraphMcpFetch(config) {
	if (config.graphMcpMode === "debug") {
		const authToken = config.graphMcpAuthToken?.trim() || config.mcpAuthToken?.trim();
		if (!authToken) throw new Error("Graph MCP debug mode requires graphMcpAuthToken. Run `cia debug on --token <token>`.");
		return createMcpAuthFetchClient(authToken);
	}
	return createConfiguredFetchWithToken(void 0, "walletPrivateKey");
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
