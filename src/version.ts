import { readFileSync } from 'node:fs'

export const PACKAGE_INFO = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8')
) as { name: string; version: string }

export const PACKAGE_VERSION = PACKAGE_INFO.version
