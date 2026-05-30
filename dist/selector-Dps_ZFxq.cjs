const require_store = require("./store-CQhU8dz8.cjs");
//#region src/cases/selector.ts
async function resolveCaseSelector(input) {
	if (!/^[1-9]\d*$/.test(input)) return input;
	const selected = (await require_store.CaseStore.list())[Number(input) - 1];
	if (!selected) throw new Error(`No case numbered ${input}. Run \`cia case list\` to see available cases.`);
	return selected.id;
}
//#endregion
exports.resolveCaseSelector = resolveCaseSelector;
