import { describe, it, expect } from 'vitest';
import {
  encodeRequest,
  decodeResponse,
  decodeRequest,
  PROTOCOL_VERSION,
  REQUEST_HEADER_LEN,
  RESPONSE_HEADER_LEN,
  RESPONSE_CODE_OK,
} from '../src/codec.js';

describe('encodeRequest', () => {
  it('encodes a request frame without extensions', () => {
    const cmd = 10001;
    const requestId = new Uint8Array(16).fill(0xab);
    const payload = new Uint8Array([0x01, 0x02, 0x03]);

    const frame = encodeRequest(cmd, requestId, null, payload);

    // Total length = 28 (header) + 0 (ext) + 3 (payload) = 31
    expect(frame.length).toBe(31);

    // Length field (offset 0, 4B BE)
    expect(frame[0]).toBe(0);
    expect(frame[1]).toBe(0);
    expect(frame[2]).toBe(0);
    expect(frame[3]).toBe(31);

    // Version (offset 4, 2B BE) = 1
    expect(frame[4]).toBe(0);
    expect(frame[5]).toBe(1);

    // Cmd (offset 6, 4B BE) = 10001
    expect(frame[6]).toBe(0);
    expect(frame[7]).toBe(0);
    expect(frame[8]).toBe(0x27);
    expect(frame[9]).toBe(0x11);

    // RequestID (offset 10, 16B)
    expect(frame.slice(10, 26)).toEqual(requestId);

    // ExtensionsLen (offset 26, 2B BE) = 0
    expect(frame[26]).toBe(0);
    expect(frame[27]).toBe(0);

    // Payload
    expect(frame.slice(28)).toEqual(payload);
  });

  it('encodes a request frame with extensions', () => {
    const cmd = 100;
    const requestId = new Uint8Array(16).fill(0xcd);
    const extensions = new Uint8Array([0xaa, 0xbb]);
    const payload = new Uint8Array([0x04, 0x05]);

    const frame = encodeRequest(cmd, requestId, extensions, payload);

    // Total = 28 + 2 + 2 = 32
    expect(frame.length).toBe(32);

    // Length
    expect(frame[3]).toBe(32);

    // ExtensionsLen
    expect(frame[26]).toBe(0);
    expect(frame[27]).toBe(2);

    // Extensions at offset 28
    expect(frame[28]).toBe(0xaa);
    expect(frame[29]).toBe(0xbb);

    // Payload at offset 30
    expect(frame[30]).toBe(0x04);
    expect(frame[31]).toBe(0x05);
  });

  it('encodes with empty payload', () => {
    const cmd = 1;
    const requestId = new Uint8Array(16);
    const payload = new Uint8Array(0);

    const frame = encodeRequest(cmd, requestId, null, payload);

    expect(frame.length).toBe(REQUEST_HEADER_LEN);
    expect(frame[3]).toBe(REQUEST_HEADER_LEN);
  });
});

describe('decodeResponse', () => {
  it('decodes a success response', () => {
    const requestId = new Uint8Array(16).fill(0x11);
    const payload = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);

    const length = RESPONSE_HEADER_LEN + payload.length;
    const frame = new Uint8Array(length);
    const view = new DataView(frame.buffer);
    view.setUint32(0, length, false);
    frame.set(requestId, 4);
    view.setUint32(20, RESPONSE_CODE_OK, false);
    frame.set(payload, 24);

    const resp = decodeResponse(frame);

    expect(Array.from(resp.requestId)).toEqual(Array.from(requestId));
    expect(resp.code).toBe(0);
    expect(Array.from(resp.payload)).toEqual(Array.from(payload));
  });

  it('decodes an error response', () => {
    const requestId = new Uint8Array(16).fill(0x22);
    const errMsg = new TextEncoder().encode('something went wrong');

    const length = RESPONSE_HEADER_LEN + errMsg.length;
    const frame = new Uint8Array(length);
    const view = new DataView(frame.buffer);
    view.setUint32(0, length, false);
    frame.set(requestId, 4);
    view.setUint32(20, 500, false);
    frame.set(errMsg, 24);

    const resp = decodeResponse(frame);

    expect(resp.code).toBe(500);
    expect(new TextDecoder().decode(resp.payload)).toBe('something went wrong');
  });

  it('throws on too-short frame', () => {
    expect(() => decodeResponse(new Uint8Array(10))).toThrow('too short');
  });

  it('handles response with empty payload', () => {
    const requestId = new Uint8Array(16);
    const frame = new Uint8Array(RESPONSE_HEADER_LEN);
    const view = new DataView(frame.buffer);
    view.setUint32(0, RESPONSE_HEADER_LEN, false);
    frame.set(requestId, 4);
    view.setUint32(20, 0, false);

    const resp = decodeResponse(frame);
    expect(resp.payload.length).toBe(0);
  });
});

describe('roundtrip', () => {
  it('encode → decodeRequest produces original values', () => {
    const cmd = 1001;
    const requestId = new Uint8Array(16);
    crypto.getRandomValues(requestId);
    const extensions = new Uint8Array([0x01, 0x02, 0x03]);
    const payload = new Uint8Array([0xaa, 0xbb, 0xcc, 0xdd]);

    const encoded = encodeRequest(cmd, requestId, extensions, payload);
    const decoded = decodeRequest(encoded);

    expect(decoded.length).toBe(encoded.length);
    expect(decoded.version).toBe(PROTOCOL_VERSION);
    expect(decoded.cmd).toBe(cmd);
    expect(decoded.requestId).toEqual(requestId);
    expect(decoded.extensionsLen).toBe(3);
    expect(decoded.extensions).toEqual(extensions);
    expect(decoded.payload).toEqual(payload);
  });

  it('encode → decodeRequest without extensions', () => {
    const cmd = 9999;
    const requestId = new Uint8Array(16);
    crypto.getRandomValues(requestId);
    const payload = new Uint8Array(64);
    crypto.getRandomValues(payload);

    const encoded = encodeRequest(cmd, requestId, null, payload);
    const decoded = decodeRequest(encoded);

    expect(decoded.cmd).toBe(cmd);
    expect(decoded.extensionsLen).toBe(0);
    expect(decoded.extensions.length).toBe(0);
    expect(decoded.payload).toEqual(payload);
  });
});

describe('decodeRequest edge cases', () => {
  it('throws on frame too short', () => {
    expect(() => decodeRequest(new Uint8Array(10))).toThrow('too short');
  });

  it('throws on truncated frame', () => {
    const encoded = encodeRequest(1, new Uint8Array(16), null, new Uint8Array(10));
    const truncated = encoded.slice(0, 30);
    expect(() => decodeRequest(truncated)).toThrow('truncated');
  });
});
