#!/usr/bin/env node
'use strict';

// CJS shim — bridges the npm bin entry (CJS, no build step) to the
// ESM dist built by tsdown. Dynamic import() is the correct bridge pattern
// (see references/get-shit-done/bin/rbmk-sdk.js for the RBMK workflow precedent).
import('../dist/cli.mjs').catch((err) => {
  console.error('Failed to load chain-insights:', err.message);
  process.exit(1);
});
