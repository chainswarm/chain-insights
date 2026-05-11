import path from "node:path";
import { readFile, readdir } from "node:fs/promises";
import os from "node:os";
const BUILTIN_PLAYBOOKS = {
	"trace-funds": `---
name: trace-funds
description: Trace fund flows from a target address — follows hops and auto-generates a money flow visualization
version: 1.0.0
params:
  - name: address
    type: string
    required: true
  - name: hops
    type: number
    required: false
    default: "2"
---

## Step 1: Trace Funds

\`\`\`tool
trace_funds
\`\`\`

\`\`\`params
address: {{address}}
hops: {{hops}}
\`\`\`

## Step 2: Get Transaction Graph

\`\`\`tool
get_transaction_graph
\`\`\`

\`\`\`params
root: {{address}}
depth: {{hops}}
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

## Step 1: Check Risk Exposure

\`\`\`tool
check_risk_exposure
\`\`\`

\`\`\`params
address: {{address}}
\`\`\`

## Step 2: Get Entity Details

\`\`\`tool
get_entity_details
\`\`\`

\`\`\`params
address: {{address}}
\`\`\`
`,
	"entity-profile": `---
name: entity-profile
description: Build a comprehensive entity profile — transaction history, counterparties, and risk signals
version: 1.0.0
params:
  - name: address
    type: string
    required: true
---

## Step 1: Get Transaction History

\`\`\`tool
get_transaction_history
\`\`\`

\`\`\`params
address: {{address}}
\`\`\`

## Step 2: Get Counterparties

\`\`\`tool
get_counterparties
\`\`\`

\`\`\`params
address: {{address}}
\`\`\`

## Step 3: Check Risk Signals

\`\`\`tool
check_risk_exposure
\`\`\`

\`\`\`params
address: {{address}}
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

//# sourceMappingURL=resolver-2gNVc8Ag.mjs.map