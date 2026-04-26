# CLAUDE.md — courier-js

## Project

JavaScript/TypeScript Courier RPC client library, wire-compatible with Go `github.com/simpossible/courier`.

## Build & Test

```bash
npm install
npm run build      # tsc → dist/
npm test           # vitest run
npm run test:watch # vitest --watch
```

## Protocol Constants

| Constant | Value |
|---|---|
| PROTOCOL_VERSION | 1 |
| REQUEST_HEADER_LEN | 28 |
| RESPONSE_HEADER_LEN | 22 |
| RESPONSE_CODE_OK | 0 |
| Topic prefix | `mrpc` |

## Topic Format

- Request: `mrpc/request/{serviceName}`
- Response: `mrpc/response/{clientID}`
- Event: `mrpc/event/{serviceName}/{eventName}`

## Binary Frame Layout

### Request (28+ bytes)
`[4B length][2B version][4B cmd][16B requestID][2B extLen][ext…][payload…]`

### Response (22+ bytes)
`[4B length][16B requestID][2B code][payload…]`

## Code Style

- All binary ops use `Uint8Array` + `DataView` (no Buffer)
- Big-endian byte order
- No comments unless WHY is non-obvious
- TypeScript strict mode
