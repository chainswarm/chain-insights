import neo4j, { type Driver } from 'neo4j-driver'

type MemgraphConfig = {
  uri: string
  user?: string
  password?: string
}

const NETWORK_URIS: Record<string, string | undefined> = {
  bittensor: process.env.MEMGRAPH_URI_BITTENSOR ?? process.env.MEMGRAPH_URI,
  bittensor_evm: process.env.MEMGRAPH_URI_BITTENSOR ?? process.env.MEMGRAPH_URI,
  base: process.env.MEMGRAPH_URI_BASE,
  ethereum: process.env.MEMGRAPH_URI_ETHEREUM,
}

export function memgraphConfigFor(network: string): MemgraphConfig {
  const uri = NETWORK_URIS[network] ?? (network === 'bittensor' ? 'bolt://127.0.0.1:7687' : undefined)
  if (!uri) throw new Error(`Unsupported or unconfigured network: ${network}`)
  return {
    uri,
    user: process.env.MEMGRAPH_USER || undefined,
    password: process.env.MEMGRAPH_PASSWORD || undefined,
  }
}

export function createDriver(config: MemgraphConfig): Driver {
  const auth = config.user ? neo4j.auth.basic(config.user, config.password ?? '') : undefined
  return neo4j.driver(config.uri, auth, {
    encrypted: 'ENCRYPTION_OFF',
    maxConnectionPoolSize: Number(process.env.MEMGRAPH_POOL_SIZE ?? 32),
  })
}

const driverCache = new Map<string, Driver>()

export function getCachedDriver(network: string): Driver {
  const config = memgraphConfigFor(network)
  const cached = driverCache.get(config.uri)
  if (cached) return cached
  const driver = createDriver(config)
  driverCache.set(config.uri, driver)
  return driver
}

export async function closeCachedDrivers(): Promise<void> {
  const drivers = [...driverCache.values()]
  driverCache.clear()
  await Promise.all(drivers.map((driver) => driver.close()))
}

export async function runReadQuery(driver: Driver, query: string): Promise<Record<string, unknown>[]> {
  const session = driver.session({ defaultAccessMode: neo4j.session.READ })
  try {
    const result = await session.run(query)
    return result.records.map((record) => {
      const row: Record<string, unknown> = {}
      for (const key of record.keys) {
        row[String(key)] = serializeNeo4jValue(record.get(key))
      }
      return row
    })
  } finally {
    await session.close()
  }
}

export function serializeNeo4jValue(value: unknown): unknown {
  if (value == null) return null
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value === 'bigint') return Number(value)
  if (neo4j.isInt(value)) return value.inSafeRange() ? value.toNumber() : value.toString()
  if (Array.isArray(value)) return value.map((item) => serializeNeo4jValue(item))

  if (typeof value === 'object') {
    const candidate = value as Record<string, unknown>

    if ('labels' in candidate && 'elementId' in candidate && 'properties' in candidate) {
      return {
        id: candidate.elementId,
        ...serializeObject(candidate.properties as Record<string, unknown>),
      }
    }

    if ('type' in candidate && 'elementId' in candidate && 'properties' in candidate) {
      const start = candidate.start as Record<string, unknown> | undefined
      const end = candidate.end as Record<string, unknown> | undefined
      const props = serializeObject(candidate.properties as Record<string, unknown>)
      return {
        ...props,
        id: props.id ?? candidate.elementId,
        type: candidate.type,
        from: start?.properties && typeof start.properties === 'object'
          ? (start.properties as Record<string, unknown>).address ?? null
          : null,
        to: end?.properties && typeof end.properties === 'object'
          ? (end.properties as Record<string, unknown>).address ?? null
          : null,
      }
    }

    if ('segments' in candidate && Array.isArray(candidate.segments)) {
      const nodes: unknown[] = []
      const edges: unknown[] = []
      for (const segment of candidate.segments as Array<Record<string, unknown>>) {
        if (segment.start) nodes.push(serializeNeo4jValue(segment.start))
        if (segment.relationship) edges.push(serializeNeo4jValue(segment.relationship))
        if (segment.end) nodes.push(serializeNeo4jValue(segment.end))
      }
      return { nodes, edges }
    }

    return serializeObject(candidate)
  }

  return String(value)
}

function serializeObject(input: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    output[key] = serializeNeo4jValue(value)
  }
  return output
}
