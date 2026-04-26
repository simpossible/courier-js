const TIMEOUT_CODE = 408;
const CANCEL_CODE = 499;
const TRANSPORT_CODE = 503;

export class CourierError extends Error {
  readonly code: number;

  constructor(code: number, message: string) {
    super(`courier/rpc: code=${code} msg=${message}`);
    this.name = 'CourierError';
    this.code = code;
  }
}

export function timeoutError(timeout: number): CourierError {
  return new CourierError(TIMEOUT_CODE, `request timed out after ${timeout}ms`);
}

export function cancelError(): CourierError {
  return new CourierError(CANCEL_CODE, 'request canceled');
}

export function transportError(reason: string): CourierError {
  return new CourierError(TRANSPORT_CODE, reason);
}
