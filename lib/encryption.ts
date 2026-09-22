import crypto from 'node:crypto';

function deriveKey(secret: string) {
  return crypto.createHash('sha256').update(secret).digest();
}

function encryptWithKey(value: string, secret: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveKey(secret), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return `${iv.toString('base64')}.${cipher.getAuthTag().toString('base64')}.${encrypted.toString('base64')}`;
}

function decryptWithKey(value: string, secret: string) {
  const [iv, tag, data] = value.split('.');
  if (!iv || !tag || !data) throw new Error('密文格式无效');
  const decipher = crypto.createDecipheriv('aes-256-gcm', deriveKey(secret), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
}

// Existing account passwords use the historical service-role-derived key.
export function encryptSecret(value: string) {
  return encryptWithKey(value, process.env.SUPABASE_SERVICE_ROLE_KEY || 'change-me-in-production');
}

export function decryptSecret(value: string) {
  return decryptWithKey(value, process.env.SUPABASE_SERVICE_ROLE_KEY || 'change-me-in-production');
}

function sportCredentialKey() {
  const secret = process.env.SPORT_WORLD_CREDENTIAL_KEY;
  if (!secret && process.env.NODE_ENV === 'production') {
    throw new Error('SPORT_WORLD_CREDENTIAL_KEY 未配置');
  }
  return secret || process.env.SUPABASE_SERVICE_ROLE_KEY || 'change-me-in-production';
}

export function encryptSportSecret(value: string) {
  return encryptWithKey(value, sportCredentialKey());
}

export function decryptSportSecret(value: string) {
  return decryptWithKey(value, sportCredentialKey());
}
