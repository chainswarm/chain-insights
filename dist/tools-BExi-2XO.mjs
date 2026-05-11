import { t as __exportAll } from "./rolldown-runtime-wcPFST8Q.mjs";
import { t as decryptKey } from "./wallet-DJh-1OOI.mjs";
import { createPublicClient, formatUnits, http } from "viem";
import { base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
//#region src/wallet/tools.ts
var tools_exports = /* @__PURE__ */ __exportAll({
	BASE_CHAIN_HEX: () => BASE_CHAIN_HEX,
	BASE_CHAIN_ID: () => BASE_CHAIN_ID,
	DEFAULT_BASE_RPC_URL: () => DEFAULT_BASE_RPC_URL,
	USDC_ADDRESS: () => USDC_ADDRESS,
	buildTopupInfo: () => buildTopupInfo,
	formatWalletBalance: () => formatWalletBalance,
	getBalanceUsdc: () => getBalanceUsdc,
	getWalletAccount: () => getWalletAccount,
	getWalletBalanceText: () => getWalletBalanceText
});
const BASE_CHAIN_ID = 8453;
const BASE_CHAIN_HEX = "0x2105";
const USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const DEFAULT_BASE_RPC_URL = "https://base.llamarpc.com";
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
function normalizePrivateKey(value) {
	if (!/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error("Stored wallet private key is not a valid 0x-prefixed EVM private key");
	return value;
}
async function getWalletAccount() {
	const privateKey = normalizePrivateKey(await decryptKey());
	return {
		address: privateKeyToAccount(privateKey).address,
		privateKey
	};
}
async function getBalanceUsdc(address, rpcUrl = process.env["BASE_RPC_URL"] ?? "https://base.llamarpc.com") {
	try {
		return formatUnits(await createPublicClient({
			chain: base,
			transport: http(rpcUrl)
		}).readContract({
			address: USDC_ADDRESS,
			abi: USDC_ABI,
			functionName: "balanceOf",
			args: [address]
		}), 6);
	} catch {
		return "unknown";
	}
}
function formatWalletBalance(address, balanceUsdc) {
	const capacity = balanceUsdc !== "unknown" ? `Capacity: ~${Math.floor(parseFloat(balanceUsdc) * 100)} standard tool calls` : "";
	return [
		`Balance: ${balanceUsdc} USDC`,
		"Network: Base",
		`Address: ${address}`,
		capacity
	].filter(Boolean).join("\n");
}
async function getWalletBalanceText(account) {
	const wallet = account ?? await getWalletAccount();
	const balance = await getBalanceUsdc(wallet.address);
	return formatWalletBalance(wallet.address, balance);
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
export { getBalanceUsdc as a, tools_exports as c, formatWalletBalance as i, USDC_ADDRESS as n, getWalletAccount as o, buildTopupInfo as r, getWalletBalanceText as s, BASE_CHAIN_HEX as t };

//# sourceMappingURL=tools-BExi-2XO.mjs.map