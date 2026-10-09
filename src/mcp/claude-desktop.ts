import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

/**
 * Claude Desktop chat runs its conversations on the Claude Code engine. That
 * engine starts every server in the user's Claude Code settings as well as the
 * servers in Claude Desktop's own settings file. Claude Desktop draws our views
 * only for a server from its own file (`chain-insights`, written by
 * `cia setup claude-desktop`); the Claude Code copy answers in text. With both
 * present the model sees every tool twice and may pick the copy that cannot
 * draw. The Claude Code copy therefore steps aside when it runs inside Claude
 * Desktop and the drawing copy is configured.
 */

/** The value Claude Code sets in CLAUDE_CODE_ENTRYPOINT when Claude Desktop runs it. */
export const CLAUDE_DESKTOP_ENTRYPOINT = 'claude-desktop'

/** The server name `cia setup claude-desktop` writes. */
export const CLAUDE_DESKTOP_SERVER_NAME = 'chain-insights'

export const DEFERRED_SERVER_INSTRUCTIONS = [
  'Chain Insights is served in Claude Desktop by its `chain-insights` connector,',
  'which draws the money-flow graph and the time series. Use the tools of that',
  'connector. This copy, started from the Claude Code settings, lists no tools',
  'here so that each tool appears once.',
].join(' ')

/** Claude Desktop's settings file, as bin/install.cjs writes it. */
export function claudeDesktopConfigPath(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  home: string = homedir()
): string {
  if (platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')
  }
  if (platform === 'win32') {
    const appData = env['APPDATA'] || path.join(home, 'AppData', 'Roaming')
    return path.join(appData, 'Claude', 'claude_desktop_config.json')
  }
  const configHome = env['XDG_CONFIG_HOME'] || path.join(home, '.config')
  return path.join(configHome, 'Claude', 'claude_desktop_config.json')
}

/** True when Claude Desktop's own settings start a `chain-insights` server. */
export function claudeDesktopServesChainInsights(configFile: string): boolean {
  try {
    const config = JSON.parse(readFileSync(configFile, 'utf8')) as {
      mcpServers?: Record<string, unknown>
    }
    const servers = config?.mcpServers
    return (
      servers !== null &&
      typeof servers === 'object' &&
      !Array.isArray(servers) &&
      CLAUDE_DESKTOP_SERVER_NAME in servers
    )
  } catch {
    return false
  }
}

/**
 * True when this process is the Claude Code copy inside Claude Desktop and the
 * drawing copy is configured. Claude Desktop starts its own copy without
 * CLAUDE_CODE_ENTRYPOINT, so that copy never steps aside.
 */
export function defersToClaudeDesktop(
  env: NodeJS.ProcessEnv = process.env,
  configFile: string = claudeDesktopConfigPath(env)
): boolean {
  if (env['CLAUDE_CODE_ENTRYPOINT'] !== CLAUDE_DESKTOP_ENTRYPOINT) return false
  return claudeDesktopServesChainInsights(configFile)
}
