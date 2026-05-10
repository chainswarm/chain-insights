// Stable import surface for the DB module. Keeps init.ts focused on lifecycle.
// Phase 3 adds typed query helpers here.
export { getDb, initSchema, healthCheck, resetDbInstance } from './init.js'
