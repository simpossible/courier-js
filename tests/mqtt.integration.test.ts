import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect } from 'mqtt';
import { CourierClient, __setMqttConnect } from '../src/client.js';
import { Compression } from '../src/compression.js';
import { decodeRequest, decodeResponse } from '../src/codec.js';

const url = process.env.COURIER_MQTT_URL;
const service = process.env.COURIER_INTEGRATION_SERVICE!;

describe.skipIf(!url)('real MQTT interoperability', () => {
  let client: CourierClient;
  const sent: Uint8Array[] = [];
  const received: Uint8Array[] = [];
  let echoes = 0;
  beforeAll(async () => {
    if (!service) throw new Error('COURIER_INTEGRATION_SERVICE is required');
    // Use the actual mqtt.js socket client, with no mock transport.
    __setMqttConnect((broker, options) => connect(broker, options));
    client = new CourierClient({ broker: url!, clientId: `js-integration-${Date.now()}`, timeout: 1000 });
    await client.connect();
    client.getMqttClient().on('packetsend', (packet: { cmd: string; payload: Uint8Array }) => {
      if (packet.cmd === 'publish') sent.push(new Uint8Array(packet.payload));
    });
    client.getMqttClient().on('packetreceive', (packet: { cmd: string; payload: Uint8Array }) => {
      if (packet.cmd === 'publish') received.push(new Uint8Array(packet.payload));
    });
  });
  afterAll(async () => { await client?.close(); });

  async function count(device: string): Promise<number> {
    return JSON.parse(new TextDecoder().decode(await client.call(service, 4, new Uint8Array(), { targetDeviceId: device })));
  }
  for (const compression of [undefined, Compression.None, Compression.GZIP]) {
    it(`roundtrips payload and empty message with compression=${compression}`, async () => {
      for (const payload of [new TextEncoder().encode('设备状态 online;'.repeat(4096)), new Uint8Array()]) {
        const result = await client.call(service, 1, payload, { targetDeviceId: 'device-b', compression });
        expect(Array.from(result)).toEqual(Array.from(payload));
        echoes++;
        const reqBytes = sent.at(-1)!;
        const respBytes = received.at(-1)!;
        const req = decodeRequest(reqBytes);
        const resp = decodeResponse(respBytes, compression === undefined ? 1 : 2);
        expect(req.compression).toBe(compression ?? Compression.None);
        expect(resp.compression).toBe(compression ?? Compression.None);
        expect(resp.requestId).toEqual(req.requestId);
        if (compression === Compression.GZIP && payload.length) {
          expect(reqBytes.length).toBeLessThan(payload.length);
          expect(respBytes.length).toBeLessThan(payload.length);
        }
      }
    });
  }
  it('routes to each exact device and delivers shared calls once', async () => {
    for (const device of ['device-a', 'device-b']) {
      expect(new TextDecoder().decode(await client.call(service, 2, new Uint8Array(), {
        targetDeviceId: device, compression: Compression.GZIP,
      }))).toBe(device);
    }
    expect(await count('device-a')).toBe(0);
    expect(await count('device-b')).toBe(echoes);
    for (let i = 0; i < 5; i++) await client.call(service, 1, new Uint8Array([i]), { compression: Compression.GZIP });
    expect(await count('device-a') + await count('device-b')).toBe(echoes + 5);
  });
  it('matches concurrent legacy and gzip responses', async () => {
    await Promise.all(Array.from({ length: 12 }, async (_, i) => {
      const payload = new TextEncoder().encode(`parallel-${i}`);
      const result = await client.call(service, 1, payload, { targetDeviceId: 'device-b', compression: i % 2 ? undefined : Compression.GZIP });
      expect(Array.from(result)).toEqual(Array.from(payload));
    }));
    expect(await count('device-a') + await count('device-b')).toBe(echoes + 17);
  });
  it('returns the compressed uint32 remote error', async () => {
    await expect(client.call(service, 3, new Uint8Array(), { targetDeviceId: 'device-b', compression: Compression.GZIP }))
      .rejects.toMatchObject({ code: 70000 });
  });
  it('times out offline without falling back', async () => {
    const before = await count('device-a') + await count('device-b');
    await expect(client.call(service, 1, new Uint8Array(), { targetDeviceId: 'missing', compression: Compression.GZIP }))
      .rejects.toMatchObject({ code: 408 });
    expect(await count('device-a') + await count('device-b')).toBe(before);
  });
});
