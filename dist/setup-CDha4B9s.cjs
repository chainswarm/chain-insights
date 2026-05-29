const require_chunk = require("./chunk-DakpK96I.cjs");
let node_url = require("node:url");
let node_path = require("node:path");
node_path = require_chunk.__toESM(node_path, 1);
let node_fs = require("node:fs");
let node_fs_promises = require("node:fs/promises");
let node_os = require("node:os");
node_os = require_chunk.__toESM(node_os, 1);
//#region src/claude-desktop/setup.ts
function defaultClaudeDesktopConfigPath() {
	if (process.platform === "darwin") return node_path.default.join(node_os.default.homedir(), "Library", "Application Support", "Claude", "claude_desktop_config.json");
	if (process.platform === "win32") {
		const appData = process.env["APPDATA"] ?? node_path.default.join(node_os.default.homedir(), "AppData", "Roaming");
		return node_path.default.join(appData, "Claude", "claude_desktop_config.json");
	}
	return node_path.default.join(node_os.default.homedir(), ".config", "Claude", "claude_desktop_config.json");
}
function defaultProxyCommand() {
	const currentDir = node_path.default.dirname((0, node_url.fileURLToPath)(require("url").pathToFileURL(__filename).href));
	const packageRoot = [node_path.default.resolve(currentDir, ".."), node_path.default.resolve(currentDir, "..", "..")].find((candidate) => (0, node_fs.existsSync)(node_path.default.join(candidate, "bin", "mcp-proxy.cjs")));
	if (!packageRoot) throw new Error(`Could not locate Chain Insights package root from ${currentDir}`);
	return {
		command: process.execPath,
		args: [node_path.default.join(packageRoot, "bin", "mcp-proxy.cjs")]
	};
}
async function fileExists(filePath) {
	try {
		await (0, node_fs_promises.access)(filePath, node_fs.constants.F_OK);
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
	const current = exists ? parseClaudeConfig(await (0, node_fs_promises.readFile)(configPath, "utf8"), configPath) : {};
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
		await (0, node_fs_promises.mkdir)(node_path.default.dirname(configPath), { recursive: true });
		if (exists) {
			backupPath = backupPathFor(configPath);
			await (0, node_fs_promises.copyFile)(configPath, backupPath);
		}
		await (0, node_fs_promises.writeFile)(configPath, nextText, { mode: 384 });
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
exports.setupClaudeDesktop = setupClaudeDesktop;
