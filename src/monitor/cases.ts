// src/monitor/cases.ts (minimal seed — Task 5 completes this module)
export interface MonitorCase { case_id: string; type: 'stolen-funds' | 'scam-topology'; network: string; seeds: string[]; status: 'open' | 'closed'; created_at_ms: number; closed_at_ms?: number; note?: string }
export async function listCases(_workspaceRoot: string, _opts?: { openOnly?: boolean }): Promise<MonitorCase[]> { return [] }
