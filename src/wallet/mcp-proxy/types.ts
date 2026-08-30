export interface WalletData {
  address: string
  privateKey: string // hex-encoded, encrypted at rest
  createdAt: string
}

export interface BalanceResult {
  address: string
  balance: string
  currency: string
  network: string
}
