import { CaseStore } from "./store-BT2SCcQr.mjs";
//#region src/cases/selector.ts
async function resolveCaseSelector(input) {
	if (!/^[1-9]\d*$/.test(input)) return input;
	const selected = (await CaseStore.list())[Number(input) - 1];
	if (!selected) throw new Error(`No case numbered ${input}. Run \`cia case list\` to see available cases.`);
	return selected.id;
}
//#endregion
export { resolveCaseSelector };

//# sourceMappingURL=selector-CTUiQrzI.mjs.map