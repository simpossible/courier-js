import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { gzip } from 'pako';
import { Compression, MAX_PAYLOAD_SIZE, decompressPayload } from '../src/compression.js';
import { encodeRequest, decodeRequest, encodeResponse, decodeResponse } from '../src/codec.js';

describe('v2 compression', () => {
  for (const algorithm of [Compression.None, Compression.GZIP]) {
    for (const text of ['', 'hello 世界', 'status: online;'.repeat(1000)]) {
      it(`roundtrips algorithm ${algorithm}, ${text.length} characters`, () => {
        const id = new Uint8Array(16).fill(42);
        const payload = new TextEncoder().encode(text);
        const extensions = new Uint8Array([7, 8]);
        const reqBytes = encodeRequest(123, id, extensions, payload, algorithm);
        expect(reqBytes[28]).toBe(algorithm);
        const req = decodeRequest(reqBytes);
        expect(req.version).toBe(2);
        expect(req.compression).toBe(algorithm);
        expect(req.requestId).toEqual(id);
        expect(req.extensions).toEqual(extensions);
        expect(req.payload).toEqual(payload);
        const responseBytes = encodeResponse(id, 70000, payload, algorithm);
        expect(responseBytes[24]).toBe(algorithm);
        const resp = decodeResponse(responseBytes, 2);
        expect(resp.compression).toBe(algorithm);
        expect(resp.code).toBe(70000);
        expect(resp.payload).toEqual(payload);
      });
    }
  }
  it('rejects unknown algorithms, bad CRC, truncation, and invalid lengths', () => {
    const req = encodeRequest(1, new Uint8Array(16), null, new Uint8Array([1,2]), Compression.GZIP);
    for (const mutate of [
      (b: Uint8Array) => { b[28] = 99; return b; },
      (b: Uint8Array) => { b[b.length - 8] ^= 255; return b; },
      (b: Uint8Array) => { b = b.slice(0, -1); new DataView(b.buffer).setUint32(0, b.length); return b; },
      (b: Uint8Array) => { b[5] = 99; return b; },
      (b: Uint8Array) => { b[26] = 255; return b; },
      (b: Uint8Array) => { new DataView(b.buffer).setUint32(0, 28); return b; },
    ]) expect(() => decodeRequest(mutate(req.slice()))).toThrow();
    expect(() => encodeRequest(1, new Uint8Array(16), null, new Uint8Array(), 99)).toThrow();
    expect(() => decodeResponse(encodeResponse(new Uint8Array(16), 0, new Uint8Array()), 99)).toThrow();
  });
  it('bounds output during decompression and rejects oversized inputs', () => {
    const tooLarge = new Uint8Array(MAX_PAYLOAD_SIZE + 1);
    expect(() => encodeRequest(1, new Uint8Array(16), null, tooLarge, Compression.GZIP)).toThrow('limit');
    expect(() => decompressPayload(gzip(tooLarge), Compression.GZIP)).toThrow('limit');
  });
});

const vectors = JSON.parse(readFileSync(new URL('./fixtures/compression.json', import.meta.url), 'utf8'));
for (const v of vectors) {
  it(`decodes ${v.producer}/${v.mode} wire fixtures`, () => {
    const req = decodeRequest(Buffer.from(v.request, 'base64'));
    expect(req.version).toBe(v.version);
    expect(req.compression).toBe(v.compression);
    expect(req.cmd).toBe(70001);
    expect(Array.from(req.extensions)).toEqual([170, 187]);
    expect(Buffer.from(req.payload).toString('base64')).toBe(v.payload);
    const resp = decodeResponse(Buffer.from(v.response, 'base64'), v.version);
    expect(resp.requestId).toEqual(req.requestId);
    expect(resp.compression).toBe(v.compression);
    expect(resp.code).toBe(70000);
    expect(Buffer.from(resp.payload).toString('base64')).toBe(v.payload);
  });
}
