require("./chunk-CZWwpsFl.cjs");
let node_fs = require("node:fs");
//#region src/version.ts
const PACKAGE_INFO = JSON.parse((0, node_fs.readFileSync)(new URL("../package.json", require("url").pathToFileURL(__filename).href), "utf8"));
const PACKAGE_VERSION = PACKAGE_INFO.version;
//#endregion
Object.defineProperty(exports, "PACKAGE_INFO", {
	enumerable: true,
	get: function() {
		return PACKAGE_INFO;
	}
});
Object.defineProperty(exports, "PACKAGE_VERSION", {
	enumerable: true,
	get: function() {
		return PACKAGE_VERSION;
	}
});
