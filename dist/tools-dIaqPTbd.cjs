const require_chunk = require("./chunk-CZWwpsFl.cjs");
const require_wallet = require("./wallet-Cxq4zv9u.cjs");
let viem_accounts = require("viem/accounts");
let viem = require("viem");
let viem_chains = require("viem/chains");
//#region src/wallet/tools.ts
var tools_exports = /* @__PURE__ */ require_chunk.__exportAll({
	BASE_CHAIN_ID: () => BASE_CHAIN_ID,
	DEFAULT_BASE_RPC_URL: () => DEFAULT_BASE_RPC_URL,
	PUBLIC_BASE_RPC_URLS: () => PUBLIC_BASE_RPC_URLS,
	USDC_ADDRESS: () => USDC_ADDRESS,
	buildTopupInfo: () => buildTopupInfo,
	formatWalletBalance: () => formatWalletBalance,
	getBalanceEth: () => getBalanceEth,
	getBalanceUsdc: () => getBalanceUsdc,
	getWalletAccount: () => getWalletAccount,
	getWalletBalanceText: () => getWalletBalanceText
});
const BASE_CHAIN_ID = 8453;
const USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const DEFAULT_BASE_RPC_URL = "https://mainnet.base.org";
const PUBLIC_BASE_RPC_URLS = [
	DEFAULT_BASE_RPC_URL,
	"https://base-rpc.publicnode.com",
	"https://base.drpc.org",
	"https://1rpc.io/base"
];
const USDC_ABI = [{
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
}];
async function getWalletAccount() {
	const privateKey = require_wallet.normalizeWalletPrivateKey(await require_wallet.decryptKey());
	return {
		address: (0, viem_accounts.privateKeyToAccount)(privateKey).address,
		privateKey
	};
}
async function getBalanceUsdc(address, rpcUrl = process.env["BASE_RPC_URL"]) {
	const rpcUrls = [...rpcUrl ? [rpcUrl] : [], ...PUBLIC_BASE_RPC_URLS.filter((fallbackUrl) => fallbackUrl !== rpcUrl)];
	for (const url of rpcUrls) try {
		return (0, viem.formatUnits)(await (0, viem.createPublicClient)({
			chain: viem_chains.base,
			transport: (0, viem.http)(url)
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
	const rpcUrls = [...rpcUrl ? [rpcUrl] : [], ...PUBLIC_BASE_RPC_URLS.filter((fallbackUrl) => fallbackUrl !== rpcUrl)];
	for (const url of rpcUrls) try {
		return (0, viem.formatEther)(await (0, viem.createPublicClient)({
			chain: viem_chains.base,
			transport: (0, viem.http)(url)
		}).getBalance({ address }));
	} catch {}
	return "unknown";
}
function formatWalletBalance(address, balanceUsdc, balanceEth) {
	return [
		`Balance: ${balanceUsdc} USDC`,
		balanceEth === void 0 ? void 0 : `Gas: ${balanceEth} ETH on Base`,
		"Network: Base",
		"Base ETH is required for one-time USDC Permit2 approval gas.",
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
Object.defineProperty(exports, "buildTopupInfo", {
	enumerable: true,
	get: function() {
		return buildTopupInfo;
	}
});
Object.defineProperty(exports, "formatWalletBalance", {
	enumerable: true,
	get: function() {
		return formatWalletBalance;
	}
});
Object.defineProperty(exports, "getBalanceEth", {
	enumerable: true,
	get: function() {
		return getBalanceEth;
	}
});
Object.defineProperty(exports, "getBalanceUsdc", {
	enumerable: true,
	get: function() {
		return getBalanceUsdc;
	}
});
Object.defineProperty(exports, "getWalletAccount", {
	enumerable: true,
	get: function() {
		return getWalletAccount;
	}
});
Object.defineProperty(exports, "getWalletBalanceText", {
	enumerable: true,
	get: function() {
		return getWalletBalanceText;
	}
});
Object.defineProperty(exports, "tools_exports", {
	enumerable: true,
	get: function() {
		return tools_exports;
	}
});
