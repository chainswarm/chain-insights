const require_version = require("./version-CO9Or_YV.cjs");
let node_child_process = require("node:child_process");
let node_readline_promises = require("node:readline/promises");
let node_process = require("node:process");
//#region src/update.ts
const DEFAULT_REGISTRY_URL = "https://registry.npmjs.org";
const DEFAULT_TIMEOUT_MS = 3e3;
function compareSemverVersions(a, b) {
	const left = parseSemverCore(a);
	const right = parseSemverCore(b);
	for (let i = 0; i < 3; i += 1) {
		if (left[i] > right[i]) return 1;
		if (left[i] < right[i]) return -1;
	}
	return 0;
}
function resolveUpdateRegistryUrl(env = process.env) {
	return env["CHAIN_INSIGHTS_NPM_REGISTRY_URL"]?.trim() || DEFAULT_REGISTRY_URL;
}
function buildPackageLatestUrl(packageName, registryUrl = DEFAULT_REGISTRY_URL) {
	return `${registryUrl.endsWith("/") ? registryUrl.slice(0, -1) : registryUrl}/${encodeURIComponent(packageName)}/latest`;
}
function resolveNpmUpdateInvocation(packageName = require_version.PACKAGE_INFO.name, env = process.env) {
	const packageSpec = `${packageName}@latest`;
	const displayCommand = `npm install -g ${packageSpec}`;
	const npmExecPath = env["npm_execpath"]?.trim();
	if (npmExecPath) return {
		command: process.execPath,
		args: [
			npmExecPath,
			"install",
			"-g",
			packageSpec
		],
		displayCommand
	};
	return {
		command: process.platform === "win32" ? "npm.cmd" : "npm",
		args: [
			"install",
			"-g",
			packageSpec
		],
		displayCommand
	};
}
async function fetchLatestPackageVersion(options = {}) {
	const packageName = options.packageName ?? require_version.PACKAGE_INFO.name;
	const registryUrl = options.registryUrl ?? resolveUpdateRegistryUrl();
	const fetchImpl = options.fetchImpl ?? fetch;
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
	try {
		const response = await fetchImpl(buildPackageLatestUrl(packageName, registryUrl), {
			headers: {
				accept: "application/json",
				"user-agent": `chain-insights/${require_version.PACKAGE_VERSION}`
			},
			signal: controller.signal
		});
		if (!response.ok) throw new Error(`npmjs registry returned ${response.status}`);
		const body = await response.json();
		if (typeof body.version !== "string" || !body.version.trim()) throw new Error("npmjs registry response did not include a version");
		return body.version.trim();
	} finally {
		clearTimeout(timeout);
	}
}
async function checkForUpdate(options = {}) {
	const packageName = options.packageName ?? require_version.PACKAGE_INFO.name;
	const currentVersion = options.currentVersion ?? require_version.PACKAGE_VERSION;
	const updateCommand = resolveNpmUpdateInvocation(packageName).displayCommand;
	try {
		const latestVersion = await fetchLatestPackageVersion(options);
		return {
			packageName,
			currentVersion,
			latestVersion,
			updateAvailable: compareSemverVersions(latestVersion, currentVersion) > 0,
			updateCommand
		};
	} catch (err) {
		return {
			packageName,
			currentVersion,
			updateAvailable: false,
			updateCommand,
			error: err.message
		};
	}
}
function runPackageUpdate(packageName = require_version.PACKAGE_INFO.name) {
	const invocation = resolveNpmUpdateInvocation(packageName);
	const result = (0, node_child_process.spawnSync)(invocation.command, invocation.args, { stdio: "inherit" });
	if (result.error) throw result.error;
	if (result.status !== 0) {
		const detail = result.signal ? `signal ${result.signal}` : `exit code ${result.status ?? "unknown"}`;
		throw new Error(`Update failed with ${detail}`);
	}
}
function shouldPromptForUpdate(options = {}) {
	const env = options.env ?? process.env;
	if (env["CHAIN_INSIGHTS_SKIP_UPDATE_CHECK"] === "1") return false;
	if (env["CI"] === "true") return false;
	const input = options.input ?? node_process.stdin;
	const output = options.output ?? node_process.stdout;
	return input.isTTY === true && output.isTTY === true;
}
async function maybePromptForUpdate(options = {}) {
	if (!shouldPromptForUpdate(options)) return;
	const check = await checkForUpdate(options);
	if (check.error || !check.updateAvailable || !check.latestVersion) return;
	const output = options.output ?? node_process.stdout;
	output.write(`\nChain Insights ${check.latestVersion} is available (current ${check.currentVersion}).\n`);
	output.write(`Update command: ${check.updateCommand}\n`);
	const rl = (0, node_readline_promises.createInterface)({
		input: options.input ?? node_process.stdin,
		output
	});
	try {
		const answer = await rl.question("Update now? [Y/n] ");
		if (!answer.trim() || answer.trim().toLowerCase().startsWith("y")) try {
			runPackageUpdate(check.packageName);
		} catch (err) {
			output.write(`Update failed: ${err.message}\n`);
			output.write("Workspace initialization is complete. Run `cia update` when ready.\n");
		}
		else output.write("Skipped update. Run `cia update` when ready.\n");
	} finally {
		rl.close();
	}
}
function parseSemverCore(version) {
	const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:[-+].*)?$/.exec(version);
	if (!match) throw new Error(`Invalid semver version: ${version}`);
	return [
		Number(match[1]),
		Number(match[2]),
		Number(match[3])
	];
}
//#endregion
exports.checkForUpdate = checkForUpdate;
exports.maybePromptForUpdate = maybePromptForUpdate;
exports.runPackageUpdate = runPackageUpdate;
