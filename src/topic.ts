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
