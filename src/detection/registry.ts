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
