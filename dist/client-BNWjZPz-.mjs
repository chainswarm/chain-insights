import { t as __exportAll } from "./rolldown-runtime-wcPFST8Q.mjs";
import { privateKeyToAccount } from "viem/accounts";
import { wrapFetchWithPaymentFromConfig } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm";
import { UptoEvmScheme } from "@x402/evm/upto/client";
//#region src/mcp/client.ts
var client_exports = /* @__PURE__ */ __exportAll({
	PAYMENT_NEXT_STEPS: () => PAYMENT_NEXT_STEPS,
	PaymentRequiredError: () => PaymentRequiredError,
	createConfiguredGraphMcpFetch: () => createConfiguredGraphMcpFetch,
	createConfiguredMcpFetch: () => createConfiguredMcpFetch,
	createMcpAuthFetchClient: () => createMcpAuthFetchClient,
	createMcpFetchClient: () => createMcpFetchClient,
	resolveGraphMcpEndpoint: () => resolveGraphMcpEndpoint
});
var PaymentRequiredError = class extends Error {
	constructor(message) {
		super(message);
		this.name = "PaymentRequiredError";
	}
};
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
const PAYMENT_NEXT_STEPS = "Next steps: run `chain-insights wallet topup` to fund your wallet with USDC on Base (required for paid queries), or `chain-insights access-key set <key>` if you have been given test access.";
function describePaymentRequiredResponse(response, payerAddress) {
	const encoded = response.headers.get("payment-required");
	if (!encoded) return `Payment required — this tool costs USDC on Base via x402 micropayments. ${PAYMENT_NEXT_STEPS}`;
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
		if (reason === "payment_required") return `${message}. ${PAYMENT_NEXT_STEPS}`;
		return `${message}. ${PAYMENT_NEXT_STEPS}`;
	} catch {
		return `Payment required — this tool costs USDC on Base via x402 micropayments. ${PAYMENT_NEXT_STEPS}`;
	}
}
function createPaymentFailureReportingFetch(baseFetch, payerAddress) {
	const reportingFetch = (async (input, init) => {
		const response = await baseFetch(input, init);
		if (response.status !== 402) return response;
		throw new PaymentRequiredError(describePaymentRequiredResponse(response, payerAddress));
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
	const account = privateKeyToAccount(privateKey);
	const reportingFetch = createPaymentFailureReportingFetch(wrapFetchWithPaymentFromConfig(fetch, { schemes: [{
		network: "eip155:8453",
		client: new UptoEvmScheme(account)
	}, {
		network: "eip155:8453",
		client: new ExactEvmScheme(account)
	}] }), account.address);
	return authToken ? createHeaderFetch(authToken, reportingFetch) : reportingFetch;
}
/**
* Creates a bearer/debug-token fetch for local Graph MCP testing.
*
* The public x402 debug bypass expects X-MCP-Debug-Token.
* Private endpoints commonly expect Authorization: Bearer <token>.
* Sending both lets one config value work for public debug and private M2M endpoints.
*
* Wraps with 402 interception so that if the server still requires payment
* (e.g. token not accepted for paid tools), the user sees actionable guidance
* instead of a generic transport error.
*/
function createMcpAuthFetchClient(authToken, baseFetch = fetch) {
	return createPaymentFailureReportingFetch(createHeaderFetch(authToken, baseFetch));
}
function resolveGraphMcpEndpoint(config) {
	return config.graphMcpEndpoint?.trim() || config.mcpEndpoint;
}
async function createConfiguredFetchWithToken(authToken, missingTokenName) {
	const normalizedAuthToken = authToken?.trim();
	if (normalizedAuthToken) return createMcpAuthFetchClient(normalizedAuthToken);
	const { isWalletConfigured, decryptKey } = await import("./wallet-B6NNdnWH.mjs").then((n) => n.s);
	if (!await isWalletConfigured()) throw new Error(`Wallet not configured and ${missingTokenName} is empty. Run \`chain-insights access-key set <key>\` for invited test access or \`chain-insights config set ${missingTokenName} <token>\` for local MCP debug bypass, or \`chain-insights config set walletPrivateKey <key>\` to enable paid x402 MCP calls.`);
	return createMcpFetchClient(await decryptKey());
}
async function createConfiguredMcpFetch(config) {
	return createConfiguredFetchWithToken(config.mcpAuthToken, "mcpAuthToken");
}
async function createConfiguredGraphMcpFetch(config) {
	if (config.graphMcpMode === "debug") {
		const authToken = config.graphMcpAuthToken?.trim() || config.mcpAuthToken?.trim();
		if (!authToken) throw new Error("Graph MCP debug mode requires graphMcpAuthToken. Run `cia access-key set <key>` or `cia debug on --token <token>`.");
		return createMcpAuthFetchClient(authToken);
	}
	return createConfiguredFetchWithToken(void 0, "walletPrivateKey");
}
//#endregion
export { resolveGraphMcpEndpoint as a, createMcpFetchClient as i, client_exports as n, createConfiguredMcpFetch as r, PaymentRequiredError as t };

//# sourceMappingURL=client-BNWjZPz-.mjs.map