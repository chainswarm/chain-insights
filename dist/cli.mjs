import { n as PACKAGE_VERSION, t as PACKAGE_INFO } from "./version-BA3J8hu4.mjs";
import { Command, Option } from "commander";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
//#region src/cli.ts
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const installerPath = path.resolve(__dirname, "..", "bin", "install.cjs");
const program = new Command();
program.name("chain-insights").description("AML investigation toolkit for blockchain analysis").version(PACKAGE_INFO.version).option("--claude", "Install Claude Code skills globally to ~/.claude/skills/").option("--codex", "Install Codex skills globally to ~/.codex/skills/ and register MCP").option("--hermes", "Install Hermes skills globally to ~/.hermes/skills/chain-insights/ and register MCP");
const rawArgs = process.argv.slice(2);
const installerFlags = rawArgs.filter((a) => a === "--claude" || a === "--codex" || a === "--hermes");
if (installerFlags.length > 0 && !rawArgs.some((a) => !a.startsWith("-"))) {
	try {
		execFileSync(process.execPath, [installerPath, ...installerFlags], { stdio: "inherit" });
	} catch (err) {
		console.error("Installation failed:", err.message);
		process.exit(1);
	}
	process.exit(0);
}
if (rawArgs[0] === "mcp" && [
	"trace-funds",
	"track-funds",
	"scam-topology"
].includes(rawArgs[1] ?? "")) {
	console.error(`error: unknown command '${rawArgs[1]}'`);
	process.exit(1);
}
function optionalNumber(value) {
	if (value === void 0) return void 0;
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) throw new Error(`Invalid number: ${value}`);
	return parsed;
}
function optionalNumberArg(value, name) {
	if (value === void 0) return void 0;
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string") return optionalNumber(value);
	throw new Error(`Invalid number for ${name}: ${String(value)}`);
}
async function withGraphMcpClient(name, fn) {
	const { loadConfig } = await import("./config-C6zM8Xir.mjs").then((n) => n.t);
	const config = await loadConfig();
	const { createConfiguredGraphMcpFetch, resolveGraphMcpEndpoint } = await import("./client-ytTO0mcZ.mjs").then((n) => n.r);
	const paymentFetch = await createConfiguredGraphMcpFetch(config);
	const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
	const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
	const client = new Client({
		name,
		version: PACKAGE_VERSION
	});
	await client.connect(new StreamableHTTPClientTransport(new URL(resolveGraphMcpEndpoint(config)), { fetch: paymentFetch }));
	try {
		return await fn(client, config);
	} finally {
		await client.close();
	}
}
function printMcpTextContent(result) {
	for (const item of result.content ?? []) if (item.type === "text") console.log(item.text);
}
function addExposureSubjectOptions(command) {
	return command.requiredOption("--network <network>", "Network to query. Run `cia mcp networks` for supported networks.").option("--account <address>", "Account address to inspect").option("--owner <address>", "Owner address to inspect").option("--counterparty <address>", "Counterparty address to inspect").option("--venue <name>", "Optional venue filter, for example Bittensor or Hyperliquid").option("--instrument <id>", "Optional instrument filter, for example a subnet lifecycle id or BTC-PERP").option("--instrument-type <type>", "Optional instrument type filter, for example subnet, perp, spot, vault, or staking").option("--start-timestamp-ms <milliseconds>", "Optional inclusive lower activity timestamp bound").option("--end-timestamp-ms <milliseconds>", "Optional inclusive upper activity timestamp bound").option("--limit <number>", "Maximum exposure rows, default 100, max 500");
}
function addExposureMarketOptions(command, requiredInstrument, includeNetwork = true) {
	let configured = command.option("--venue <name>", "Optional venue filter, for example Bittensor or Hyperliquid").option("--market <id>", "Alias for --instrument when using market language").option("--instrument-type <type>", "Optional instrument type filter, for example subnet, perp, spot, vault, or staking").option("--start-timestamp-ms <milliseconds>", "Optional inclusive lower activity timestamp bound").option("--end-timestamp-ms <milliseconds>", "Optional inclusive upper activity timestamp bound").option("--limit <number>", "Maximum exposure rows, default 100, max 500");
	if (includeNetwork) configured = configured.requiredOption("--network <network>", "Network to query. Run `cia mcp networks` for supported networks.");
	return requiredInstrument ? configured.requiredOption("--instrument <id>", "Instrument, market, subnet, hotkey, vault, or durable exposure target identifier to inspect") : configured.option("--instrument <id>", "Instrument, market, subnet, hotkey, vault, or durable exposure target identifier to inspect");
}
function buildExposureInsightCommand(name, tool, description) {
	const command = new Command(name).description(description);
	const configured = tool === "exposure_crowding" ? addExposureMarketOptions(command, true) : tool === "exposure_exit_pressure" ? addExposureSubjectOptions(command).option("--market <id>", "Alias for --instrument when using market language") : addExposureSubjectOptions(command);
	if (tool === "exposure_correlation") configured.option("--candidate-accounts <addresses>", "Comma-separated candidate accounts to compare against");
	if (tool === "exposure_explain") configured.option("--market <id>", "Alias for --instrument when using market language").option("--position-id <id>", "Optional venue-native position, trade, stake, rotation, or lifecycle identifier");
	return configured.action(async (opts) => {
		try {
			await withGraphMcpClient(`chain-insights-cli-${name}`, async (client) => {
				const { exposureCarry, exposureCorrelation, exposureCrowding, exposureExitPressure, exposureExplain, exposureQuality } = await import("./public-tools-A_0trm_c.mjs");
				const args = {
					network: opts.network,
					account: opts.account,
					owner: opts.owner,
					counterparty: opts.counterparty,
					venue: opts.venue,
					instrument: opts.instrument,
					market: opts.market,
					instrumentType: opts.instrumentType,
					startTimestampMs: optionalNumber(opts.startTimestampMs),
					endTimestampMs: optionalNumber(opts.endTimestampMs),
					limit: optionalNumber(opts.limit),
					candidateAccounts: opts.candidateAccounts,
					positionId: opts.positionId
				};
				const result = tool === "exposure_quality" ? await exposureQuality(client, args) : tool === "exposure_carry" ? await exposureCarry(client, args) : tool === "exposure_crowding" ? await exposureCrowding(client, args) : tool === "exposure_exit_pressure" ? await exposureExitPressure(client, args) : tool === "exposure_correlation" ? await exposureCorrelation(client, args) : await exposureExplain(client, args);
				console.log(result.summaryText);
				console.log(JSON.stringify(result.structuredContent, null, 2));
			});
		} catch (err) {
			console.error(err.message);
			process.exit(1);
		}
	});
}
async function printNetworkCapabilities(opts) {
	const { loadConfig } = await import("./config-C6zM8Xir.mjs").then((n) => n.t);
	const { fetchNetworkCapabilities, formatNetworkCapabilities } = await import("./capabilities-CM72SErE.mjs");
	const document = await fetchNetworkCapabilities(await loadConfig());
	if (opts.json) console.log(JSON.stringify(document, null, 2));
	else console.log(formatNetworkCapabilities(document));
}
program.command("networks").alias("network").description("List supported graph networks, capability layers, retention, and freshness").option("--json", "Print raw capability JSON").action(async (opts) => {
	try {
		await printNetworkCapabilities(opts);
	} catch (err) {
		console.error(err.message);
		process.exit(1);
	}
});
program.command("serve").description("Start local visualization server").option("-p, --port <number>", "Port to bind (default: 4321)", "4321").action(async (opts) => {
	try {
		const { requireWorkspaceRoot } = await import("./output-root-BK4pdjyz.mjs").then((n) => n.t);
		const workspaceRoot = requireWorkspaceRoot();
		const { startServer } = await import("./server-BK4bfOiv.mjs").then((n) => n.t);
		console.log(`Workspace: ${workspaceRoot}`);
		startServer(parseInt(opts.port, 10));
	} catch (err) {
		console.error(err.message);
		process.exit(1);
	}
});
program.command("status").description("Show toolkit status and configuration").action(async () => {
	const { loadConfig } = await import("./config-C6zM8Xir.mjs").then((n) => n.t);
	const { findActiveWorkspace, activeDataDir } = await import("./active-BQopLul8.mjs").then((n) => n.t);
	const config = await loadConfig();
	const workspace = findActiveWorkspace();
	const graphMcpStatus = config.graphMcpMode === "debug" && config.graphMcpAuthToken?.trim() ? "bearer access mode" : `${config.graphMcpMode} mode`;
	console.log("Config: ", activeDataDir(config.dataDir));
	if (workspace) console.log("Workspace:", workspace.root);
	console.log("Server: ", `http://127.0.0.1:${config.serverPort}`);
	console.log("Graph MCP:", graphMcpStatus);
	console.log("Graph endpoint:", config.graphMcpEndpoint);
});
program.command("update").description("Check npmjs for a newer Chain Insights release and update this CLI").option("--check", "Only check for a newer release").option("--dry-run", "Print the update command without running it").action(async (opts) => {
	try {
		const { checkForUpdate, runPackageUpdate } = await import("./update-CJUfGCxs.mjs");
		const result = await checkForUpdate();
		if (result.error) throw new Error(`Could not check npmjs for updates: ${result.error}`);
		if (!result.updateAvailable || !result.latestVersion) {
			console.log(`Chain Insights is up to date (${result.currentVersion}).`);
			return;
		}
		console.log(`Chain Insights ${result.latestVersion} is available (current ${result.currentVersion}).`);
		if (opts.check) {
			console.log(`Run: ${result.updateCommand}`);
			return;
		}
		if (opts.dryRun) {
			console.log(`Would run: ${result.updateCommand}`);
			return;
		}
		console.log(`Running: ${result.updateCommand}`);
		runPackageUpdate(result.packageName);
	} catch (err) {
		console.error(err.message);
		process.exit(1);
	}
});
program.command("debug").description("Configure Graph MCP debug mode").addCommand(new Command("on").description("Enable Graph MCP debug mode without x402 payments").requiredOption("--token <token>", "Debug bearer token").option("--endpoint <url>", "Graph MCP endpoint").action(async (opts) => {
	try {
		const { saveConfig } = await import("./config-C6zM8Xir.mjs").then((n) => n.t);
		await saveConfig({
			graphMcpMode: "debug",
			graphMcpAuthToken: opts.token,
			...opts.endpoint ? { graphMcpEndpoint: opts.endpoint } : {}
		});
		console.log("Graph MCP debug mode enabled");
		if (opts.endpoint) console.log(`Graph endpoint: ${opts.endpoint}`);
		console.log("Payments: disabled for Graph MCP calls");
	} catch (err) {
		console.error(err.message);
		process.exit(1);
	}
})).addCommand(new Command("off").description("Disable Graph MCP debug mode and use paid x402 calls").action(async () => {
	try {
		const { saveConfig } = await import("./config-C6zM8Xir.mjs").then((n) => n.t);
		await saveConfig({
			graphMcpMode: "paid",
			graphMcpAuthToken: ""
		});
		console.log("Graph MCP debug mode disabled");
		console.log("Payments: enabled for Graph MCP calls");
	} catch (err) {
		console.error(err.message);
		process.exit(1);
	}
})).addCommand(new Command("status").description("Show Graph MCP payment/debug mode").action(async () => {
	try {
		const { loadConfig } = await import("./config-C6zM8Xir.mjs").then((n) => n.t);
		const config = await loadConfig();
		console.log(`Graph MCP mode: ${config.graphMcpMode}`);
		console.log(`Graph endpoint: ${config.graphMcpEndpoint}`);
		console.log(`Debug token:    ${config.graphMcpAuthToken?.trim() ? "configured" : "not configured"}`);
		console.log(`Payments:       ${config.graphMcpMode === "debug" ? "disabled" : "enabled"}`);
	} catch (err) {
		console.error(err.message);
		process.exit(1);
	}
}));
program.command("access-key").description("Configure Graph MCP test access key mode").addCommand(new Command("set").description("Use a Graph MCP test access key without x402 payments").argument("<key>", "Test access key").option("--endpoint <url>", "Graph MCP endpoint").action(async (key, opts) => {
	try {
		const normalizedKey = key.trim();
		if (!normalizedKey) throw new Error("Test access key is required");
		const { saveConfig } = await import("./config-C6zM8Xir.mjs").then((n) => n.t);
		await saveConfig({
			graphMcpMode: "debug",
			graphMcpAuthToken: normalizedKey,
			...opts.endpoint ? { graphMcpEndpoint: opts.endpoint } : {}
		});
		console.log("Graph MCP test access key configured");
		if (opts.endpoint) console.log(`Graph endpoint: ${opts.endpoint}`);
		console.log("Payments: disabled when the server accepts this key");
	} catch (err) {
		console.error(err.message);
		process.exit(1);
	}
})).addCommand(new Command("clear").description("Remove the Graph MCP test access key and use paid x402 calls").action(async () => {
	try {
		const { saveConfig } = await import("./config-C6zM8Xir.mjs").then((n) => n.t);
		await saveConfig({
			graphMcpMode: "paid",
			graphMcpAuthToken: ""
		});
		console.log("Graph MCP test access key cleared");
		console.log("Payments: enabled for Graph MCP calls");
	} catch (err) {
		console.error(err.message);
		process.exit(1);
	}
})).addCommand(new Command("status").description("Show Graph MCP test access key status").action(async () => {
	try {
		const { loadConfig } = await import("./config-C6zM8Xir.mjs").then((n) => n.t);
		const config = await loadConfig();
		console.log(`Graph endpoint: ${config.graphMcpEndpoint}`);
		console.log(`Access key:     ${config.graphMcpAuthToken?.trim() ? "configured" : "not configured"}`);
		console.log(`Payments:       ${config.graphMcpAuthToken?.trim() ? "disabled when accepted by server" : "enabled"}`);
	} catch (err) {
		console.error(err.message);
		process.exit(1);
	}
}));
program.command("init").description("Initialize an investigation workspace").argument("[dir]", "Workspace directory to initialize", ".").option("--force", "Overwrite existing workspace files").action(async (dir, opts) => {
	try {
		const { initWorkspace } = await import("./init-BOiJMbrt.mjs");
		const result = await initWorkspace({
			targetDir: dir,
			force: opts.force
		});
		console.log(`Workspace initialized: ${result.workspaceRoot}`);
		console.log(`Files written: ${result.filesWritten.length}`);
		const { maybePromptForUpdate } = await import("./update-CJUfGCxs.mjs");
		await maybePromptForUpdate();
	} catch (err) {
		console.error(err.message);
		process.exit(1);
	}
});
program.command("setup").description("Configure external MCP clients").addCommand(new Command("claude-desktop").alias("claude").description("Install or update the Claude Desktop MCP server entry").option("--config <path>", "Path to claude_desktop_config.json").option("--dry-run", "Print the intended change without writing files").action(async (opts) => {
	try {
		const { setupClaudeDesktop } = await import("./setup-yXK8agdn.mjs");
		const result = await setupClaudeDesktop({
			configPath: opts.config,
			dryRun: opts.dryRun
		});
		console.log(`Claude Desktop config: ${result.configPath}`);
		console.log("MCP server:            chain-insights");
		console.log(`Command:               ${result.command}`);
		console.log(`Args:                  ${result.args.join(" ")}`);
		if (result.dryRun) console.log(`Dry run:               ${result.changed ? "would update config" : "already up to date"}`);
		else if (result.changed) {
			console.log(`Updated:               yes`);
			if (result.backupPath) console.log(`Backup:                ${result.backupPath}`);
		} else console.log("Updated:               already up to date");
		console.log("Reload required:       quit and reopen Claude Desktop; it does not hot-reload MCP config.");
	} catch (err) {
		console.error(err.message);
		process.exit(1);
	}
}));
program.command("config").description("Read or write configuration values").addCommand(new Command("get").argument("<key>", "Config key to read").action(async (key) => {
	const { loadConfig } = await import("./config-C6zM8Xir.mjs").then((n) => n.t);
	const { CONFIG_KEYS } = await import("./schema-D_qwaQA5.mjs").then((n) => n.r);
	if (!CONFIG_KEYS.includes(key)) {
		console.error(`Unknown config key: ${key}`);
		process.exit(1);
	}
	const value = (await loadConfig())[key];
	console.log(value ?? "");
})).addCommand(new Command("set").argument("<key>", "Config key to write").argument("<value>", "Value to set").action(async (key, value) => {
	if (key === "walletPrivateKey") {
		try {
			const { setWalletPrivateKey } = await import("./wallet-BL0fJC29.mjs").then((n) => n.s);
			const address = await setWalletPrivateKey(value);
			console.log("Wallet private key encrypted and stored in ~/.chain-insights/wallet.json");
			console.log(`Wallet address: ${address}`);
		} catch (err) {
			console.error(err.message);
			process.exit(1);
		}
		return;
	}
	const { loadConfig, saveConfig } = await import("./config-C6zM8Xir.mjs").then((n) => n.t);
	const { CONFIG_KEYS, DEFAULT_CONFIG } = await import("./schema-D_qwaQA5.mjs").then((n) => n.r);
	const current = await loadConfig();
	if (!CONFIG_KEYS.includes(key)) {
		console.error(`Unknown config key: ${key}`);
		process.exit(1);
	}
	const existing = current[key];
	const defaultValue = DEFAULT_CONFIG[key];
	const coerced = typeof existing === "number" || typeof defaultValue === "number" ? Number(value) : value;
	await saveConfig({ [key]: coerced });
	const displayed = key.toLowerCase().includes("token") ? "[redacted]" : coerced;
	console.log(`Set ${key} = ${displayed}`);
}));
program.command("wallet").description("Manage the local Base USDC payment wallet").addCommand(new Command("import").description("Import a Base payment wallet").argument("<private-key>", "0x-prefixed EVM private key").action(async (privateKey) => {
	try {
		const { setWalletPrivateKey } = await import("./wallet-BL0fJC29.mjs").then((n) => n.s);
		const address = await setWalletPrivateKey(privateKey);
		console.log(`Wallet imported: ${address}`);
		console.log("Next: run `chain-insights wallet ready`");
	} catch (err) {
		console.error(err.message);
		process.exit(1);
	}
})).addCommand(new Command("address").description("Print the local payment wallet address").action(async () => {
	try {
		const { getWalletAccount } = await import("./tools-v6kcdojg.mjs").then((n) => n.c);
		const account = await getWalletAccount();
		console.log(account.address);
	} catch (err) {
		console.error(err.message);
		process.exit(1);
	}
})).addCommand(new Command("balance").description("Show the local payment wallet Base USDC balance").action(async () => {
	try {
		const { getWalletBalanceText } = await import("./tools-v6kcdojg.mjs").then((n) => n.c);
		console.log(await getWalletBalanceText());
	} catch (err) {
		console.error(err.message);
		process.exit(1);
	}
})).addCommand(new Command("ready").description("Check and prepare the wallet for paid GraphRAG MCP calls").option("--check-only", "Only check readiness; do not submit the one-time payment setup").addOption(new Option("--no-approve", "Deprecated alias for --check-only").hideHelp()).option("--payment-usdc <amount>", "USDC setup cap to prepare for paid calls", "1").addOption(new Option("--approval-usdc <amount>", "Deprecated alias for --payment-usdc").hideHelp()).option("--json", "Print machine-readable readiness metadata").action(async (opts) => {
	try {
		const { formatWalletReadiness, parsePaymentApprovalUnits, prepareWalletForPaidCalls } = await import("./tools-v6kcdojg.mjs").then((n) => n.c);
		const result = await prepareWalletForPaidCalls({
			minimumApprovalUnits: parsePaymentApprovalUnits(opts.paymentUsdc ?? opts.approvalUsdc ?? "1"),
			approve: opts.checkOnly ? false : opts.approve !== false
		});
		if (opts.json) {
			console.log(JSON.stringify(result, (_key, value) => typeof value === "bigint" ? value.toString() : value, 2));
			return;
		}
		console.log(formatWalletReadiness(result.readiness, result.approval));
	} catch (err) {
		console.error(err.message);
		process.exit(1);
	}
})).addCommand(new Command("topup").description("Open a local browser page to top up the payment wallet").option("--no-open", "Print the top-up URL without opening a browser").option("--json", "Print machine-readable top-up metadata").action(async (opts) => {
	try {
		const { buildTopupInfo, getWalletAccount } = await import("./tools-v6kcdojg.mjs").then((n) => n.c);
		const { startTopupServer } = await import("./topup-server-R3dNp-p8.mjs").then((n) => n.r);
		const account = await getWalletAccount();
		const url = await startTopupServer(account);
		const info = buildTopupInfo(account.address, url);
		if (opts.json) console.log(JSON.stringify(info, null, 2));
		else {
			console.log(`Top-up URL: ${url}`);
			console.log(`Wallet:     ${account.address}`);
			console.log("Network:    Base");
			console.log("Token:      USDC");
			console.log("Press Ctrl+C to stop the top-up server.");
		}
		if (opts.open !== false) {
			const open = (await import("open")).default;
			await open(url);
		}
	} catch (err) {
		console.error(err.message);
		process.exit(1);
	}
}));
program.command("mcp").description("Interact with the Chain Insights MCP endpoint").allowExcessArguments(false).addCommand(new Command("networks").description("List supported graph networks, capability layers, retention, and freshness").option("--json", "Print raw capability JSON").action(async (opts) => {
	try {
		await printNetworkCapabilities(opts);
	} catch (err) {
		console.error(err.message);
		process.exit(1);
	}
})).addCommand(new Command("tools").description("List available MCP tools (cached 24h)").option("--refresh", "Force refresh schema cache").action(async (opts) => {
	try {
		const { loadSchema, saveSchema } = await import("./schema-cache-DwDvPy4e.mjs");
		const { formatToolsTable } = await import("./format-Bq94jSyw.mjs");
		const { visibleRemoteTools } = await import("./tool-visibility-nr6XqO1F.mjs").then((n) => n.n);
		const { loadConfig } = await import("./config-C6zM8Xir.mjs").then((n) => n.t);
		const { createConfiguredGraphMcpFetch, resolveGraphMcpEndpoint } = await import("./client-ytTO0mcZ.mjs").then((n) => n.r);
		const config = await loadConfig();
		const graphMcpEndpoint = resolveGraphMcpEndpoint(config);
		let tools = opts.refresh ? null : await loadSchema(graphMcpEndpoint);
		if (!tools) {
			const paymentFetch = await createConfiguredGraphMcpFetch(config);
			const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
			const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
			const client = new Client({
				name: "chain-insights-cli",
				version: PACKAGE_VERSION
			});
			await client.connect(new StreamableHTTPClientTransport(new URL(graphMcpEndpoint), { fetch: paymentFetch }));
			try {
				tools = (await client.listTools()).tools;
				await saveSchema(tools, graphMcpEndpoint);
			} finally {
				await client.close();
			}
		}
		console.log(formatToolsTable(visibleRemoteTools(tools)));
	} catch (err) {
		console.error(err.message);
		process.exit(1);
	}
})).addCommand(new Command("aml-address-risk").description("Screen an address for risk, exchange behavior, and optional compare_address connection risk").requiredOption("--address <address>", "Full blockchain address to screen").requiredOption("--network <network>", "Network to query. Run `cia mcp networks` for supported networks.").option("--compare-address <address>", "Optional second address for connection-risk compare mode").option("--remote", "Force remote MCP tool call instead of local Chain Insights recipe").action(async (opts) => {
	try {
		await withGraphMcpClient("chain-insights-cli-aml-address-risk", async (client) => {
			if (opts.remote) {
				printMcpTextContent(await client.callTool({
					name: "aml_address_risk",
					arguments: {
						address: opts.address,
						network: opts.network,
						...opts.compareAddress ? { compare_address: opts.compareAddress } : {}
					}
				}));
				return;
			}
			const { addressRisk } = await import("./public-tools-A_0trm_c.mjs");
			const result = await addressRisk(client, {
				address: opts.address,
				network: opts.network,
				compareAddress: opts.compareAddress
			});
			console.log(result.summaryText);
		});
	} catch (err) {
		console.error(err.message);
		process.exit(1);
	}
})).addCommand(new Command("aml-trace-victim-funds").description("Trace victim/source addresses forward to exchange deposit candidates").requiredOption("--victim-addresses <addresses>", "Comma-separated full victim/source addresses, max 5").requiredOption("--network <network>", "Network to query. Run `cia mcp networks` for supported networks.").option("--known-suspect-addresses <addresses>", "Optional known suspect addresses for context only, max 5").option("--incident-timestamp-ms <milliseconds>", "Optional incident timestamp in milliseconds").option("--max-hops <number>", "Maximum trace hops, 1-5").option("--per-address-limit <number>", "Maximum exchange paths/results per address, 1-10").option("--min-amount-sum <number>", "Minimum r.amount_sum for traced edges").option("--remote", "Force remote MCP tool call instead of local Chain Insights recipe").action(async (opts) => {
	try {
		const { requireWorkspaceRoot } = await import("./output-root-BK4pdjyz.mjs").then((n) => n.t);
		requireWorkspaceRoot();
		await withGraphMcpClient("chain-insights-cli-aml-trace-victim-funds", async (client, config) => {
			if (opts.remote) {
				printMcpTextContent(await client.callTool({
					name: "aml_trace_victim_funds",
					arguments: {
						victim_addresses: opts.victimAddresses,
						network: opts.network,
						...opts.knownSuspectAddresses ? { known_suspect_addresses: opts.knownSuspectAddresses } : {}
					}
				}));
				return;
			}
			const { traceVictimFunds } = await import("./public-tools-A_0trm_c.mjs");
			const result = await traceVictimFunds(client, config, {
				victimAddresses: opts.victimAddresses,
				knownSuspectAddresses: opts.knownSuspectAddresses,
				network: opts.network,
				incidentTimestampMs: optionalNumber(opts.incidentTimestampMs),
				maxHops: optionalNumber(opts.maxHops),
				perAddressLimit: optionalNumber(opts.perAddressLimit),
				minAmountSum: optionalNumber(opts.minAmountSum)
			});
			console.log(result.summaryText);
			console.log(JSON.stringify(result.structuredContent, null, 2));
		});
	} catch (err) {
		console.error(err.message);
		process.exit(1);
	}
})).addCommand(new Command("aml-trace-suspect-funds").description("Trace suspected scammer, mule, operator, or laundering-ring addresses forward to cashout topology").requiredOption("--network <network>", "Network to query. Run `cia mcp networks` for supported networks.").requiredOption("--suspect-addresses <addresses>", "Comma-separated full suspect-controlled addresses, max 5").option("--incident-timestamp-ms <milliseconds>", "Optional incident timestamp in milliseconds").option("--max-hops <number>", "Maximum trace hops, default 3, max 5").option("--per-address-limit <number>", "Maximum exchange paths/results per address, 1-10").option("--min-amount-sum <number>", "Minimum r.amount_sum for traced edges").action(async (opts) => {
	try {
		const { requireWorkspaceRoot } = await import("./output-root-BK4pdjyz.mjs").then((n) => n.t);
		requireWorkspaceRoot();
		await withGraphMcpClient("chain-insights-cli-aml-trace-suspect-funds", async (client, config) => {
			const { traceSuspectFunds } = await import("./public-tools-A_0trm_c.mjs");
			const result = await traceSuspectFunds(client, config, {
				suspectAddresses: opts.suspectAddresses,
				network: opts.network,
				maxHops: optionalNumber(opts.maxHops),
				perAddressLimit: optionalNumber(opts.perAddressLimit),
				minAmountSum: optionalNumber(opts.minAmountSum),
				incidentTimestampMs: optionalNumber(opts.incidentTimestampMs)
			});
			console.log(result.summaryText);
			console.log(JSON.stringify(result.structuredContent, null, 2));
		});
	} catch (err) {
		console.error(err.message);
		process.exit(1);
	}
})).addCommand(new Command("aml-trace-deposit-sources").description("Trace backward from suspected deposit/cashout addresses to upstream sources and convergence").requiredOption("--network <network>", "Network to query. Run `cia mcp networks` for supported networks.").requiredOption("--deposit-addresses <addresses>", "Comma-separated full suspected deposit/cashout addresses, max 5").option("--max-hops <number>", "Maximum reverse traceback hops, default 2, max 5").action(async (opts) => {
	try {
		const { requireWorkspaceRoot } = await import("./output-root-BK4pdjyz.mjs").then((n) => n.t);
		requireWorkspaceRoot();
		await withGraphMcpClient("chain-insights-cli-aml-trace-deposit-sources", async (client, config) => {
			const { traceDepositSources } = await import("./public-tools-A_0trm_c.mjs");
			const result = await traceDepositSources(client, config, {
				depositAddresses: opts.depositAddresses,
				network: opts.network,
				maxHops: optionalNumber(opts.maxHops)
			});
			console.log(result.summaryText);
			console.log(JSON.stringify(result.structuredContent, null, 2));
		});
	} catch (err) {
		console.error(err.message);
		process.exit(1);
	}
})).addCommand(new Command("exposure-profile").description("Explain staking or trading exposure around one account, owner, or counterparty").requiredOption("--network <network>", "Network to query. Run `cia mcp networks` for supported networks.").option("--account <address>", "Account address to inspect").option("--owner <address>", "Owner address to inspect").option("--counterparty <address>", "Counterparty address to inspect").option("--venue <name>", "Optional venue filter, for example Bittensor or Hyperliquid").option("--instrument <id>", "Optional instrument filter, for example a subnet lifecycle id or BTC-PERP").option("--instrument-type <type>", "Optional instrument type filter, for example subnet, perp, spot, vault, or staking").option("--start-timestamp-ms <milliseconds>", "Optional inclusive lower activity timestamp bound").option("--end-timestamp-ms <milliseconds>", "Optional inclusive upper activity timestamp bound").option("--limit <number>", "Maximum exposure rows, default 100, max 500").action(async (opts) => {
	try {
		await withGraphMcpClient("chain-insights-cli-exposure-profile", async (client) => {
			const { exposureProfile } = await import("./public-tools-A_0trm_c.mjs");
			const result = await exposureProfile(client, {
				network: opts.network,
				account: opts.account,
				owner: opts.owner,
				counterparty: opts.counterparty,
				venue: opts.venue,
				instrument: opts.instrument,
				instrumentType: opts.instrumentType,
				startTimestampMs: optionalNumber(opts.startTimestampMs),
				endTimestampMs: optionalNumber(opts.endTimestampMs),
				limit: optionalNumber(opts.limit)
			});
			console.log(result.summaryText);
			console.log(JSON.stringify(result.structuredContent, null, 2));
		});
	} catch (err) {
		console.error(err.message);
		process.exit(1);
	}
})).addCommand(buildExposureInsightCommand("exposure-quality", "exposure_quality", "Score whether exposure behavior looks disciplined, fragile, lucky, or noisy")).addCommand(buildExposureInsightCommand("exposure-carry", "exposure_carry", "Explain carry earned or paid by staking, trading, funding, fees, emissions, or dividends")).addCommand(buildExposureInsightCommand("exposure-crowding", "exposure_crowding", "Measure crowding and side concentration for a market, subnet, hotkey, vault, or strategy")).addCommand(buildExposureInsightCommand("exposure-exit-pressure", "exposure_exit_pressure", "Explain liquidation, slippage, funding pain, unstake, or other exit pressure")).addCommand(buildExposureInsightCommand("exposure-correlation", "exposure_correlation", "Compare accounts for possible copy, overlap, or strategy-cluster exposure behavior")).addCommand(buildExposureInsightCommand("exposure-explain", "exposure_explain", "Explain a specific exposure lifecycle, trade, position, stake, rotation, or incident")).addCommand(new Command("call").description("Call an MCP tool directly (debug)").argument("<tool>", "Tool name to call").argument("[args...]", "Key=value arguments (e.g. address=0x1234 chain=ethereum)").action(async (tool, rawArgs) => {
	try {
		const { parseMcpCallArgs } = await import("./call-args-DPXdX3_D.mjs");
		const { assertPublicMcpToolName } = await import("./tool-visibility-nr6XqO1F.mjs").then((n) => n.n);
		const args = parseMcpCallArgs(rawArgs);
		assertPublicMcpToolName(tool);
		await withGraphMcpClient("chain-insights-cli-call", async (client, config) => {
			if (tool === "aml_address_risk") {
				const { addressRisk } = await import("./public-tools-A_0trm_c.mjs");
				const result = await addressRisk(client, {
					address: String(args["address"] ?? ""),
					network: String(args["network"] ?? ""),
					compareAddress: args["compare_address"] === void 0 ? void 0 : String(args["compare_address"])
				});
				console.log(result.summaryText);
				return;
			}
			if (tool === "aml_trace_victim_funds") {
				const { traceVictimFunds } = await import("./public-tools-A_0trm_c.mjs");
				const result = await traceVictimFunds(client, config, {
					victimAddresses: args["victim_addresses"] ?? "",
					knownSuspectAddresses: args["known_suspect_addresses"],
					network: String(args["network"] ?? ""),
					incidentTimestampMs: optionalNumberArg(args["incident_timestamp_ms"], "incident_timestamp_ms"),
					maxHops: typeof args["max_hops"] === "number" ? args["max_hops"] : void 0,
					perAddressLimit: typeof args["per_address_limit"] === "number" ? args["per_address_limit"] : void 0,
					minAmountSum: typeof args["min_amount_sum"] === "number" ? args["min_amount_sum"] : void 0
				});
				console.log(result.summaryText);
				console.log(JSON.stringify(result.structuredContent, null, 2));
				return;
			}
			if (tool === "aml_trace_suspect_funds") {
				const { traceSuspectFunds } = await import("./public-tools-A_0trm_c.mjs");
				const result = await traceSuspectFunds(client, config, {
					suspectAddresses: args["suspect_addresses"] ?? "",
					network: String(args["network"] ?? ""),
					maxHops: typeof args["max_hops"] === "number" ? args["max_hops"] : void 0,
					perAddressLimit: typeof args["per_address_limit"] === "number" ? args["per_address_limit"] : void 0,
					minAmountSum: typeof args["min_amount_sum"] === "number" ? args["min_amount_sum"] : void 0,
					incidentTimestampMs: optionalNumberArg(args["incident_timestamp_ms"], "incident_timestamp_ms")
				});
				console.log(result.summaryText);
				console.log(JSON.stringify(result.structuredContent, null, 2));
				return;
			}
			if (tool === "aml_trace_deposit_sources") {
				const { traceDepositSources } = await import("./public-tools-A_0trm_c.mjs");
				const result = await traceDepositSources(client, config, {
					depositAddresses: args["deposit_addresses"] ?? "",
					network: String(args["network"] ?? ""),
					maxHops: typeof args["max_hops"] === "number" ? args["max_hops"] : void 0
				});
				console.log(result.summaryText);
				console.log(JSON.stringify(result.structuredContent, null, 2));
				return;
			}
			if (tool === "exposure_profile") {
				const { exposureProfile } = await import("./public-tools-A_0trm_c.mjs");
				const result = await exposureProfile(client, {
					network: String(args["network"] ?? ""),
					account: args["account"] === void 0 ? void 0 : String(args["account"]),
					owner: args["owner"] === void 0 ? void 0 : String(args["owner"]),
					counterparty: args["counterparty"] === void 0 ? void 0 : String(args["counterparty"]),
					venue: args["venue"] === void 0 ? void 0 : String(args["venue"]),
					instrument: args["instrument"] === void 0 ? void 0 : String(args["instrument"]),
					instrumentType: args["instrument_type"] === void 0 ? void 0 : String(args["instrument_type"]),
					startTimestampMs: optionalNumberArg(args["start_timestamp_ms"], "start_timestamp_ms"),
					endTimestampMs: optionalNumberArg(args["end_timestamp_ms"], "end_timestamp_ms"),
					limit: optionalNumberArg(args["limit"], "limit")
				});
				console.log(result.summaryText);
				console.log(JSON.stringify(result.structuredContent, null, 2));
				return;
			}
			if ([
				"exposure_quality",
				"exposure_carry",
				"exposure_crowding",
				"exposure_exit_pressure",
				"exposure_correlation",
				"exposure_explain"
			].includes(tool)) {
				const { exposureCarry, exposureCorrelation, exposureCrowding, exposureExitPressure, exposureExplain, exposureQuality } = await import("./public-tools-A_0trm_c.mjs");
				const exposureArgs = {
					network: String(args["network"] ?? ""),
					account: args["account"] === void 0 ? void 0 : String(args["account"]),
					owner: args["owner"] === void 0 ? void 0 : String(args["owner"]),
					counterparty: args["counterparty"] === void 0 ? void 0 : String(args["counterparty"]),
					venue: args["venue"] === void 0 ? void 0 : String(args["venue"]),
					instrument: args["instrument"] === void 0 ? void 0 : String(args["instrument"]),
					market: args["market"] === void 0 ? void 0 : String(args["market"]),
					instrumentType: args["instrument_type"] === void 0 ? void 0 : String(args["instrument_type"]),
					startTimestampMs: optionalNumberArg(args["start_timestamp_ms"], "start_timestamp_ms"),
					endTimestampMs: optionalNumberArg(args["end_timestamp_ms"], "end_timestamp_ms"),
					limit: optionalNumberArg(args["limit"], "limit"),
					candidateAccounts: args["candidate_accounts"],
					positionId: args["position_id"] === void 0 ? void 0 : String(args["position_id"])
				};
				const result = tool === "exposure_quality" ? await exposureQuality(client, exposureArgs) : tool === "exposure_carry" ? await exposureCarry(client, exposureArgs) : tool === "exposure_crowding" ? await exposureCrowding(client, exposureArgs) : tool === "exposure_exit_pressure" ? await exposureExitPressure(client, exposureArgs) : tool === "exposure_correlation" ? await exposureCorrelation(client, exposureArgs) : await exposureExplain(client, exposureArgs);
				console.log(result.summaryText);
				console.log(JSON.stringify(result.structuredContent, null, 2));
				return;
			}
			printMcpTextContent(await client.callTool({
				name: tool,
				arguments: args
			}));
		});
	} catch (err) {
		console.error(err.message);
		process.exit(1);
	}
}));
program.command("viz").description("Generate a workspace visualization").argument("[source-id]", "Workspace graph report ID to render").option("--data <file>", "Raw transaction JSON file for ad-hoc visualization").option("-p, --port <number>", "Server port", "4321").action(async (sourceId, opts) => {
	try {
		if (!sourceId && !opts.data) {
			console.error("Provide either a visualization source ID or --data <file.json>");
			process.exit(1);
		}
		const { generateVisualization } = await import("./viz-D8umSF-t.mjs").then((n) => n.n);
		const result = await generateVisualization({
			sourceId,
			dataFile: opts.data
		});
		const { startServer } = await import("./server-BK4bfOiv.mjs").then((n) => n.t);
		const port = parseInt(opts.port, 10);
		startServer(port);
		const url = `http://127.0.0.1:${port}/viz/${result.vizId}`;
		console.log(`Visualization: ${url}`);
		const open = (await import("open")).default;
		await open(url);
	} catch (err) {
		console.error(err.message);
		process.exit(1);
	}
});
program.parse(process.argv);
//#endregion
export {};

//# sourceMappingURL=cli.mjs.map