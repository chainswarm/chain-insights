import type { Hex } from 'viem'
import { generatePrivateKey } from 'viem/accounts'

const ANSI_RESET = '\u001b[0m'
const ANSI_RED_BOLD = '\u001b[1;31m'
const ANSI_YELLOW_BOLD = '\u001b[1;33m'

export interface WalletBackupWarningOptions {
  color?: boolean
  width?: number
}

export function generateWalletPrivateKey(): Hex {
  return generatePrivateKey()
}

export function isWalletBackupConfirmed(answer: string): boolean {
  return answer === 'BACKED UP'
}

function paint(value: string, color: string | undefined): string {
  return color ? `${color}${value}${ANSI_RESET}` : value
}

export function formatWalletBackupWarning(
  privateKey: string,
  options: WalletBackupWarningOptions = {}
): string {
  const color = options.color === true
  const lines = [
    '⚠  BACK UP YOUR PRIVATE KEY NOW  ⚠',
    '',
    'This key controls your payment wallet.',
    'It will not be shown again.',
    '',
    `Private key: ${privateKey}`,
    '',
    'Type BACKED UP to continue:',
  ]
  const contentWidth = Math.max(options.width ?? 60, ...lines.map((line) => line.length))
  const horizontal = '─'.repeat(contentWidth + 2)
  const renderLine = (line: string, lineIndex: number): string => {
    const lineColor =
      lineIndex === 0
        ? ANSI_RED_BOLD
        : line.startsWith('Private key:')
          ? ANSI_YELLOW_BOLD
          : undefined
    return `│ ${paint(line, color ? lineColor : undefined)}${' '.repeat(contentWidth - line.length)} │`
  }
  return [`┌${horizontal}┐`, ...lines.map(renderLine), `└${horizontal}┘`].join('\n')
}
