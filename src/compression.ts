import { gzip, Inflate } from 'pako';

export enum Compression {
  None = 0,
  GZIP = 1,
}
export const MAX_PAYLOAD_SIZE = 16 * 1024 * 1024;

export function compressPayload(payload: Uint8Array, algorithm: Compression): Uint8Array {
  validateAlgorithm(algorithm);
  if (payload.length > MAX_PAYLOAD_SIZE) throw new Error('courier/codec: payload exceeds 16 MiB limit');
  return algorithm === Compression.GZIP ? gzip(payload) : payload;
}

export function decompressPayload(payload: Uint8Array, algorithm: Compression): Uint8Array {
  validateAlgorithm(algorithm);
  if (algorithm === Compression.None) {
    if (payload.length > MAX_PAYLOAD_SIZE) throw new Error('courier/codec: payload exceeds 16 MiB limit');
    return payload;
  }
  const chunks: Uint8Array[] = [];
  let length = 0;
  // GZIP only; do not silently accept raw DEFLATE or zlib streams.
  const decoder = new Inflate({ windowBits: 31, chunkSize: 65536 });
  decoder.onData = (chunk) => {
    length += chunk.length;
    if (length > MAX_PAYLOAD_SIZE) throw new Error('courier/codec: payload exceeds 16 MiB limit');
    chunks.push(chunk);
  };
  decoder.push(payload, true);
  if (decoder.err || !decoder.ended) throw new Error(`courier/codec: invalid gzip payload: ${decoder.msg}`);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}

function validateAlgorithm(algorithm: Compression): void {
  if (algorithm !== Compression.None && algorithm !== Compression.GZIP) {
    throw new Error('courier/codec: unsupported compression algorithm');
  }
}
