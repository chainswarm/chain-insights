import { createHash } from 'node:crypto'
import { lstat, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

export function safeSlug(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
  return slug || 'case-export'
}

export function safeFilename(value: string): string {
  const parsed = path.parse(value)
  const name = safeSlug(parsed.name)
  const ext = parsed.ext.toLowerCase().replace(/[^.a-z0-9]/g, '')
  return `${name}${ext || '.md'}`
}

export function assertInsideDirectory(root: string, candidate: string): void {
  const resolvedRoot = path.resolve(root)
  const resolvedCandidate = path.resolve(candidate)
  const relative = path.relative(resolvedRoot, resolvedCandidate)
  if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) return
  throw new Error(`Refusing to write outside export directory: ${candidate}`)
}

export async function assertNoSymlink(filePath: string): Promise<void> {
  try {
    const stat = await lstat(filePath)
    if (stat.isSymbolicLink()) throw new Error(`Refusing to write through symlink: ${filePath}`)
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return
    throw err
  }
}

export async function writePrivateFile(
  root: string,
  relativePath: string,
  content: string,
): Promise<{ path: string; sha256: string; bytes: number }> {
  const filePath = path.join(root, relativePath)
  assertInsideDirectory(root, filePath)
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 })
  await assertNoSymlink(filePath)
  await writeFile(filePath, content, { mode: 0o600 })
  const bytes = Buffer.byteLength(content, 'utf8')
  const sha256 = createHash('sha256').update(content).digest('hex')
  return { path: relativePath, sha256, bytes }
}
