// Every monitor-owned workspace location in one place (spec: canonical JSON
// under the workspace; DuckDB derived under .chain-insights/monitor/).
import path from 'node:path'

export interface MonitorPaths {
  monitorDir: string
  configPath: string
  runsDir: string
  alertsDir: string
  alertsLog: string
  acksLog: string
  emittedLog: string
  logsDir: string
  watchlistHitsLog: string
  reviewsDir: string
  dbPath: string
  watchlistPath: string
  detectionsDir: string
  reviewedDir: string
  casesDir: string
  reportsDir: string
}

export function monitorPaths(workspaceRoot: string): MonitorPaths {
  const root = path.resolve(workspaceRoot)
  const monitorDir = path.join(root, '.chain-insights', 'monitor')
  const alertsDir = path.join(monitorDir, 'alerts')
  const logsDir = path.join(monitorDir, 'logs')
  return {
    monitorDir,
    configPath: path.join(monitorDir, 'config.json'),
    runsDir: path.join(monitorDir, 'runs'),
    alertsDir,
    alertsLog: path.join(alertsDir, 'alerts.jsonl'),
    acksLog: path.join(alertsDir, 'acks.jsonl'),
    emittedLog: path.join(alertsDir, 'emitted.jsonl'),
    logsDir,
    watchlistHitsLog: path.join(logsDir, 'watchlist-hits.jsonl'),
    reviewsDir: path.join(monitorDir, 'reviews'),
    dbPath: path.join(monitorDir, 'monitor.duckdb'),
    watchlistPath: path.join(monitorDir, 'watchlist.json'),
    detectionsDir: path.join(root, 'detections'),
    reviewedDir: path.join(root, 'detections', 'reviewed'),
    casesDir: path.join(root, 'cases'),
    reportsDir: path.join(root, 'reports', 'monitor'),
  }
}
