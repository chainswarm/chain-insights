const require_chunk = require("./chunk-CZWwpsFl.cjs");
const require_version = require("./version-BNGtdpmH.cjs");
let commander = require("commander");
let node_child_process = require("node:child_process");
let node_url = require("node:url");
let node_path = require("node:path");
node_path = require_chunk.__toESM(node_path, 1);
//#region src/cli.ts
const __dirname$1 = node_path.default.dirname((0, node_url.fileURLToPath)(require("url").pathToFileURL(__filename).href));
const installerPath = node_path.default.resolve(__dirname$1, "..", "bin", "install.cjs");
const program = new commander.Command();
program.name("chain-insights").description("AML investigation toolkit for blockchain analysis").version(require_version.PACKAGE_INFO.version).option("--claude", "Install Claude Code skills globally to ~/.claude/skills/").option("--codex", "Install Codex skills globally to ~/.codex/skills/ and register MCP");
const rawArgs = process.argv.slice(2);
const installerFlags = rawArgs.filter((a) => a === "--claude" || a === "--codex");
if (installerFlags.length > 0 && !rawArgs.some((a) => !a.startsWith("-"))) {
	try {
		(0, node_child_process.execFileSync)(process.execPath, [installerPath, ...installerFlags], { stdio: "inherit" });
	} catch (err) {
		console.error("Installation failed:", err.message);
		process.exit(1);
	}
	process.exit(0);
}
if (rawArgs[0] === "mcp" && rawArgs[1] === "trace-funds") {
	console.error("error: unknown command 'trace-funds'");
	process.exit(1);
}
async function resolveCaseSelector(input) {
	const { resolveCaseSelector } = await Promise.resolve().then(() => require("./selector-DDfNQKBG.cjs"));
	return resolveCaseSelector(input);
}
async function scopeCasesToInvocationDir() {
	if (process.env["CHAIN_INSIGHTS_CASES_ROOT"]?.trim()) return;
	const { activeCasesRoot } = await Promise.resolve().then(() => require("./active-Dv7Tu-O4.cjs")).then((n) => n.active_exports);
	process.env["CHAIN_INSIGHTS_CASES_ROOT"] = activeCasesRoot();
}
async function showCaseContext(caseSelector) {
	const { CaseStore } = await Promise.resolve().then(() => require("./cases-F4U7q3l8.cjs"));
	const caseId = await resolveCaseSelector(caseSelector);
	const ctx = await CaseStore.loadContext(caseId);
	console.log(`\n=== Case: ${ctx.case.id} ===`);
	console.log(`Name:   ${ctx.case.name}`);
	console.log(`Status: ${ctx.case.status}`);
	console.log(`Tags:   ${ctx.case.tags.join(", ") || "none"}`);
	console.log(`Evidence files: ${ctx.evidenceCount}`);
	console.log(`Dossiers: ${ctx.dossierSummaries.length}`);
	if (ctx.lastSession) {
		console.log(`\n--- Last Session (${ctx.lastSession.sessionId}) ---`);
		console.log(ctx.lastSession.body.slice(0, 500));
	} else console.log("\nNo previous sessions.");
	if (ctx.dossierSummaries.length > 0) {
		console.log("\n--- Entity Dossiers ---");
		for (const d of ctx.dossierSummaries) console.log(`  ${d.address} [${d.type}] tags: ${d.riskTags || "none"}`);
	}
}
function optionalNumber(value) {
	if (value === void 0) return void 0;
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) throw new Error(`Invalid number: ${value}`);
	return parsed;
}
async function withGraphMcpClient(name, fn) {
	const { loadConfig } = await Promise.resolve().then(() => require("./config-Bmdl5hdk.cjs")).then((n) => n.config_exports);
	const config = await loadConfig();
	const { createConfiguredGraphMcpFetch, resolveGraphMcpEndpoint } = await Promise.resolve().then(() => require("./client-35PgrKFh.cjs")).then((n) => n.client_exports);
	const paymentFetch = await createConfiguredGraphMcpFetch(config);
	const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
	const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
	const client = new Client({
		name,
		version: require_version.PACKAGE_VERSION
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
program.command("serve").description("Start local visualization server").option("-p, --port <number>", "Port to bind (default: 4321)", "4321").action(async (opts) => {
	try {
		const { requireWorkspaceRoot } = await Promise.resolve().then(() => require("./output-root-CncCLcN-.cjs")).then((n) => n.output_root_exports);
		const workspaceRoot = requireWorkspaceRoot();
		const { startServer } = await Promise.resolve().then(() => require("./server-B_wZQHsz.cjs")).then((n) => n.server_exports);
		console.log(`Workspace: ${workspaceRoot}`);
		startServer(parseInt(opts.port, 10));
	} catch (err) {
		console.error(err.message);
		process.exit(1);
	}
});
program.command("status").description("Show toolkit status and configuration").action(async () => {
	const { loadConfig } = await Promise.resolve().then(() => require("./config-Bmdl5hdk.cjs")).then((n) => n.config_exports);
	const { findActiveWorkspace, activeDataDir } = await Promise.resolve().then(() => require("./active-Dv7Tu-O4.cjs")).then((n) => n.active_exports);
	const config = await loadConfig();
	const workspace = findActiveWorkspace();
	console.log("Config: ", activeDataDir(config.dataDir));
	if (workspace) console.log("Workspace:", workspace.root);
	console.log("Server: ", `http://127.0.0.1:${config.serverPort}`);
	console.log("Graph MCP:", `${config.graphMcpMode} mode`);
	console.log("Graph endpoint:", config.graphMcpEndpoint);
});
program.command("debug").description("Configure Graph MCP debug mode").addCommand(new commander.Command("on").description("Enable Graph MCP debug mode without x402 payments").requiredOption("--token <token>", "Debug bearer token").option("--endpoint <url>", "Graph MCP endpoint").action(async (opts) => {
	try {
		const { saveConfig } = await Promise.resolve().then(() => require("./config-Bmdl5hdk.cjs")).then((n) => n.config_exports);
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
})).addCommand(new commander.Command("off").description("Disable Graph MCP debug mode and use paid x402 calls").action(async () => {
	try {
		const { saveConfig } = await Promise.resolve().then(() => require("./config-Bmdl5hdk.cjs")).then((n) => n.config_exports);
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
})).addCommand(new commander.Command("status").description("Show Graph MCP payment/debug mode").action(async () => {
	try {
		const { loadConfig } = await Promise.resolve().then(() => require("./config-Bmdl5hdk.cjs")).then((n) => n.config_exports);
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
program.command("init").description("Initialize an investigation workspace").argument("[dir]", "Workspace directory to initialize", ".").option("--force", "Overwrite existing workspace files").action(async (dir, opts) => {
	try {
		const { initWorkspace } = await Promise.resolve().then(() => require("./init-DsSp113o.cjs"));
		const result = await initWorkspace({
			targetDir: dir,
			force: opts.force
		});
		console.log(`Workspace initialized: ${result.workspaceRoot}`);
		console.log(`Files written: ${result.filesWritten.length}`);
	} catch (err) {
		console.error(err.message);
		process.exit(1);
	}
});
program.command("setup").description("Configure external MCP clients").addCommand(new commander.Command("claude-desktop").alias("claude").description("Install or update the Claude Desktop MCP server entry").option("--config <path>", "Path to claude_desktop_config.json").option("--dry-run", "Print the intended change without writing files").action(async (opts) => {
	try {
		const { setupClaudeDesktop } = await Promise.resolve().then(() => require("./setup-DOpKPrlx.cjs"));
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
program.command("config").description("Read or write configuration values").addCommand(new commander.Command("get").argument("<key>", "Config key to read").action(async (key) => {
	const { loadConfig } = await Promise.resolve().then(() => require("./config-Bmdl5hdk.cjs")).then((n) => n.config_exports);
	const { CONFIG_KEYS } = await Promise.resolve().then(() => require("./schema-4XpzDFQM.cjs")).then((n) => n.schema_exports);
	if (!CONFIG_KEYS.includes(key)) {
		console.error(`Unknown config key: ${key}`);
		process.exit(1);
	}
	const value = (await loadConfig())[key];
	console.log(value ?? "");
})).addCommand(new commander.Command("set").argument("<key>", "Config key to write").argument("<value>", "Value to set").action(async (key, value) => {
	if (key === "walletPrivateKey") {
		try {
			const { setWalletPrivateKey } = await Promise.resolve().then(() => require("./wallet-RnvvSpV2.cjs")).then((n) => n.wallet_exports);
			const address = await setWalletPrivateKey(value);
			console.log("Wallet private key encrypted and stored in ~/.chain-insights/wallet.json");
			console.log(`Wallet address: ${address}`);
		} catch (err) {
			console.error(err.message);
			process.exit(1);
		}
		return;
	}
	const { loadConfig, saveConfig } = await Promise.resolve().then(() => require("./config-Bmdl5hdk.cjs")).then((n) => n.config_exports);
	const { CONFIG_KEYS, DEFAULT_CONFIG } = await Promise.resolve().then(() => require("./schema-4XpzDFQM.cjs")).then((n) => n.schema_exports);
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
program.command("wallet").description("Manage the local Base USDC payment wallet").addCommand(new commander.Command("address").description("Print the local payment wallet address").action(async () => {
	try {
		const { getWalletAccount } = await Promise.resolve().then(() => require("./tools-f_vJUZAF.cjs")).then((n) => n.tools_exports);
		const account = await getWalletAccount();
		console.log(account.address);
	} catch (err) {
		console.error(err.message);
		process.exit(1);
	}
})).addCommand(new commander.Command("balance").description("Show the local payment wallet Base USDC balance").action(async () => {
	try {
		const { getWalletBalanceText } = await Promise.resolve().then(() => require("./tools-f_vJUZAF.cjs")).then((n) => n.tools_exports);
		console.log(await getWalletBalanceText());
	} catch (err) {
		console.error(err.message);
		process.exit(1);
	}
})).addCommand(new commander.Command("topup").description("Open a local browser page to top up the payment wallet").option("--no-open", "Print the top-up URL without opening a browser").option("--json", "Print machine-readable top-up metadata").action(async (opts) => {
	try {
		const { buildTopupInfo, getWalletAccount } = await Promise.resolve().then(() => require("./tools-f_vJUZAF.cjs")).then((n) => n.tools_exports);
		const { startTopupServer } = await Promise.resolve().then(() => require("./topup-server-BZuQifvh.cjs")).then((n) => n.topup_server_exports);
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
program.command("mcp").description("Interact with the Chain Insights MCP endpoint").allowExcessArguments(false).addCommand(new commander.Command("tools").description("List available MCP tools (cached 24h)").option("--refresh", "Force refresh schema cache").action(async (opts) => {
	try {
		const { loadSchema, saveSchema } = await Promise.resolve().then(() => require("./schema-cache-BIely23-.cjs"));
		const { formatToolsTable } = await Promise.resolve().then(() => require("./format-D380-zF5.cjs"));
		const { visibleRemoteTools } = await Promise.resolve().then(() => require("./tool-visibility-CwgY205r.cjs")).then((n) => n.tool_visibility_exports);
		const { loadConfig } = await Promise.resolve().then(() => require("./config-Bmdl5hdk.cjs")).then((n) => n.config_exports);
		const { createConfiguredGraphMcpFetch, resolveGraphMcpEndpoint } = await Promise.resolve().then(() => require("./client-35PgrKFh.cjs")).then((n) => n.client_exports);
		const config = await loadConfig();
		const graphMcpEndpoint = resolveGraphMcpEndpoint(config);
		let tools = opts.refresh ? null : await loadSchema(graphMcpEndpoint);
		if (!tools) {
			const paymentFetch = await createConfiguredGraphMcpFetch(config);
			const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
			const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
			const client = new Client({
				name: "chain-insights-cli",
				version: require_version.PACKAGE_VERSION
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
})).addCommand(new commander.Command("address-risk").description("Screen an address for risk, exchange behavior, and optional compare_address connection risk").requiredOption("--address <address>", "Full blockchain address to screen").requiredOption("--network <network>", "Network to query: bittensor, ethereum, or base").option("--compare-address <address>", "Optional second address for connection-risk compare mode").option("--remote", "Force remote MCP tool call instead of local fallback").action(async (opts) => {
	try {
		await withGraphMcpClient("chain-insights-cli-address-risk", async (client) => {
			if (opts.remote) {
				printMcpTextContent(await client.callTool({
					name: "address_risk",
					arguments: {
						address: opts.address,
						network: opts.network,
						...opts.compareAddress ? { compare_address: opts.compareAddress } : {}
					}
				}));
				return;
			}
			const { addressRisk } = await Promise.resolve().then(() => require("./public-tools-hPj0U1JL.cjs"));
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
})).addCommand(new commander.Command("track-funds").description("Trace trusted/victim addresses and optional known untrusted/scammer addresses").requiredOption("--trusted-addresses <addresses>", "Comma-separated full trusted/victim addresses, max 5").requiredOption("--network <network>", "Network to query: bittensor, ethereum, or base").option("--untrusted-addresses <addresses>", "Comma-separated full known untrusted/scammer addresses, max 5").option("--case <id>", "Case ID to attach compact evidence pointers").option("--max-hops <number>", "Maximum trace hops, 1-5").option("--per-address-limit <number>", "Maximum exchange paths/results per address, 1-10").option("--min-amount-sum <number>", "Minimum r.amount_sum for traced edges").option("--remote", "Force remote MCP tool call instead of local fallback").action(async (opts) => {
	try {
		const { requireWorkspaceRoot } = await Promise.resolve().then(() => require("./output-root-CncCLcN-.cjs")).then((n) => n.output_root_exports);
		requireWorkspaceRoot();
		await withGraphMcpClient("chain-insights-cli-track-funds", async (client, config) => {
			if (opts.remote) {
				printMcpTextContent(await client.callTool({
					name: "track_funds",
					arguments: {
						trusted_addresses: opts.trustedAddresses,
						network: opts.network,
						...opts.untrustedAddresses ? { untrusted_addresses: opts.untrustedAddresses } : {}
					}
				}));
				return;
			}
			const { trackFunds } = await Promise.resolve().then(() => require("./public-tools-hPj0U1JL.cjs"));
			const result = await trackFunds(client, config, {
				trustedAddresses: opts.trustedAddresses,
				untrustedAddresses: opts.untrustedAddresses,
				network: opts.network,
				caseId: opts.case,
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
})).addCommand(new commander.Command("call").description("Call an MCP tool directly (debug)").argument("<tool>", "Tool name to call").argument("[args...]", "Key=value arguments (e.g. address=0x1234 chain=ethereum)").action(async (tool, rawArgs) => {
	try {
		const { parseMcpCallArgs } = await Promise.resolve().then(() => require("./call-args-BvG9lcQ_.cjs"));
		const { assertPublicMcpToolName } = await Promise.resolve().then(() => require("./tool-visibility-CwgY205r.cjs")).then((n) => n.tool_visibility_exports);
		const args = parseMcpCallArgs(rawArgs);
		assertPublicMcpToolName(tool);
		await withGraphMcpClient("chain-insights-cli-call", async (client, config) => {
			if (tool === "address_risk") {
				const { addressRisk } = await Promise.resolve().then(() => require("./public-tools-hPj0U1JL.cjs"));
				const result = await addressRisk(client, {
					address: String(args["address"] ?? ""),
					network: String(args["network"] ?? ""),
					compareAddress: args["compare_address"] === void 0 ? void 0 : String(args["compare_address"])
				});
				console.log(result.summaryText);
				return;
			}
			if (tool === "track_funds") {
				const { trackFunds } = await Promise.resolve().then(() => require("./public-tools-hPj0U1JL.cjs"));
				const result = await trackFunds(client, config, {
					trustedAddresses: args["trusted_addresses"] ?? "",
					untrustedAddresses: args["untrusted_addresses"],
					network: String(args["network"] ?? ""),
					caseId: args["case_id"] === void 0 ? void 0 : String(args["case_id"]),
					maxHops: typeof args["max_hops"] === "number" ? args["max_hops"] : void 0,
					perAddressLimit: typeof args["per_address_limit"] === "number" ? args["per_address_limit"] : void 0,
					minAmountSum: typeof args["min_amount_sum"] === "number" ? args["min_amount_sum"] : void 0
				});
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
const caseCommand = new commander.Command("case").description("Manage investigation cases").hook("preAction", async () => {
	await scopeCasesToInvocationDir();
}).addCommand(new commander.Command("open").description("Open a new investigation case").argument("<name>", "Case name (e.g. \"Tornado Mixer Investigation\")").option("--tags <tags>", "Comma-separated tags (e.g. aml,mixer,defi)", "").option("--description <desc>", "Brief description of the investigation", "").action(async (name, opts) => {
	try {
		if (/^[1-9]\d*$/.test(name.trim())) throw new Error("Numeric case names look like list selectors. Use a descriptive case name, e.g. `cia case open \"Tracking stolen funds from <address>\"`.");
		const { CaseStore } = await Promise.resolve().then(() => require("./cases-F4U7q3l8.cjs"));
		const tags = opts.tags ? opts.tags.split(",").map((t) => t.trim()).filter(Boolean) : [];
		const c = await CaseStore.create({
			name,
			tags,
			description: opts.description
		});
		const { casesRoot } = await Promise.resolve().then(() => require("./store-DdzrPrNM.cjs"));
		console.log(`Case opened: ${c.id}`);
		console.log(`Directory:   ${node_path.default.join(casesRoot(), c.id)}/`);
		console.log(`Status:      ${c.status}`);
	} catch (err) {
		console.error(err.message);
		process.exit(1);
	}
})).addCommand(new commander.Command("activate").description("Activate a case (set status to active)").argument("<case-id>", "Case ID to activate").action(async (caseSelector) => {
	try {
		const { CaseStore } = await Promise.resolve().then(() => require("./cases-F4U7q3l8.cjs"));
		const caseId = await resolveCaseSelector(caseSelector);
		const c = await CaseStore.setStatus(caseId, "active");
		console.log(`Case ${c.id} is now: active`);
	} catch (err) {
		console.error(err.message);
		process.exit(1);
	}
})).addCommand(new commander.Command("suspend").description("Suspend a case (set status to suspended)").argument("<case-id>", "Case ID to suspend").action(async (caseSelector) => {
	try {
		const { CaseStore } = await Promise.resolve().then(() => require("./cases-F4U7q3l8.cjs"));
		const caseId = await resolveCaseSelector(caseSelector);
		const c = await CaseStore.setStatus(caseId, "suspended");
		console.log(`Case ${c.id} is now: suspended`);
	} catch (err) {
		console.error(err.message);
		process.exit(1);
	}
})).addCommand(new commander.Command("close").description("Close a case permanently").argument("<case-id>", "Case ID to close").action(async (caseSelector) => {
	try {
		const { CaseStore } = await Promise.resolve().then(() => require("./cases-F4U7q3l8.cjs"));
		const caseId = await resolveCaseSelector(caseSelector);
		const c = await CaseStore.setStatus(caseId, "closed");
		console.log(`Case ${c.id} is now: closed`);
	} catch (err) {
		console.error(err.message);
		process.exit(1);
	}
})).addCommand(new commander.Command("list").description("List all investigation cases").option("--status <status>", "Filter by status (open|active|suspended|closed)").action(async (opts) => {
	try {
		const { CaseStore } = await Promise.resolve().then(() => require("./cases-F4U7q3l8.cjs"));
		const cases = await CaseStore.list();
		const filtered = opts.status ? cases.filter((c) => c.status === opts.status) : cases;
		if (filtered.length === 0) {
			console.log("No cases found.");
			return;
		}
		for (const [index, c] of filtered.entries()) console.log(`${index + 1}. ${c.id}  [${c.status}]  ${c.name}`);
	} catch (err) {
		console.error(err.message);
		process.exit(1);
	}
})).addCommand(new commander.Command("evidence").description("Manage case evidence").addCommand(new commander.Command("add").description("Add evidence to a case from an MCP query result").argument("<case-id>", "Case ID to add evidence to").option("--source <tool>", "MCP tool name that produced this evidence", "manual").option("--content <text>", "Evidence content (MCP response or notes)", "").option("--query-params <params>", "Query parameters used (e.g. address=0x1234)", "").action(async (caseSelector, opts) => {
	try {
		const { EvidenceStore } = await Promise.resolve().then(() => require("./cases-F4U7q3l8.cjs"));
		const caseId = await resolveCaseSelector(caseSelector);
		const result = await EvidenceStore.append(caseId, {
			source: opts.source,
			content: opts.content,
			queryParams: opts.queryParams
		});
		console.log(`Evidence saved: ${result.filename}`);
		console.log(`SHA-256: ${result.sha256}`);
	} catch (err) {
		console.error(err.message);
		process.exit(1);
	}
})).addCommand(new commander.Command("verify").description("Verify evidence manifest integrity for a case").argument("<case-id>", "Case ID to verify").action(async (caseSelector) => {
	try {
		const { EvidenceStore } = await Promise.resolve().then(() => require("./cases-F4U7q3l8.cjs"));
		const caseId = await resolveCaseSelector(caseSelector);
		const result = await EvidenceStore.verifyManifest(caseId);
		if (result.ok) console.log(`Manifest OK — ${result.count} evidence file(s) verified`);
		else {
			console.error(`Manifest FAILED — tampered files: ${(result.tampered ?? []).join(", ")}`);
			process.exit(1);
		}
	} catch (err) {
		console.error(err.message);
		process.exit(1);
	}
}))).addCommand(new commander.Command("dossier").description("Manage entity dossiers for a case").addCommand(new commander.Command("update").description("Append a finding to an entity dossier").argument("<case-id>", "Case ID").argument("<address>", "Entity address or identifier").option("--finding <text>", "Finding to append to the dossier", "").option("--type <type>", "Entity type (eoa|contract|exchange|mixer|unknown)", "unknown").action(async (caseSelector, address, opts) => {
	try {
		const { DossierStore } = await Promise.resolve().then(() => require("./cases-F4U7q3l8.cjs"));
		const caseId = await resolveCaseSelector(caseSelector);
		const entityType = [
			"eoa",
			"contract",
			"exchange",
			"mixer",
			"unknown"
		].includes(opts.type) ? opts.type : "unknown";
		await DossierStore.appendFinding(caseId, address, opts.finding, entityType);
		console.log(`Dossier updated for ${address}`);
	} catch (err) {
		console.error(err.message);
		process.exit(1);
	}
}))).addCommand(new commander.Command("session").description("Manage investigation sessions").addCommand(new commander.Command("start").description("Start a new investigation session for a case").argument("<case-id>", "Case ID").argument("[title...]", "Optional session title").action(async (caseSelector, titleParts) => {
	try {
		const { SessionStore } = await Promise.resolve().then(() => require("./cases-F4U7q3l8.cjs"));
		const caseId = await resolveCaseSelector(caseSelector);
		const title = titleParts.join(" ").trim();
		const s = await SessionStore.start(caseId, title ? { title } : {});
		console.log(`Session started: ${s.sessionId}`);
	} catch (err) {
		console.error(err.message);
		process.exit(1);
	}
})).addCommand(new commander.Command("end").description("End the current session with findings and next steps").argument("<case-id>", "Case ID").option("--findings <text>", "Key findings from this session", "").option("--next-steps <text>", "Next steps for the investigation", "").action(async (caseSelector, opts) => {
	try {
		const { SessionStore } = await Promise.resolve().then(() => require("./cases-F4U7q3l8.cjs"));
		const caseId = await resolveCaseSelector(caseSelector);
		await SessionStore.end(caseId, {
			findings: opts.findings,
			nextSteps: opts.nextSteps
		});
		await SessionStore.archiveOldSessions(caseId);
		console.log(`Session ended for case ${caseId}`);
	} catch (err) {
		console.error(err.message);
		process.exit(1);
	}
}))).addCommand(new commander.Command("show").description("Show saved case context").argument("<case-id>", "Case ID or case list number to show").action(async (caseSelector) => {
	try {
		await showCaseContext(caseSelector);
	} catch (err) {
		console.error(err.message);
		process.exit(1);
	}
}));
program.addCommand(caseCommand);
program.command("playbook").description("Run and manage investigation playbooks").addCommand(new commander.Command("run").description("Execute a playbook by name").argument("<name>", "Playbook name (e.g. trace-funds, risk-check, entity-profile)").option("--case <id>", "Case ID to attach evidence to (auto-created if omitted)").option("--from <n>", "Resume from step N (1-based)", "1").option("--dry-run", "Show steps without executing").option("-p, --param <kv...>", "Parameters as key=value pairs (repeatable, e.g. -p address=0x1 -p hops=3)").action(async (name, opts) => {
	try {
		const resolvedParams = {};
		for (const kv of opts.param ?? []) {
			const eq = kv.indexOf("=");
			if (eq === -1) {
				console.error(`Invalid param format: "${kv}". Use key=value`);
				process.exit(1);
			}
			const key = kv.slice(0, eq);
			if (!key) {
				console.error(`Invalid param format: "${kv}". Key must be non-empty`);
				process.exit(1);
			}
			resolvedParams[key] = kv.slice(eq + 1);
		}
		const { resolvePlaybookContent } = await Promise.resolve().then(() => require("./resolver-cdsIBBH5.cjs"));
		const markdown = await resolvePlaybookContent(name);
		const { PlaybookParser } = await Promise.resolve().then(() => require("./parser--sL50jHE.cjs"));
		const definition = PlaybookParser.parse(markdown, resolvedParams);
		for (const spec of definition.params) if (spec.required && !resolvedParams[spec.name] && !spec.default) {
			console.error(`Missing required param: ${spec.name}. Pass with: -p ${spec.name}=<value>`);
			process.exit(1);
		}
		const fromN = parseInt(opts.from, 10);
		if (isNaN(fromN) || fromN < 1) {
			console.error(`Invalid --from value: "${opts.from}". Must be a positive integer.`);
			process.exit(1);
		}
		const { PlaybookRunner } = await Promise.resolve().then(() => require("./runner-fA0ekDGM.cjs"));
		await PlaybookRunner.run(definition, {
			caseId: opts.case,
			from: fromN,
			dryRun: opts.dryRun,
			params: resolvedParams
		});
	} catch (err) {
		console.error(err.message);
		process.exit(1);
	}
})).addCommand(new commander.Command("list").description("List available playbooks (built-in and user-defined)").action(async () => {
	try {
		const { listPlaybooks } = await Promise.resolve().then(() => require("./resolver-cdsIBBH5.cjs"));
		const playbooks = await listPlaybooks();
		if (playbooks.length === 0) {
			console.log("No playbooks found.");
			return;
		}
		for (const p of playbooks) console.log(`  ${p.name.padEnd(20)} [${p.source}]`);
	} catch (err) {
		console.error(err.message);
		process.exit(1);
	}
})).addCommand(new commander.Command("show").description("Show steps for a playbook without executing").argument("<name>", "Playbook name").action(async (name) => {
	try {
		const { resolvePlaybookContent } = await Promise.resolve().then(() => require("./resolver-cdsIBBH5.cjs"));
		const { PlaybookParser } = await Promise.resolve().then(() => require("./parser--sL50jHE.cjs"));
		const markdown = await resolvePlaybookContent(name);
		const definition = PlaybookParser.parse(markdown, {});
		console.log(`Playbook: ${definition.name} v${definition.version}`);
		console.log(`${definition.description}\n`);
		console.log(`Parameters:`);
		for (const p of definition.params) {
			const req = p.required ? "(required)" : `(optional, default: ${p.default ?? "none"})`;
			console.log(`  ${p.name}: ${p.type} ${req}`);
		}
		console.log(`\nSteps:`);
		for (const step of definition.steps) console.log(`  ${step.index}. ${step.label} → tool: ${step.tool}`);
	} catch (err) {
		console.error(err.message);
		process.exit(1);
	}
}));
program.command("viz").description("Generate money flow visualization").argument("[case-id]", "Case ID to visualize").option("--data <file>", "Raw transaction JSON file for ad-hoc visualization").option("-p, --port <number>", "Server port", "4321").action(async (caseId, opts) => {
	try {
		if (!caseId && !opts.data) {
			console.error("Provide either a case ID or --data <file.json>");
			process.exit(1);
		}
		const { generateVisualization } = await Promise.resolve().then(() => require("./viz-Cdwp49uL.cjs")).then((n) => n.viz_exports);
		const result = await generateVisualization({
			caseId,
			dataFile: opts.data
		});
		const { startServer } = await Promise.resolve().then(() => require("./server-B_wZQHsz.cjs")).then((n) => n.server_exports);
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
