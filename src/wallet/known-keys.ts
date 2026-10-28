import { privateKeyToAccount } from 'viem/accounts'
import type { Hex } from 'viem'

/**
 * The text every money path shows when the local wallet's key is public.
 * A public key is one anyone can look up: a small number such as 1, a key of
 * one repeated byte, or a key of a well-known test mnemonic. Bots watch those
 * addresses on every EVM chain and take anything sent there within seconds.
 */
export const PUBLIC_KEY_WALLET_TEXT =
  "This wallet's key is public. Anything sent to it is taken within seconds. Run `cia wallet create --replace`."

// Below 2^128 a key is a counter, not a random draw: 1, 2, 16 and the like.
// A random 256-bit key lands there with odds of 2^-128.
const SMALL_KEY_LIMIT = 1n << 128n
// A random key holds about 31 distinct bytes. Fewer than 8 is a pattern,
// such as one byte repeated.
const MIN_DISTINCT_BYTES = 8

// The public test accounts, by address only. A key never sits in this file.
// - The 20 accounts of the 'test test ... junk' mnemonic that Anvil and
//   Hardhat print at start.
// - The 10 accounts of the Ganache deterministic mnemonic.
const PUBLIC_TEST_ADDRESSES = new Set(
  [
    '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
    '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
    '0x90F79bf6EB2c4f870365E785982E1f101E93b906',
    '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65',
    '0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc',
    '0x976EA74026E726554dB657fA54763abd0C3a0aa9',
    '0x14dC79964da2C08b23698B3D3cc7Ca32193d9955',
    '0x23618e81E3f5cdF7f54C3d65f7FBc0aBf5B21E8f',
    '0xa0Ee7A142d267C1f36714E4a8F75612F20a79720',
    '0xBcd4042DE499D14e55001CcbB24a551F3b954096',
    '0x71bE63f3384f5fb98995898A86B02Fb2426c5788',
    '0xFABB0ac9d68B0B445fB7357272Ff202C5651694a',
    '0x1CBd3b2770909D4e10f157cABC84C7264073C9Ec',
    '0xdF3e18d64BC6A983f673Ab319CCaE4f1a57C7097',
    '0xcd3B766CCDd6AE721141F452C550Ca635964ce71',
    '0x2546BcD3c84621e976D8185a91A922aE77ECEc30',
    '0xbDA5747bFD65F08deb54cb465eB87D40e51B197E',
    '0xdD2FD4581271e230360230F9337D5c0430Bf44C0',
    '0x8626f6940E2eb28930eFb4CeF49B2d1F2C9C1199',
    '0x90F8bf6A479f320ead074411a4B0e7944Ea8c9C1',
    '0xFFcf8FDEE72ac11b5c542428B35EEF5769C409f0',
    '0x22d491Bde2303f2f43325b2108D26f1eAbA1e32b',
    '0xE11BA2b4D45Eaed5996Cd0823791E0C93114882d',
    '0xd03ea8624C8C5987235048901fB614fDcA89b117',
    '0x95cED938F7991cd0dFcb48F0a06a40FA1aF46EBC',
    '0x3E5e9111Ae8eB78Fe1CC3bb8915d5D461F3Ef9A9',
    '0x28a8746e75304c0780E011BEd21C72cD78cd535E',
    '0xACa94ef8bD5ffEE41947b4585a84BdA5a3d3DA6E',
    '0x1dF62f291b2E969fB0849d99D9Ce41e2F137006e',
  ].map((address) => address.toLowerCase())
)

/** Why a key is public, or null when it is not. */
export function publicKeyReason(privateKey: string): string | null {
  if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) return null
  const value = BigInt(privateKey)
  if (value < SMALL_KEY_LIMIT) return 'the key is a small number'
  const bytes = new Set<string>()
  for (let i = 2; i < privateKey.length; i += 2) bytes.add(privateKey.slice(i, i + 2).toLowerCase())
  if (bytes.size < MIN_DISTINCT_BYTES) return 'the key repeats a few bytes'
  let address: string
  try {
    address = privateKeyToAccount(privateKey as Hex).address.toLowerCase()
  } catch {
    return null
  }
  if (PUBLIC_TEST_ADDRESSES.has(address)) return 'the key belongs to a public test mnemonic'
  return null
}

export function isPrivateKeyPublic(privateKey: string): boolean {
  return publicKeyReason(privateKey) !== null
}

/** Throws PUBLIC_KEY_WALLET_TEXT, with the reason, when the key is public. */
export function assertPrivateKeyNotPublic(privateKey: string): void {
  const reason = publicKeyReason(privateKey)
  if (reason) {
    throw new Error(`Refused: ${reason}. Anything sent to its address is taken within seconds. Generate a new key with \`cia wallet create\`.`)
  }
}
