import { Command } from "commander";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
//#region src/cli.ts
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const installerPath = path.resolve(__dirname, "..", "bin", "install.cjs");
const program = new Command();
program.name("chain-insights").description("AML investigation toolkit for blockchain analysis").version(pkg.version).option("--claude", "Install Claude Code skills globally to ~/.claude/skills/").option("--codex", "Install Codex skills globally to ~/.codex/skills/ and register MCP");
const rawArgs = process.argv.slice(2);
const installerFlags = rawArgs.filter((a) => a === "--claude" || a === "--codex");
if (installerFlags.length > 0 && !rawArgs.some((a) => !a.startsWith("-"))) {
	try {
		execFileSync(process.execPath, [installerPath, ...installerFlags], { stdio: "inherit" });
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
	const { resolveCaseSelector } = await import("./selector-YE5MT5cS.mjs");
	return resolveCaseSelector(input);
}
async function scopeCasesToInvocationDir() {
	if (process.env["CHAIN_INSIGHTS_CASES_ROOT"]?.trim()) return;
	const { activeCasesRoot } = await import("./active-DhZAbOKJ.mjs").then((n) => n.n);
	process.env["CHAIN_INSIGHTS_CASES_ROOT"] = activeCasesRoot();
}
async function showCaseContext(caseSelector) {
	const { CaseStore } = await import("./cases-BPDhz2C6.mjs");
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
	const { loadConfig } = await import("./config-DapwbWWu.mjs").then((n) => n.t);
	const config = await loadConfig();
	const { createConfiguredGraphMcpFetch, resolveGraphMcpEndpoint } = await import("./client-Bl03JHUH.mjs").then((n) => n.t);
	const paymentFetch = await createConfiguredGraphMcpFetch(config);
	const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
	const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
	const client = new Client({
		name,
		version: "0.1.0"
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
		const { requireWorkspaceRoot } = await import("./output-root-DSl0xFAF.mjs").then((n) => n.t);
		const workspaceRoot = requireWorkspaceRoot();
		const { startServer } = await import("./server-lqbGlp_4.mjs").then((n) => n.t);
		console.log(`Workspace: ${workspaceRoot}`);
		startServer(parseInt(opts.port, 10));
	} catch (err) {
		console.error(err.message);
		process.exit(1);
	}
});
program.command("status").description("Show toolkit status and configuration").action(async () => {
	const { loadConfig } = await import("./config-DapwbWWu.mjs").then((n) => n.t);
	const { findActiveWorkspace, activeDataDir } = await import("./active-DhZAbOKJ.mjs").then((n) => n.n);
	const config = await loadConfig();
	const workspace = findActiveWorkspace();
	console.log("Config: ", activeDataDir(config.dataDir));
	if (workspace) console.log("Workspace:", workspace.root);
	console.log("Server: ", `http://127.0.0.1:${config.serverPort}`);
	console.log("Graph MCP:", `${config.graphMcpMode} mode`);
	console.log("Graph endpoint:", config.graphMcpEndpoint);
});
program.command("debug").description("Configure Graph MCP debug mode").addCommand(new Command("on").description("Enable Graph MCP debug mode without x402 payments").requiredOption("--token <token>", "Debug bearer token").option("--endpoint <url>", "Graph MCP endpoint").action(async (opts) => {
	try {
		const { saveConfig } = await import("./config-DapwbWWu.mjs").then((n) => n.t);
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
		const { saveConfig } = await import("./config-DapwbWWu.mjs").then((n) => n.t);
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
		const { loadConfig } = await import("./config-DapwbWWu.mjs").then((n) => n.t);
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
		const { initWorkspace } = await import("./init-DG13T6uj.mjs");
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
program.command("setup").description("Configure external MCP clients").addCommand(new Command("claude-desktop").alias("claude").description("Install or update the Claude Desktop MCP server entry").option("--config <path>", "Path to claude_desktop_config.json").option("--dry-run", "Print the intended change without writing files").action(async (opts) => {
	try {
		const { setupClaudeDesktop } = await import("./setup-K8vvsUMv.mjs");
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
	const { loadConfig } = await import("./config-DapwbWWu.mjs").then((n) => n.t);
	const { CONFIG_KEYS } = await import("./schema-2A9z9f1Q.mjs").then((n) => n.r);
	if (!CONFIG_KEYS.includes(key)) {
		console.error(`Unknown config key: ${key}`);
		process.exit(1);
	}
	const value = (await loadConfig())[key];
	console.log(value ?? "");
})).addCommand(new Command("set").argument("<key>", "Config key to write").argument("<value>", "Value to set").action(async (key, value) => {
	if (key === "walletPrivateKey") {
		try {
			const { encryptKey } = await import("./wallet-CKG61Aoq.mjs").then((n) => n.i);
			await encryptKey(value);
			console.log("Wallet private key encrypted and stored in ~/.chain-insights/wallet.json");
		} catch (err) {
			console.error(err.message);
			process.exit(1);
		}
		return;
	}
	const { loadConfig, saveConfig } = await import("./config-DapwbWWu.mjs").then((n) => n.t);
	const { CONFIG_KEYS, DEFAULT_CONFIG } = await import("./schema-2A9z9f1Q.mjs").then((n) => n.r);
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
program.command("wallet").description("Manage the local Base USDC payment wallet").addCommand(new Command("address").description("Print the local payment wallet address").action(async () => {
	try {
		const { getWalletAccount } = await import("./tools-ByWZGszy.mjs").then((n) => n.o);
		const account = await getWalletAccount();
		console.log(account.address);
	} catch (err) {
		console.error(err.message);
		process.exit(1);
	}
})).addCommand(new Command("balance").description("Show the local payment wallet Base USDC balance").action(async () => {
	try {
		const { getWalletBalanceText } = await import("./tools-ByWZGszy.mjs").then((n) => n.o);
		console.log(await getWalletBalanceText());
	} catch (err) {
		console.error(err.message);
		process.exit(1);
	}
})).addCommand(new Command("topup").description("Open a local browser page to top up the payment wallet").option("--no-open", "Print the top-up URL without opening a browser").option("--json", "Print machine-readable top-up metadata").action(async (opts) => {
	try {
		const { buildTopupInfo, getWalletAccount } = await import("./tools-ByWZGszy.mjs").then((n) => n.o);
		const { startTopupServer } = await import("./topup-server-WM-OiJzV.mjs").then((n) => n.r);
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
program.command("mcp").description("Interact with the Chain Insights MCP endpoint").allowExcessArguments(false).addCommand(new Command("tools").description("List available MCP tools (cached 24h)").option("--refresh", "Force refresh schema cache").action(async (opts) => {
	try {
		const { loadSchema, saveSchema } = await import("./schema-cache--gKWCySz.mjs");
		const { formatToolsTable } = await import("./format-TsKe-chT.mjs");
		const { visibleRemoteTools } = await import("./tool-visibility-B-nSHuFy.mjs").then((n) => n.n);
		const { loadConfig } = await import("./config-DapwbWWu.mjs").then((n) => n.t);
		const { createConfiguredGraphMcpFetch, resolveGraphMcpEndpoint } = await import("./client-Bl03JHUH.mjs").then((n) => n.t);
		const config = await loadConfig();
		const graphMcpEndpoint = resolveGraphMcpEndpoint(config);
		let tools = opts.refresh ? null : await loadSchema(graphMcpEndpoint);
		if (!tools) {
			const paymentFetch = await createConfiguredGraphMcpFetch(config);
			const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
			const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
			const client = new Client({
				name: "chain-insights-cli",
				version: "0.1.0"
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
})).addCommand(new Command("address-risk").description("Screen an address for risk, exchange behavior, and optional compare_address connection risk").requiredOption("--address <address>", "Full blockchain address to screen").requiredOption("--network <network>", "Network to query: bittensor, ethereum, or base").option("--compare-address <address>", "Optional second address for connection-risk compare mode").option("--remote", "Force remote MCP tool call instead of local fallback").action(async (opts) => {
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
			const { addressRisk } = await import("./public-tools-W8q69hp-.mjs");
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
})).addCommand(new Command("track-funds").description("Trace trusted/victim addresses and optional known untrusted/scammer addresses").requiredOption("--trusted-addresses <addresses>", "Comma-separated full trusted/victim addresses, max 5").requiredOption("--network <network>", "Network to query: bittensor, ethereum, or base").option("--untrusted-addresses <addresses>", "Comma-separated full known untrusted/scammer addresses, max 5").option("--case <id>", "Case ID to attach compact evidence pointers").option("--max-hops <number>", "Maximum trace hops, 1-5").option("--per-address-limit <number>", "Maximum exchange paths/results per address, 1-10").option("--min-amount-sum <number>", "Minimum r.amount_sum for traced edges").option("--remote", "Force remote MCP tool call instead of local fallback").action(async (opts) => {
	try {
		const { requireWorkspaceRoot } = await import("./output-root-DSl0xFAF.mjs").then((n) => n.t);
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
			const { trackFunds } = await import("./public-tools-W8q69hp-.mjs");
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
})).addCommand(new Command("call").description("Call an MCP tool directly (debug)").argument("<tool>", "Tool name to call").argument("[args...]", "Key=value arguments (e.g. address=0x1234 chain=ethereum)").action(async (tool, rawArgs) => {
	try {
		const { parseMcpCallArgs } = await import("./call-args-Bhwy2lvz.mjs");
		const { assertPublicMcpToolName } = await import("./tool-visibility-B-nSHuFy.mjs").then((n) => n.n);
		const args = parseMcpCallArgs(rawArgs);
		assertPublicMcpToolName(tool);
		await withGraphMcpClient("chain-insights-cli-call", async (client, config) => {
			if (tool === "address_risk") {
				const { addressRisk } = await import("./public-tools-W8q69hp-.mjs");
				const result = await addressRisk(client, {
					address: String(args["address"] ?? ""),
					network: String(args["network"] ?? ""),
					compareAddress: args["compare_address"] === void 0 ? void 0 : String(args["compare_address"])
				});
				console.log(result.summaryText);
				return;
			}
			if (tool === "track_funds") {
				const { trackFunds } = await import("./public-tools-W8q69hp-.mjs");
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
const caseCommand = new Command("case").description("Manage investigation cases").hook("preAction", async () => {
	await scopeCasesToInvocationDir();
}).addCommand(new Command("open").description("Open a new investigation case").argument("<name>", "Case name (e.g. \"Tornado Mixer Investigation\")").option("--tags <tags>", "Comma-separated tags (e.g. aml,mixer,defi)", "").option("--description <desc>", "Brief description of the investigation", "").action(async (name, opts) => {
	try {
		if (/^[1-9]\d*$/.test(name.trim())) throw new Error("Numeric case names look like list selectors. Use a descriptive case name, e.g. `cia case open \"Tracking stolen funds from <address>\"`.");
		const { CaseStore } = await import("./cases-BPDhz2C6.mjs");
		const tags = opts.tags ? opts.tags.split(",").map((t) => t.trim()).filter(Boolean) : [];
		const c = await CaseStore.create({
			name,
			tags,
			description: opts.description
		});
		const { casesRoot } = await import("./store-DKzwHXyY.mjs");
		console.log(`Case opened: ${c.id}`);
		console.log(`Directory:   ${path.join(casesRoot(), c.id)}/`);
		console.log(`Status:      ${c.status}`);
	} catch (err) {
		console.error(err.message);
		process.exit(1);
	}
})).addCommand(new Command("activate").description("Activate a case (set status to active)").argument("<case-id>", "Case ID to activate").action(async (caseSelector) => {
	try {
		const { CaseStore } = await import("./cases-BPDhz2C6.mjs");
		const caseId = await resolveCaseSelector(caseSelector);
		const c = await CaseStore.setStatus(caseId, "active");
		console.log(`Case ${c.id} is now: active`);
	} catch (err) {
		console.error(err.message);
		process.exit(1);
	}
})).addCommand(new Command("suspend").description("Suspend a case (set status to suspended)").argument("<case-id>", "Case ID to suspend").action(async (caseSelector) => {
	try {
		const { CaseStore } = await import("./cases-BPDhz2C6.mjs");
		const caseId = await resolveCaseSelector(caseSelector);
		const c = await CaseStore.setStatus(caseId, "suspended");
		console.log(`Case ${c.id} is now: suspended`);
	} catch (err) {
		console.error(err.message);
		process.exit(1);
	}
})).addCommand(new Command("close").description("Close a case permanently").argument("<case-id>", "Case ID to close").action(async (caseSelector) => {
	try {
		const { CaseStore } = await import("./cases-BPDhz2C6.mjs");
		const caseId = await resolveCaseSelector(caseSelector);
		const c = await CaseStore.setStatus(caseId, "closed");
		console.log(`Case ${c.id} is now: closed`);
	} catch (err) {
		console.error(err.message);
		process.exit(1);
	}
})).addCommand(new Command("list").description("List all investigation cases").option("--status <status>", "Filter by status (open|active|suspended|closed)").action(async (opts) => {
	try {
		const { CaseStore } = await import("./cases-BPDhz2C6.mjs");
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
})).addCommand(new Command("evidence").description("Manage case evidence").addCommand(new Command("add").description("Add evidence to a case from an MCP query result").argument("<case-id>", "Case ID to add evidence to").option("--source <tool>", "MCP tool name that produced this evidence", "manual").option("--content <text>", "Evidence content (MCP response or notes)", "").option("--query-params <params>", "Query parameters used (e.g. address=0x1234)", "").action(async (caseSelector, opts) => {
	try {
		const { EvidenceStore } = await import("./cases-BPDhz2C6.mjs");
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
})).addCommand(new Command("verify").description("Verify evidence manifest integrity for a case").argument("<case-id>", "Case ID to verify").action(async (caseSelector) => {
	try {
		const { EvidenceStore } = await import("./cases-BPDhz2C6.mjs");
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
}))).addCommand(new Command("dossier").description("Manage entity dossiers for a case").addCommand(new Command("update").description("Append a finding to an entity dossier").argument("<case-id>", "Case ID").argument("<address>", "Entity address or identifier").option("--finding <text>", "Finding to append to the dossier", "").option("--type <type>", "Entity type (eoa|contract|exchange|mixer|unknown)", "unknown").action(async (caseSelector, address, opts) => {
	try {
		const { DossierStore } = await import("./cases-BPDhz2C6.mjs");
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
}))).addCommand(new Command("session").description("Manage investigation sessions").addCommand(new Command("start").description("Start a new investigation session for a case").argument("<case-id>", "Case ID").argument("[title...]", "Optional session title").action(async (caseSelector, titleParts) => {
	try {
		const { SessionStore } = await import("./cases-BPDhz2C6.mjs");
		const caseId = await resolveCaseSelector(caseSelector);
		const title = titleParts.join(" ").trim();
		const s = await SessionStore.start(caseId, title ? { title } : {});
		console.log(`Session started: ${s.sessionId}`);
	} catch (err) {
		console.error(err.message);
		process.exit(1);
	}
})).addCommand(new Command("end").description("End the current session with findings and next steps").argument("<case-id>", "Case ID").option("--findings <text>", "Key findings from this session", "").option("--next-steps <text>", "Next steps for the investigation", "").action(async (caseSelector, opts) => {
	try {
		const { SessionStore } = await import("./cases-BPDhz2C6.mjs");
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
}))).addCommand(new Command("show").description("Show saved case context").argument("<case-id>", "Case ID or case list number to show").action(async (caseSelector) => {
	try {
		await showCaseContext(caseSelector);
	} catch (err) {
		console.error(err.message);
		process.exit(1);
	}
}));
program.addCommand(caseCommand);
program.command("playbook").description("Run and manage investigation playbooks").addCommand(new Command("run").description("Execute a playbook by name").argument("<name>", "Playbook name (e.g. trace-funds, risk-check, entity-profile)").option("--case <id>", "Case ID to attach evidence to (auto-created if omitted)").option("--from <n>", "Resume from step N (1-based)", "1").option("--dry-run", "Show steps without executing").option("-p, --param <kv...>", "Parameters as key=value pairs (repeatable, e.g. -p address=0x1 -p hops=3)").action(async (name, opts) => {
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
		const { resolvePlaybookContent } = await import("./resolver-CpwcBjrH.mjs");
		const markdown = await resolvePlaybookContent(name);
		const { PlaybookParser } = await import("./parser-BZ3WHWq8.mjs");
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
		const { PlaybookRunner } = await import("./runner-DHKHd4P8.mjs");
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
})).addCommand(new Command("list").description("List available playbooks (built-in and user-defined)").action(async () => {
	try {
		const { listPlaybooks } = await import("./resolver-CpwcBjrH.mjs");
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
})).addCommand(new Command("show").description("Show steps for a playbook without executing").argument("<name>", "Playbook name").action(async (name) => {
	try {
		const { resolvePlaybookContent } = await import("./resolver-CpwcBjrH.mjs");
		const { PlaybookParser } = await import("./parser-BZ3WHWq8.mjs");
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
		const { generateVisualization } = await import("./viz-CH1fYwmB.mjs").then((n) => n.n);
		const result = await generateVisualization({
			caseId,
			dataFile: opts.data
		});
		const { startServer } = await import("./server-lqbGlp_4.mjs").then((n) => n.t);
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