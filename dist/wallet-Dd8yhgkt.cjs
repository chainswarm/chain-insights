const require_chunk = require("./chunk-CZWwpsFl.cjs");
let node_path = require("node:path");
node_path = require_chunk.__toESM(node_path, 1);
let node_fs_promises = require("node:fs/promises");
let node_os = require("node:os");
node_os = require_chunk.__toESM(node_os, 1);
let node_crypto = require("node:crypto");
node_crypto = require_chunk.__toESM(node_crypto, 1);
let viem_accounts = require("viem/accounts");
//#region src/wallet/index.ts
var wallet_exports = /* @__PURE__ */ require_chunk.__exportAll({
	decryptKey: () => decryptKey,
	encryptKey: () => encryptKey,
	isWalletConfigured: () => isWalletConfigured,
	normalizeWalletPrivateKey: () => normalizeWalletPrivateKey,
	setWalletPrivateKey: () => setWalletPrivateKey,
	walletAddressFromPrivateKey: () => walletAddressFromPrivateKey,
	walletPath: () => walletPath
});
function walletPath() {
	return node_path.default.join(node_os.default.homedir(), ".chain-insights", "wallet.json");
}
function deriveKey(salt) {
	return node_crypto.default.scryptSync(`${node_os.default.hostname()}:${node_os.default.userInfo().username}`, salt, 32);
}
function normalizeWalletPrivateKey(value) {
	if (!/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error("Stored wallet private key is not a valid 0x-prefixed EVM private key");
	return value;
}
function walletAddressFromPrivateKey(privateKey) {
	return (0, viem_accounts.privateKeyToAccount)(normalizeWalletPrivateKey(privateKey)).address;
}
/**
* Encrypts a private key and writes it to ~/.chain-insights/wallet.json.
* Uses AES-256-GCM with a machine-identity-derived key and a random per-wallet salt.
* File is written with 0o600 permissions (owner read/write only).
*
* @param privateKey - The EVM private key to encrypt (0x-prefixed)
*/
async function encryptKey(privateKey) {
	const normalizedPrivateKey = normalizeWalletPrivateKey(privateKey);
	const salt = node_crypto.default.randomBytes(16);
	const key = deriveKey(salt);
	const iv = node_crypto.default.randomBytes(12);
	const cipher = node_crypto.default.createCipheriv("aes-256-gcm", key, iv);
	const encrypted = Buffer.concat([cipher.update(normalizedPrivateKey, "utf8"), cipher.final()]);
	const tag = cipher.getAuthTag();
	const walletData = {
		salt: salt.toString("hex"),
		iv: iv.toString("hex"),
		tag: tag.toString("hex"),
		data: encrypted.toString("hex")
	};
	const p = walletPath();
	await (0, node_fs_promises.mkdir)(node_path.default.dirname(p), { recursive: true });
	await (0, node_fs_promises.writeFile)(p, JSON.stringify(walletData, null, 2) + "\n", { mode: 384 });
}
async function setWalletPrivateKey(privateKey) {
	const normalizedPrivateKey = normalizeWalletPrivateKey(privateKey);
	const address = walletAddressFromPrivateKey(normalizedPrivateKey);
	await encryptKey(normalizedPrivateKey);
	return address;
}
/**
* Reads and decrypts the private key from ~/.chain-insights/wallet.json.
* Throws a human-readable error if wallet is absent or decryption fails.
*
* @returns The decrypted EVM private key string
*/
async function decryptKey() {
	let raw;
	try {
		raw = await (0, node_fs_promises.readFile)(walletPath(), "utf8");
	} catch (err) {
		if (err.code === "ENOENT") throw new Error("Wallet not configured. Run `chain-insights wallet import <private-key>`, then `chain-insights wallet ready`.");
		throw err;
	}
	try {
		const stored = JSON.parse(raw);
		const key = deriveKey(Buffer.from(stored.salt, "hex"));
		const iv = Buffer.from(stored.iv, "hex");
		const tag = Buffer.from(stored.tag, "hex");
		const encrypted = Buffer.from(stored.data, "hex");
		const decipher = node_crypto.default.createDecipheriv("aes-256-gcm", key, iv);
		decipher.setAuthTag(tag);
		return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
	} catch {
		throw new Error("Wallet decryption failed. If you changed your hostname or username, re-import it with `chain-insights wallet import <private-key>`.");
	}
}
/**
* Returns true if wallet.json exists, false if absent.
* Does not validate the wallet contents.
*/
async function isWalletConfigured() {
	try {
		await (0, node_fs_promises.stat)(walletPath());
		return true;
	} catch (err) {
		if (err.code === "ENOENT") return false;
		throw err;
	}
}
//#endregion
Object.defineProperty(exports, "decryptKey", {
	enumerable: true,
	get: function() {
		return decryptKey;
	}
});
Object.defineProperty(exports, "encryptKey", {
	enumerable: true,
	get: function() {
		return encryptKey;
	}
});
Object.defineProperty(exports, "isWalletConfigured", {
	enumerable: true,
	get: function() {
		return isWalletConfigured;
	}
});
Object.defineProperty(exports, "normalizeWalletPrivateKey", {
	enumerable: true,
	get: function() {
		return normalizeWalletPrivateKey;
	}
});
Object.defineProperty(exports, "setWalletPrivateKey", {
	enumerable: true,
	get: function() {
		return setWalletPrivateKey;
	}
});
Object.defineProperty(exports, "walletAddressFromPrivateKey", {
	enumerable: true,
	get: function() {
		return walletAddressFromPrivateKey;
	}
});
Object.defineProperty(exports, "wallet_exports", {
	enumerable: true,
	get: function() {
		return wallet_exports;
	}
});
