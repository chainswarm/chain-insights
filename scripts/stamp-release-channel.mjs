#!/usr/bin/env node
// Writes the npm dist-tag of a release into the built package, as
// dist/channel.json {"channel":"<tag>"}. The publish workflow runs it after
// the build and the tests and before `npm pack --ignore-scripts`: a pack that
// ran the `prepare` build would empty dist/ first and drop the file.
//
// The CLI reads the file at start (src/version.ts): the tag `next` reads the
// staging endpoint, every other tag and a missing file read production.
//
// Usage: node scripts/stamp-release-channel.mjs <dist-tag> [dist-dir]
import { existsSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const [tag, distDir = 'dist'] = process.argv.slice(2)
if (!tag || !/^[a-z][a-z0-9-]*$/.test(tag)) {
  console.error(
    `stamp-release-channel: a dist-tag like latest or next is required (got ${JSON.stringify(tag ?? '')})`
  )
  process.exit(1)
}
if (!existsSync(path.join(distDir, 'cli.mjs'))) {
  console.error(`stamp-release-channel: ${distDir}/cli.mjs is missing; build the package first`)
  process.exit(1)
}
const file = path.join(distDir, 'channel.json')
writeFileSync(file, JSON.stringify({ channel: tag }) + '\n', 'utf8')
console.log(`${file}: ${JSON.stringify({ channel: tag })}`)
