//#region src/mcp/format.ts
const NAME_WIDTH = 30;
const DESC_MAX = 60;
/**
* Formats an array of MCP tools as a plain text table string.
* Returns "No tools available." for an empty array.
* Caller controls output — use console.log(formatToolsTable(tools)).
*/
function formatToolsTable(tools) {
	if (tools.length === 0) return "No tools available.";
	return [
		`${"Tool".padEnd(NAME_WIDTH)}  Description`,
		"-".repeat(NAME_WIDTH) + "  " + "-".repeat(DESC_MAX),
		...tools.map((t) => {
			return `${t.name.padEnd(NAME_WIDTH)}  ${(t.description ?? "").slice(0, DESC_MAX)}`;
		})
	].join("\n");
}
//#endregion
export { formatToolsTable };

//# sourceMappingURL=format-CQsovyNF.mjs.map