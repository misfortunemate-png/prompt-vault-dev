// Compatibility path for affected PWA runtimes where a cross-origin GET with
// Authorization rejects at the Fetch API layer before an HTTP response is
// exposed. Keep Bearer as the primary path and retry only the configured
// Prompt Vault Cloud GET after a TypeError.
//
// The production Worker already accepts ?token= and that path was verified
// independently in #56. Long-lived query-token exposure is tracked in #61;
// this compatibility path is intentionally narrow and should not spread to
// writes or unrelated hosts.

import { getConnection } from './connection.js';

const nativeFetch = globalThis.fetch.bind(globalThis);

function mergedHeaders(input, init) {
  const headers = new Headers(input instanceof Request ? input.headers : undefined);
  if (init?.headers) {
    new Headers(init.headers).forEach((value, key) => headers.set(key, value));
  }
  return headers;
}

function requestMethod(input, init) {
  return String(init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
}

function requestUrl(input) {
  return new URL(input instanceof Request ? input.url : String(input), globalThis.location?.href);
}

function getBearer(headers) {
  const auth = headers.get('Authorization') || '';
  return auth.startsWith('Bearer ') ? auth.slice(7) : '';
}

function isConfiguredPromptVaultCloudUrl(url) {
  const { cloudUrl } = getConnection();
  if (!cloudUrl) return false;
  try {
    const base = new URL(cloudUrl);
    const basePath = base.pathname.replace(/\/+$/, '');
    return url.protocol === 'https:' &&
      url.origin === base.origin &&
      (url.pathname === basePath || url.pathname.startsWith(`${basePath}/`));
  } catch {
    return false;
  }
}

function requestSignal(input, init) {
  return init?.signal || (input instanceof Request ? input.signal : null);
}

async function fetchWithCloudGetFallback(input, init) {
  try {
    return await nativeFetch(input, init);
  } catch (primaryError) {
    // Browser fetch/network failures are TypeError. Do not reinterpret aborts
    // or arbitrary application exceptions as a compatibility case.
    if (primaryError?.name !== 'TypeError') throw primaryError;
    if (requestSignal(input, init)?.aborted) throw primaryError;
    if (requestMethod(input, init) !== 'GET') throw primaryError;

    const headers = mergedHeaders(input, init);
    const token = getBearer(headers);
    if (!token) throw primaryError;

    let url;
    try {
      url = requestUrl(input);
    } catch {
      throw primaryError;
    }
    if (!isConfiguredPromptVaultCloudUrl(url)) throw primaryError;

    // Remove all non-safelisted auth/read headers so the retry is a simple GET
    // and does not repeat the failing Authorization preflight path.
    headers.delete('Authorization');
    headers.delete('Content-Type');
    url.searchParams.set('token', token);

    const retryInit = {
      ...init,
      method: 'GET',
      headers,
      cache: 'no-store',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    };

    return nativeFetch(url.toString(), retryInit);
  }
}

globalThis.fetch = fetchWithCloudGetFallback;
