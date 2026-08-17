export const ErrorCode = {
  API_AUTH_FAILED: 'API_AUTH_FAILED',
  API_RATE_LIMITED: 'API_RATE_LIMITED',
  API_NETWORK: 'API_NETWORK',
  FS_WRITE_FAILED: 'FS_WRITE_FAILED',
  FS_NOT_FOUND: 'FS_NOT_FOUND',
  FS_PERMISSION: 'FS_PERMISSION',
  VAL_INVALID_PARAM: 'VAL_INVALID_PARAM',
  VAL_MISSING_FIELD: 'VAL_MISSING_FIELD',
};

export function createError(code, message, detail) {
  return { code, message, detail, ts: new Date().toISOString() };
}
