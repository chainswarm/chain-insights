// Detection checkpoint store (rbmk#462). Each CIA detector keeps a per-network
// checkpoint in the workspace so an incremental (`--since-checkpoint`) scan
// covers only (last, now]. A missing/unreadable checkpoint means "scan from
// genesis" (full window). The checkpoint advances ONLY after a findings
// document is durably written, so a crash never skips a window.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

export interface DetectionCheckpoint {
  detector: string
  network: string
  last_block_timestamp: number
  last_scanned_at_timestamp: number
}

function checkpointDir(workspaceRoot: string): string {
  return path.join(workspaceRoot, '.chain-insights', 'detectors')
}

function checkpointPath(workspaceRoot: string, detector: string, network: string): string {
  return path.join(checkpointDir(workspaceRoot), `${detector}.${network}.checkpoint.json`)
}

// Returns last_block_timestamp = 0 (scan-from-genesis) when the checkpoint
// is absent or unreadable — never throws for a first run.
export async function readCheckpoint(
  workspaceRoot: string,
  detector: string,
  network: string,
): Promise<DetectionCheckpoint> {
  const file = checkpointPath(workspaceRoot, detector, network)
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8')) as Partial<DetectionCheckpoint>
    return {
      detector,
      network,
      last_block_timestamp: Number(parsed.last_block_timestamp) || 0,
      last_scanned_at_timestamp: Number(parsed.last_scanned_at_timestamp) || 0,
    }
  } catch {
    return { detector, network, last_block_timestamp: 0, last_scanned_at_timestamp: 0 }
  }
}

// Durably writes the advanced checkpoint. Call ONLY after the findings document
// for this window has been written.
export async function writeCheckpoint(
  workspaceRoot: string,
  checkpoint: DetectionCheckpoint,
): Promise<void> {
  await mkdir(checkpointDir(workspaceRoot), { recursive: true })
  await writeFile(
    checkpointPath(workspaceRoot, checkpoint.detector, checkpoint.network),
    JSON.stringify(checkpoint, null, 2) + '\n',
    'utf8',
  )
}
