import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CourierClient, __setMqttConnect } from '../src/client.js';
import { CourierError } from '../src/errors.js';
import { RESPONSE_CODE_OK } from '../src/codec.js';

type MqttPublishCallback = (err?: Error) => void;

interface MockMqttClient {
  connected: boolean;
  on: ReturnType<typeof vi.fn>;
  subscribe: ReturnType<typeof vi.fn>;
  publish: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
  _trigger: (event: string, ...args: unknown[]) => void;
  _subCallback: (topic: string, data: Buffer) => void;
}

function createMockMqtt(): MockMqttClient {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();

  const mock: MockMqttClient = {
    connected: true,
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      let set = listeners.get(event);
      if (!set) {
        set = new Set();
        listeners.set(event, set);
      }
      set.add(handler);
    }),
    subscribe: vi.fn((_topic: string, _opts: unknown, callback: (err?: Error) => void) => {
      callback();
    }),
    publish: vi.fn((_topic: string, _msg: unknown, _opts: unknown, callback?: MqttPublishCallback) => {
      if (callback) callback();
    }),
    end: vi.fn((_force: boolean, _opts: unknown, callback: () => void) => {
      mock.connected = false;
      callback();
    }),
    _trigger(event: string, ...args: unknown[]) {
      const set = listeners.get(event);
      if (set) for (const h of set) h(...args);
    },
    _subCallback(topic: string, data: Buffer) {
      const set = listeners.get('message');
      if (set) for (const h of set) h(topic, data);
    },
  };

  return mock;
}

let lastMock: MockMqttClient;

function setupClient(opts?: Record<string, unknown>): { client: CourierClient; mock: MockMqttClient } {
  const mock = createMockMqtt();
  lastMock = mock;

  __setMqttConnect((_url: string, _opts: Record<string, unknown>) => mock);

  const client = new CourierClient({
    broker: 'ws://localhost:8083/mqtt',
    clientId: 'test-client',
    timeout: 500,
    ...opts,
  });

  return { client, mock };
}

function buildResponseFrame(requestId: Uint8Array, code: number, payload: Uint8Array): Buffer {
  const length = 22 + payload.length;
  const buf = Buffer.alloc(length);
  buf.writeUInt32BE(length, 0);
  buf.set(requestId, 4);
  buf.writeUInt16BE(code, 20);
  buf.set(payload, 22);
  return buf;
}

describe('CourierClient', () => {
  afterEach(() => {
    __setMqttConnect(null as unknown as never);
  });

  it('connects and subscribes to response topic', async () => {
    const { client, mock } = setupClient();
    const connectPromise = client.connect();
    mock._trigger('connect', {});
    await connectPromise;

    expect(mock.subscribe).toHaveBeenCalledWith('mrpc/response/test-client', expect.any(Object), expect.any(Function));
  });

  it('makes a successful RPC call', async () => {
    const { client, mock } = setupClient();
    const connectPromise = client.connect();
    mock._trigger('connect', {});
    await connectPromise;

    let publishedFrame: Uint8Array | null = null;
    mock.publish = vi.fn((_topic: string, msg: Buffer, _opts: unknown, cb?: MqttPublishCallback) => {
      publishedFrame = new Uint8Array(msg.buffer, msg.byteOffset, msg.byteLength);
      if (cb) cb();
    });

    const callPromise = client.call('TestService', 1001, new Uint8Array([0x01]));
    await new Promise((r) => setTimeout(r, 10));

    expect(publishedFrame).not.toBeNull();

    const requestId = publishedFrame!.slice(10, 26);
    const responsePayload = new Uint8Array([0x02, 0x03]);
    const responseFrame = buildResponseFrame(requestId, RESPONSE_CODE_OK, responsePayload);
    mock._subCallback('mrpc/response/test-client', responseFrame);

    const result = await callPromise;
    expect(Array.from(result)).toEqual(Array.from(responsePayload));
  });

  it('throws CourierError on non-zero response code', async () => {
    const { client, mock } = setupClient();
    const connectPromise = client.connect();
    mock._trigger('connect', {});
    await connectPromise;

    let publishedFrame: Uint8Array | null = null;
    mock.publish = vi.fn((_topic: string, msg: Buffer, _opts: unknown, cb?: MqttPublishCallback) => {
      publishedFrame = new Uint8Array(msg.buffer, msg.byteOffset, msg.byteLength);
      if (cb) cb();
    });

    const callPromise = client.call('TestService', 1001, new Uint8Array(0));
    await new Promise((r) => setTimeout(r, 10));

    const requestId = publishedFrame!.slice(10, 26);
    const errMsg = new TextEncoder().encode('not found');
    const responseFrame = buildResponseFrame(requestId, 404, errMsg);
    mock._subCallback('mrpc/response/test-client', responseFrame);

    try {
      await callPromise;
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(CourierError);
      expect((err as CourierError).code).toBe(404);
      expect((err as Error).message).toContain('code=404');
    }
  });

  it('throws timeout error when no response arrives', async () => {
    const { client, mock } = setupClient({ timeout: 100 });
    const connectPromise = client.connect();
    mock._trigger('connect', {});
    await connectPromise;

    mock.publish = vi.fn((_topic: string, _msg: unknown, _opts: unknown, cb?: MqttPublishCallback) => {
      if (cb) cb();
    });

    await expect(client.call('TestService', 1001, new Uint8Array(0)))
      .rejects.toThrow('timed out');
  });

  it('throws error when calling before connect', async () => {
    const { client } = setupClient();
    await expect(client.call('TestService', 1, new Uint8Array(0)))
      .rejects.toThrow('not connected');
  });

  it('throws error when calling after close', async () => {
    const { client, mock } = setupClient();
    const connectPromise = client.connect();
    mock._trigger('connect', {});
    await connectPromise;
    await client.close();

    await expect(client.call('TestService', 1, new Uint8Array(0)))
      .rejects.toThrow('client closed');
  });

  it('close rejects all pending calls', async () => {
    const { client, mock } = setupClient({ timeout: 5000 });
    const connectPromise = client.connect();
    mock._trigger('connect', {});
    await connectPromise;

    mock.publish = vi.fn((_topic: string, _msg: unknown, _opts: unknown, cb?: MqttPublishCallback) => {
      if (cb) cb();
    });

    const callPromise = client.call('TestService', 1001, new Uint8Array(0));
    await new Promise((r) => setTimeout(r, 10));

    await client.close();
    await expect(callPromise).rejects.toThrow('client closed');
  });

  it('publishes to the correct request topic', async () => {
    const { client, mock } = setupClient();
    const connectPromise = client.connect();
    mock._trigger('connect', {});
    await connectPromise;

    mock.publish = vi.fn((_topic: string, _msg: unknown, _opts: unknown, cb?: MqttPublishCallback) => {
      if (cb) cb();
    });

    const callPromise = client.call('ChatService', 1001, new Uint8Array(0));
    await new Promise((r) => setTimeout(r, 10));

    expect(mock.publish).toHaveBeenCalledWith('mrpc/request/ChatService', expect.any(Uint8Array), expect.any(Object), expect.any(Function));

    const callFrame = mock.publish.mock.calls[0][1] as Uint8Array;
    const requestId = callFrame.slice(10, 26);
    const resp = buildResponseFrame(requestId, 0, new Uint8Array(0));
    mock._subCallback('mrpc/response/test-client', resp);
    await callPromise;
  });

  it('ignores response with unknown requestId', async () => {
    const { client, mock } = setupClient({ timeout: 200 });
    const connectPromise = client.connect();
    mock._trigger('connect', {});
    await connectPromise;

    mock.publish = vi.fn((_topic: string, _msg: unknown, _opts: unknown, cb?: MqttPublishCallback) => {
      if (cb) cb();
    });

    const callPromise = client.call('TestService', 1001, new Uint8Array(0));
    await new Promise((r) => setTimeout(r, 10));

    const wrongId = new Uint8Array(16).fill(0xff);
    const resp = buildResponseFrame(wrongId, 0, new Uint8Array(0));
    mock._subCallback('mrpc/response/test-client', resp);

    await expect(callPromise).rejects.toThrow('timed out');
  });
});

 it('routes a call to the requested device', async () => {
    const { client, mock } = setupClient();
    const connected = client.connect();
    mock._trigger('connect', {});
    await connected;
    const result = client.call('Status', 1, new Uint8Array(), { targetDeviceId: 'device-b' });
    const [topic, frame] = mock.publish.mock.calls[0];
    expect(topic).toBe('mrpc/request/Status/device/device-b');
    mock._subCallback('mrpc/response/test-client', buildResponseFrame(frame.slice(10, 26), RESPONSE_CODE_OK, new Uint8Array([7])));
    expect(Array.from(await result)).toEqual([7]);
    await expect(client.call('Status', 1, new Uint8Array(), { targetDeviceId: '+' })).rejects.toThrow('device ID');
    await client.close();
 });
