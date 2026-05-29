import { fileURLToPath } from "node:url";
import path from "node:path";
import { constants, existsSync } from "node:fs";
import { access, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
//#region src/claude-desktop/setup.ts
function defaultClaudeDesktopConfigPath() {
	if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Application Support", "Claude", "claude_desktop_config.json");
	if (process.platform === "win32") {
		const appData = process.env["APPDATA"] ?? path.join(os.homedir(), "AppData", "Roaming");
		return path.join(appData, "Claude", "claude_desktop_config.json");
	}
	return path.join(os.homedir(), ".config", "Claude", "claude_desktop_config.json");
}
function defaultProxyCommand() {
	const currentDir = path.dirname(fileURLToPath(import.meta.url));
	const packageRoot = [path.resolve(currentDir, ".."), path.resolve(currentDir, "..", "..")].find((candidate) => existsSync(path.join(candidate, "bin", "mcp-proxy.cjs")));
	if (!packageRoot) throw new Error(`Could not locate Chain Insights package root from ${currentDir}`);
	return {
		command: process.execPath,
		args: [path.join(packageRoot, "bin", "mcp-proxy.cjs")]
	};
}
async function fileExists(filePath) {
	try {
		await access(filePath, constants.F_OK);
		return true;
	} catch {
		return false;
	}
}
function parseClaudeConfig(raw, filePath) {
	const parsed = JSON.parse(raw);
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`Claude Desktop config must be a JSON object: ${filePath}`);
	return parsed;
}
function backupPathFor(filePath) {
	return `${filePath}.bak-${(/* @__PURE__ */ new Date()).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")}`;
}
async function setupClaudeDesktop(options = {}) {
	const configPath = options.configPath ?? defaultClaudeDesktopConfigPath();
	const { command, args } = defaultProxyCommand();
	const exists = await fileExists(configPath);
	const current = exists ? parseClaudeConfig(await readFile(configPath, "utf8"), configPath) : {};
	const next = {
		...current,
		mcpServers: {
			...current.mcpServers ?? {},
			"chain-insights": {
				command,
				args
			}
		}
	};
	const currentText = exists ? JSON.stringify(current, null, 2) + "\n" : "";
	const nextText = JSON.stringify(next, null, 2) + "\n";
	const changed = currentText !== nextText;
	const dryRun = options.dryRun ?? false;
	let backupPath;
	if (!dryRun && changed) {
		await mkdir(path.dirname(configPath), { recursive: true });
		if (exists) {
			backupPath = backupPathFor(configPath);
			await copyFile(configPath, backupPath);
		}
		await writeFile(configPath, nextText, { mode: 384 });
	}
	return {
		configPath,
		command,
		args,
		backupPath,
		changed,
		dryRun
	};
}
//#endregion
export { setupClaudeDesktop };

//# sourceMappingURL=setup-yXK8agdn.mjs.map