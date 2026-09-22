import crypto from 'node:crypto';
import { GeeTestV4Error, solveGeeTestV4 } from './geetest';

const DEFAULT_BASE_URL = 'https://run.gxapp.iydsj.com';
const APP_VERSION = '7.3.40';
const STATIC_SALT = '2slhe02lsfiwowlcixisla_sls-_slaor';
const REQUEST_RSA_PUBLIC_KEY = Buffer.from(
  'MIGJAoGBALmmqVPOwY1mTVHGEfg7jHck1MNXsVtUfrqY99bm/W2cjLi3LvG/wMYwbhmf9O+y3CUlZ5g4AMd2Ly4XbWUloG/O8+1USGJ8ddmrzbl8j2EZi0OhpVCYI381+zZ0qa3z1cOuG2XdJnE7pO6Y4JNC37miqMXYmjejVi2QDIbONomfAgMBAAE=',
  'base64',
);

export type OfficialErrorKind = 'AUTH_FAILED' | 'TOKEN_EXPIRED' | 'VERIFY_REQUIRED' | 'NETWORK_ERROR' | 'API_ERROR' | 'RATE_LIMITED' | 'DATA_PARSE_ERROR' | 'CONFIG_ERROR';

export class OfficialSportWorldError extends Error {
  constructor(public readonly kind: OfficialErrorKind, message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'OfficialSportWorldError';
  }
}

export type OfficialSession = { token: string; uid?: string; unid?: string };
export type OfficialProgress = {
  semester?: string;
  completedRuns?: number;
  completedDistance?: number;
  targetRuns?: number;
  targetDistance?: number;
  status?: string;
  startsAt?: string;
  endsAt?: string;
};
export type OfficialRun = {
  id: string;
  runDate?: string;
  startTime?: string;
  endTime?: string;
  distance: number;
  duration?: number;
  pace?: number;
  status?: string;
  rawStatus?: string;
  isValid: boolean;
  sportType?: string;
  semester?: string;
};

type EnvelopeSession = {
  keyDataOne: string;
  keyDataTwo: string;
  keyDataThree: string;
  keyDataFour: string;
  responseKey: Buffer;
};

type Envelope = { d: string; h: string; k: string; p: '101'; t: '0' };
type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : null;
}

function valueAt(input: unknown, ...keys: string[]): unknown {
  const source = record(input);
  if (!source) return undefined;
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null) return source[key];
  }
  return undefined;
}

function text(input: unknown): string | undefined {
  return input === undefined || input === null ? undefined : String(input);
}

function number(input: unknown): number | undefined {
  const parsed = Number(input);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function dataFrom(payload: unknown): unknown {
  const data = valueAt(payload, 'data');
  if (typeof data !== 'string') return data ?? payload;
  try { return JSON.parse(data); } catch { return data; }
}

function md5(value: string | Buffer): string {
  return crypto.createHash('md5').update(value).digest('hex').toLowerCase();
}

function byteHash(value: Buffer): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (((value[index] | ((hash << 8) >>> 0)) >>> 0) ^ (hash >>> 24)) >>> 0;
  }
  return hash;
}

function deriveResponseKey(one: string, two: string, three: string, four: string): Buffer {
  let state0 = byteHash(Buffer.from(one));
  let state1 = byteHash(Buffer.from(two));
  let state2 = byteHash(Buffer.from(three));
  let state3 = byteHash(Buffer.from(four));
  const first = (state2 ^ state0) >>> 0;
  const firstMix = ((((first >>> 24) | (first << 8)) ^ ((first >>> 8) | (first << 24)) ^ first)) >>> 0;
  state1 = (firstMix ^ state1) >>> 0;
  state3 = (firstMix ^ state3) >>> 0;
  const second = (state3 ^ state1) >>> 0;
  const secondMix = ((((second >>> 24) | (second << 8)) ^ ((second >>> 8) | (second << 24)) ^ second)) >>> 0;
  state0 = (secondMix ^ state0) >>> 0;
  state2 = (secondMix ^ state2) >>> 0;

  let a = ((~(state2 | state3)) ^ state1) >>> 0;
  let b = ((state2 ^ state3) ^ a) >>> 0;
  const c = ((a & state2) ^ state0) >>> 0;
  b = (b ^ c) >>> 0;
  a = ((~(b | c)) ^ a) >>> 0;
  const d = ((a & b) ^ state3) >>> 0;
  const result = Buffer.alloc(16);
  [d, a, b, c].forEach((part, index) => result.writeUInt32LE(part, index * 4));
  return result;
}

function randomPrintable(length: number): string {
  return Array.from({ length }, () => String.fromCharCode(crypto.randomInt(0x21, 0x7e))).join('');
}

function createEnvelopeSession(): EnvelopeSession {
  const source = crypto.randomUUID().replaceAll('-', '') + randomPrintable(16);
  const [keyDataOne, keyDataTwo, keyDataThree, keyDataFour] = [0, 12, 24, 36].map((start) => source.slice(start, start + 12));
  return { keyDataOne, keyDataTwo, keyDataThree, keyDataFour, responseKey: deriveResponseKey(keyDataOne, keyDataTwo, keyDataThree, keyDataFour) };
}

function encryptEnvelope(plaintext: string, session: EnvelopeSession): Envelope {
  const inner = `${JSON.stringify({
    data: Buffer.from(plaintext).toString('base64'),
    keyDataFour: session.keyDataFour,
    keyDataOne: session.keyDataOne,
    keyDataThree: session.keyDataThree,
    keyDataTwo: session.keyDataTwo,
    platform: 2,
    timeStamp: Math.floor(Date.now() / 1000),
  })}\n`;
  const aesKey = Buffer.from(randomPrintable(16));
  const cipher = crypto.createCipheriv('aes-128-cbc', aesKey, Buffer.alloc(16));
  const encrypted = Buffer.concat([cipher.update(inner), cipher.final()]);
  const publicKey = crypto.createPublicKey({ key: REQUEST_RSA_PUBLIC_KEY, format: 'der', type: 'pkcs1' });
  const encryptedKey = crypto.publicEncrypt({ key: publicKey, padding: crypto.constants.RSA_PKCS1_PADDING }, aesKey);
  return { d: encrypted.toString('base64'), h: md5(inner), k: encryptedKey.toString('base64'), p: '101', t: '0' };
}

function decryptEnvelope(payload: JsonRecord, session: EnvelopeSession): unknown {
  if (String(payload.v) !== '101' || typeof payload.r !== 'string') return payload;
  try {
    const decipher = crypto.createDecipheriv('aes-128-cbc', session.responseKey, Buffer.alloc(16));
    const decrypted = Buffer.concat([decipher.update(Buffer.from(payload.r, 'base64')), decipher.final()]);
    const inner = JSON.parse(decrypted.toString('utf8')) as JsonRecord;
    if (typeof inner.data !== 'string') throw new Error('响应缺少 data 字段');
    return JSON.parse(Buffer.from(inner.data, 'base64').toString('utf8'));
  } catch (error) {
    throw new OfficialSportWorldError('DATA_PARSE_ERROR', '运动世界响应解密失败，接口协议可能已更新', error);
  }
}

function tokenSign(timestamp: string, token?: string, uid?: string): string {
  const values = { timeStamp: timestamp, token: token || '', uid: uid || '' };
  const canonical = Object.entries(values).sort(([left], [right]) => left.toLowerCase().localeCompare(right.toLowerCase()) || left.localeCompare(right)).map(([key, value]) => `${key}=${value}`).join('&');
  return md5(canonical + STATIC_SALT);
}

function toIso(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    const milliseconds = numeric < 10_000_000_000 ? numeric * 1000 : numeric;
    const date = new Date(milliseconds);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function metersToKilometers(value: unknown): number | undefined {
  const meters = number(value);
  return meters === undefined ? undefined : Math.round(Math.max(0, meters) / 10) / 100;
}

function businessError(payload: unknown): OfficialSportWorldError | null {
  const errorCode = number(valueAt(payload, 'error', 'code'));
  if (errorCode === undefined || errorCode === 0 || errorCode === 10000) return null;
  const message = String(valueAt(payload, 'message', 'msg', 'errorMsg') || '运动世界接口请求失败');
  if (errorCode === 10003 || errorCode === 10004 || /密码错误|账号.*错误|用户不存在/.test(message)) return new OfficialSportWorldError('AUTH_FAILED', '运动世界账号或密码错误');
  if (errorCode === 18001 || errorCode === 18002 || /验证码|设备|切换|风控|确认|captcha|verify/i.test(message)) return new OfficialSportWorldError('VERIFY_REQUIRED', `运动世界需要在 App 内完成验证：${message}`);
  if (errorCode === 429 || /频繁|限流/.test(message)) return new OfficialSportWorldError('RATE_LIMITED', '运动世界请求过于频繁，请稍后重试');
  if (/token|未登录|登录.*(?:过期|失效)|认证.*(?:过期|失效)/i.test(message)) return new OfficialSportWorldError('TOKEN_EXPIRED', '运动世界登录已过期');
  return new OfficialSportWorldError('API_ERROR', message);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function geetestAttempts(): number {
  const configured = Number(process.env.SPORT_WORLD_GEETEST_MAX_RETRIES || 3);
  return Number.isInteger(configured) ? Math.min(Math.max(configured, 1), 3) : 3;
}

export class OfficialSportWorldClient {
  private readonly baseUrl: string;
  private readonly deviceId: string;
  private readonly envelopeSession = createEnvelopeSession();
  private session: OfficialSession | null = null;
  private cachedSummary: unknown;

  constructor(private readonly account?: string) {
    this.baseUrl = (process.env.SPORT_WORLD_OFFICIAL_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '');
    this.deviceId = crypto.createHash('sha256').update(account || 'runflow-sport-world').digest('hex').slice(0, 32);
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    const timestamp = String(Date.now());
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json;charset=utf-8',
      appVersion: APP_VERSION,
      physicPixel: '1080x2400',
      logicPixel: '393x873',
      isRoot: '0',
      osType: '0',
    };
    if (this.session?.uid) headers.uid = this.session.uid;
    Object.assign(headers, {
      IMEI: '',
      timeStamp: timestamp,
      blMac: '',
      nonce: crypto.randomUUID(),
    });
    if (this.session?.token) headers.token = this.session.token;
    Object.assign(headers, {
      cpuModel: 'arm64-v8a',
      deviceName: 'SM-A5460',
      appInstallTime: '1767225600000',
      androidId: '',
      DeviceId: this.deviceId,
      appUpdateTime: '1767225600000',
      wifiMac: '',
      CustomDeviceId: '',
      osVersion: '15',
      'User-Agent': 'okhttp/4.12.0',
      tokenSign: tokenSign(timestamp, this.session?.token, this.session?.uid),
      ...extra,
    });
    return headers;
  }

  private async request(path: string, body: JsonRecord, extraHeaders?: Record<string, string>, checkBusinessError = true): Promise<unknown> {
    const timeout = Math.max(1000, Number(process.env.SPORT_WORLD_API_TIMEOUT_MS || 15000));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const publicHeaders = this.headers(extraHeaders);
      const headers = { ...publicHeaders, headerSign: JSON.stringify(encryptEnvelope(JSON.stringify(publicHeaders), this.envelopeSession)) };
      const response = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(encryptEnvelope(JSON.stringify(body), this.envelopeSession)),
        cache: 'no-store',
        signal: controller.signal,
      });
      const raw = await response.text();
      let wire: unknown;
      try { wire = raw ? JSON.parse(raw) : {}; } catch { throw new OfficialSportWorldError('DATA_PARSE_ERROR', '运动世界返回了无法识别的数据'); }
      if (!response.ok) {
        if (response.status === 429) throw new OfficialSportWorldError('RATE_LIMITED', '运动世界请求过于频繁，请稍后重试');
        if (response.status === 401 || response.status === 403) throw new OfficialSportWorldError('TOKEN_EXPIRED', '运动世界登录已过期');
        throw new OfficialSportWorldError('API_ERROR', `运动世界接口请求失败（HTTP ${response.status}）`);
      }
      const payload = decryptEnvelope(record(wire) || {}, this.envelopeSession);
      if (checkBusinessError) {
        const error = businessError(payload);
        if (error) throw error;
      }
      return payload;
    } catch (error) {
      if (error instanceof OfficialSportWorldError) throw error;
      const message = error instanceof Error && error.name === 'AbortError' ? '运动世界接口请求超时' : '运动世界网络连接失败';
      throw new OfficialSportWorldError('NETWORK_ERROR', message, error);
    } finally {
      clearTimeout(timer);
    }
  }

  private async completeGeeTest(account: string, loginId: string): Promise<void> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= geetestAttempts(); attempt += 1) {
      try {
        const validation = await solveGeeTestV4();
        const payload = await this.request('/api/v70270/security/geevalidate', {
          lotNumber: validation.lotNumber,
          captchaOutput: validation.captchaOutput,
          passToken: validation.passToken,
          genTime: validation.genTime,
          isOffline: false,
          osType: 0,
          businessType: 0,
          uuid: loginId,
          username: account,
        }, undefined, false);
        const errorCode = number(valueAt(payload, 'error', 'code'));
        if (errorCode === 10000 || errorCode === 0) {
          await delay(2_000);
          return;
        }
        if (errorCode !== 10003) {
          const error = businessError(payload);
          if (error) throw error;
          throw new OfficialSportWorldError('API_ERROR', '运动世界安全验证接口返回异常');
        }
        lastError = new OfficialSportWorldError('VERIFY_REQUIRED', '运动世界安全验证结果未被接受');
      } catch (error) {
        if (error instanceof GeeTestV4Error) {
          if (error.code === 'CONFIG_ERROR') throw new OfficialSportWorldError('CONFIG_ERROR', error.message, error);
          lastError = error;
        } else if (error instanceof OfficialSportWorldError) {
          if (!['NETWORK_ERROR', 'VERIFY_REQUIRED'].includes(error.kind)) throw error;
          lastError = error;
        } else {
          lastError = error;
        }
      }
      if (attempt < geetestAttempts()) await delay(500 + crypto.randomInt(0, 501));
    }
    throw new OfficialSportWorldError('VERIFY_REQUIRED', '运动世界安全验证未通过，请稍后重试', lastError);
  }

  async login(account: string, password: string): Promise<OfficialSession> {
    const loginId = crypto.randomUUID();
    const check = await this.request('/api/v65/security/checkGeeUse', { username: account, uuid: loginId, unid: 0, type: 2 });
    if (dataFrom(check) !== true) {
      await this.completeGeeTest(account, loginId);
    }
    const authorization = `Basic ${Buffer.from(`${account}:${password}`).toString('base64')}`;
    const payload = await this.request('/api/v70100/login', { loginType: 1, device_model: 'SM-A5460', os_version: '15', uuid: loginId }, { Authorization: authorization });
    const data = dataFrom(payload);
    const token = text(valueAt(data, 'token'));
    if (!token) throw new OfficialSportWorldError('AUTH_FAILED', '运动世界账号或密码错误');
    this.session = { token, uid: text(valueAt(data, 'uid')), unid: text(valueAt(data, 'unid')) };
    return this.session;
  }

  async validateToken(session: OfficialSession): Promise<boolean> {
    this.session = session;
    try {
      this.cachedSummary = await this.request('/api/v55/runnings/recordssummary/semester', { sid: 0 });
      return true;
    } catch (error) {
      if (error instanceof OfficialSportWorldError && ['TOKEN_EXPIRED', 'AUTH_FAILED'].includes(error.kind)) return false;
      throw error;
    }
  }

  async getSemesterProgress(session: OfficialSession): Promise<OfficialProgress> {
    this.session = session;
    const summaryPayload = this.cachedSummary ?? await this.request('/api/v55/runnings/recordssummary/semester', { sid: 0 });
    this.cachedSummary = undefined;
    const summary = dataFrom(summaryPayload);
    let personal: unknown;
    try {
      personal = dataFrom(await this.request('/api/v41/running/getPersonalSemesterInfo', { runMode: 1 }));
    } catch (error) {
      if (error instanceof OfficialSportWorldError && ['TOKEN_EXPIRED', 'AUTH_FAILED', 'VERIFY_REQUIRED'].includes(error.kind)) throw error;
    }
    const completedRuns = number(valueAt(summary, 'semesterValidCount')) ?? number(valueAt(personal, 'semesterValid', 'semesterValidCount'));
    return {
      semester: text(valueAt(summary, 'sname', 'semesterName')) || text(valueAt(personal, 'sname', 'semesterName')),
      completedRuns,
      completedDistance: metersToKilometers(valueAt(summary, 'semesterValidDis', 'semesterDis')),
      targetRuns: number(valueAt(personal, 'semesterGoalCount', 'targetCount', 'goalCount')),
      targetDistance: metersToKilometers(valueAt(personal, 'semesterGoalDis', 'targetDistance')),
      status: text(valueAt(personal, 'statusInfo', 'status', 'completionStatus')),
      startsAt: toIso(valueAt(personal, 'startTime', 'semesterStartTime', 'semesterStart')),
      endsAt: toIso(valueAt(personal, 'endTime', 'semesterEndTime', 'semesterEnd')),
    };
  }

  async getRunHistory(session: OfficialSession, page: number, pageSize: number, semester?: string): Promise<{ records: OfficialRun[]; hasMore: boolean }> {
    this.session = session;
    const payload = await this.request('/api/v70230/runnings/records', { pageNum: page, pageSize, sid: 0, type: 1 });
    const data = dataFrom(payload);
    const source = Array.isArray(data) ? data : valueAt(data, 'list', 'records', 'rows', 'items');
    if (!Array.isArray(source)) throw new OfficialSportWorldError('DATA_PARSE_ERROR', '运动世界跑步记录格式无法识别');
    const records = source.map((item): OfficialRun | null => {
      const row = record(item);
      if (!row) return null;
      const distance = metersToKilometers(valueAt(row, 'totalDis', 'validDis')) ?? 0;
      const duration = number(valueAt(row, 'totalTime', 'validTime'));
      const startTime = toIso(valueAt(row, 'startTime', 'sportDate'));
      const rawStatus = text(valueAt(row, 'statusInfo', 'status'));
      const complete = valueAt(row, 'complete');
      const isValid = complete === true || complete === 1 || /有效|达标|完成|valid|complete/i.test(rawStatus || '');
      const id = text(valueAt(row, 'rrid', 'id', 'recordId', 'uuid')) || crypto.createHash('sha256').update(`${startTime || ''}|${distance}`).digest('hex');
      return {
        id,
        runDate: startTime?.slice(0, 10),
        startTime,
        endTime: toIso(valueAt(row, 'endTime')),
        distance,
        duration,
        pace: duration && distance > 0 ? Math.round(duration / distance) : undefined,
        status: rawStatus || (isValid ? '有效' : '未达标'),
        rawStatus,
        isValid,
        sportType: text(valueAt(row, 'sportType', 'type')),
        semester,
      };
    }).filter((item): item is OfficialRun => Boolean(item));
    const total = number(valueAt(data, 'total', 'totalCount', 'count'));
    const explicit = valueAt(data, 'hasMore', 'has_more', 'more');
    const hasMore = explicit === true || (explicit === undefined && (total !== undefined ? page * pageSize < total : records.length >= pageSize));
    return { records, hasMore };
  }
}

export const officialProtocolInternals = { deriveResponseKey, dataFrom, metersToKilometers, toIso };
