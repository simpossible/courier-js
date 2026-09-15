import { encodeRequest, decodeResponse, RESPONSE_CODE_OK } from './codec.js';
import { CourierError, timeoutError, transportError } from './errors.js';
import { requestTopic, responseTopic, directRequestTopic } from './topic.js';

function uint8ToBytes(data: Uint8Array): Uint8Array {
  return new Uint8Array(data);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyMqttClient = any;

export interface MqttConnectFn {
  (url: string, opts: Record<string, unknown>): AnyMqttClient;
}

function loadMqttConnect(): MqttConnectFn {
  if (typeof window !== 'undefined' && (window as unknown as Record<string, unknown>).mqtt) {
    const m = (window as unknown as Record<string, { connect?: MqttConnectFn; default?: { connect?: MqttConnectFn } }>).mqtt;
    const fn = m.connect ?? m.default?.connect;
    if (!fn) throw new Error('courier/rpc: mqtt.connect not found in window.mqtt');
    return fn;
  }
  // eslint-disable-next-line no-eval
  const m = eval('require("mqtt")'); // eslint-disable-line @typescript-eslint/no-require-imports
  const fn = m.connect ?? m.default?.connect;
  if (!fn) throw new Error('courier/rpc: mqtt.connect not found');
  return fn;
}

let _connectFn: MqttConnectFn | null = null;

export function __setMqttConnect(fn: MqttConnectFn): void {
  _connectFn = fn;
}

function mqttConnect(url: string, opts: Record<string, unknown>): AnyMqttClient {
  const fn = _connectFn ?? loadMqttConnect();
  return fn(url, opts);
}

export interface CallOptions {
  targetDeviceId?: string;
}

export interface CourierClientOptions {
  broker: string;
  clientId: string;
  username?: string;
  password?: string;
  timeout?: number;
  retryCount?: number;
  retryInterval?: number;
  retryBackoff?: number;
  keepAlive?: number;
  cleanSession?: boolean;
  qos?: 0 | 1 | 2;
}

interface PendingCall {
  resolve: (payload: Uint8Array) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

type EventHandler = (() => void) | ((err: Error) => void);

function newRequestId(): Uint8Array {
  const id = new Uint8Array(16);
  crypto.getRandomValues(id);
  return id;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export class CourierClient {
  readonly clientId: string;
  private readonly broker: string;
  private readonly timeout: number;
  private readonly retryCount: number;
  private readonly retryInterval: number;
  private readonly retryBackoff: number;
  private readonly keepAlive: number;
  private readonly cleanSession: boolean;
  private readonly qos: 0 | 1 | 2;
  private readonly username?: string;
  private readonly password?: string;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private mqttClient: any = null;
  private pending = new Map<string, PendingCall>();
  private handlers = new Map<string, Set<EventHandler>>();
  private closed = false;

  constructor(options: CourierClientOptions) {
    this.broker = options.broker;
    this.clientId = options.clientId;
    this.username = options.username;
    this.password = options.password;
    this.timeout = options.timeout ?? 10000;
    this.retryCount = options.retryCount ?? 0;
    this.retryInterval = options.retryInterval ?? 1000;
    this.retryBackoff = options.retryBackoff ?? 1.5;
    this.keepAlive = options.keepAlive ?? 60;
    this.cleanSession = options.cleanSession ?? true;
    this.qos = options.qos ?? 0;
  }

  async connect(): Promise<void> {
    if (this.closed) throw new Error('courier/rpc: client closed');
    if (this.mqttClient) return;

    const opts: Record<string, unknown> = {
      clientId: this.clientId,
      protocolVersion: 5,
      keepalive: this.keepAlive,
      clean: this.cleanSession,
      resubscribe: true,
      reconnectPeriod: 5000,
    };
    if (this.username !== undefined) opts.username = this.username;
    if (this.password !== undefined) opts.password = this.password;

    return new Promise<void>((resolve, reject) => {
      const client = mqttConnect(this.broker, opts);
      this.mqttClient = client;

      client.on('error', (err: Error) => {
        this.emit('error', err);
      });

      client.on('close', () => {
        this.emit('disconnected');
      });

      client.on('reconnect', () => {
        this.emit('connected');
      });

      const respTopic = responseTopic(this.clientId);

      client.on('connect', () => {
        client.subscribe(respTopic, { qos: this.qos }, (err?: Error) => {
          if (err) {
            reject(transportError(`subscribe failed: ${err.message}`));
            return;
          }
          this.emit('connected');
          resolve();
        });
      });

      client.on('message', (_topic: string, message: Uint8Array) => {
        this.handleMessage(message);
      });
    });
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const [, call] of this.pending) {
      clearTimeout(call.timer);
      call.reject(new Error('courier/rpc: client closed'));
    }
    this.pending.clear();

    if (this.mqttClient) {
      const client = this.mqttClient;
      this.mqttClient = null;
      return new Promise((resolve) => {
        client.end(true, {}, () => resolve());
      });
    }
  }

  async call(serviceName: string, cmd: number, payload: Uint8Array, options: CallOptions = {}): Promise<Uint8Array> {
    if (this.closed) throw new Error('courier/rpc: client closed');
    if (!this.mqttClient || !this.mqttClient.connected) {
      throw new Error('courier/rpc: not connected');
    }

    const requestId = newRequestId();
    const requestHex = toHex(requestId);
    const reqTopic = options.targetDeviceId === undefined
      ? requestTopic(serviceName)
      : directRequestTopic(serviceName, options.targetDeviceId);
    const frame = encodeRequest(cmd, requestId, null, payload);

    return new Promise<Uint8Array>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestHex);
        reject(timeoutError(this.timeout));
      }, this.timeout);

      this.pending.set(requestHex, { resolve, reject, timer });

      const doPublish = (): void => {
        if (!this.mqttClient) return;
        const msg = uint8ToBytes(frame);
        this.mqttClient.publish(reqTopic, msg, {
          qos: this.qos,
          properties: { userProperties: { client_id: this.clientId } },
        }, (err?: Error) => {
          if (err) {
            this.pending.delete(requestHex);
            clearTimeout(timer);
            reject(transportError(`publish failed: ${err.message}`));
          }
        });
      };

      doPublish();

      if (this.retryCount > 0) {
        let attempts = 0;
        let interval = this.retryInterval;
        const retryTimer = setInterval(() => {
          if (!this.pending.has(requestHex)) {
            clearInterval(retryTimer);
            return;
          }
          if (++attempts >= this.retryCount) {
            clearInterval(retryTimer);
            return;
          }
          if (this.mqttClient && this.mqttClient.connected) {
            this.mqttClient.publish(reqTopic, uint8ToBytes(frame), {
              qos: this.qos,
              properties: { userProperties: { client_id: this.clientId } },
            });
          }
          interval = Math.round(interval * this.retryBackoff);
        }, this.retryInterval);
      }
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getMqttClient(): any {
    return this.mqttClient;
  }

  on(event: 'connected', handler: () => void): void;
  on(event: 'disconnected', handler: () => void): void;
  on(event: 'error', handler: (err: Error) => void): void;
  on(event: string, handler: EventHandler): void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler);
  }

  private emit(event: 'connected'): void;
  private emit(event: 'disconnected'): void;
  private emit(event: 'error', err: Error): void;
  private emit(event: string, ...args: unknown[]): void {
    const set = this.handlers.get(event);
    if (set) {
      for (const handler of set) {
        try {
          (handler as (...a: unknown[]) => void)(...args);
        } catch {
          // swallow handler errors
        }
      }
    }
  }

  private handleMessage(data: Uint8Array): void {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const raw: any = data;
      let bytes: Uint8Array;
      if (data instanceof Uint8Array) {
        bytes = data;
      } else if (raw instanceof ArrayBuffer) {
        bytes = new Uint8Array(raw);
      } else if (raw?.buffer instanceof ArrayBuffer) {
        bytes = new Uint8Array(raw.buffer, raw.byteOffset ?? 0, raw.length ?? raw.byteLength);
      } else {
        bytes = new Uint8Array(raw);
      }

      const resp = decodeResponse(bytes);
      const requestHex = toHex(resp.requestId);

      const call = this.pending.get(requestHex);
      if (!call) return;

      this.pending.delete(requestHex);
      clearTimeout(call.timer);

      if (resp.code !== RESPONSE_CODE_OK) {
        const msg = new TextDecoder().decode(resp.payload);
        call.reject(new CourierError(resp.code, msg));
      } else {
        call.resolve(resp.payload);
      }
    } catch {
      // malformed response frame, ignore
    }
  }
}
