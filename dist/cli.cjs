const require_chunk = require("./chunk-CZWwpsFl.cjs");
let commander = require("commander");
let node_fs = require("node:fs");
let node_child_process = require("node:child_process");
let node_url = require("node:url");
let node_path = require("node:path");
node_path = require_chunk.__toESM(node_path, 1);
//#region src/cli.ts
const pkg = JSON.parse((0, node_fs.readFileSync)(new URL("../package.json", require("url").pathToFileURL(__filename).href), "utf8"));
const __dirname$1 = node_path.default.dirname((0, node_url.fileURLToPath)(require("url").pathToFileURL(__filename).href));
const installerPath = node_path.default.resolve(__dirname$1, "..", "bin", "install.cjs");
const program = new commander.Command();
program.name("chain-insights").description("AML investigation toolkit for blockchain analysis").version(pkg.version).option("--claude", "Install Claude Code skills globally to ~/.claude/skills/");
const rawArgs = process.argv.slice(2);
if (rawArgs.includes("--claude") && !rawArgs.some((a) => !a.startsWith("-"))) {
	try {
		(0, node_child_process.execFileSync)(process.execPath, [installerPath, "--claude"], { stdio: "inherit" });
	} catch (err) {
		console.error("Installation failed:", err.message);
		process.exit(1);
	}
	process.exit(0);
}
program.command("serve").description("Start local visualization server").option("-p, --port <number>", "Port to bind (default: 4321)", "4321").action(async (opts) => {
	const { startServer } = await Promise.resolve().then(() => require("./server-D-6VVAth.cjs")).then((n) => n.server_exports);
	startServer(parseInt(opts.port, 10));
});
program.command("status").description("Show toolkit status and database health").action(async () => {
	const { healthCheck } = await Promise.resolve().then(() => require("./db-UbTrO2bk.cjs")).then((n) => n.db_exports);
	const { loadConfig } = await Promise.resolve().then(() => require("./config-CIJ9gahy.cjs")).then((n) => n.config_exports);
	const [db, config] = await Promise.all([healthCheck(), loadConfig()]);
	console.log("DB:     ", db.ok ? "healthy" : `error — ${db.error ?? "unknown"}`);
	console.log("Config: ", config.dataDir);
	console.log("Server: ", `http://127.0.0.1:${config.serverPort}`);
});
program.command("setup").description("Configure external MCP clients").addCommand(new commander.Command("claude-desktop").alias("claude").description("Install or update the Claude Desktop MCP server entry").option("--config <path>", "Path to claude_desktop_config.json").option("--dry-run", "Print the intended change without writing files").action(async (opts) => {
	try {
		const { setupClaudeDesktop } = await Promise.resolve().then(() => require("./setup-Cw_GgO9I.cjs"));
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
	const { loadConfig } = await Promise.resolve().then(() => require("./config-CIJ9gahy.cjs")).then((n) => n.config_exports);
	const { CONFIG_KEYS } = await Promise.resolve().then(() => require("./schema-DRvul__x.cjs")).then((n) => n.schema_exports);
	if (!CONFIG_KEYS.includes(key)) {
		console.error(`Unknown config key: ${key}`);
		process.exit(1);
	}
	const value = (await loadConfig())[key];
	console.log(value ?? "");
})).addCommand(new commander.Command("set").argument("<key>", "Config key to write").argument("<value>", "Value to set").action(async (key, value) => {
	if (key === "walletPrivateKey") {
		try {
			const { encryptKey } = await Promise.resolve().then(() => require("./wallet-D6lq6MOc.cjs")).then((n) => n.wallet_exports);
			await encryptKey(value);
			console.log("Wallet private key encrypted and stored in ~/.chain-insights/wallet.json");
		} catch (err) {
			console.error(err.message);
			process.exit(1);
		}
		return;
	}
	const { loadConfig, saveConfig } = await Promise.resolve().then(() => require("./config-CIJ9gahy.cjs")).then((n) => n.config_exports);
	const { CONFIG_KEYS, DEFAULT_CONFIG } = await Promise.resolve().then(() => require("./schema-DRvul__x.cjs")).then((n) => n.schema_exports);
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
		const { getWalletAccount } = await Promise.resolve().then(() => require("./tools-DwUHwut2.cjs")).then((n) => n.tools_exports);
		const account = await getWalletAccount();
		console.log(account.address);
	} catch (err) {
		console.error(err.message);
		process.exit(1);
	}
})).addCommand(new commander.Command("balance").description("Show the local payment wallet Base USDC balance").action(async () => {
	try {
		const { getWalletBalanceText } = await Promise.resolve().then(() => require("./tools-DwUHwut2.cjs")).then((n) => n.tools_exports);
		console.log(await getWalletBalanceText());
	} catch (err) {
		console.error(err.message);
		process.exit(1);
	}
})).addCommand(new commander.Command("topup").description("Open a local browser page to top up the payment wallet").option("--no-open", "Print the top-up URL without opening a browser").option("--json", "Print machine-readable top-up metadata").action(async (opts) => {
	try {
		const { buildTopupInfo, getWalletAccount } = await Promise.resolve().then(() => require("./tools-DwUHwut2.cjs")).then((n) => n.tools_exports);
		const { startTopupServer } = await Promise.resolve().then(() => require("./topup-server-BtSOY0aZ.cjs")).then((n) => n.topup_server_exports);
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
program.command("mcp").description("Interact with the Chain Insights MCP endpoint").addCommand(new commander.Command("tools").description("List available MCP tools (cached 24h)").option("--refresh", "Force refresh schema cache").action(async (opts) => {
	try {
		const { loadSchema, saveSchema } = await Promise.resolve().then(() => require("./schema-cache-C6HyTRp1.cjs"));
		const { formatToolsTable } = await Promise.resolve().then(() => require("./format-BIve8N94.cjs"));
		const { loadConfig } = await Promise.resolve().then(() => require("./config-CIJ9gahy.cjs")).then((n) => n.config_exports);
		let tools = opts.refresh ? null : await loadSchema();
		if (!tools) {
			const config = await loadConfig();
			const { createConfiguredMcpFetch } = await Promise.resolve().then(() => require("./client-DqAQco0O.cjs")).then((n) => n.client_exports);
			const paymentFetch = await createConfiguredMcpFetch(config);
			const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
			const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
			const client = new Client({
				name: "chain-insights-cli",
				version: "0.1.0"
			});
			await client.connect(new StreamableHTTPClientTransport(new URL(config.mcpEndpoint), { fetch: paymentFetch }));
			try {
				tools = (await client.listTools()).tools;
				await saveSchema(tools);
			} finally {
				await client.close();
			}
		}
		console.log(formatToolsTable(tools));
	} catch (err) {
		console.error(err.message);
		process.exit(1);
	}
})).addCommand(new commander.Command("call").description("Call an MCP tool directly (debug)").argument("<tool>", "Tool name to call").argument("[args...]", "Key=value arguments (e.g. address=0x1234 chain=ethereum)").action(async (tool, rawArgs) => {
	try {
		const args = {};
		for (const pair of rawArgs) {
			const eqIdx = pair.indexOf("=");
			if (eqIdx === -1) {
				console.error(`Invalid arg format: ${pair} (expected key=value)`);
				process.exit(1);
			}
			args[pair.slice(0, eqIdx)] = pair.slice(eqIdx + 1);
		}
		const { loadConfig } = await Promise.resolve().then(() => require("./config-CIJ9gahy.cjs")).then((n) => n.config_exports);
		const config = await loadConfig();
		const { createConfiguredMcpFetch } = await Promise.resolve().then(() => require("./client-DqAQco0O.cjs")).then((n) => n.client_exports);
		const paymentFetch = await createConfiguredMcpFetch(config);
		const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
		const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
		const client = new Client({
			name: "chain-insights-cli-call",
			version: "0.1.0"
		});
		await client.connect(new StreamableHTTPClientTransport(new URL(config.mcpEndpoint), { fetch: paymentFetch }));
		try {
			const content = (await client.callTool({
				name: tool,
				arguments: args
			})).content;
			for (const item of content) if (item.type === "text") console.log(item.text);
		} finally {
			await client.close();
		}
	} catch (err) {
		console.error(err.message);
		process.exit(1);
	}
}));
program.command("case").description("Manage investigation cases").addCommand(new commander.Command("open").description("Open a new investigation case").argument("<name>", "Case name (e.g. \"Tornado Mixer Investigation\")").option("--tags <tags>", "Comma-separated tags (e.g. aml,mixer,defi)", "").option("--description <desc>", "Brief description of the investigation", "").action(async (name, opts) => {
	try {
		const { getDb, initSchema } = await Promise.resolve().then(() => require("./init-b2b3GEFH.cjs")).then((n) => n.init_exports);
		const { CaseStore } = await Promise.resolve().then(() => require("./cases-D252I91v.cjs"));
		const conn = await getDb();
		await initSchema(conn);
		conn.closeSync();
		const tags = opts.tags ? opts.tags.split(",").map((t) => t.trim()).filter(Boolean) : [];
		const c = await CaseStore.create({
			name,
			tags,
			description: opts.description
		});
		console.log(`Case opened: ${c.id}`);
		console.log(`Directory:   ~/.chain-insights/cases/${c.id}/`);
		console.log(`Status:      ${c.status}`);
	} catch (err) {
		console.error(err.message);
		process.exit(1);
	}
})).addCommand(new commander.Command("activate").description("Activate a case (set status to active)").argument("<case-id>", "Case ID to activate").action(async (caseId) => {
	try {
		const { getDb, initSchema } = await Promise.resolve().then(() => require("./init-b2b3GEFH.cjs")).then((n) => n.init_exports);
		const { CaseStore } = await Promise.resolve().then(() => require("./cases-D252I91v.cjs"));
		const conn = await getDb();
		await initSchema(conn);
		conn.closeSync();
		const c = await CaseStore.setStatus(caseId, "active");
		console.log(`Case ${c.id} is now: active`);
	} catch (err) {
		console.error(err.message);
		process.exit(1);
	}
})).addCommand(new commander.Command("suspend").description("Suspend a case (set status to suspended)").argument("<case-id>", "Case ID to suspend").action(async (caseId) => {
	try {
		const { getDb, initSchema } = await Promise.resolve().then(() => require("./init-b2b3GEFH.cjs")).then((n) => n.init_exports);
		const { CaseStore } = await Promise.resolve().then(() => require("./cases-D252I91v.cjs"));
		const conn = await getDb();
		await initSchema(conn);
		conn.closeSync();
		const c = await CaseStore.setStatus(caseId, "suspended");
		console.log(`Case ${c.id} is now: suspended`);
	} catch (err) {
		console.error(err.message);
		process.exit(1);
	}
})).addCommand(new commander.Command("close").description("Close a case permanently").argument("<case-id>", "Case ID to close").action(async (caseId) => {
	try {
		const { getDb, initSchema } = await Promise.resolve().then(() => require("./init-b2b3GEFH.cjs")).then((n) => n.init_exports);
		const { CaseStore } = await Promise.resolve().then(() => require("./cases-D252I91v.cjs"));
		const conn = await getDb();
		await initSchema(conn);
		conn.closeSync();
		const c = await CaseStore.setStatus(caseId, "closed");
		console.log(`Case ${c.id} is now: closed`);
	} catch (err) {
		console.error(err.message);
		process.exit(1);
	}
})).addCommand(new commander.Command("list").description("List all investigation cases").option("--status <status>", "Filter by status (open|active|suspended|closed)").action(async (opts) => {
	try {
		const { getDb, initSchema } = await Promise.resolve().then(() => require("./init-b2b3GEFH.cjs")).then((n) => n.init_exports);
		const { CaseStore } = await Promise.resolve().then(() => require("./cases-D252I91v.cjs"));
		const conn = await getDb();
		await initSchema(conn);
		conn.closeSync();
		const cases = await CaseStore.list();
		const filtered = opts.status ? cases.filter((c) => c.status === opts.status) : cases;
		if (filtered.length === 0) {
			console.log("No cases found.");
			return;
		}
		for (const c of filtered) console.log(`${c.id}  [${c.status}]  ${c.name}`);
	} catch (err) {
		console.error(err.message);
		process.exit(1);
	}
})).addCommand(new commander.Command("evidence").description("Manage case evidence").addCommand(new commander.Command("add").description("Add evidence to a case from an MCP query result").argument("<case-id>", "Case ID to add evidence to").option("--source <tool>", "MCP tool name that produced this evidence", "manual").option("--content <text>", "Evidence content (MCP response or notes)", "").option("--query-params <params>", "Query parameters used (e.g. address=0x1234)", "").action(async (caseId, opts) => {
	try {
		const { EvidenceStore } = await Promise.resolve().then(() => require("./cases-D252I91v.cjs"));
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
})).addCommand(new commander.Command("verify").description("Verify evidence manifest integrity for a case").argument("<case-id>", "Case ID to verify").action(async (caseId) => {
	try {
		const { EvidenceStore } = await Promise.resolve().then(() => require("./cases-D252I91v.cjs"));
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
}))).addCommand(new commander.Command("dossier").description("Manage entity dossiers for a case").addCommand(new commander.Command("update").description("Append a finding to an entity dossier").argument("<case-id>", "Case ID").argument("<address>", "Entity address or identifier").option("--finding <text>", "Finding to append to the dossier", "").option("--type <type>", "Entity type (eoa|contract|exchange|mixer|unknown)", "unknown").action(async (caseId, address, opts) => {
	try {
		const { DossierStore } = await Promise.resolve().then(() => require("./cases-D252I91v.cjs"));
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
}))).addCommand(new commander.Command("session").description("Manage investigation sessions").addCommand(new commander.Command("start").description("Start a new investigation session for a case").argument("<case-id>", "Case ID").action(async (caseId) => {
	try {
		const { SessionStore } = await Promise.resolve().then(() => require("./cases-D252I91v.cjs"));
		const s = await SessionStore.start(caseId);
		console.log(`Session started: ${s.sessionId}`);
	} catch (err) {
		console.error(err.message);
		process.exit(1);
	}
})).addCommand(new commander.Command("end").description("End the current session with findings and next steps").argument("<case-id>", "Case ID").option("--findings <text>", "Key findings from this session", "").option("--next-steps <text>", "Next steps for the investigation", "").action(async (caseId, opts) => {
	try {
		const { SessionStore } = await Promise.resolve().then(() => require("./cases-D252I91v.cjs"));
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
}))).addCommand(new commander.Command("resume").description("Resume a case — restore investigation context for agent injection").argument("<case-id>", "Case ID to resume").action(async (caseId) => {
	try {
		const { getDb, initSchema } = await Promise.resolve().then(() => require("./init-b2b3GEFH.cjs")).then((n) => n.init_exports);
		const { CaseStore } = await Promise.resolve().then(() => require("./cases-D252I91v.cjs"));
		const conn = await getDb();
		await initSchema(conn);
		conn.closeSync();
		const ctx = await CaseStore.loadContext(caseId);
		console.log(`\n=== Case Resume: ${ctx.case.id} ===`);
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
	} catch (err) {
		console.error(err.message);
		process.exit(1);
	}
}));
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
		const { resolvePlaybookContent } = await Promise.resolve().then(() => require("./resolver-DTj550hP.cjs"));
		const markdown = await resolvePlaybookContent(name);
		const { PlaybookParser } = await Promise.resolve().then(() => require("./parser-3yKUHymY.cjs"));
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
		const { PlaybookRunner } = await Promise.resolve().then(() => require("./runner-Cc8XVWnc.cjs"));
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
		const { listPlaybooks } = await Promise.resolve().then(() => require("./resolver-DTj550hP.cjs"));
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
		const { resolvePlaybookContent } = await Promise.resolve().then(() => require("./resolver-DTj550hP.cjs"));
		const { PlaybookParser } = await Promise.resolve().then(() => require("./parser-3yKUHymY.cjs"));
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
		const { generateVisualization } = await Promise.resolve().then(() => require("./viz-DmLjMp3p.cjs")).then((n) => n.viz_exports);
		const result = await generateVisualization({
			caseId,
			dataFile: opts.data
		});
		const { startServer } = await Promise.resolve().then(() => require("./server-D-6VVAth.cjs")).then((n) => n.server_exports);
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
