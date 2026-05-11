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
    readFile: vi.fn(),
  }
})

describe('resolvePlaybook', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it("resolvePlaybook('trace-funds') resolves to builtin sentinel when user dir absent", async () => {
    const fsMock = await import('node:fs/promises')
    const accessMock = vi.mocked(fsMock.access)

    // User dir access fails; built-ins are now in BUILTIN_PLAYBOOKS map (no fs access needed)
    accessMock.mockRejectedValueOnce(new Error('ENOENT'))

    const { resolvePlaybook } = await import('../src/playbooks/resolver.js')
    const result = await resolvePlaybook('trace-funds')

    // Should return the builtin sentinel
    expect(result).toBe('builtin:trace-funds')
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
    // etcpasswd — user dir fails; not in BUILTIN_PLAYBOOKS map → throws Playbook not found
    accessMock.mockRejectedValueOnce(new Error('ENOENT'))
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

    // User dir throws (not found); built-ins come from BUILTIN_PLAYBOOKS map
    readdirMock.mockRejectedValueOnce(new Error('ENOENT'))

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

    // User dir does not exist — built-ins come from BUILTIN_PLAYBOOKS map (not filesystem)
    readdirMock.mockRejectedValueOnce(new Error('ENOENT'))

    const { listPlaybooks } = await import('../src/playbooks/resolver.js')
    const result = await listPlaybooks()

    // Built-ins from BUILTIN_PLAYBOOKS map should all be source 'builtin'
    const builtins = result.filter(p => p.source === 'builtin')
    expect(builtins.length).toBeGreaterThanOrEqual(3)
    expect(builtins.map(p => p.name)).toContain('trace-funds')
  })

  it("listPlaybooks() marks user playbooks with source 'user'", async () => {
    const fsMock = await import('node:fs/promises')
    const readdirMock = vi.mocked(fsMock.readdir)

    // User dir returns a custom playbook (built-ins come from BUILTIN_PLAYBOOKS map)
    readdirMock.mockResolvedValueOnce(['my-custom.md'] as unknown as Awaited<ReturnType<typeof fsMock.readdir>>)

    const { listPlaybooks } = await import('../src/playbooks/resolver.js')
    const result = await listPlaybooks()

    const userPlaybooks = result.filter(p => p.source === 'user')
    expect(userPlaybooks[0]?.source).toBe('user')
    expect(userPlaybooks[0]?.name).toBe('my-custom')
  })
})

describe('resolvePlaybookContent', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('resolvePlaybookContent returns user file content when user file exists', async () => {
    const fsMock = await import('node:fs/promises')
    const readFileMock = vi.mocked(fsMock.readFile)

    // User file exists — readFile returns markdown content
    readFileMock.mockResolvedValueOnce('# User Playbook\n## Step 1\nContent here' as unknown as Buffer)

    const { resolvePlaybookContent } = await import('../src/playbooks/resolver.js')
    const result = await resolvePlaybookContent('my-custom')

    expect(result).toBe('# User Playbook\n## Step 1\nContent here')
    expect(readFileMock).toHaveBeenCalledWith(
      path.join(os.homedir(), '.chain-insights', 'playbooks', 'my-custom.md'),
      'utf8'
    )
  })

  it('resolvePlaybookContent falls back to built-in when user file ENOENT', async () => {
    const fsMock = await import('node:fs/promises')
    const readFileMock = vi.mocked(fsMock.readFile)

    // User file does not exist — fall through to built-in map
    const enoentErr = Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    readFileMock.mockRejectedValueOnce(enoentErr)

    const { resolvePlaybookContent } = await import('../src/playbooks/resolver.js')
    // trace-funds is a known built-in
    const result = await resolvePlaybookContent('trace-funds')

    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
    // Should contain the built-in playbook's frontmatter marker
    expect(result).toContain('trace-funds')
  })

  it('resolvePlaybookContent throws Playbook not found for unknown name after ENOENT', async () => {
    const fsMock = await import('node:fs/promises')
    const readFileMock = vi.mocked(fsMock.readFile)

    // User file does not exist
    const enoentErr = Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    readFileMock.mockRejectedValueOnce(enoentErr)

    const { resolvePlaybookContent } = await import('../src/playbooks/resolver.js')
    await expect(resolvePlaybookContent('nonexistent-playbook')).rejects.toThrow(/Playbook not found/)
  })

  it('resolvePlaybookContent throws Invalid playbook name for empty/special-char names', async () => {
    const { resolvePlaybookContent } = await import('../src/playbooks/resolver.js')
    await expect(resolvePlaybookContent('...')).rejects.toThrow(/Invalid playbook name/)
  })
})
