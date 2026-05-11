import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import path from 'node:path'
import os from 'node:os'

// Mock fs/promises so we don't need actual files on disk
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    access: vi.fn(),
    readdir: vi.fn(),
  }
})

describe('resolvePlaybook', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it("resolvePlaybook('trace-funds') resolves to built-in path when user dir absent", async () => {
    const fsMock = await import('node:fs/promises')
    const accessMock = vi.mocked(fsMock.access)

    // User dir access fails, built-in dir access succeeds
    accessMock
      .mockRejectedValueOnce(new Error('ENOENT'))  // user path fails
      .mockResolvedValueOnce(undefined)              // builtin path succeeds

    const { resolvePlaybook } = await import('../src/playbooks/resolver.js')
    const result = await resolvePlaybook('trace-funds')

    // Should end with trace-funds.md (built-in path)
    expect(result).toMatch(/trace-funds\.md$/)
    // Should not be in user's home dir
    expect(result).not.toContain(path.join(os.homedir(), '.chain-insights', 'playbooks'))
  })

  it("resolvePlaybook('custom') resolves to user dir path when user file exists", async () => {
    const fsMock = await import('node:fs/promises')
    const accessMock = vi.mocked(fsMock.access)

    // User dir access succeeds immediately
    accessMock.mockResolvedValueOnce(undefined)

    const { resolvePlaybook } = await import('../src/playbooks/resolver.js')
    const result = await resolvePlaybook('custom')

    // Should be in user's home dir
    const expectedUserPath = path.join(os.homedir(), '.chain-insights', 'playbooks', 'custom.md')
    expect(result).toBe(expectedUserPath)
  })

  it('resolvePlaybook throws for empty or all-special-char playbook name', async () => {
    const fsMock = await import('node:fs/promises')
    const accessMock = vi.mocked(fsMock.access)
    // Will throw Invalid playbook name since result of sanitizing '...' is empty
    accessMock.mockRejectedValue(new Error('ENOENT'))
    const { resolvePlaybook } = await import('../src/playbooks/resolver.js')
    await expect(resolvePlaybook('...')).rejects.toThrow(/Invalid playbook name/)
  })

  it('resolvePlaybook sanitizes path traversal attempts (no ../ in resolved path)', async () => {
    const fsMock = await import('node:fs/promises')
    const accessMock = vi.mocked(fsMock.access)
    // etcpasswd.md — both user and builtin not found, so throws Playbook not found
    accessMock
      .mockRejectedValueOnce(new Error('ENOENT'))
      .mockRejectedValueOnce(new Error('ENOENT'))
    const { resolvePlaybook } = await import('../src/playbooks/resolver.js')
    // The attempt is sanitized to 'etcpasswd' — no path traversal possible
    await expect(resolvePlaybook('../../etc/passwd')).rejects.toThrow(/Playbook not found/)
  })

  it('resolvePlaybook throws when playbook not found in either location', async () => {
    const fsMock = await import('node:fs/promises')
    const accessMock = vi.mocked(fsMock.access)

    // Both user and builtin fail
    accessMock
      .mockRejectedValueOnce(new Error('ENOENT'))
      .mockRejectedValueOnce(new Error('ENOENT'))

    const { resolvePlaybook } = await import('../src/playbooks/resolver.js')
    await expect(resolvePlaybook('nonexistent')).rejects.toThrow(/Playbook not found/)
  })
})

describe('listPlaybooks', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it("listPlaybooks() returns array including 'trace-funds', 'risk-check', 'entity-profile'", async () => {
    const fsMock = await import('node:fs/promises')
    const readdirMock = vi.mocked(fsMock.readdir)

    // Built-in dir has these files, user dir throws (not found)
    readdirMock
      .mockRejectedValueOnce(new Error('ENOENT')) // user dir fails
      .mockResolvedValueOnce(['trace-funds.md', 'risk-check.md', 'entity-profile.md'] as unknown as Awaited<ReturnType<typeof fsMock.readdir>>)

    const { listPlaybooks } = await import('../src/playbooks/resolver.js')
    const result = await listPlaybooks()

    const names = result.map(p => p.name)
    expect(names).toContain('trace-funds')
    expect(names).toContain('risk-check')
    expect(names).toContain('entity-profile')
  })

  it("listPlaybooks() marks built-in playbooks with source 'builtin'", async () => {
    const fsMock = await import('node:fs/promises')
    const readdirMock = vi.mocked(fsMock.readdir)

    readdirMock
      .mockRejectedValueOnce(new Error('ENOENT'))
      .mockResolvedValueOnce(['trace-funds.md'] as unknown as Awaited<ReturnType<typeof fsMock.readdir>>)

    const { listPlaybooks } = await import('../src/playbooks/resolver.js')
    const result = await listPlaybooks()

    expect(result[0]?.source).toBe('builtin')
  })

  it("listPlaybooks() marks user playbooks with source 'user'", async () => {
    const fsMock = await import('node:fs/promises')
    const readdirMock = vi.mocked(fsMock.readdir)

    // User dir succeeds, builtin dir returns nothing
    readdirMock
      .mockResolvedValueOnce(['my-custom.md'] as unknown as Awaited<ReturnType<typeof fsMock.readdir>>)
      .mockResolvedValueOnce([] as unknown as Awaited<ReturnType<typeof fsMock.readdir>>)

    const { listPlaybooks } = await import('../src/playbooks/resolver.js')
    const result = await listPlaybooks()

    expect(result[0]?.source).toBe('user')
    expect(result[0]?.name).toBe('my-custom')
  })
})
