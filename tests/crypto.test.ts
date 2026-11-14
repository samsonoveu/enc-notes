import { describe, expect, it } from 'vitest';

/**
 * The browser crypto module is plain JavaScript so it ships to the browser
 * without a build step. It is loaded here at runtime; Node 22 provides the
 * WebCrypto globals it depends on, so the real shipped file is exercised.
 */
type EncryptedPayload = {
  readonly cipher: string;
  readonly salt: string;
  readonly iv: string;
};

type CryptoModule = {
  readonly encryptText: (text: string, password: string) => Promise<EncryptedPayload>;
  readonly decryptText: (payload: EncryptedPayload, password: string) => Promise<string>;
  readonly DecryptError: new (...args: never[]) => Error;
};

const cryptoModule = (await import(
  /* @vite-ignore */ new URL('../public/crypto.js', import.meta.url).href
)) as CryptoModule;

const { encryptText, decryptText, DecryptError } = cryptoModule;

describe('web crypto', () => {
  const PASSWORD = 'правильный пароль';
  const TEXT = 'Секретный текст.\nВторая строка — с юникодом: 🔐 Ω ✓';

  it('round-trips text through encrypt and decrypt', async () => {
    const payload = await encryptText(TEXT, PASSWORD);
    const decrypted = await decryptText(payload, PASSWORD);

    expect(decrypted).toBe(TEXT);
  });

  it('produces base64 fields of the expected sizes', async () => {
    const payload = await encryptText(TEXT, PASSWORD);

    expect(payload.salt).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    expect(payload.iv).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    // 16-byte salt and 12-byte IV encode to 24 and 16 base64 chars.
    expect(payload.salt).toHaveLength(24);
    expect(payload.iv).toHaveLength(16);
  });

  it('uses a fresh salt and iv on every call', async () => {
    const first = await encryptText(TEXT, PASSWORD);
    const second = await encryptText(TEXT, PASSWORD);

    expect(first.salt).not.toBe(second.salt);
    expect(first.iv).not.toBe(second.iv);
    expect(first.cipher).not.toBe(second.cipher);
  });

  it('rejects a wrong password', async () => {
    const payload = await encryptText(TEXT, PASSWORD);

    await expect(decryptText(payload, 'неверный пароль')).rejects.toBeInstanceOf(DecryptError);
  });

  it('rejects a tampered ciphertext', async () => {
    const payload = await encryptText(TEXT, PASSWORD);
    const tampered = { ...payload, cipher: `${payload.cipher.slice(0, -4)}AAAA` };

    await expect(decryptText(tampered, PASSWORD)).rejects.toBeInstanceOf(DecryptError);
  });

  it('rejects corrupt base64', async () => {
    const payload = await encryptText(TEXT, PASSWORD);
    const broken = { ...payload, salt: '!!!not-base64!!!' };

    await expect(decryptText(broken, PASSWORD)).rejects.toBeInstanceOf(DecryptError);
  });

  it('handles an empty note body', async () => {
    const payload = await encryptText('', PASSWORD);

    await expect(decryptText(payload, PASSWORD)).resolves.toBe('');
  });

  it('handles a long unicode body', async () => {
    const long = 'строка 🔐 '.repeat(5_000);
    const payload = await encryptText(long, PASSWORD);

    expect(await decryptText(payload, PASSWORD)).toBe(long);
  });
});
