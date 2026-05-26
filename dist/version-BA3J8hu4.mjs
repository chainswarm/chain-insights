import { readFileSync } from "node:fs";
//#region src/version.ts
const PACKAGE_INFO = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const PACKAGE_VERSION = PACKAGE_INFO.version;
//#endregion
export { PACKAGE_VERSION as n, PACKAGE_INFO as t };

//# sourceMappingURL=version-BA3J8hu4.mjs.map