//#region src/mcp/call-args.ts
const NUMERIC_ARG_KEYS = new Set([
	"per_query_timeout_seconds",
	"incident_timestamp_ms",
	"max_hops",
	"per_address_limit",
	"min_amount_sum"
]);
function parseMcpArgValue(key, value) {
	const trimmed = value.trim();
	if (!trimmed) return value;
	if (trimmed.startsWith("{") || trimmed.startsWith("[")) return JSON.parse(trimmed);
	if (NUMERIC_ARG_KEYS.has(key) && /^-?\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);
	return value;
}
function parseMcpCallArgs(rawArgs) {
	const args = {};
	for (const pair of rawArgs) {
		const eqIdx = pair.indexOf("=");
		if (eqIdx === -1) throw new Error(`Invalid arg format: ${pair} (expected key=value)`);
		const key = pair.slice(0, eqIdx);
		args[key] = parseMcpArgValue(key, pair.slice(eqIdx + 1));
	}
	return args;
}
//#endregion
export { parseMcpCallArgs };

//# sourceMappingURL=call-args-DVHfocVJ.mjs.map