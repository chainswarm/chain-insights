const require_chunk = require("./chunk-CZWwpsFl.cjs");
let node_fs = require("node:fs");
node_fs = require_chunk.__toESM(node_fs, 1);
let node_path = require("node:path");
node_path = require_chunk.__toESM(node_path, 1);
let node_os = require("node:os");
node_os = require_chunk.__toESM(node_os, 1);
let _duckdb_node_api = require("@duckdb/node-api");
//#region src/db/init.ts
var init_exports = /* @__PURE__ */ require_chunk.__exportAll({
	getDb: () => getDb,
	healthCheck: () => healthCheck,
	initSchema: () => initSchema,
	migrateCasesTable: () => migrateCasesTable
});
function dataDir() {
	return node_path.default.join(node_os.default.homedir(), ".chain-insights");
}
function dbPath() {
	return node_path.default.join(dataDir(), "chain-insights.db");
}
let _instance = null;
async function getDb() {
	if (!_instance) {
		node_fs.default.mkdirSync(dataDir(), { recursive: true });
		_instance = await _duckdb_node_api.DuckDBInstance.create(dbPath());
		node_fs.default.chmodSync(dbPath(), 384);
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
Object.defineProperty(exports, "getDb", {
	enumerable: true,
	get: function() {
		return getDb;
	}
});
Object.defineProperty(exports, "healthCheck", {
	enumerable: true,
	get: function() {
		return healthCheck;
	}
});
Object.defineProperty(exports, "initSchema", {
	enumerable: true,
	get: function() {
		return initSchema;
	}
});
Object.defineProperty(exports, "init_exports", {
	enumerable: true,
	get: function() {
		return init_exports;
	}
});
