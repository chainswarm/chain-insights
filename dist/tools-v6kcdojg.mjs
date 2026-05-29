import { t as __exportAll } from "./rolldown-runtime-D7D4PA-g.mjs";
import { i as normalizeWalletPrivateKey, t as decryptKey } from "./wallet-BL0fJC29.mjs";
import { privateKeyToAccount } from "viem/accounts";
import { createPublicClient, createWalletClient, formatEther, formatUnits, http, parseUnits } from "viem";
import { base } from "viem/chains";
//#region src/wallet/tools.ts
var tools_exports = /* @__PURE__ */ __exportAll({
	BASE_CHAIN_ID: () => BASE_CHAIN_ID,
	DEFAULT_BASE_RPC_URL: () => DEFAULT_BASE_RPC_URL,
	DEFAULT_PAYMENT_APPROVAL_UNITS: () => DEFAULT_PAYMENT_APPROVAL_UNITS,
	PERMIT2_ADDRESS: () => PERMIT2_ADDRESS,
	PUBLIC_BASE_RPC_URLS: () => PUBLIC_BASE_RPC_URLS,
	USDC_ADDRESS: () => USDC_ADDRESS,
	approvePaymentAllowance: () => approvePaymentAllowance,
	buildTopupInfo: () => buildTopupInfo,
	formatWalletBalance: () => formatWalletBalance,
	formatWalletReadiness: () => formatWalletReadiness,
	getBalanceEth: () => getBalanceEth,
	getBalanceUsdc: () => getBalanceUsdc,
	getPaymentApprovalUnits: () => getPaymentApprovalUnits,
	getWalletAccount: () => getWalletAccount,
	getWalletBalanceText: () => getWalletBalanceText,
	getWalletReadiness: () => getWalletReadiness,
	parsePaymentApprovalUnits: () => parsePaymentApprovalUnits,
	prepareWalletForPaidCalls: () => prepareWalletForPaidCalls
});
const BASE_CHAIN_ID = 8453;
const USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const PERMIT2_ADDRESS = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
const DEFAULT_BASE_RPC_URL = "https://mainnet.base.org";
const DEFAULT_PAYMENT_APPROVAL_UNITS = 1000000n;
const PUBLIC_BASE_RPC_URLS = [
	DEFAULT_BASE_RPC_URL,
	"https://base-rpc.publicnode.com",
	"https://base.drpc.org",
	"https://1rpc.io/base"
];
const USDC_ABI = [
	{
		type: "function",
		name: "balanceOf",
		stateMutability: "view",
		inputs: [{
			name: "account",
			type: "address"
		}],
		outputs: [{
			name: "",
			type: "uint256"
		}]
	},
	{
		type: "function",
		name: "allowance",
		stateMutability: "view",
		inputs: [{
			name: "owner",
			type: "address"
		}, {
			name: "spender",
			type: "address"
		}],
		outputs: [{
			name: "",
			type: "uint256"
		}]
	},
	{
		type: "function",
		name: "approve",
		stateMutability: "nonpayable",
		inputs: [{
			name: "spender",
			type: "address"
		}, {
			name: "amount",
			type: "uint256"
		}],
		outputs: [{
			name: "",
			type: "bool"
		}]
	}
];
async function getWalletAccount() {
	const privateKey = normalizeWalletPrivateKey(await decryptKey());
	return {
		address: privateKeyToAccount(privateKey).address,
		privateKey
	};
}
function baseRpcUrls(rpcUrl = process.env["BASE_RPC_URL"]) {
	return [...rpcUrl ? [rpcUrl] : [], ...PUBLIC_BASE_RPC_URLS.filter((fallbackUrl) => fallbackUrl !== rpcUrl)];
}
async function getBalanceUsdc(address, rpcUrl = process.env["BASE_RPC_URL"]) {
	for (const url of baseRpcUrls(rpcUrl)) try {
		return formatUnits(await createPublicClient({
			chain: base,
			transport: http(url)
		}).readContract({
			address: USDC_ADDRESS,
			abi: USDC_ABI,
			functionName: "balanceOf",
			args: [address]
		}), 6);
	} catch {}
	return "unknown";
}
async function getBalanceEth(address, rpcUrl = process.env["BASE_RPC_URL"]) {
	for (const url of baseRpcUrls(rpcUrl)) try {
		return formatEther(await createPublicClient({
			chain: base,
			transport: http(url)
		}).getBalance({ address }));
	} catch {}
	return "unknown";
}
async function getPaymentApprovalUnits(address, rpcUrl = process.env["BASE_RPC_URL"]) {
	for (const url of baseRpcUrls(rpcUrl)) try {
		return await createPublicClient({
			chain: base,
			transport: http(url)
		}).readContract({
			address: USDC_ADDRESS,
			abi: USDC_ABI,
			functionName: "allowance",
			args: [address, PERMIT2_ADDRESS]
		});
	} catch {}
	return null;
}
function parsePaymentApprovalUnits(amountUsdc) {
	const trimmed = amountUsdc.trim();
	if (!/^\d+(\.\d{1,6})?$/.test(trimmed) || !isPositiveDecimal(trimmed)) throw new Error("Payment setup amount must be a positive USDC value with up to 6 decimals.");
	return parseUnits(trimmed, 6);
}
function isPositiveDecimal(value) {
	if (value === "unknown") return false;
	const parsed = Number.parseFloat(value);
	return Number.isFinite(parsed) && parsed > 0;
}
function decimalStatus(value) {
	return value === "unknown" ? null : isPositiveDecimal(value);
}
function readinessNextSteps(readiness) {
	const nextSteps = [];
	if (readiness.hasUsdc === false) nextSteps.push("Run `chain-insights wallet topup` and send USDC on Base to this wallet.");
	if (readiness.hasUsdc === null) nextSteps.push("Base USDC balance could not be confirmed; retry or set BASE_RPC_URL to a working Base RPC endpoint.");
	if (readiness.needsPaymentApproval && readiness.hasGas === false) nextSteps.push("Add a small amount of ETH on Base for the one-time payment setup gas.");
	if (readiness.needsPaymentApproval && readiness.hasGas !== false) nextSteps.push("Run `chain-insights wallet ready` to finish the one-time payment setup.");
	if (readiness.hasGas === null) nextSteps.push("Base ETH gas balance could not be confirmed; retry or set BASE_RPC_URL to a working Base RPC endpoint.");
	return nextSteps;
}
function buildWalletReadiness(params) {
	const paymentApprovalUnits = params.paymentApprovalUnits ?? 0n;
	const hasUsdc = decimalStatus(params.balanceUsdc);
	const hasGas = decimalStatus(params.balanceEth);
	const hasPaymentApproval = paymentApprovalUnits >= params.minimumApprovalUnits;
	const needsPaymentApproval = !hasPaymentApproval;
	const ready = hasUsdc !== false && hasPaymentApproval;
	const readiness = {
		address: params.address,
		balanceUsdc: params.balanceUsdc,
		balanceEth: params.balanceEth,
		paymentApprovalUsdc: params.paymentApprovalUnits === null ? "unknown" : formatUnits(paymentApprovalUnits, 6),
		paymentApprovalUnits,
		minimumApprovalUnits: params.minimumApprovalUnits,
		hasUsdc,
		hasGas,
		hasPaymentApproval,
		needsPaymentApproval,
		ready,
		nextSteps: []
	};
	return {
		...readiness,
		nextSteps: readinessNextSteps(readiness)
	};
}
async function getWalletReadiness(account, minimumApprovalUnits = DEFAULT_PAYMENT_APPROVAL_UNITS) {
	const wallet = account ?? await getWalletAccount();
	const [balanceUsdc, balanceEth, paymentApprovalUnits] = await Promise.all([
		getBalanceUsdc(wallet.address),
		getBalanceEth(wallet.address),
		getPaymentApprovalUnits(wallet.address)
	]);
	return buildWalletReadiness({
		address: wallet.address,
		balanceUsdc,
		balanceEth,
		paymentApprovalUnits,
		minimumApprovalUnits
	});
}
function formatWalletReadiness(readiness, approval) {
	const status = readiness.ready ? "Ready for paid GraphRAG MCP calls" : "Action needed before paid GraphRAG MCP calls";
	const setup = readiness.needsPaymentApproval ? `Payment setup: needs one-time setup for up to ${formatUnits(readiness.minimumApprovalUnits, 6)} USDC of paid calls` : "Payment setup: ready";
	const setupCompletedLine = approval?.status === "approved" ? "Payment setup completed." : void 0;
	return [
		status,
		`Balance: ${readiness.balanceUsdc} USDC`,
		`Gas: ${readiness.balanceEth} ETH on Base`,
		setup,
		setupCompletedLine,
		"Network: Base",
		`Address: ${readiness.address}`,
		...readiness.nextSteps.map((step) => `Next: ${step}`)
	].filter(Boolean).join("\n");
}
async function approvePaymentAllowance(account, minimumApprovalUnits = DEFAULT_PAYMENT_APPROVAL_UNITS, rpcUrl = process.env["BASE_RPC_URL"]) {
	const wallet = account ?? await getWalletAccount();
	const initialApprovalUnits = await getPaymentApprovalUnits(wallet.address, rpcUrl);
	if (initialApprovalUnits !== null && initialApprovalUnits >= minimumApprovalUnits) return {
		status: "already_ready",
		paymentApprovalUnits: initialApprovalUnits,
		minimumApprovalUnits
	};
	const clientAccount = privateKeyToAccount(wallet.privateKey);
	for (const url of baseRpcUrls(rpcUrl)) try {
		const publicClient = createPublicClient({
			chain: base,
			transport: http(url)
		});
		const txHash = await createWalletClient({
			account: clientAccount,
			chain: base,
			transport: http(url)
		}).writeContract({
			address: USDC_ADDRESS,
			abi: USDC_ABI,
			functionName: "approve",
			args: [PERMIT2_ADDRESS, minimumApprovalUnits]
		});
		if ((await publicClient.waitForTransactionReceipt({ hash: txHash })).status === "reverted") throw new Error(`Payment setup transaction reverted: ${txHash}`);
		return {
			status: "approved",
			txHash,
			paymentApprovalUnits: await getPaymentApprovalUnits(wallet.address, url) ?? minimumApprovalUnits,
			minimumApprovalUnits
		};
	} catch (err) {
		if (url === baseRpcUrls(rpcUrl).at(-1)) throw err;
	}
	throw new Error("Unable to submit payment setup transaction on Base.");
}
async function prepareWalletForPaidCalls(options = {}) {
	const minimumApprovalUnits = options.minimumApprovalUnits ?? 1000000n;
	const wallet = options.account ?? await getWalletAccount();
	const readiness = await getWalletReadiness(wallet, minimumApprovalUnits);
	if (!readiness.needsPaymentApproval) return {
		readiness,
		approval: {
			status: "already_ready",
			paymentApprovalUnits: readiness.paymentApprovalUnits,
			minimumApprovalUnits
		}
	};
	if (options.approve === false || readiness.hasGas === false) return { readiness };
	const approval = await approvePaymentAllowance(wallet, minimumApprovalUnits, options.rpcUrl);
	return {
		readiness: buildWalletReadiness({
			address: wallet.address,
			balanceUsdc: readiness.balanceUsdc,
			balanceEth: readiness.balanceEth,
			paymentApprovalUnits: approval.paymentApprovalUnits,
			minimumApprovalUnits
		}),
		approval
	};
}
function formatWalletBalance(address, balanceUsdc, balanceEth) {
	return [
		`Balance: ${balanceUsdc} USDC`,
		balanceEth === void 0 ? void 0 : `Gas: ${balanceEth} ETH on Base`,
		"Network: Base",
		"Base ETH is used only for one-time payment setup gas.",
		`Address: ${address}`
	].filter(Boolean).join("\n");
}
async function getWalletBalanceText(account) {
	const wallet = account ?? await getWalletAccount();
	const [balanceUsdc, balanceEth] = await Promise.all([getBalanceUsdc(wallet.address), getBalanceEth(wallet.address)]);
	return formatWalletBalance(wallet.address, balanceUsdc, balanceEth);
}
function buildTopupInfo(address, topupUrl) {
	return {
		wallet_address: address,
		network: "Base",
		chain_id: BASE_CHAIN_ID,
		token: "USDC",
		token_contract: USDC_ADDRESS,
		...topupUrl ? { topup_url: topupUrl } : {}
	};
}
//#endregion
export { getWalletAccount as a, tools_exports as c, getBalanceUsdc as i, formatWalletBalance as n, getWalletBalanceText as o, getBalanceEth as r, prepareWalletForPaidCalls as s, buildTopupInfo as t };

//# sourceMappingURL=tools-v6kcdojg.mjs.map