/**
 * Serializes broadcasts from the facilitator account within this process.
 *
 * Settlement, merchant forwards, recovery and refunds all send from one EOA, and each send
 * takes its transaction nonce from the RPC's pending count. Two sends that read that count
 * before either is broadcast get the same nonce, and one of them is dropped or replaced.
 * Running each send (nonce read, sign, broadcast) one at a time means every send reads the
 * count after the previous broadcast was accepted. Only the broadcast is queued: waiting for
 * receipts happens outside, so settlements still confirm in parallel.
 *
 * This covers one process. Replicas sharing the key need a nonce allocator of their own.
 */

let tail: Promise<unknown> = Promise.resolve();

export function serializeSend<T>(send: () => Promise<T>): Promise<T> {
  const result = tail.then(() => send());
  tail = result.catch(() => undefined);
  return result;
}
