// Every monitor-owned workspace location in one place (canonical JSON under
// the workspace; derived render state under .chain-insights/monitor/).
import path from 'node:path'

export interface MonitorPaths {
  monitorDir: string
  configPath: string
  logsDir: string
  renderStatePath: string
  casesDir: string
  lockPath: string
}

export function monitorPaths(workspaceRoot: string): MonitorPaths {
  const root = path.resolve(workspaceRoot)
  const monitorDir = path.join(root, '.chain-insights', 'monitor')
  const logsDir = path.join(monitorDir, 'logs')
  return {
    monitorDir,
    configPath: path.join(monitorDir, 'config.json'),
    logsDir,
    renderStatePath: path.join(monitorDir, 'render-state.json'),
    casesDir: path.join(root, 'cases'),
    lockPath: path.join(root, '.cia-monitor.lock'),
  }
}
