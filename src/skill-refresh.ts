import {
  cpSync,
  existsSync,
  lstatSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Keeps the skill copies that `cia setup` installed at the version of the
 * package that runs. npm runs no setup step on `npm i -g chain-insights@X`, so
 * without this an upgrade brings new server rules while every host keeps
 * reading the skill of the release it was set up with.
 *
 * Rules, in order:
 * - Only a place setup already installed is refreshed. Nothing is installed.
 * - A symlinked skill belongs to its owner (a checkout) and is never touched.
 * - A copy stamped by a newer release is left alone: two installs of
 *   different versions (a global install and a bundled extension) must not
 *   take turns downgrading each other.
 */

/** The reviewed skill set; the same list as PUBLIC_SKILL_NAMES in bin/install.cjs. */
export const PUBLIC_SKILL_NAMES = Object.freeze(['chain-insights-cypher'])

/** Written inside each installed skill by setup and by the refresh. */
export const SKILL_VERSION_FILE = '.chain-insights-version'

export interface SkillRefreshResult {
  /** Skill directories replaced with the packaged copy. */
  refreshed: string[]
  /** Skill directories left alone, with the reason. */
  skipped: { dir: string; reason: 'symlink' | 'newer' | 'current' }[]
  /** Skill directories that could not be replaced, with the error text. */
  failed: { dir: string; error: string }[]
}

/** The places `cia setup` installs skills: Claude Code, Codex, Hermes. */
export function skillTargetDirs(home: string = homedir()): string[] {
  return [
    path.join(home, '.claude', 'skills'),
    path.join(home, '.codex', 'skills'),
    path.join(home, '.hermes', 'skills', 'chain-insights'),
  ]
}

/** The skills/ directory shipped in the package, next to dist/ and src/. */
export function packagedSkillsDir(): string {
  return fileURLToPath(new URL('../skills', import.meta.url))
}

/** Compares two x.y.z versions; a pre-release suffix is ignored. */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string) =>
    v
      .split('-')[0]!
      .split('.')
      .map((n) => Number.parseInt(n, 10) || 0)
  const left = parts(a)
  const right = parts(b)
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

function readStamp(skillDir: string): string | undefined {
  try {
    return readFileSync(path.join(skillDir, SKILL_VERSION_FILE), 'utf8').trim() || undefined
  } catch {
    return undefined
  }
}

/** Swaps the packaged copy in through hidden siblings, so a reader never sees half a skill. */
function replaceSkill(source: string, dest: string, version: string): void {
  const parent = path.dirname(dest)
  const name = path.basename(dest)
  const staged = path.join(parent, `.${name}.refresh-${process.pid}`)
  const retired = path.join(parent, `.${name}.old-${process.pid}`)
  rmSync(staged, { recursive: true, force: true })
  try {
    cpSync(source, staged, { recursive: true })
    writeFileSync(path.join(staged, SKILL_VERSION_FILE), `${version}\n`, 'utf8')
    renameSync(dest, retired)
    try {
      renameSync(staged, dest)
    } catch (error) {
      renameSync(retired, dest)
      throw error
    }
    rmSync(retired, { recursive: true, force: true })
  } finally {
    rmSync(staged, { recursive: true, force: true })
  }
}

export function refreshInstalledSkills(
  version: string,
  options: { home?: string; sourceDir?: string } = {}
): SkillRefreshResult {
  const sourceDir = options.sourceDir ?? packagedSkillsDir()
  const result: SkillRefreshResult = { refreshed: [], skipped: [], failed: [] }
  for (const target of skillTargetDirs(options.home)) {
    for (const name of PUBLIC_SKILL_NAMES) {
      const source = path.join(sourceDir, name)
      const dest = path.join(target, name)
      if (!existsSync(source)) continue
      let stat
      try {
        stat = lstatSync(dest)
      } catch {
        continue // not installed here
      }
      if (stat.isSymbolicLink()) {
        result.skipped.push({ dir: dest, reason: 'symlink' })
        continue
      }
      if (!stat.isDirectory()) continue
      const stamp = readStamp(dest)
      if (stamp !== undefined) {
        const order = compareVersions(stamp, version)
        if (order > 0) {
          result.skipped.push({ dir: dest, reason: 'newer' })
          continue
        }
        if (order === 0) {
          result.skipped.push({ dir: dest, reason: 'current' })
          continue
        }
      }
      try {
        replaceSkill(source, dest, version)
        result.refreshed.push(dest)
      } catch (error) {
        result.failed.push({
          dir: dest,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
  }
  return result
}
