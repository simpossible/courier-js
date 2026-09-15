# @simpossible/courier

JavaScript/TypeScript Courier RPC client library, wire-compatible with the Go [courier](https://github.com/simpossible/courier) framework.

Courier is a lightweight RPC framework built on MQTT + Protobuf with a custom binary frame protocol. This library lets JavaScript applications (browser or Node.js) communicate with Go courier servers.

## Install

```bash
npm install @simpossible/courier
```

## Quick Start

```typescript
import { CourierClient } from '@simpossible/courier';

const client = new CourierClient({
  broker: 'ws://localhost:8083/mqtt',  // MQTT broker (WebSocket for browser, mqtt:// for Node)
  clientId: 'my-app-client',           // Must match server-side identity
  timeout: 10000,
});

await client.connect();

// Send an RPC call (cmd=1001, payload is protobuf-encoded)
const response = await client.call('ChatService', 1001, protobufPayload);
await client.close();
```

## API

### CourierClient

```typescript
const client = new CourierClient(options);
```

#### Options

| Option | Type | Default | Description |
|---|---|---|---|
| `broker` | `string` | required | MQTT broker URL (`ws://`, `wss://`, `mqtt://`) |
| `clientId` | `string` | required | MQTT ClientID, used for response routing |
| `username` | `string` | - | MQTT auth username |
| `password` | `string` | - | MQTT auth password |
| `timeout` | `number` | `10000` | Request timeout in ms |
| `retryCount` | `number` | `0` | Number of retries (0 = no retry) |
| `retryInterval` | `number` | `1000` | Initial retry interval in ms |
| `retryBackoff` | `number` | `1.5` | Retry backoff multiplier |
| `keepAlive` | `number` | `60` | MQTT keep-alive in seconds |
| `cleanSession` | `boolean` | `true` | MQTT clean session |
| `qos` | `0 \| 1 \| 2` | `0` | MQTT QoS level |

#### Methods

- **`connect(): Promise<void>`** — Connect to broker and subscribe to response topic
- **`call(serviceName, cmd, payload): Promise<Uint8Array>`** — Send RPC request and wait for response
- **`close(): Promise<void>`** — Disconnect and reject all pending requests
- **`getMqttClient(): MqttClient | null`** — Access underlying MQTT client for event subscriptions

#### Events

```typescript
client.on('connected', () => { /* ... */ });
client.on('disconnected', () => { /* ... */ });
client.on('error', (err) => { /* ... */ });
```

### Errors

```typescript
import { CourierError } from '@simpossible/courier';

// Thrown when server returns non-zero code
// err.code = server error code
// err.message = "courier/rpc: code=XXX msg=..."
```

Predefined error codes:
- `408` — Request timeout
- `499` — Request canceled
- `503` — Transport error

## Code Generation

Use `protoc-gen-courier-js` to generate typed client classes from `.proto` files:

```bash
npx protoc-gen-courier-js chat.proto --pb-import ./chat.pb --out chat.courier.ts
```

Your `.proto` file must annotate each RPC method with a `cmd` number:

```protobuf
import "courier/options.proto";

service ChatService {
  rpc Login(LoginRequest) returns (LoginResponse) {
    option (courier.cmd) = 1001;
  }
}
```

This generates:

```typescript
export class ChatServiceClient {
  constructor(client: CourierClient) { /* ... */ }
  async login(req: LoginRequest): Promise<LoginResponse> { /* ... */ }
}
```

## Protocol

The binary frame protocol is identical to Go courier:

**Request Frame** (client → server):
```
[4B length BE][2B version=1][4B cmd BE][16B requestID][2B extLen][ext...][payload...]
```

**Response Frame** (server → client):
```
[4B length BE][16B requestID][2B code BE][payload...]
```

**MQTT Topics**:
- Request: `mrpc/request/{serviceName}`
- Response: `mrpc/response/{clientId}`
- Event: `mrpc/event/{serviceName}/{eventName}`

## Development

```bash
npm install
npm run build      # TypeScript → dist/
npm test           # vitest run
npm run test:watch # vitest --watch
```

## License

MIT

### 精确调用设备

```typescript
const response = await client.call('DeviceService', cmd, payload, {
  targetDeviceId: 'device-001',
});
```

省略选项保持原有共享分发。服务端需配置同一设备 ID（Go：`rpc.WithServerDeviceID`），并订阅 `mrpc/request/DeviceService/device/device-001`。目标离线按原有超时处理，重试不回退到共享入口。设备 ID 必须是非空 topic 段，不能包含 `/`、`+`、`#` 或 NUL。重新生成的 Protobuf 客户端方法也支持第二个 `options` 参数。
