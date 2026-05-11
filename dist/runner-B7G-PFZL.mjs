import { n as loadConfig } from "./config-DTfloQyC.mjs";
import { r as initSchema, t as getDb } from "./init-SohRr-mY.mjs";
import { n as createConfiguredMcpFetch } from "./client-B2wqOxU5.mjs";
import { t as generateVisualization } from "./viz-C9G58DE5.mjs";
import { n as CaseStore, t as EvidenceStore } from "./evidence-BY6Jubrc.mjs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
//#region src/playbooks/runner.ts
/** Sleep for ms milliseconds. */
function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
/** Check if an error is a timeout/abort error. */
function isTimeoutError(err) {
	if (!(err instanceof Error)) return false;
	return err.name === "AbortError" || err.code === "ECONNRESET";
}
/** Check if an error is a payment failure. */
function isPaymentError(err) {
	if (!(err instanceof Error)) return false;
	const msg = err.message.toLowerCase();
	return msg.includes("http 402") || msg.includes("status 402") || msg.includes("payment required") || msg.includes("x402");
}
/**
* Call an MCP tool with retry logic on timeout (up to 3 total attempts).
* Returns the text result or throws on non-retryable error.
*/
async function callWithRetry(client, toolName, params) {
	const MAX_ATTEMPTS = 3;
	let lastErr;
	for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) try {
		return (await client.callTool({
			name: toolName,
			arguments: params
		})).content.filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n");
	} catch (err) {
		if (isTimeoutError(err) && attempt < MAX_ATTEMPTS) {
			lastErr = err;
			await sleep(1e3);
			continue;
		}
		throw err;
	}
	throw lastErr;
}
async function validateStepTools(client, steps) {
	const result = await client.listTools();
	const available = new Set(result.tools.map((tool) => tool.name));
	const missing = [...new Set(steps.map((step) => step.tool).filter((tool) => !available.has(tool)))];
	if (missing.length === 0) return;
	const availableList = [...available].sort().join(", ") || "none";
	throw new Error(`Unknown MCP tool(s) in playbook: ${missing.join(", ")}. Available tools: ${availableList}. Run \`chain-insights mcp tools --refresh\` to inspect the live MCP schema.`);
}
const PlaybookRunner = { 
/**
* Execute a playbook definition step-by-step against the live MCP.
*
* @param playbook - Parsed and validated PlaybookDefinition
* @param opts     - Runner options (caseId, from, dryRun, params)
*/
async run(playbook, opts) {
	const startIndex = (opts.from ?? 1) - 1;
	const stepsToRun = playbook.steps.slice(startIndex);
	const totalSteps = playbook.steps.length;
	if (opts.dryRun) {
		console.log(`Playbook: ${playbook.name} (dry run — no MCP calls)`);
		console.log(`Steps: ${totalSteps} total, starting from ${startIndex + 1}`);
		console.log("");
		for (const step of stepsToRun) console.log(`Step ${step.index}/${totalSteps}: ${step.tool} (params: ${JSON.stringify(step.params)})`);
		console.log("");
		console.log("Cost: unknown (MCP pricing not available without live connection)");
		return;
	}
	const config = await loadConfig();
	const mcpFetch = await createConfiguredMcpFetch(config);
	const conn = await getDb();
	await initSchema(conn);
	conn.closeSync();
	let caseId;
	if (opts.caseId) caseId = (await CaseStore.get(opts.caseId)).id;
	else {
		caseId = (await CaseStore.create({
			name: `quick-${playbook.name}-${Date.now()}`,
			tags: [
				"quick",
				"playbook",
				playbook.name
			],
			description: `Auto-created for one-off playbook run: ${playbook.name}`
		})).id;
		console.log(`Created quick case: ${caseId}`);
	}
	const client = new Client({
		name: "chain-insights-playbook",
		version: "0.1.0"
	});
	await client.connect(new StreamableHTTPClientTransport(new URL(config.mcpEndpoint), { fetch: mcpFetch }));
	let evidenceCount = 0;
	try {
		await validateStepTools(client, stepsToRun);
		for (const step of stepsToRun) {
			console.log(`Step ${step.index}/${totalSteps}: ${step.label}...`);
			let result;
			try {
				result = await callWithRetry(client, step.tool, step.params);
			} catch (err) {
				if (isPaymentError(err)) if (process.stdin.isTTY) {
					const { createInterface } = await import("node:readline");
					const rl = createInterface({
						input: process.stdin,
						output: process.stdout
					});
					const answer = await new Promise((resolve) => {
						rl.question(`Payment required for step ${step.index}. (retry/skip/abort): `, resolve);
					});
					rl.close();
					if (answer.trim().toLowerCase() === "retry") result = await callWithRetry(client, step.tool, step.params);
					else if (answer.trim().toLowerCase() === "skip") {
						console.log(`Step ${step.index} skipped.`);
						continue;
					} else throw new Error(`Aborted at step ${step.index} due to payment failure.`);
				} else throw new Error(`Payment required for step ${step.index} but no interactive terminal available. Configure wallet with \`chain-insights config set walletPrivateKey <key>\`. Aborting.`);
				else {
					const completedMsg = step.index - 1 - startIndex > 0 ? `Completed: steps ${startIndex + 1}..${step.index - 1}.` : "No steps completed before failure.";
					console.error(`Step ${step.index} failed: ${err.message}. ${completedMsg} Run with --from ${step.index} to resume.`);
					throw err;
				}
			}
			await EvidenceStore.append(caseId, {
				source: step.tool,
				content: result,
				queryParams: JSON.stringify(step.params)
			});
			evidenceCount++;
			console.log(`  (${result.length} chars stored)`);
		}
		if (playbook.name === "trace-funds") try {
			const viz = await generateVisualization({ caseId });
			console.log(`Visualization generated: ${viz.htmlPath}`);
		} catch {
			console.log("No transaction data to visualize.");
		}
		console.log(`Playbook complete. Case: ${caseId}. Evidence: ${evidenceCount} entries.`);
	} finally {
		await client.close();
	}
} };
//#endregion
export { PlaybookRunner };

//# sourceMappingURL=runner-B7G-PFZL.mjs.map