#!/usr/bin/env node
'use strict';

// Chain Insights installer — CJS, stdlib-only.
// Runs before node_modules exists; zero npm imports allowed.
// Extension is .cjs (not .js) because package.json has "type": "module" —
// a .js file would be treated as ESM and require() calls would crash.
// Adapted from GSD reference: references/get-shit-done/bin/install.js

const fs   = require('fs');
const path = require('path');
const os   = require('os');

// ANSI colors — no chalk
const cyan  = '\x1b[36m';
const green = '\x1b[32m';
const bold  = '\x1b[1m';
const dim   = '\x1b[2m';
const reset = '\x1b[0m';

// Parse args
const args      = process.argv.slice(2);
const hasClaude = args.includes('--claude');
const hasLocal  = args.includes('--local');

if (!hasClaude && !hasLocal) {
  console.log(`\n${bold}chain-insights installer${reset}`);
  console.log(`\nUsage: node bin/install.cjs --claude`);
  console.log(`  ${cyan}--claude${reset}  Install Claude Code skills globally to ~/.claude/skills/`);
  console.log(`  ${cyan}--local${reset}   Install skills locally to ./.claude/commands/chain-insights/`);
  console.log('');
  process.exit(0);
}

const homeDir    = os.homedir();
const dataDir    = path.join(homeDir, '.chain-insights');
const configPath = path.join(dataDir, 'config.json');
const srcSkillsDir = path.join(__dirname, '..', 'skills');

// Determine skills target
const skillsDir = hasLocal
  ? path.join(process.cwd(), '.claude', 'commands', 'chain-insights')
  : path.join(homeDir, '.claude', 'skills');

// ─── 1. Copy Claude Code skills ───────────────────────────────────────────

function copyCommandsAsClaudeSkills(srcDir, targetDir) {
  if (!fs.existsSync(srcDir)) {
    console.error(`Skills source not found: ${srcDir}`);
    return;
  }

  fs.mkdirSync(targetDir, { recursive: true });

  // Remove stale ci-* skill dirs before copying (clean reinstall)
  const existing = fs.readdirSync(targetDir, { withFileTypes: true });
  for (const entry of existing) {
    if (entry.isDirectory() && entry.name.startsWith('ci-')) {
      fs.rmSync(path.join(targetDir, entry.name), { recursive: true, force: true });
    }
  }

  // Recurse into skills/ directory; each subdirectory becomes a skill dir
  const skillDirs = fs.readdirSync(srcDir, { withFileTypes: true })
    .filter(e => e.isDirectory());

  for (const skillDir of skillDirs) {
    const skillSrc  = path.join(srcDir, skillDir.name);
    const skillDest = path.join(targetDir, skillDir.name);
    fs.mkdirSync(skillDest, { recursive: true });

    const files = fs.readdirSync(skillSrc);
    for (const file of files) {
      const srcFile  = path.join(skillSrc, file);
      const destFile = path.join(skillDest, file);
      const content  = fs.readFileSync(srcFile, 'utf8');
      fs.writeFileSync(destFile, content, 'utf8');
    }
  }
}

copyCommandsAsClaudeSkills(srcSkillsDir, skillsDir);

// ─── 2. Create ~/.chain-insights/ config directory ────────────────────────

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// ─── 3. Write default config.json if absent ───────────────────────────────

if (!fs.existsSync(configPath)) {
  const defaultConfig = {
    mcpEndpoint:   'http://localhost:4000',
    mcpAuthToken:  '',
    walletAddress: '',
    serverPort:    4321,
    dataDir:       dataDir,
    version:       '1',
  };
  fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2) + '\n', 'utf8');
  // Owner-readable only — config may contain MCP auth token (ASVS L1 V4.3.2 / T-02-01)
  fs.chmodSync(configPath, 0o600);
}

// ─── 4. Print installation summary ────────────────────────────────────────

console.log(`\n${bold}${green}Chain Insights installed${reset}`);
console.log(`  ${cyan}Skills:${reset}   ${skillsDir}`);
console.log(`  ${cyan}Config:${reset}   ${configPath}`);
console.log(`  ${cyan}Data dir:${reset} ${dataDir}`);
console.log(`\n${dim}Run ${reset}${cyan}chain-insights status${reset}${dim} to verify the installation.${reset}\n`);
