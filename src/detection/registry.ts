// Detector registry (rbmk#462): the CLI-visible detectors and their scan cores.
// All four relocated detectors are batch-runnable: fake-token over the assets
// dimension, mixer over degree-qualified candidates, address-poisoning over a
// bounded recent facts window, attack-attribution over seed-labeled downstream
// walks.
import type { DetectorScan } from './runtime.js'
import { fakeTokenDetector } from './detectors/fake-token.js'
import { mixerDetector } from './detectors/mixer.js'
import { addressPoisoningDetector } from './detectors/address-poisoning.js'
import { attackAttributionDetector } from './detectors/attack-attribution.js'

export const DETECTORS: Record<string, DetectorScan> = {
  'fake-token': fakeTokenDetector,
  mixer: mixerDetector,
  'address-poisoning': addressPoisoningDetector,
  'attack-attribution': attackAttributionDetector,
}

export function resolveDetector(id: string): DetectorScan {
  const d = DETECTORS[id]
  if (!d) {
    throw new Error(`unknown detector "${id}"; available: ${Object.keys(DETECTORS).join(', ')}`)
  }
  return d
}

// Deprecation (label-cutover spec req 3): these three detections moved into
// the platform backend (Spec A of the systemic-detection epic). The local
// implementations stay in the repo as the shadow-comparison reference until
// the epic's cutover completes; every run warns so nobody builds on a lane
// that is going away. Mixer stays a monitor-run detector and never warns.
export const DEPRECATED_DETECTORS: ReadonlySet<string> = new Set([
  'address-poisoning',
  'fake-token',
  'attack-attribution',
])

export function deprecationWarning(id: string): string | undefined {
  if (!DEPRECATED_DETECTORS.has(id)) return undefined
  return (
    `detector "${id}" is deprecated: this detection now runs on the platform backend and ` +
    `surfaces as address labels (watchlist_label alerts on watched addresses, and ` +
    `aml_address_risk enrichment). The local scan remains only as the cutover shadow ` +
    `reference. See docs/monitoring.md.`
  )
}
