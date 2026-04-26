export const PROTOCOL_VERSION = 1;
export const REQUEST_HEADER_LEN = 28;
export const RESPONSE_HEADER_LEN = 22;
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
): Uint8Array {
  const extLen = extensions ? extensions.length : 0;
  const length = REQUEST_HEADER_LEN + extLen + payload.length;
  const buf = new Uint8Array(length);

  writeUint32BE(buf, 0, length);
  writeUint16BE(buf, 4, PROTOCOL_VERSION);
  writeUint32BE(buf, 6, cmd);
  buf.set(requestId, 10);
  writeUint16BE(buf, 26, extLen);

  let offset = REQUEST_HEADER_LEN;
  if (extLen > 0 && extensions) {
    buf.set(extensions, offset);
    offset += extLen;
  }
  buf.set(payload, offset);

  return buf;
}

export interface ResponseFrame {
  requestId: Uint8Array;
  code: number;
  payload: Uint8Array;
}

export function decodeResponse(data: Uint8Array): ResponseFrame {
  if (data.length < RESPONSE_HEADER_LEN) {
    throw new Error(`courier/codec: response frame too short (${data.length} < ${RESPONSE_HEADER_LEN})`);
  }

  const length = readUint32BE(data, 0);
  const requestId = data.slice(4, 20);
  const code = readUint16BE(data, 20);
  const payload = data.slice(22, length);

  return { requestId, code, payload };
}

export function decodeRequest(data: Uint8Array): {
  length: number;
  version: number;
  cmd: number;
  requestId: Uint8Array;
  extensionsLen: number;
  extensions: Uint8Array;
  payload: Uint8Array;
} {
  if (data.length < REQUEST_HEADER_LEN) {
    throw new Error(`courier/codec: request frame too short (${data.length} < ${REQUEST_HEADER_LEN})`);
  }

  const length = readUint32BE(data, 0);
  if (data.length < length) {
    throw new Error(`courier/codec: truncated request frame (have ${data.length}, need ${length})`);
  }

  const version = readUint16BE(data, 4);
  const cmd = readUint32BE(data, 6);
  const requestId = data.slice(10, 26);
  const extensionsLen = readUint16BE(data, 26);

  let extensions = new Uint8Array(0);
  let payloadOffset = REQUEST_HEADER_LEN;
  if (extensionsLen > 0) {
    extensions = data.slice(REQUEST_HEADER_LEN, REQUEST_HEADER_LEN + extensionsLen);
    payloadOffset += extensionsLen;
  }
  const payload = data.slice(payloadOffset, length);

  return { length, version, cmd, requestId, extensionsLen, extensions, payload };
}
