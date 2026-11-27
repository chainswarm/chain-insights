#!/usr/bin/env node
// Writes the npm dist-tag of a release into the package, as channel.json
// {"channel":"<tag>"} at the package root, beside package.json. The publish
// workflow runs it after the build and the tests and before `npm pack`.
//
// The file sits outside dist/ on purpose: npm 10 (the npm of Node 22) runs
// the `prepare` build on `npm pack` even with --ignore-scripts, and that build
// empties dist/ first (tsdown clean: true). A file at the root survives it.
//
// The CLI reads the file at start (src/version.ts): the tag `next` reads the
// staging endpoint, every other tag and a missing file read production.
//
// Usage: node scripts/stamp-release-channel.mjs <dist-tag> [package-dir]
import { existsSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const [tag, packageDir = '.'] = process.argv.slice(2)
if (!tag || !/^[a-z][a-z0-9-]*$/.test(tag)) {
  console.error(
    `stamp-release-channel: a dist-tag like latest or next is required (got ${JSON.stringify(tag ?? '')})`
  )
  process.exit(1)
}
if (!existsSync(path.join(packageDir, 'package.json'))) {
  console.error(`stamp-release-channel: ${packageDir}/package.json is missing`)
  process.exit(1)
}
if (!existsSync(path.join(packageDir, 'dist', 'cli.mjs'))) {
  console.error(`stamp-release-channel: ${packageDir}/dist/cli.mjs is missing; build the package first`)
  process.exit(1)
}
const file = path.join(packageDir, 'channel.json')
writeFileSync(file, JSON.stringify({ channel: tag }) + '\n', 'utf8')
console.log(`${file}: ${JSON.stringify({ channel: tag })}`)
