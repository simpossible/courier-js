import { Compression, compressPayload, decompressPayload } from './compression.js';

export const PROTOCOL_VERSION = 1;
export const REQUEST_HEADER_LEN = 28;
export const RESPONSE_HEADER_LEN = 24;
export const COMPRESSION_PROTOCOL_VERSION = 2;
export const REQUEST_HEADER_LEN_V2 = 29;
export const RESPONSE_HEADER_LEN_V2 = 25;
export const RESPONSE_CODE_OK = 0;

function writeUint32BE(buf: Uint8Array, offset: number, value: number): void {
  const view = new DataView(buf.buffer, buf.byteOffset + offset, 4);
  view.setUint32(0, value, false);
}

function writeUint16BE(buf: Uint8Array, offset: number, value: number): void {
  const view = new DataView(buf.buffer, buf.byteOffset + offset, 2);
  view.setUint16(0, value, false);
}

function readUint32BE(buf: Uint8Array, offset: number): number {
  const view = new DataView(buf.buffer, buf.byteOffset + offset, 4);
  return view.getUint32(0, false);
}

function readUint16BE(buf: Uint8Array, offset: number): number {
  const view = new DataView(buf.buffer, buf.byteOffset + offset, 2);
  return view.getUint16(0, false);
}

export function encodeRequest(
  cmd: number,
  requestId: Uint8Array,
  extensions: Uint8Array | null,
  payload: Uint8Array,
  compression?: Compression,
): Uint8Array {
  const extLen = extensions ? extensions.length : 0;
  if (requestId.length !== 16 || extLen > 65535) throw new Error('courier/codec: invalid request ID or extensions length');
  const version = compression === undefined ? PROTOCOL_VERSION : COMPRESSION_PROTOCOL_VERSION;
  const headerLen = compression === undefined ? REQUEST_HEADER_LEN : REQUEST_HEADER_LEN_V2;
  if (compression !== undefined) payload = compressPayload(payload, compression);
  const length = headerLen + extLen + payload.length;
  const buf = new Uint8Array(length);

  writeUint32BE(buf, 0, length);
  writeUint16BE(buf, 4, version);
  writeUint32BE(buf, 6, cmd);
  buf.set(requestId, 10);
  writeUint16BE(buf, 26, extLen);

  if (compression !== undefined) buf[28] = compression;
  let offset = headerLen;
  if (extLen > 0 && extensions) {
    buf.set(extensions, offset);
    offset += extLen;
  }
  buf.set(payload, offset);

  return buf;
}

export interface ResponseFrame {
  requestId: Uint8Array;
  version: number;
  compression: Compression;
  code: number;
  payload: Uint8Array;
}

// Response version is determined by the originating request, not guessed from payload bytes.
export function decodeResponse(data: Uint8Array, version = PROTOCOL_VERSION): ResponseFrame {
  const headerLen = responseHeaderLength(version);
  const length = validateFrame(data, headerLen);
  const compression = version === COMPRESSION_PROTOCOL_VERSION ? data[24] : Compression.None;
  let payload = data.slice(headerLen, length);
  if (version === COMPRESSION_PROTOCOL_VERSION) payload = new Uint8Array(decompressPayload(payload, compression));
  return { requestId: data.slice(4, 20), version, compression, code: readUint32BE(data, 20), payload };
}

export function encodeResponse(requestId: Uint8Array, code: number, payload: Uint8Array, compression?: Compression): Uint8Array {
  if (requestId.length !== 16) throw new Error('courier/codec: invalid request ID');
  const headerLen = compression === undefined ? RESPONSE_HEADER_LEN : RESPONSE_HEADER_LEN_V2;
  if (compression !== undefined) payload = compressPayload(payload, compression);
  const frame = new Uint8Array(headerLen + payload.length);
  writeUint32BE(frame, 0, frame.length);
  frame.set(requestId, 4);
  writeUint32BE(frame, 20, code);
  if (compression !== undefined) frame[24] = compression;
  frame.set(payload, headerLen);
  return frame;
}

export function decodeRequest(data: Uint8Array): {
  length: number;
  version: number;
  compression: Compression;
  cmd: number;
  requestId: Uint8Array;
  extensionsLen: number;
  extensions: Uint8Array;
  payload: Uint8Array;
} {
  validateFrame(data, REQUEST_HEADER_LEN);
  const version = readUint16BE(data, 4);
  if (version !== PROTOCOL_VERSION && version !== COMPRESSION_PROTOCOL_VERSION) {
    throw new Error('courier/codec: unsupported protocol version');
  }
  const headerLen = version === PROTOCOL_VERSION ? REQUEST_HEADER_LEN : REQUEST_HEADER_LEN_V2;
  const length = validateFrame(data, headerLen);
  const extensionsLen = readUint16BE(data, 26);
  const payloadOffset = headerLen + extensionsLen;
  if (payloadOffset > length) throw new Error('courier/codec: invalid extensions length');
  const compression = version === COMPRESSION_PROTOCOL_VERSION ? data[28] : Compression.None;
  let payload = data.slice(payloadOffset, length);
  if (version === COMPRESSION_PROTOCOL_VERSION) payload = new Uint8Array(decompressPayload(payload, compression));
  return {
    length, version, compression, cmd: readUint32BE(data, 6), requestId: data.slice(10, 26),
    extensionsLen, extensions: data.slice(headerLen, payloadOffset), payload,
  };
}

function responseHeaderLength(version: number): number {
  if (version === PROTOCOL_VERSION) return RESPONSE_HEADER_LEN;
  if (version === COMPRESSION_PROTOCOL_VERSION) return RESPONSE_HEADER_LEN_V2;
  throw new Error('courier/codec: unsupported protocol version');
}

function validateFrame(data: Uint8Array, headerLen: number): number {
  if (data.length < headerLen) throw new Error('courier/codec: frame too short');
  const length = readUint32BE(data, 0);
  if (length < headerLen) throw new Error('courier/codec: invalid frame length');
  if (length > data.length) throw new Error('courier/codec: truncated frame');
  return length;
}
