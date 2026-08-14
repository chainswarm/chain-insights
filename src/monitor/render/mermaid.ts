// src/monitor/render/mermaid.ts
// Case seed-set diagram (spec req 3, case-tracking shape): the monitored
// addresses, drawn as a bounded flowchart. Pure over the case document — no
// trace edges exist in the reduced monitor.
import type { MonitorCase } from '../cases.js'

export const DEFAULT_MERMAID_MAX_NODES = 30

/** Address shown in a node: first 8 + … + last 6 chars for long addresses;
 *  strips characters Mermaid treats as syntax. Exported for tests. */
export function mermaidNodeText(address: string): string {
  const safe = address.replace(/["|[\]{}<>`]/g, '')
  return safe.length <= 16 ? safe : safe.slice(0, 8) + '…' + safe.slice(-6)
}

/** flowchart LR of the case's seed set, bounded to maxNodes seeds. Every seed
 *  gets the `seed` class. Returns the full fenced block content WITHOUT the
 *  ```mermaid fence. */
export function buildMermaidFlow(
  monitorCase: MonitorCase,
  maxNodes: number = DEFAULT_MERMAID_MAX_NODES,
): string {
  const kept = monitorCase.seeds.slice(0, maxNodes)
  const lines = ['flowchart LR']
  kept.forEach((address, i) => {
    lines.push(`  a${i}["${mermaidNodeText(address)}"]`)
  })
  lines.push('  classDef seed fill:#fde68a,stroke:#b45309')
  if (kept.length > 0) {
    lines.push(`  class ${kept.map((_, i) => `a${i}`).join(',')} seed`)
  }
  return lines.join('\n')
}