import { t as __exportAll } from "./rolldown-runtime-wcPFST8Q.mjs";
import path from "node:path";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import crypto from "node:crypto";
//#region src/wallet/index.ts
var wallet_exports = /* @__PURE__ */ __exportAll({
	decryptKey: () => decryptKey,
	encryptKey: () => encryptKey,
	isWalletConfigured: () => isWalletConfigured,
	walletPath: () => walletPath
});
function walletPath() {
	return path.join(os.homedir(), ".chain-insights", "wallet.json");
}
function deriveKey(salt) {
	return crypto.scryptSync(`${os.hostname()}:${os.userInfo().username}`, salt, 32);
}
/**
* Encrypts a private key and writes it to ~/.chain-insights/wallet.json.
* Uses AES-256-GCM with a machine-identity-derived key and a random per-wallet salt.
* File is written with 0o600 permissions (owner read/write only).
*
* @param privateKey - The EVM private key to encrypt (0x-prefixed)
*/
async function encryptKey(privateKey) {
	const salt = crypto.randomBytes(16);
	const key = deriveKey(salt);
	const iv = crypto.randomBytes(12);
	const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
	const encrypted = Buffer.concat([cipher.update(privateKey, "utf8"), cipher.final()]);
	const tag = cipher.getAuthTag();
	const walletData = {
		salt: salt.toString("hex"),
		iv: iv.toString("hex"),
		tag: tag.toString("hex"),
		data: encrypted.toString("hex")
	};
	const p = walletPath();
	await mkdir(path.dirname(p), { recursive: true });
	await writeFile(p, JSON.stringify(walletData, null, 2) + "\n", { mode: 384 });
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
		raw = await readFile(walletPath(), "utf8");
	} catch (err) {
		if (err.code === "ENOENT") throw new Error("Wallet not configured. Run `chain-insights config set walletPrivateKey <key>` to enable paid MCP calls");
		throw err;
	}
	try {
		const stored = JSON.parse(raw);
		const key = deriveKey(Buffer.from(stored.salt, "hex"));
		const iv = Buffer.from(stored.iv, "hex");
		const tag = Buffer.from(stored.tag, "hex");
		const encrypted = Buffer.from(stored.data, "hex");
		const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
		decipher.setAuthTag(tag);
		return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
	} catch {
		throw new Error("Wallet decryption failed. If you changed your hostname or username, re-configure with `chain-insights config set walletPrivateKey <key>`.");
	}
}
/**
* Returns true if wallet.json exists, false if absent.
* Does not validate the wallet contents.
*/
async function isWalletConfigured() {
	try {
		await stat(walletPath());
		return true;
	} catch (err) {
		if (err.code === "ENOENT") return false;
		throw err;
	}
}
//#endregion
export { wallet_exports as i, encryptKey as n, isWalletConfigured as r, decryptKey as t };

//# sourceMappingURL=wallet-CrWZrB8c.mjs.map