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
[4B length BE][16B requestID][4B code BE][payload...]
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

### GZIP 压缩

```typescript
import { Compression } from '@simpossible/courier';

// 可在 CourierClient 构造选项中设置 compression，或为单次调用设置：
const response = await client.call('DeviceService', cmd, payload, {
  targetDeviceId: 'device-001',
  compression: Compression.GZIP,
});
```

服务端解压后调用处理器，并按相同算法压缩响应。客户端自动解压，返回原始 payload。`Compression.None` 覆盖客户端默认选项，使用不压缩的 v2；完全省略压缩配置保持 v1。生成的 Protobuf 客户端方法也接受该选项。

v2 请求头为 29 字节：在原 header 末尾、extensions 前增加 `Compression`（偏移 28）；响应头为 25 字节：在 4 字节 Code 后增加 `Compression`（偏移 24）。算法 `0=None`、`1=GZIP`。响应版本根据对应请求确定；直接解码 v2 响应使用 `decodeResponse(data, 2)`。原始及解压后 payload 上限为 16 MiB，未知算法和损坏数据会被拒绝。

先升级全部服务端实例，再开启客户端压缩；旧服务端不支持 v2，无自动降级。此次也将 JS 响应 Code 从 uint16 修正为与 Go/Dart 一致的 uint32，早期使用 2 字节 Code 的端点需要升级。

### 本地 MQTT 联调

运行 `npm run test:integration`，自动启动临时 MQTT 5 broker 与两个 Go 服务实例，执行 `tests/mqtt.integration.test.ts`，结束后关闭服务。需要 Python 3、Go、Node/npm，并在 `../courier` 检出 Go 仓库（可用 `COURIER_GO_DIR` 覆盖）。依赖已安装可运行 `npm run test:integration -- --skip-install`。普通 `npm test` 不连接 broker。

测试覆盖三种协议模式、实际压缩帧、并发、设备直达、共享分发、错误响应和离线超时。在 Go 仓库执行 `./scripts/test-integration.sh` 可一次运行全部 SDK。
