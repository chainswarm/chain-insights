import { CaseStore } from './store.js'

export async function resolveCaseSelector(input: string): Promise<string> {
  if (!/^[1-9]\d*$/.test(input)) return input

  const cases = await CaseStore.list()
  const index = Number(input) - 1
  const selected = cases[index]
  if (!selected) {
    throw new Error(`No case numbered ${input}. Run \`cia case list\` to see available cases.`)
  }
  return selected.id
}
