const TOPIC_PREFIX = 'mrpc';

export function requestTopic(serviceName: string): string {
  return `${TOPIC_PREFIX}/request/${serviceName}`;
}

export function responseTopic(clientId: string): string {
  return `${TOPIC_PREFIX}/response/${clientId}`;
}

export function eventTopic(serviceName: string, eventName: string): string {
  return `${TOPIC_PREFIX}/event/${serviceName}/${eventName}`;
}

export function directRequestTopic(serviceName: string, deviceId: string): string {
  if (!deviceId || /[\/+#\u0000]/u.test(deviceId)) {
    throw new Error('courier/rpc: device ID must be a non-empty MQTT topic segment without /, +, # or NUL');
  }
  return `${TOPIC_PREFIX}/request/${serviceName}/device/${deviceId}`;
}
