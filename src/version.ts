import { readFileSync } from 'node:fs'

export const PACKAGE_INFO = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8')
) as { name: string; version: string }

export const PACKAGE_VERSION = PACKAGE_INFO.version

/**
 * The npm dist-tag this build was published under, read from
 * `dist/channel.json`. The publish workflow writes that file after the build
 * and before `npm pack`, so the channel is a fact of the package, never a
 * guess at run time. A source checkout or a local build has no file and
 * reads `undefined`, which means production.
 */
export function readReleaseChannel(
  file: URL = new URL('../dist/channel.json', import.meta.url)
): string | undefined {
  let raw: string
  try {
    raw = readFileSync(file, 'utf8')
  } catch {
    return undefined
  }
  try {
    const channel = (JSON.parse(raw) as { channel?: unknown }).channel
    return typeof channel === 'string' && channel.trim() ? channel.trim() : undefined
  } catch {
    return undefined
  }
}

export const RELEASE_CHANNEL = readReleaseChannel()
