import { t as __exportAll } from "./rolldown-runtime-wcPFST8Q.mjs";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { DuckDBInstance } from "@duckdb/node-api";
//#region src/db/init.ts
var init_exports = /* @__PURE__ */ __exportAll({
	getDb: () => getDb,
	healthCheck: () => healthCheck,
	initSchema: () => initSchema,
	migrateCasesTable: () => migrateCasesTable
});
function dataDir() {
	return path.join(os.homedir(), ".chain-insights");
}
function dbPath() {
	return path.join(dataDir(), "chain-insights.db");
}
let _instance = null;
async function getDb() {
	if (!_instance) {
		fs.mkdirSync(dataDir(), { recursive: true });
		_instance = await DuckDBInstance.create(dbPath());
		fs.chmodSync(dbPath(), 384);
	}
	return _instance.connect();
}
async function migrateCasesTable(conn) {
	const r = await conn.runAndReadAll("SELECT column_name FROM information_schema.columns WHERE table_name='cases'");
	const existing = new Set(r.getRows().map((row) => row[0]));
	for (const [col, type] of [
		["updated_at", "TIMESTAMPTZ"],
		["tags", "VARCHAR"],
		["description", "VARCHAR"],
		["slug", "VARCHAR"]
	]) if (!existing.has(col)) await conn.run(`ALTER TABLE cases ADD COLUMN ${col} ${type}`);
}
async function initSchema(conn) {
	await conn.run(`
    CREATE TABLE IF NOT EXISTS cases (
      id         VARCHAR PRIMARY KEY,
      name       VARCHAR NOT NULL,
      status     VARCHAR DEFAULT 'open',
      created_at TIMESTAMPTZ DEFAULT now()
    )
  `);
	await migrateCasesTable(conn);
}
async function healthCheck() {
	try {
		const conn = await getDb();
		await initSchema(conn);
		const rows = (await conn.runAndReadAll("SELECT 1 AS ping")).getRows();
		conn.closeSync();
		return { ok: rows.length === 1 };
	} catch (err) {
		return {
			ok: false,
			error: String(err)
		};
	}
}
//#endregion
export { init_exports as i, healthCheck as n, initSchema as r, getDb as t };

//# sourceMappingURL=init-SohRr-mY.mjs.map