// Detector registry (rbmk#462): the CLI-visible detectors and their scan cores.
// fake-token is a complete batch scanner (assets dimension). mixer is
// candidate-driven — its batch `scan()` returns [] until the candidate-source
// enumeration lands (DEC-15); the interactive aml_mixer_likeness tool drives it
// with candidates. address-poisoning and attack-attribution are registered as
// they land (scaffolded pending morning review, rbmk#462).
import type { DetectorScan } from './runtime.js'
import { fakeTokenDetector } from './detectors/fake-token.js'
import { mixerDetector } from './detectors/mixer.js'

export const DETECTORS: Record<string, DetectorScan> = {
  'fake-token': fakeTokenDetector,
  mixer: mixerDetector,
}

export function resolveDetector(id: string): DetectorScan {
  const d = DETECTORS[id]
  if (!d) {
    throw new Error(`unknown detector "${id}"; available: ${Object.keys(DETECTORS).join(', ')}`)
  }
  return d
}
