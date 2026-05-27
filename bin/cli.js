#!/usr/bin/env node
'use strict';

// CJS shim: bridges the npm bin entry to the ESM dist built by tsdown.
// Dynamic import() is the correct bridge pattern from CommonJS to ESM.
import('../dist/cli.mjs').catch((err) => {
  console.error('Failed to load chain-insights:', err.message);
  process.exit(1);
});
