import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const dataDir = process.env.PW_DATA_DIR ? path.resolve(process.env.PW_DATA_DIR) : path.resolve(process.cwd(), 'data');
const secretPath = path.join(dataDir, '.secret');

function loadSecret(): Buffer {
  fs.mkdirSync(dataDir, { recursive: true });
  try {
    return Buffer.from(fs.readFileSync(secretPath, 'utf8').trim(), 'base64');
  } catch {
    const secret = crypto.randomBytes(32);
    fs.writeFileSync(secretPath, secret.toString('base64'), { mode: 0o600 });
    return secret;
  }
}

const secret = loadSecret();

export function encryptSecret(value: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', secret, iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${encrypted.toString('base64url')}`;
}

export function decryptSecret(payload: string | null | undefined): string {
  if (!payload) return '';
  try {
    const [version, ivB64, tagB64, dataB64] = payload.split('.');
    if (version !== 'v1') return '';
    const decipher = crypto.createDecipheriv('aes-256-gcm', secret, Buffer.from(ivB64, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    return '';
  }
}

export function maskSecret(value: string): string {
  if (!value) return '';
  if (value.length <= 8) return '••••••••';
  return `••••••••${value.slice(-4)}`;
}
