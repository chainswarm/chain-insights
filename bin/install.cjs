#!/usr/bin/env node
'use strict';

// Chain Insights installer — CJS, stdlib-only.
// Runs before node_modules exists; zero npm imports allowed.
// Extension is .cjs (not .js) because package.json has "type": "module" —
// a .js file would be treated as ESM and require() calls would crash.

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
const hasCodex  = args.includes('--codex');
const hasHermes = args.includes('--hermes');
const hasLocal  = args.includes('--local');

if (!hasClaude && !hasCodex && !hasHermes && !hasLocal) {
  console.log(`\n${bold}chain-insights installer${reset}`);
  console.log(`\nUsage: node bin/install.cjs --claude | --codex | --hermes`);
  console.log(`  ${cyan}--claude${reset}  Install Claude Code skills globally to ~/.claude/skills/`);
  console.log(`  ${cyan}--codex${reset}   Install Codex skills globally to ~/.codex/skills/ and register MCP`);
  console.log(`  ${cyan}--hermes${reset}  Install Hermes skills globally to ~/.hermes/skills/chain-insights/ and register MCP`);
  console.log(`  ${cyan}--local${reset}   Install skills locally to ./.claude/commands/chain-insights/`);
  console.log('');
  process.exit(0);
}

const homeDir    = os.homedir();
const dataDir    = path.join(homeDir, '.chain-insights');
const configPath = path.join(dataDir, 'config.json');
const srcSkillsDir = path.join(__dirname, '..', 'skills');
const PUBLIC_SKILL_NAMES = Object.freeze([
  'chain-insights-cypher',
  'chain-insights-schema-bittensor',
  'chain-insights-schema-evm',
]);
const RETIRED_SKILL_NAMES = Object.freeze([
  'chain-insights-address-risk',
  'chain-insights-bittensor-cypher',
  'chain-insights-developer-experience',
  'chain-insights-investigation',
  'chain-insights-monitoring',
  'ci-status',
  'test-chain-insights-graph',
]);

// Determine skills targets
const skillsTargets = [];
if (hasClaude) skillsTargets.push({ name: 'Claude Code', dir: path.join(homeDir, '.claude', 'skills') });
if (hasCodex) skillsTargets.push({ name: 'Codex', dir: path.join(homeDir, '.codex', 'skills') });
if (hasHermes) skillsTargets.push({ name: 'Hermes', dir: path.join(homeDir, '.hermes', 'skills', 'chain-insights') });
if (hasLocal) skillsTargets.push({ name: 'Local Claude commands', dir: path.join(process.cwd(), '.claude', 'commands', 'chain-insights') });

// ─── 1. Copy agent skills ─────────────────────────────────────────────────

function copyCommandsAsClaudeSkills(srcDir, targetDir) {
  if (!fs.existsSync(srcDir)) {
    throw new Error(`Skills source not found: ${srcDir}`);
  }

  fs.mkdirSync(targetDir, { recursive: true });

  // The target is shared with user-owned skills. Remove only the exact retired
  // names from older Chain Insights releases, then replace the reviewed set.
  // Never delete by prefix or enumerate arbitrary source directories.

  const copyTree = (src, dest) => {
    const stat = fs.statSync(src);
    if (stat.isDirectory()) {
      fs.mkdirSync(dest, { recursive: true });
      for (const child of fs.readdirSync(src)) {
        copyTree(path.join(src, child), path.join(dest, child));
      }
      return;
    }
    if (stat.isFile()) {
      fs.copyFileSync(src, dest);
    }
  };

  for (const skillName of RETIRED_SKILL_NAMES) {
    fs.rmSync(path.join(targetDir, skillName), { recursive: true, force: true });
  }

  for (const skillName of PUBLIC_SKILL_NAMES) {
    const skillSrc  = path.join(srcDir, skillName);
    const skillDest = path.join(targetDir, skillName);
    if (!fs.existsSync(skillSrc) || !fs.statSync(skillSrc).isDirectory()) {
      throw new Error(`Reviewed skill source not found: ${skillSrc}`);
    }
    fs.rmSync(skillDest, { recursive: true, force: true });
    copyTree(skillSrc, skillDest);
  }
}

for (const target of skillsTargets) {
  copyCommandsAsClaudeSkills(srcSkillsDir, target.dir);
}

// ─── 2. Create ~/.chain-insights/ config directory ────────────────────────

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// ─── 3. Write default config.json if absent ───────────────────────────────

if (!fs.existsSync(configPath)) {
  const defaultConfig = {
    graphMcpEndpoint: 'http://127.0.0.1:8012/mcp',
    walletAddress: '',
    graphMcpMode:  'paid',
    serverPort:    4321,
    dataDir:       dataDir,
    version:       '1',
  };
  fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2) + '\n', 'utf8');
  // Owner-readable only — config may contain MCP auth token (ASVS L1 V4.3.2 / T-02-01)
  fs.chmodSync(configPath, 0o600);
}

// ─── 4. Register MCP proxy in supported clients ───────────────────────────

const proxyBinPath = path.resolve(__dirname, 'mcp-proxy.cjs');
const { execFileSync } = require('child_process');

if (hasClaude) {
  try {
    execFileSync(
      'claude',
      ['mcp', 'add', 'chain-insights-proxy', '--scope', 'user', '--', 'node', proxyBinPath],
      { stdio: 'pipe' }
    );
    console.log(`  ${cyan}Claude MCP:${reset} registered (chain-insights-proxy) at ${proxyBinPath}`);
  } catch {
    console.log(`  ${dim}Claude MCP:${reset} run manually: claude mcp add chain-insights-proxy --scope user -- node ${proxyBinPath}`);
  }
}

function tomlQuoted(value) {
  return JSON.stringify(value);
}

function installCodexMcp(configFile, proxyPath) {
  fs.mkdirSync(path.dirname(configFile), { recursive: true });
  let content = fs.existsSync(configFile) ? fs.readFileSync(configFile, 'utf8') : '';
  const block = [
    '[mcp_servers.chain-insights]',
    'command = "node"',
    `args = [${tomlQuoted(proxyPath)}]`,
    '',
  ].join('\n');

  const heading = '[mcp_servers.chain-insights]';
  const start = content.indexOf(heading);
  if (start >= 0) {
    let end = content.length;
    const rest = content.slice(start + heading.length);
    const nextSection = rest.search(/\n\[/);
    if (nextSection >= 0) end = start + heading.length + nextSection + 1;
    content = `${content.slice(0, start)}${block}${content.slice(end)}`;
  } else {
    const separator = content.endsWith('\n') || content.length === 0 ? '' : '\n';
    content = `${content}${separator}\n${block}`;
  }

  fs.writeFileSync(configFile, content, 'utf8');
}

if (hasCodex) {
  const codexConfig = path.join(homeDir, '.codex', 'config.toml');
  installCodexMcp(codexConfig, proxyBinPath);
  console.log(`  ${cyan}Codex MCP:${reset} registered in ${codexConfig}`);
}

function yamlQuoted(value) {
  return JSON.stringify(value);
}

function findTopLevelSectionEnd(lines, start) {
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '') continue;
    if (!line.startsWith(' ') && !line.startsWith('\t')) return i;
  }
  return lines.length;
}

function findHermesServerEnd(lines, start, sectionEnd) {
  for (let i = start + 1; i < sectionEnd; i++) {
    const line = lines[i];
    if (/^  [^ ].*:/.test(line)) return i;
  }
  return sectionEnd;
}

function installHermesMcp(configFile, proxyPath) {
  fs.mkdirSync(path.dirname(configFile), { recursive: true });

  const serverBlock = [
    '  chain-insights:',
    '    command: "node"',
    '    args:',
    `    - ${yamlQuoted(proxyPath)}`,
    '    enabled: true',
  ];

  let content = fs.existsSync(configFile) ? fs.readFileSync(configFile, 'utf8') : '';
  if (/^mcp_servers:\s*\{\s*\}\s*$/m.test(content)) {
    content = content.replace(/^mcp_servers:\s*\{\s*\}\s*$/m, ['mcp_servers:', ...serverBlock].join('\n'));
    fs.writeFileSync(configFile, content.endsWith('\n') ? content : `${content}\n`, 'utf8');
    return;
  }

  const lines = content.length ? content.split(/\r?\n/) : [];
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();

  const sectionStart = lines.findIndex(line => line === 'mcp_servers:');
  if (sectionStart < 0) {
    if (lines.length > 0) lines.push('');
    lines.push('mcp_servers:', ...serverBlock);
    fs.writeFileSync(configFile, `${lines.join('\n')}\n`, 'utf8');
    return;
  }

  const sectionEnd = findTopLevelSectionEnd(lines, sectionStart);
  const serverStart = lines.findIndex((line, index) => index > sectionStart && index < sectionEnd && line === '  chain-insights:');
  if (serverStart >= 0) {
    const serverEnd = findHermesServerEnd(lines, serverStart, sectionEnd);
    lines.splice(serverStart, serverEnd - serverStart, ...serverBlock);
  } else {
    lines.splice(sectionStart + 1, 0, ...serverBlock);
  }

  fs.writeFileSync(configFile, `${lines.join('\n')}\n`, 'utf8');
}

if (hasHermes) {
  const hermesConfig = path.join(homeDir, '.hermes', 'config.yaml');
  installHermesMcp(hermesConfig, proxyBinPath);
  console.log(`  ${cyan}Hermes MCP:${reset} registered in ${hermesConfig}`);
}

// ─── 5. Print installation summary ────────────────────────────────────────

console.log(`\n${bold}${green}Chain Insights installed${reset}`);
for (const target of skillsTargets) {
  console.log(`  ${cyan}${target.name} skills:${reset} ${target.dir}`);
}
console.log(`  ${cyan}Config:${reset}   ${configPath}`);
console.log(`  ${cyan}Data dir:${reset} ${dataDir}`);
console.log(`\n${dim}Run ${reset}${cyan}chain-insights status${reset}${dim} to verify the installation.${reset}\n`);
