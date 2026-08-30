#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'

export function parseSemver(version) {
  const match =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/.exec(
      version
    )
  if (!match) {
    throw new Error(`Invalid semver version: ${version}`)
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ?? '',
    build: match[5] ?? '',
  }
}

export function compareSemver(a, b) {
  const left = typeof a === 'string' ? parseSemver(a) : a
  const right = typeof b === 'string' ? parseSemver(b) : b
  for (const key of ['major', 'minor', 'patch']) {
    if (left[key] > right[key]) return 1
    if (left[key] < right[key]) return -1
  }
  if (left.prerelease === right.prerelease) return 0
  if (!left.prerelease) return 1
  if (!right.prerelease) return -1
  return left.prerelease.localeCompare(right.prerelease)
}

export function changelogHasVersionEntry(changelog, version) {
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`^## \\[?${escaped}\\]?\\b`, 'm').test(changelog)
}

export function packageEntrypointPaths(pkg) {
  const paths = new Set()
  const addPath = (value) => {
    if (typeof value === 'string' && value.startsWith('./')) {
      paths.add(value.slice(2))
    }
  }
  const visit = (value) => {
    if (typeof value === 'string') {
      addPath(value)
      return
    }
    if (!value || typeof value !== 'object') return
    for (const child of Object.values(value)) visit(child)
  }

  addPath(pkg.main)
  addPath(pkg.module)
  visit(pkg.exports)
  return [...paths].sort()
}

export function missingPackageEntrypoints(pkg, exists = existsSync) {
  return packageEntrypointPaths(pkg).filter((path) => !exists(path))
}

export function committedPackageTarballs(trackedFiles) {
  return trackedFiles
    .map((path) => path.trim())
    .filter((path) => path.endsWith('.tgz'))
    .sort()
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trimEnd()
}

function gitOrNull(args) {
  try {
    return git(args)
  } catch {
    return null
  }
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function readBaseFile(baseRef, path) {
  return git(['show', `${baseRef}:${path}`])
}

function ensureBaseRef(baseRef) {
  try {
    git(['cat-file', '-e', `${baseRef}:package.json`])
    return
  } catch {
    // GitHub pull_request checkouts may only have the synthetic merge ref.
  }

  if (!baseRef.startsWith('origin/')) {
    throw new Error(`Base ref is not available locally: ${baseRef}`)
  }

  const branch = baseRef.slice('origin/'.length)
  git(['fetch', '--no-tags', '--depth=1', 'origin', `${branch}:refs/remotes/${baseRef}`])
}

function fileChanged(baseRef, path) {
  const committedDiff =
    gitOrNull(['diff', '--name-only', `${baseRef}...HEAD`]) ??
    git(['diff', '--name-only', baseRef, 'HEAD'])
  const changedFiles = [
    ...committedDiff.split('\n').filter(Boolean),
    ...git(['diff', '--name-only']).split('\n').filter(Boolean),
    ...git(['diff', '--name-only', '--cached']).split('\n').filter(Boolean),
    ...git(['ls-files', '--others', '--exclude-standard']).split('\n').filter(Boolean),
  ]
  return changedFiles.includes(path)
}

function resolveBaseRef() {
  const envBase = process.env.RELEASE_GATE_BASE_REF || process.env.GITHUB_BASE_REF
  if (envBase) {
    return envBase.startsWith('origin/') ? envBase : `origin/${envBase}`
  }
  return 'origin/main'
}

export function runReleaseGate({ baseRef = resolveBaseRef() } = {}) {
  ensureBaseRef(baseRef)

  const pkg = readJson('package.json')
  const lock = readJson('package-lock.json')
  const basePkg = JSON.parse(readBaseFile(baseRef, 'package.json'))

  const version = pkg.version
  parseSemver(version)
  parseSemver(basePkg.version)

  const failures = []

  if (compareSemver(version, basePkg.version) <= 0) {
    failures.push(`package.json version must increase from ${basePkg.version}; got ${version}`)
  }

  if (!fileChanged(baseRef, 'package.json')) {
    failures.push('package.json must be updated with a semver bump')
  }

  if (!fileChanged(baseRef, 'package-lock.json')) {
    failures.push('package-lock.json must be updated with the same version bump')
  }

  if (lock.version !== version) {
    failures.push(
      `package-lock.json top-level version ${lock.version} does not match package.json ${version}`
    )
  }

  if (lock.packages?.['']?.version !== version) {
    failures.push(
      `package-lock.json packages[""].version ${lock.packages?.['']?.version} does not match package.json ${version}`
    )
  }

  const missingEntrypoints = missingPackageEntrypoints(pkg)
  if (missingEntrypoints.length > 0) {
    failures.push(
      `package.json entrypoints are missing from the built package: ${missingEntrypoints.join(', ')}`
    )
  }

  const trackedTarballs = committedPackageTarballs(git(['ls-files', '*.tgz']).split('\n'))
  if (trackedTarballs.length > 0) {
    failures.push(`Committed npm package tarballs are not allowed: ${trackedTarballs.join(', ')}`)
  }

  if (!fileChanged(baseRef, 'CHANGELOG.md')) {
    failures.push('CHANGELOG.md must be updated')
  } else {
    const changelog = readFileSync('CHANGELOG.md', 'utf8')
    if (!changelogHasVersionEntry(changelog, version)) {
      failures.push(
        `CHANGELOG.md must include a heading for version ${version}, for example: ## [${version}] - YYYY-MM-DD`
      )
    }
  }

  if (failures.length > 0) {
    throw new Error(`Release gate failed:\n- ${failures.join('\n- ')}`)
  }

  return {
    baseVersion: basePkg.version,
    version,
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const result = runReleaseGate()
    console.log(`Release gate passed: ${result.baseVersion} -> ${result.version}`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}
