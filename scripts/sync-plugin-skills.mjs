#!/usr/bin/env node
// Keeps plugin/skills/ in step with skills/: the Claude plugin ships copies of
// the investigation skills a Claude user needs, and skills/ is their one home.
//
//   node scripts/sync-plugin-skills.mjs          copy skills/<name> into plugin/skills/<name>
//   node scripts/sync-plugin-skills.mjs --check  exit 1 and name every drifted file
//
// tests/plugin.test.ts fails when the copies drift, so an edit to a skill in
// skills/ needs a sync run in the same change.
import { cpSync, existsSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const defaultRoot = dirname(dirname(fileURLToPath(import.meta.url)))

// The core skill the plugin always carries. Protocol skills sit beside it.
export const CORE_SKILL_NAME = 'chain-insights-cypher'

// The skills the plugin carries: every skill that skills/ ships, read from
// skills/ — the core skill, then every directory named chain-insights-* that
// holds a SKILL.md, sorted. bin/install.cjs and src/skill-refresh.ts apply the
// same rule.
export function pluginSkills(root = defaultRoot) {
  const skills = join(root, 'skills')
  const protocol = existsSync(skills)
    ? readdirSync(skills, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && /^chain-insights-[a-z0-9-]+$/.test(entry.name))
        .map((entry) => entry.name)
        .filter((name) => name !== CORE_SKILL_NAME)
        .filter((name) => existsSync(join(skills, name, 'SKILL.md')))
        .sort()
    : []
  return [CORE_SKILL_NAME, ...protocol]
}

function filesUnder(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    return entry.isDirectory() ? filesUnder(path) : [path]
  })
}

/** Every difference between skills/<name> and plugin/skills/<name>, as readable lines. */
export function pluginSkillDrift(root = defaultRoot) {
  const drift = []
  const names = pluginSkills(root)
  const pluginSkillsDir = join(root, 'plugin', 'skills')
  const shipped = existsSync(pluginSkillsDir)
    ? readdirSync(pluginSkillsDir).filter((name) =>
        statSync(join(pluginSkillsDir, name)).isDirectory()
      )
    : []
  for (const name of shipped) {
    if (!names.includes(name)) drift.push(`plugin/skills/${name}: not a plugin skill`)
  }
  for (const name of names) {
    const source = join(root, 'skills', name)
    const copy = join(pluginSkillsDir, name)
    if (!existsSync(source)) {
      drift.push(`skills/${name}: missing`)
      continue
    }
    const sourceFiles = filesUnder(source).map((file) => relative(source, file))
    const copyFiles = filesUnder(copy).map((file) => relative(copy, file))
    for (const file of sourceFiles) {
      if (!copyFiles.includes(file)) {
        drift.push(`plugin/skills/${name}/${file}: missing`)
      } else if (!readFileSync(join(source, file)).equals(readFileSync(join(copy, file)))) {
        drift.push(`plugin/skills/${name}/${file}: differs from skills/${name}/${file}`)
      }
    }
    for (const file of copyFiles) {
      if (!sourceFiles.includes(file)) drift.push(`plugin/skills/${name}/${file}: not in skills/`)
    }
  }
  return drift
}

/** Replace plugin/skills/ with fresh copies of the plugin skills. */
export function syncPluginSkills(root = defaultRoot) {
  const pluginSkillsDir = join(root, 'plugin', 'skills')
  rmSync(pluginSkillsDir, { recursive: true, force: true })
  for (const name of pluginSkills(root)) {
    cpSync(join(root, 'skills', name), join(pluginSkillsDir, name), { recursive: true })
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv.includes('--check')) {
    const drift = pluginSkillDrift()
    if (drift.length > 0) {
      console.error(`plugin/skills drifted from skills/:\n${drift.join('\n')}`)
      console.error('Run: node scripts/sync-plugin-skills.mjs')
      process.exit(1)
    }
    console.log('plugin/skills matches skills/')
  } else {
    syncPluginSkills()
    console.log(`plugin/skills synced: ${pluginSkills().join(', ')}`)
  }
}
