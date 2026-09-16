// Compatibility fallback for browsers/PWA runtimes where a cross-origin
// Authorization request is rejected before an HTTP response is exposed.
//
// The Cloud Worker already supports ?token= authentication. Keep Bearer auth
// as the primary path, and only retry idempotent GET requests after fetch()
// itself rejects (CORS/preflight/DNS/transport class failure). This avoids
// changing normal auth semantics while giving affected PWA runtimes a
// no-custom-header fallback path.

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

function isPromptVaultCloudUrl(url) {
  return url.pathname === '/api/prompt-vault' || url.pathname.startsWith('/api/prompt-vault/');
}

async function fetchWithCloudGetFallback(input, init) {
  try {
    return await nativeFetch(input, init);
  } catch (primaryError) {
    const method = requestMethod(input, init);
    if (method !== 'GET') throw primaryError;

    const headers = mergedHeaders(input, init);
    const token = getBearer(headers);
    if (!token) throw primaryError;

    let url;
    try {
      url = requestUrl(input);
    } catch {
      throw primaryError;
    }
    if (!isPromptVaultCloudUrl(url)) throw primaryError;

    // Remove the non-safelisted Authorization header so the retry can be a
    // simple GET. The server-side auth middleware already accepts ?token=.
    headers.delete('Authorization');
    url.searchParams.set('token', token);

    const retryInit = {
      ...init,
      method: 'GET',
      headers,
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    };

    return nativeFetch(url.toString(), retryInit);
  }
}

globalThis.fetch = fetchWithCloudGetFallback;
