/**
 * Client-side cryptography.
 *
 * The password never leaves the browser: the server stores only the ciphertext
 * and the parameters needed to decrypt it. AES-256-GCM gives us authenticated
 * encryption, so a wrong password shows up as a failed authentication tag
 * rather than as garbage plaintext.
 */

const PBKDF2_ITERATIONS = 600_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const KEY_BITS = 256;

/**
 * @typedef {object} EncryptedPayload
 * @property {string} cipher Base64 AES-256-GCM ciphertext (with auth tag).
 * @property {string} salt   Base64 PBKDF2 salt.
 * @property {string} iv     Base64 AES-GCM initialisation vector.
 */

export class DecryptError extends Error {
  constructor(message = 'Не удалось расшифровать заметку') {
    super(message);
    this.name = 'DecryptError';
  }
}

/** @returns {Crypto} */
function getCrypto() {
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    // WebCrypto is restricted to secure contexts; localhost counts as one.
    throw new Error('WebCrypto недоступен. Откройте страницу по HTTPS или на localhost.');
  }

  return crypto;
}

/**
 * Derive a 256-bit AES-GCM key from a password and salt.
 *
 * @param {string} password
 * @param {BufferSource} salt
 * @returns {Promise<CryptoKey>}
 */
async function deriveKey(password, salt) {
  const subtle = getCrypto().subtle;

  const material = await subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  );

  return subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    material,
    { name: 'AES-GCM', length: KEY_BITS },
    false,
    ['encrypt', 'decrypt'],
  );
}

/**
 * Encrypt UTF-8 text, producing fresh random salt and IV on every call.
 *
 * @param {string} text
 * @param {string} password
 * @returns {Promise<EncryptedPayload>}
 */
export async function encryptText(text, password) {
  const subtle = getCrypto().subtle;
  const salt = getCrypto().getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = getCrypto().getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(password, salt);

  const cipherBuffer = await subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(text),
  );

  return {
    cipher: toBase64(new Uint8Array(cipherBuffer)),
    salt: toBase64(salt),
    iv: toBase64(iv),
  };
}

/**
 * Decrypt a payload. Throws {@link DecryptError} on a wrong password.
 *
 * @param {EncryptedPayload} payload
 * @param {string} password
 * @returns {Promise<string>}
 */
export async function decryptText(payload, password) {
  const subtle = getCrypto().subtle;

  const salt = fromBase64(payload.salt);
  const iv = fromBase64(payload.iv);
  const cipher = fromBase64(payload.cipher);
  const key = await deriveKey(password, salt);

  try {
    const plainBuffer = await subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher);
    return new TextDecoder().decode(plainBuffer);
  } catch {
    // AES-GCM cannot tell a wrong key from a tampered payload, so report the
    // failure in terms the user can act on.
    throw new DecryptError('Неверный пароль или заметка повреждена');
  }
}

/**
 * @param {Uint8Array} bytes
 * @returns {string}
 */
function toBase64(bytes) {
  let binary = '';

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}

/**
 * @param {string} value
 * @returns {Uint8Array}
 */
function fromBase64(value) {
  let binary;

  try {
    binary = atob(value);
  } catch {
    throw new DecryptError('Повреждённые данные заметки');
  }

  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}
