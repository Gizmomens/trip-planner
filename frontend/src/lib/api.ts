import type { ErrorDetail, TripInput } from '../types';
import { isBootstrap, isLocationsResponse, isTrip } from './response-validation';

export class ApiError extends Error {
  readonly detail: ErrorDetail;
  readonly status: number;

  constructor(detail: ErrorDetail, status = 0) {
    super(detail.message);
    this.name = 'ApiError';
    this.detail = detail;
    this.status = status;
  }
}

function failure(message: string, code: string, status = 0) {
  return new ApiError({ code, message, fields: {}, request_id: '' }, status);
}

async function request<T>(
  path: string,
  isResponse: (value: unknown) => value is T,
  options: RequestInit = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/v1/${path}`, {
      credentials: 'same-origin',
      cache: 'no-store',
      ...options,
      headers: { Accept: 'application/json', ...options.headers },
    });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw failure(
      'We could not reach the planning service. Check that the backend is running, then try again.',
      'network_error',
    );
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw failure(
      'The planning service returned an unreadable response. Please try again.',
      'invalid_response',
      response.status,
    );
  }
  if (!response.ok) {
    const detail = body && typeof body === 'object' && 'error' in body ? body.error : null;
    if (
      detail &&
      typeof detail === 'object' &&
      'message' in detail &&
      typeof detail.message === 'string'
    ) {
      const fields =
        'fields' in detail && detail.fields && typeof detail.fields === 'object'
          ? Object.fromEntries(
              Object.entries(detail.fields).filter(
                (entry): entry is [string, string] => typeof entry[1] === 'string',
              ),
            )
          : {};
      throw new ApiError(
        {
          code:
            'code' in detail && typeof detail.code === 'string' ? detail.code : 'request_failed',
          message: detail.message,
          fields,
          request_id:
            'request_id' in detail && typeof detail.request_id === 'string'
              ? detail.request_id
              : '',
        },
        response.status,
      );
    }
    throw failure(
      'The request could not be completed. Please try again.',
      'request_failed',
      response.status,
    );
  }
  if (!isResponse(body)) {
    throw failure(
      'The planning service returned an incomplete or invalid response. Please try again.',
      'invalid_response',
      response.status,
    );
  }
  return body;
}

export const api = {
  bootstrap: (signal: AbortSignal) => request('bootstrap', isBootstrap, { signal }),
  locations: (query: string, signal: AbortSignal) =>
    request(`locations?q=${encodeURIComponent(query.trim())}`, isLocationsResponse, { signal }),
  trip: (input: TripInput, csrfToken: string, signal: AbortSignal) =>
    request('trips', isTrip, {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrfToken },
      body: JSON.stringify(input),
    }),
};

export function errorMessage(error: unknown) {
  return error instanceof ApiError ? error.message : 'Something went wrong. Please try again.';
}

export function tomtomTileUrl(key: unknown): string | null {
  if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(key)) return null;
  return `https://api.tomtom.com/map/1/tile/basic/main/{z}/{x}/{y}.png?key=${encodeURIComponent(key)}`;
}
