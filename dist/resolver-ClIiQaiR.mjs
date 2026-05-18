import path from "node:path";
import { readFile, readdir } from "node:fs/promises";
import os from "node:os";
const BUILTIN_PLAYBOOKS = {
	"trace-funds": `---
name: trace-funds
description: Trace stolen funds from a victim address to exchange deposits using Chain Insights GraphRAG
version: 1.0.0
params:
  - name: address
    type: string
    required: true
  - name: network
    type: string
    required: false
    default: bittensor
---

## Step 1: Screen Victim Address

\`\`\`tool
address_risk
\`\`\`

\`\`\`params
address: {{address}}
network: {{network}}
\`\`\`

## Step 2: Trace Funds To Exchanges

\`\`\`tool
track_funds
\`\`\`

\`\`\`params
trusted_addresses: {{address}}
network: {{network}}
\`\`\`
`,
	"risk-check": `---
name: risk-check
description: Screen an address for Chain Insights risk, behavior, counterparties, exchange connections, and AML patterns
version: 1.0.0
params:
  - name: address
    type: string
    required: true
  - name: network
    type: string
    required: false
    default: bittensor
---

## Step 1: Address Risk

\`\`\`tool
address_risk
\`\`\`

\`\`\`params
address: {{address}}
network: {{network}}
\`\`\`
`,
	"entity-profile": `---
name: entity-profile
description: Build an entity profile from Chain Insights address identity, metrics, risk, counterparties, and labels
version: 1.0.0
params:
  - name: address
    type: string
    required: true
  - name: network
    type: string
    required: false
    default: bittensor
---

## Step 1: Entity Profile

\`\`\`tool
address_risk
\`\`\`

\`\`\`params
address: {{address}}
network: {{network}}
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

//# sourceMappingURL=resolver-ClIiQaiR.mjs.map