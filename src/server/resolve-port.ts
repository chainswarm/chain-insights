/**
 * Resolve the TCP port a local server (serve / viz) should bind to.
 *
 * An explicit `--port` flag always wins; when it is omitted we fall back to the
 * configured `serverPort`. `cia status` and persisted graph-report URLs already
 * advertise `config.serverPort`, so defaulting the bind port from the same
 * value keeps the advertised URL and the actual listener in sync (previously
 * both `serve` and `viz` hardcoded 4321 and ignored a `config set serverPort`).
 */
export function resolveServerPort(optPort: string | undefined, configPort: number): number {
  if (optPort === undefined) return configPort
  const parsed = Number(optPort)
  if (!Number.isInteger(parsed) || parsed < 1024 || parsed > 65535) {
    throw new Error(`Invalid --port "${optPort}": expected an integer between 1024 and 65535`)
  }
  return parsed
}
