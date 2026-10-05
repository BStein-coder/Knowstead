import crypto from 'node:crypto';

/**
 * scrypt-Parameter für neue Hashes: N = 2^15 (rund 32 MB Speicher je Prüfung). Ältere Hashes mit
 * N = 2^14 bleiben gültig und werden bei der nächsten erfolgreichen Anmeldung neu berechnet.
 */
const SCRYPT_N = 32768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LEN = 64;
const SCRYPT_MAXMEM = 128 * 1024 * 1024;

/** Passwort-Hash im Format `scrypt$N$r$p$salt$hash` (Base64url). */
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password.normalize('NFKC'), salt, KEY_LEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: SCRYPT_MAXMEM });
  return ['scrypt', SCRYPT_N, SCRYPT_R, SCRYPT_P, salt.toString('base64url'), hash.toString('base64url')].join('$');
}

interface ParsedHash {
  N: number;
  r: number;
  p: number;
  salt: Buffer;
  hash: Buffer;
}

function parseHash(stored: string | null | undefined): ParsedHash | null {
  if (!stored) return null;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return null;
  const [N, r, p] = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
  // Nur plausible Parameter – ein manipulierter Wert dürfte den Server nicht lahmlegen
  if (!Number.isInteger(N) || N < 1024 || N > 1_048_576 || (N & (N - 1)) !== 0 || !Number.isInteger(r) || r < 1 || r > 32 || !Number.isInteger(p) || p < 1 || p > 16) {
    return null;
  }
  return { N, r, p, salt: Buffer.from(parts[4], 'base64url'), hash: Buffer.from(parts[5], 'base64url') };
}

export function verifyPassword(password: string, stored: string | null | undefined): boolean {
  const parsed = parseHash(stored);
  if (!parsed) return false;
  const actual = crypto.scryptSync(password.normalize('NFKC'), parsed.salt, parsed.hash.length, { N: parsed.N, r: parsed.r, p: parsed.p, maxmem: SCRYPT_MAXMEM });
  return actual.length === parsed.hash.length && crypto.timingSafeEqual(actual, parsed.hash);
}

/** Wie `verifyPassword`, rechnet aber im Thread-Pool – blockiert bei vielen Anmeldungen nicht den Server. */
export function verifyPasswordAsync(password: string, stored: string | null | undefined): Promise<boolean> {
  const parsed = parseHash(stored);
  if (!parsed) return Promise.resolve(false);
  return new Promise((resolve) => {
    crypto.scrypt(password.normalize('NFKC'), parsed.salt, parsed.hash.length, { N: parsed.N, r: parsed.r, p: parsed.p, maxmem: SCRYPT_MAXMEM }, (err, actual) => {
      resolve(!err && actual.length === parsed.hash.length && crypto.timingSafeEqual(actual, parsed.hash));
    });
  });
}

/** Wurde der Hash mit schwächeren Parametern berechnet als aktuell üblich? */
export function needsRehash(stored: string | null | undefined): boolean {
  const parsed = parseHash(stored);
  return !!parsed && (parsed.N < SCRYPT_N || parsed.r !== SCRYPT_R || parsed.p !== SCRYPT_P);
}

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function sha256(value: string | Buffer): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function hmacSha256(secret: string | Buffer, value: string): string {
  return crypto.createHmac('sha256', secret).update(value).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

/** Symmetrische Verschlüsselung (AES-256-GCM) für gespeicherte Geheimnisse. */
export function encryptSecret(key: Buffer, plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64url')}:${tag.toString('base64url')}:${enc.toString('base64url')}`;
}

export function decryptSecret(key: Buffer, payload: string | null | undefined): string | null {
  if (!payload) return null;
  const parts = payload.split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') return null;
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(parts[1], 'base64url'));
    decipher.setAuthTag(Buffer.from(parts[2], 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(parts[3], 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}
