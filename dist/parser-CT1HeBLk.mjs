import * as z from "zod";
//#region src/playbooks/schema.ts
const ParamSpecSchema = z.object({
	name: z.string(),
	type: z.enum([
		"string",
		"number",
		"boolean"
	]).default("string"),
	required: z.boolean().default(true),
	default: z.string().optional()
});
const StepSchema = z.object({
	index: z.number().int().positive(),
	label: z.string(),
	tool: z.string().min(1),
	params: z.record(z.string(), z.string())
});
const PlaybookSchema = z.object({
	name: z.string().min(1),
	description: z.string().default(""),
	version: z.string().default("1.0.0"),
	params: z.array(ParamSpecSchema).default([]),
	steps: z.array(StepSchema)
});
//#endregion
//#region src/playbooks/parser.ts
/**
* Apply {{param}} template substitution to a string.
* Missing keys are left as-is: {{missing}} remains {{missing}}.
*/
function applyTemplate(text, params) {
	return text.replace(/\{\{(\w+)\}\}/g, (_, k) => params[k] ?? `{{${k}}}`);
}
/**
* Extract content of a fenced code block by language tag.
* Returns the trimmed content between the opening and closing fences, or null.
*/
function extractFencedBlock(section, lang) {
	const match = new RegExp("```" + lang + "\\n([\\s\\S]*?)```", "m").exec(section);
	return match ? match[1]?.trim() ?? null : null;
}
/**
* Parse params block content into a Record<string, string>.
* Each line is expected to be "key: value" format.
*/
function parseParamsBlock(content) {
	const result = {};
	for (const line of content.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		const colonIdx = trimmed.indexOf(":");
		if (colonIdx === -1) continue;
		const key = trimmed.slice(0, colonIdx).trim();
		const val = trimmed.slice(colonIdx + 1).trim();
		if (key) result[key] = val;
	}
	return result;
}
/**
* Parse flat YAML key: value frontmatter (without params arrays).
* Skips lines starting with '-' (YAML array items — not supported here).
*/
function parseFlatFrontmatter(block) {
	const result = {};
	for (const line of block.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("-")) continue;
		const colonIdx = trimmed.indexOf(":");
		if (colonIdx === -1) continue;
		const key = trimmed.slice(0, colonIdx).trim();
		const val = trimmed.slice(colonIdx + 1).trim();
		if (key && val !== void 0) result[key] = val;
	}
	return result;
}
/**
* Parse the `params:` YAML array block from frontmatter.
* Handles the multi-line format:
*   params:
*     - name: address
*       type: string
*       required: true
*     - name: hops
*       type: number
*       required: false
*       default: "2"
*
* Returns an array of raw param objects (strings, to be validated by Zod).
*/
function parseFrontmatterParamsArray(block) {
	const results = [];
	const lines = block.split("\n");
	let inParams = false;
	let current = null;
	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		if (!inParams && /^params\s*:/.test(trimmed)) {
			inParams = true;
			continue;
		}
		if (!inParams) continue;
		if (!line.startsWith(" ") && !line.startsWith("	") && !trimmed.startsWith("-")) break;
		if (trimmed.startsWith("- ")) {
			if (current !== null) results.push(current);
			current = {};
			const rest = trimmed.slice(2).trim();
			if (rest) {
				const colonIdx = rest.indexOf(":");
				if (colonIdx !== -1) {
					const k = rest.slice(0, colonIdx).trim();
					const v = rest.slice(colonIdx + 1).trim().replace(/^"(.*)"$/, "$1");
					if (k) current[k] = v;
				}
			}
			continue;
		}
		if (current !== null) {
			const colonIdx = trimmed.indexOf(":");
			if (colonIdx !== -1) {
				const k = trimmed.slice(0, colonIdx).trim();
				const v = trimmed.slice(colonIdx + 1).trim().replace(/^"(.*)"$/, "$1");
				if (k) current[k] = v;
			}
		}
	}
	if (current !== null) results.push(current);
	return results;
}
const PlaybookParser = { 
/**
* Parse a playbook markdown file into a validated PlaybookDefinition.
*
* @param markdown - Raw markdown content of the playbook file
* @param resolvedParams - Key-value parameters for {{param}} substitution
* @returns Validated PlaybookDefinition (throws ZodError on invalid data)
*/
parse(markdown, resolvedParams) {
	const fmMatch = /^---\n([\s\S]*?)\n---/.exec(markdown);
	const frontmatterBlock = fmMatch ? fmMatch[1] : "";
	const frontmatter = parseFlatFrontmatter(frontmatterBlock);
	const params = parseFrontmatterParamsArray(frontmatterBlock).map((raw) => {
		const coerced = {
			name: raw["name"] ?? "",
			type: raw["type"] ?? "string",
			required: raw["required"] !== void 0 ? raw["required"].toLowerCase() !== "false" : true
		};
		if (raw["default"] !== void 0) coerced["default"] = raw["default"];
		return ParamSpecSchema.parse(coerced);
	});
	const templateParams = {};
	for (const spec of params) if (spec.default !== void 0) templateParams[spec.name] = spec.default;
	Object.assign(templateParams, resolvedParams);
	let body = markdown;
	if (fmMatch) body = markdown.slice(fmMatch.index + fmMatch[0].length);
	const steps = body.split(/^## /m).slice(1).map((section, i) => {
		const firstNewline = section.indexOf("\n");
		const label = firstNewline === -1 ? section.trim() : section.slice(0, firstNewline).trim();
		const tool = applyTemplate(extractFencedBlock(section, "tool") ?? "", templateParams);
		const rawParams = parseParamsBlock(extractFencedBlock(section, "params") ?? "");
		const params = {};
		for (const [k, v] of Object.entries(rawParams)) params[applyTemplate(k, templateParams)] = applyTemplate(v, templateParams);
		return {
			index: i + 1,
			label,
			tool,
			params
		};
	});
	return PlaybookSchema.parse({
		name: frontmatter["name"] ?? "",
		description: frontmatter["description"] ?? "",
		version: frontmatter["version"] ?? "1.0.0",
		params,
		steps
	});
} };
//#endregion
export { PlaybookParser };

//# sourceMappingURL=parser-CT1HeBLk.mjs.map