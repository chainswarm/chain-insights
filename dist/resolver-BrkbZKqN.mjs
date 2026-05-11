import path from "node:path";
import { readFile, readdir } from "node:fs/promises";
import os from "node:os";
const BUILTIN_PLAYBOOKS = {
	"trace-funds": `---
name: trace-funds
description: Trace fund flows from a target address and generate a money flow visualization
version: 1.0.0
params:
  - name: address
    type: string
    required: true
---

## Step 1: Trace Fund Flows

\`\`\`tool
probe
\`\`\`

\`\`\`params
query: Trace all fund flows for address {{address}}. Show inbound and outbound transfers with amounts, counterparties, and timestamps.
\`\`\`

## Step 2: Visualize Money Flow

\`\`\`tool
probe
\`\`\`

\`\`\`params
query: Generate a money flow graph for address {{address}} showing the transaction relationships and fund movements identified in the previous trace.
\`\`\`
`,
	"risk-check": `---
name: risk-check
description: Check risk exposure and sanctions screening for an address
version: 1.0.0
params:
  - name: address
    type: string
    required: true
---

## Step 1: Risk Assessment

\`\`\`tool
probe
\`\`\`

\`\`\`params
query: Assess the risk exposure for address {{address}}. Check for sanctions matches, known illicit entity associations, and suspicious activity patterns.
\`\`\`

## Step 2: Counterparty Risk

\`\`\`tool
probe
\`\`\`

\`\`\`params
query: Analyze the counterparties of address {{address}} for risk signals. Identify any high-risk entities, mixers, or flagged addresses in the transaction history.
\`\`\`
`,
	"query": `---
name: query
description: Run a free-form investigation query against the Chain Insights MCP
version: 1.0.0
params:
  - name: question
    type: string
    required: true
---

## Step 1: Query

\`\`\`tool
probe
\`\`\`

\`\`\`params
query: {{question}}
\`\`\`
`
};
//#endregion
//#region src/playbooks/resolver.ts
function userDir() {
	return path.join(os.homedir(), ".chain-insights", "playbooks");
}
/**
* Resolve a playbook name to its markdown content.
* Checks user directory (~/.chain-insights/playbooks/<name>.md) first,
* then falls back to the built-in BUILTIN_PLAYBOOKS map.
* Security: sanitizes name to prevent path traversal (T-05-01).
*/
async function resolvePlaybookContent(name) {
	const safeName = name.replace(/[^a-z0-9_-]/gi, "");
	if (!safeName) throw new Error(`Invalid playbook name: ${name}`);
	const userPath = path.join(userDir(), `${safeName}.md`);
	try {
		return await readFile(userPath, "utf8");
	} catch {}
	const builtin = BUILTIN_PLAYBOOKS[safeName];
	if (builtin !== void 0) return builtin;
	throw new Error(`Playbook not found: "${safeName}". Run \`chain-insights playbook list\` to see available playbooks.`);
}
/**
* List all available playbooks — user dir first (overrides), then built-ins.
* Returns array of { name, source } objects.
*/
async function listPlaybooks() {
	const result = [];
	const seen = /* @__PURE__ */ new Set();
	try {
		const userFiles = await readdir(userDir());
		for (const file of userFiles) {
			if (!file.endsWith(".md")) continue;
			const name = file.slice(0, -3);
			seen.add(name);
			result.push({
				name,
				source: "user"
			});
		}
	} catch {}
	for (const name of Object.keys(BUILTIN_PLAYBOOKS)) {
		if (seen.has(name)) continue;
		result.push({
			name,
			source: "builtin"
		});
	}
	return result;
}
//#endregion
export { listPlaybooks, resolvePlaybookContent };

//# sourceMappingURL=resolver-BrkbZKqN.mjs.map