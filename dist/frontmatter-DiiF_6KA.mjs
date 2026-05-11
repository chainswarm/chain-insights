//#region src/cases/frontmatter.ts
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
function parseFrontmatter(content) {
	const m = content.match(FRONTMATTER_RE);
	if (!m) return {
		frontmatter: {},
		body: content
	};
	const fm = {};
	for (const line of m[1].split("\n")) {
		const colon = line.indexOf(":");
		if (colon < 0) continue;
		fm[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
	}
	return {
		frontmatter: fm,
		body: m[2]
	};
}
function serializeFrontmatter(fm, body) {
	return `---\n${Object.entries(fm).map(([k, v]) => `${k}: ${v}`).join("\n")}\n---\n${body}`;
}
//#endregion
export { serializeFrontmatter as n, parseFrontmatter as t };

//# sourceMappingURL=frontmatter-DiiF_6KA.mjs.map