import { keccak256, encodePacked, encodeAbiParameters, parseAbiParameters, recoverAddress, type Address } from 'viem';
import type { EIP3009Authorization, EIP3009Signature } from './types.js';

const EIP3009_TYPEHASH = keccak256(
  encodePacked(
    ['string'],
    ['TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)']
  )
);

/**
 * Create EIP-712 domain separator for a token contract
 */
export function createDomainSeparator(
  tokenAddress: Address,
  tokenName: string,
  tokenVersion: string,
  chainId: number
): `0x${string}` {
  const domainTypeHash = keccak256(
    encodePacked(
      ['string'],
      ['EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)']
    )
  );

  return keccak256(
    encodeAbiParameters(
      parseAbiParameters('bytes32, bytes32, bytes32, uint256, address'),
      [
        domainTypeHash,
        keccak256(encodePacked(['string'], [tokenName])),
        keccak256(encodePacked(['string'], [tokenVersion])),
        BigInt(chainId),
        tokenAddress,
      ]
    )
  );
}

export async function verifyTransferAuthorization(
  authorization: EIP3009Authorization,
  signature: EIP3009Signature,
  tokenAddress: Address,
  tokenName: string,
  tokenVersion: string,
  chainId: number
): Promise<Address | null> {
  try {
    if (signature.v !== 27 && signature.v !== 28) {
      console.error('[EIP3009] Invalid signature v value:', signature.v);
      return null;
    }

    const structHash = keccak256(
      encodeAbiParameters(
        parseAbiParameters('bytes32, address, address, uint256, uint256, uint256, bytes32'),
        [
          EIP3009_TYPEHASH,
          authorization.from,
          authorization.to,
          BigInt(authorization.value),
          BigInt(authorization.validAfter),
          BigInt(authorization.validBefore),
          authorization.nonce,
        ]
      )
    );

    const domainSeparator = createDomainSeparator(tokenAddress, tokenName, tokenVersion, chainId);

    const digest = keccak256(
      encodePacked(['string', 'bytes32', 'bytes32'], ['\x19\x01', domainSeparator, structHash])
    );

    const recoveredAddress = await recoverAddressFromDigest(digest, signature);

    return recoveredAddress;
  } catch (error) {
    console.error('[EIP3009] Failed to verify signature:', error);
    return null;
  }
}

async function recoverAddressFromDigest(
  digest: `0x${string}`,
  signature: EIP3009Signature
): Promise<Address | null> {
  try {
    const r = BigInt(signature.r);
    const s = BigInt(signature.s);
    const v = signature.v;

    const secp256k1N = BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141');
    const secp256k1halfN = secp256k1N / 2n;

    if (s > secp256k1halfN) {
      console.error('[EIP3009] Invalid signature - s value too high (malleable signature)');
      return null;
    }

    if (r === 0n || s === 0n) {
      console.error('[EIP3009] Invalid signature - r or s is zero');
      return null;
    }

    const fullSignature = `${signature.r}${signature.s.slice(2)}${v.toString(16).padStart(2, '0')}` as `0x${string}`;
    
    const recoveredAddress = await recoverAddress({
      hash: digest,
      signature: fullSignature,
    });

    return recoveredAddress;
  } catch (error) {
    console.error('[EIP3009] Failed to recover address:', error);
    return null;
  }
}

export function generateNonce(): `0x${string}` {
  const randomBytes = new Uint8Array(32);
  crypto.getRandomValues(randomBytes);
  return `0x${Array.from(randomBytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')}` as `0x${string}`;
}
