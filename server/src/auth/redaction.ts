/**
 * ZIMBI Hard Redaction Layer
 *
 * Automatically redacts secret keys, bearer tokens, API credentials,
 * and ciphertexts from logs, error messages, and responses.
 */

const SECRET_PATTERNS = [
  /sk_test_[a-zA-Z0-9_-]+/g,
  /sk_live_[a-zA-Z0-9_-]+/g,
  /zmb_test_[a-zA-Z0-9_-]+/g,
  /zmb_live_[a-zA-Z0-9_-]+/g,
  /Bearer\s+[a-zA-Z0-9_.-]+/gi,
  /postgres(ql)?:\/\/[^@]+@/gi,
];

const SENSITIVE_KEYS = new Set([
  'secretkey',
  'secret_key',
  'paystack_secret_key',
  'credential_ciphertext',
  'credentialciphertext',
  'ciphertext',
  'apikey',
  'api_key',
  'key_hash',
  'keyhash',
  'password',
  'authorization',
]);

/**
 * Redacts secrets from a string.
 */
export function redactString(str: string): string {
  if (!str || typeof str !== 'string') return str;
  let redacted = str;

  // Mask Paystack and ZIMBI keys
  redacted = redacted.replace(/sk_test_[a-zA-Z0-9_-]+/g, 'sk_test_***');
  redacted = redacted.replace(/sk_live_[a-zA-Z0-9_-]+/g, 'sk_live_***');
  redacted = redacted.replace(/zmb_test_[a-zA-Z0-9_-]+/g, 'zmb_test_***');
  redacted = redacted.replace(/zmb_live_[a-zA-Z0-9_-]+/g, 'zmb_live_***');
  redacted = redacted.replace(/Bearer\s+[^\s"']+/gi, 'Bearer ***');
  redacted = redacted.replace(/postgres(ql)?:\/\/[^@]+@/gi, 'postgresql://***:***@');

  return redacted;
}

/**
 * Deeply redacts secrets from any data structure (objects, arrays, strings, errors).
 */
export function redactSecrets<T>(data: T): T {
  if (data === null || data === undefined) {
    return data;
  }

  if (typeof data === 'string') {
    return redactString(data) as unknown as T;
  }

  if (data instanceof Error) {
    const clonedError = new Error(redactString(data.message));
    clonedError.name = data.name;
    if (data.stack) {
      clonedError.stack = redactString(data.stack);
    }
    return clonedError as unknown as T;
  }

  if (Array.isArray(data)) {
    return data.map((item) => redactSecrets(item)) as unknown as T;
  }

  if (typeof data === 'object') {
    const result: Record<string, any> = {};
    for (const [key, value] of Object.entries(data)) {
      const lowerKey = key.toLowerCase();
      if (SENSITIVE_KEYS.has(lowerKey)) {
        result[key] = '[REDACTED]';
      } else {
        result[key] = redactSecrets(value);
      }
    }
    return result as T;
  }

  return data;
}
