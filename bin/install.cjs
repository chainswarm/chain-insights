#!/usr/bin/env node
'use strict'

// Chain Insights installer — CJS, stdlib-only.
// Runs before node_modules exists; zero npm imports allowed.
// Extension is .cjs (not .js) because package.json has "type": "module" —
// a .js file would be treated as ESM and require() calls would crash.

const fs = require('fs')
const path = require('path')
const os = require('os')

// ANSI colors — no chalk
const cyan = '\x1b[36m'
const green = '\x1b[32m'
const bold = '\x1b[1m'
const dim = '\x1b[2m'
const reset = '\x1b[0m'

// Parse args
const args = process.argv.slice(2)
const hasClaude = args.includes('--claude')
const hasCodex = args.includes('--codex')
const hasHermes = args.includes('--hermes')
const hasClaudeDesktop = args.includes('--claude-desktop')
const hasLocal = args.includes('--local')

if (!hasClaude && !hasCodex && !hasHermes && !hasClaudeDesktop && !hasLocal) {
  console.log(`\n${bold}chain-insights installer${reset}`)
  console.log(`\nUsage: node bin/install.cjs --claude | --claude-desktop | --codex | --hermes`)
  console.log(`  ${cyan}--claude${reset}  Install Claude Code skills globally to ~/.claude/skills/`)
  console.log(
    `  ${cyan}--claude-desktop${reset} Register MCP in Claude Desktop (draws the money-flow views)`
  )
  console.log(
    `  ${cyan}--codex${reset}   Install Codex skills to ~/.codex/skills/ and the Chain Insights Codex plugin (draws views)`
  )
  console.log(
    `  ${cyan}--hermes${reset}  Install Hermes skills globally to ~/.hermes/skills/chain-insights/ and register MCP`
  )
  console.log(
    `  ${cyan}--local${reset}   Install skills locally to ./.claude/commands/chain-insights/`
  )
  console.log('')
  process.exit(0)
}

const homeDir = os.homedir()
const dataDir = path.join(homeDir, '.chain-insights')
const configPath = path.join(dataDir, 'config.json')
const srcSkillsDir = path.join(__dirname, '..', 'skills')
const PUBLIC_SKILL_NAMES = Object.freeze(['chain-insights-cypher'])
const SKILL_VERSION_FILE = '.chain-insights-version'
const RETIRED_SKILL_NAMES = Object.freeze([
  'chain-insights-address-risk',
  'chain-insights-bittensor-cypher',
  'chain-insights-developer-experience',
  'chain-insights-investigation',
  'chain-insights-monitoring',
  'chain-insights-schema-bittensor',
  'chain-insights-schema-evm',
  'ci-status',
  'test-chain-insights-graph',
])

// Determine skills targets
const skillsTargets = []
if (hasClaude)
  skillsTargets.push({ name: 'Claude Code', dir: path.join(homeDir, '.claude', 'skills') })
if (hasCodex) skillsTargets.push({ name: 'Codex', dir: path.join(homeDir, '.codex', 'skills') })
if (hasHermes)
  skillsTargets.push({
    name: 'Hermes',
    dir: path.join(homeDir, '.hermes', 'skills', 'chain-insights'),
  })
if (hasLocal)
  skillsTargets.push({
    name: 'Local Claude commands',
    dir: path.join(process.cwd(), '.claude', 'commands', 'chain-insights'),
  })

// ─── 1. Copy agent skills ─────────────────────────────────────────────────

function copyCommandsAsClaudeSkills(srcDir, targetDir) {
  if (!fs.existsSync(srcDir)) {
    throw new Error(`Skills source not found: ${srcDir}`)
  }

  fs.mkdirSync(targetDir, { recursive: true })

  // The target is shared with user-owned skills. Remove only the exact retired
  // names from older Chain Insights releases, then replace the reviewed set.
  // Never delete by prefix or enumerate arbitrary source directories.

  const copyTree = (src, dest) => {
    const stat = fs.statSync(src)
    if (stat.isDirectory()) {
      fs.mkdirSync(dest, { recursive: true })
      for (const child of fs.readdirSync(src)) {
        copyTree(path.join(src, child), path.join(dest, child))
      }
      return
    }
    if (stat.isFile()) {
      fs.copyFileSync(src, dest)
    }
  }

  for (const skillName of RETIRED_SKILL_NAMES) {
    fs.rmSync(path.join(targetDir, skillName), { recursive: true, force: true })
  }

  for (const skillName of PUBLIC_SKILL_NAMES) {
    const skillSrc = path.join(srcDir, skillName)
    const skillDest = path.join(targetDir, skillName)
    if (!fs.existsSync(skillSrc) || !fs.statSync(skillSrc).isDirectory()) {
      throw new Error(`Reviewed skill source not found: ${skillSrc}`)
    }
    fs.rmSync(skillDest, { recursive: true, force: true })
    copyTree(skillSrc, skillDest)
    // The proxy refreshes a copy whose stamp is older than itself (src/skill-refresh.ts).
    fs.writeFileSync(path.join(skillDest, SKILL_VERSION_FILE), `${packageVersion()}\n`, 'utf8')
  }
}

for (const target of skillsTargets) {
  copyCommandsAsClaudeSkills(srcSkillsDir, target.dir)
}

// ─── 2. Create ~/.chain-insights/ config directory ────────────────────────

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true })
}

// ─── 3. Write default config.json if absent ───────────────────────────────

if (!fs.existsSync(configPath)) {
  const defaultConfig = {
    graphMcpEndpoint: 'https://mcp.chain-insights.ai/',
    walletAddress: '',
    graphMcpMode: 'paid',
    serverPort: 4321,
    dataDir: dataDir,
    version: '1',
  }
  fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2) + '\n', 'utf8')
  // Owner-readable only — config may contain MCP auth token (ASVS L1 V4.3.2 / T-02-01)
  fs.chmodSync(configPath, 0o600)
}

// ─── 4. Register MCP proxy in supported clients ───────────────────────────

const proxyBinPath = path.resolve(__dirname, 'mcp-proxy.cjs')
const { execFileSync } = require('child_process')

if (hasClaude) {
  try {
    // "add" refuses a name that exists, so an entry from an older install (or
    // an old checkout) would stay in place. Replace it. The proxy is started
    // with this Node's absolute path: Claude Desktop runs Claude Code without
    // a shell's PATH.
    try {
      execFileSync('claude', ['mcp', 'remove', 'chain-insights-proxy', '--scope', 'user'], {
        stdio: 'pipe',
      })
    } catch {
      /* not registered yet */
    }
    execFileSync(
      'claude',
      [
        'mcp',
        'add',
        'chain-insights-proxy',
        '--scope',
        'user',
        '--',
        process.execPath,
        proxyBinPath,
      ],
      { stdio: 'pipe' }
    )
    console.log(`  ${cyan}Claude MCP:${reset} registered (chain-insights-proxy) at ${proxyBinPath}`)
  } catch {
    console.log(
      `  ${dim}Claude MCP:${reset} run manually: claude mcp remove chain-insights-proxy --scope user; claude mcp add chain-insights-proxy --scope user -- ${process.execPath} ${proxyBinPath}`
    )
  }
}

function tomlQuoted(value) {
  return JSON.stringify(value)
}

// Codex draws an MCP app view only for a server that a Codex plugin provides:
// the desktop app needs both the view's ui:// address and a plugin id on the
// tool call. A plain [mcp_servers] entry has no plugin id, so its graph_query
// answers stay text. setup codex therefore installs a local one-plugin
// marketplace and removes the plain entry earlier versions wrote.
const CODEX_MARKETPLACE = 'chain-insights'
const CODEX_PLUGIN = 'chain-insights'
const CODEX_PLUGIN_REF = `${CODEX_PLUGIN}@${CODEX_MARKETPLACE}`
const LEGACY_CODEX_MCP_HEADING = '[mcp_servers.chain-insights]'

function packageVersion() {
  return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')).version
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function writeCodexMarketplace(root, proxyPath, version) {
  writeJson(path.join(root, '.agents', 'plugins', 'marketplace.json'), {
    name: CODEX_MARKETPLACE,
    interface: { displayName: 'Chain Insights' },
    plugins: [
      {
        name: CODEX_PLUGIN,
        source: { source: 'local', path: `./plugins/${CODEX_PLUGIN}` },
        policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' },
        category: 'Developer Tools',
      },
    ],
  })
  const pluginDir = path.join(root, 'plugins', CODEX_PLUGIN)
  writeJson(path.join(pluginDir, '.codex-plugin', 'plugin.json'), {
    name: CODEX_PLUGIN,
    version,
    description: 'Chain Insights graph queries, with money-flow, chart and table views.',
    author: { name: 'Chain Insights' },
    license: 'MIT',
    mcpServers: './.mcp.json',
    interface: { displayName: 'Chain Insights', shortDescription: 'Money flows and graph queries' },
  })
  // The installing Node's absolute path, as setup claude-desktop does: a
  // desktop app does not inherit the shell's PATH.
  writeJson(path.join(pluginDir, '.mcp.json'), {
    mcpServers: { 'chain-insights': { command: process.execPath, args: [proxyPath] } },
  })
}

// The [heading] section of a TOML file, from its heading to the next heading.
function tomlSectionRange(content, heading) {
  const lines = content.split('\n')
  const start = lines.findIndex((line) => line.trim() === heading)
  if (start < 0) return null
  let end = start + 1
  while (end < lines.length && !/^\s*\[/.test(lines[end])) end++
  return { lines, start, end }
}

function removeTomlSection(content, heading) {
  const range = tomlSectionRange(content, heading)
  if (!range) return content
  const { lines, start, end } = range
  return [...lines.slice(0, start), ...lines.slice(end)].join('\n').replace(/\n{3,}/g, '\n\n')
}

function setTomlSection(content, heading, body) {
  const block = [heading, ...body, '']
  const range = tomlSectionRange(content, heading)
  if (range) {
    const { lines, start, end } = range
    return [...lines.slice(0, start), ...block, ...lines.slice(end)].join('\n')
  }
  const separator = content.endsWith('\n') || content.length === 0 ? '' : '\n'
  return `${content}${separator}\n${block.join('\n')}`
}

function installCodexPlugin(configFile, marketplaceRoot) {
  fs.mkdirSync(path.dirname(configFile), { recursive: true })
  let content = fs.existsSync(configFile) ? fs.readFileSync(configFile, 'utf8') : ''
  content = removeTomlSection(content, LEGACY_CODEX_MCP_HEADING)
  content = setTomlSection(content, `[marketplaces.${CODEX_MARKETPLACE}]`, [
    'source_type = "local"',
    `source = ${tomlQuoted(marketplaceRoot)}`,
  ])
  content = setTomlSection(content, `[plugins.${tomlQuoted(CODEX_PLUGIN_REF)}]`, ['enabled = true'])
  fs.writeFileSync(configFile, content, 'utf8')
}

// Codex copies a plugin into its own cache on `codex plugin add`. Without the
// codex command the config entries above are enough for the next start; with
// it, the cache is refreshed now, so an upgrade takes the new version.
function cacheCodexPlugin() {
  try {
    execFileSync('codex', ['plugin', 'remove', CODEX_PLUGIN_REF], {
      stdio: 'ignore',
      timeout: 30000,
    })
  } catch {
    // Not installed yet, or no codex command: the add below decides.
  }
  try {
    execFileSync('codex', ['plugin', 'add', CODEX_PLUGIN_REF], { stdio: 'ignore', timeout: 30000 })
    return true
  } catch {
    return false
  }
}

if (hasCodex) {
  const codexConfig = path.join(homeDir, '.codex', 'config.toml')
  const marketplaceRoot = path.join(dataDir, 'codex-marketplace')
  writeCodexMarketplace(marketplaceRoot, proxyBinPath, packageVersion())
  installCodexPlugin(codexConfig, marketplaceRoot)
  console.log(`  ${cyan}Codex plugin:${reset} ${CODEX_PLUGIN_REF} registered in ${codexConfig}`)
  if (cacheCodexPlugin()) {
    console.log(`  ${cyan}Codex plugin:${reset} installed; restart the Codex app to load it`)
  } else {
    console.log(
      `  ${dim}Codex plugin:${reset} run once: codex plugin add ${CODEX_PLUGIN_REF}, then restart the Codex app`
    )
  }
}

function yamlQuoted(value) {
  return JSON.stringify(value)
}

function findTopLevelSectionEnd(lines, start) {
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i]
    if (line.trim() === '') continue
    if (!line.startsWith(' ') && !line.startsWith('\t')) return i
  }
  return lines.length
}

function findHermesServerEnd(lines, start, sectionEnd) {
  for (let i = start + 1; i < sectionEnd; i++) {
    const line = lines[i]
    if (/^  [^ ].*:/.test(line)) return i
  }
  return sectionEnd
}

function installHermesMcp(configFile, proxyPath) {
  fs.mkdirSync(path.dirname(configFile), { recursive: true })

  const serverBlock = [
    '  chain-insights:',
    '    command: "node"',
    '    args:',
    `    - ${yamlQuoted(proxyPath)}`,
    '    enabled: true',
  ]

  let content = fs.existsSync(configFile) ? fs.readFileSync(configFile, 'utf8') : ''
  if (/^mcp_servers:\s*\{\s*\}\s*$/m.test(content)) {
    content = content.replace(
      /^mcp_servers:\s*\{\s*\}\s*$/m,
      ['mcp_servers:', ...serverBlock].join('\n')
    )
    fs.writeFileSync(configFile, content.endsWith('\n') ? content : `${content}\n`, 'utf8')
    return
  }

  const lines = content.length ? content.split(/\r?\n/) : []
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()

  const sectionStart = lines.findIndex((line) => line === 'mcp_servers:')
  if (sectionStart < 0) {
    if (lines.length > 0) lines.push('')
    lines.push('mcp_servers:', ...serverBlock)
    fs.writeFileSync(configFile, `${lines.join('\n')}\n`, 'utf8')
    return
  }

  const sectionEnd = findTopLevelSectionEnd(lines, sectionStart)
  const serverStart = lines.findIndex(
    (line, index) => index > sectionStart && index < sectionEnd && line === '  chain-insights:'
  )
  if (serverStart >= 0) {
    const serverEnd = findHermesServerEnd(lines, serverStart, sectionEnd)
    lines.splice(serverStart, serverEnd - serverStart, ...serverBlock)
  } else {
    lines.splice(sectionStart + 1, 0, ...serverBlock)
  }

  fs.writeFileSync(configFile, `${lines.join('\n')}\n`, 'utf8')
}

if (hasHermes) {
  const hermesConfig = path.join(homeDir, '.hermes', 'config.yaml')
  installHermesMcp(hermesConfig, proxyBinPath)
  console.log(`  ${cyan}Hermes MCP:${reset} registered in ${hermesConfig}`)
}

// Claude Desktop reads one JSON file per user. It is not a terminal program, so
// it does not see the PATH of a shell; the proxy is started with this Node's
// absolute path. Skills reach Claude Desktop through the plugin, not this file.
function claudeDesktopConfigPath() {
  if (process.platform === 'darwin') {
    return path.join(
      homeDir,
      'Library',
      'Application Support',
      'Claude',
      'claude_desktop_config.json'
    )
  }
  if (process.platform === 'win32') {
    const appData = process.env['APPDATA'] || path.join(homeDir, 'AppData', 'Roaming')
    return path.join(appData, 'Claude', 'claude_desktop_config.json')
  }
  const configHome = process.env['XDG_CONFIG_HOME'] || path.join(homeDir, '.config')
  return path.join(configHome, 'Claude', 'claude_desktop_config.json')
}

function installClaudeDesktopMcp(configFile, proxyPath) {
  fs.mkdirSync(path.dirname(configFile), { recursive: true })
  let config = {}
  if (fs.existsSync(configFile)) {
    const text = fs.readFileSync(configFile, 'utf8')
    if (text.trim() !== '') {
      try {
        config = JSON.parse(text)
      } catch {
        throw new Error(`${configFile} is not valid JSON; fix it, then run the setup again`)
      }
      if (config === null || typeof config !== 'object' || Array.isArray(config)) {
        throw new Error(
          `${configFile} does not hold a JSON object; fix it, then run the setup again`
        )
      }
    }
    fs.copyFileSync(configFile, `${configFile}.bak`)
  }
  const servers =
    config.mcpServers && typeof config.mcpServers === 'object' && !Array.isArray(config.mcpServers)
      ? config.mcpServers
      : {}
  servers['chain-insights'] = { command: process.execPath, args: [proxyPath] }
  config.mcpServers = servers
  fs.writeFileSync(configFile, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
}

// Claude Desktop keeps its settings in the same file and writes the whole file
// back when it saves them, so an entry added while it runs can be lost.
function claudeDesktopRunning() {
  const { spawnSync } = require('child_process')
  try {
    if (process.platform === 'win32') {
      const out = spawnSync('tasklist', ['/FI', 'IMAGENAME eq Claude.exe', '/NH'], {
        encoding: 'utf8',
      })
      return /claude\.exe/i.test(out.stdout || '')
    }
    const pgrepArgs =
      process.platform === 'darwin' ? ['-x', 'Claude'] : ['-f', '(^|/)claude-desktop( |$)']
    return spawnSync('pgrep', pgrepArgs, { encoding: 'utf8' }).status === 0
  } catch {
    return false
  }
}

function quitClaudeDesktopHint() {
  if (process.platform === 'darwin') return 'Claude menu > Quit Claude (Cmd+Q)'
  if (process.platform === 'win32') return 'right-click the Claude icon in the taskbar tray > Quit'
  return 'File menu > Quit, or the tray icon > Quit'
}

if (hasClaudeDesktop) {
  const desktopConfig = claudeDesktopConfigPath()
  if (claudeDesktopRunning()) {
    console.log(
      `  ${bold}Claude Desktop is running.${reset} It can overwrite the new entry when it saves its own settings.`
    )
    console.log(
      `  Quit it fully (${quitClaudeDesktopHint()}), run ${cyan}cia setup claude-desktop${reset} again, then start Claude Desktop.`
    )
  }
  try {
    installClaudeDesktopMcp(desktopConfig, proxyBinPath)
    console.log(`  ${cyan}Claude Desktop MCP:${reset} registered in ${desktopConfig}`)
    console.log(`  ${dim}Restart Claude Desktop to load it.${reset}`)
  } catch (err) {
    console.error(`  Claude Desktop MCP: ${err.message}`)
    process.exit(1)
  }
}

// ─── 5. Print installation summary ────────────────────────────────────────

console.log(`\n${bold}${green}Chain Insights installed${reset}`)
for (const target of skillsTargets) {
  console.log(`  ${cyan}${target.name} skills:${reset} ${target.dir}`)
}
console.log(`  ${cyan}Config:${reset}   ${configPath}`)
console.log(`  ${cyan}Data dir:${reset} ${dataDir}`)
console.log(
  `\n${dim}Run ${reset}${cyan}cia status${reset}${dim} to verify the installation.${reset}\n`
)
